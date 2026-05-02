import type { ParticipantRole } from "@cacp/protocol";

/**
 * Minimal structural shape consumed by `OrbitRoomState.replayFor`. The full
 * `StoredParticipant` from event-store carries DB metadata that this module
 * does not need; accepting only `{ id, role }` keeps orbit-state free of an
 * event-store import and lets unit tests pass plain object literals without
 * fabricating token hashes / connection statuses. Real call sites pass a
 * `StoredParticipant`, which is structurally compatible.
 */
export interface OrbitReplayParticipant {
  id: string;
  role: ParticipantRole;
}

/**
 * Hard cap for the number of notes returned by `replayFor`.
 *
 * The synthetic catch-up stream is bounded so a long-running discussion with
 * thousands of notes cannot blow up handshake latency or socket buffers. We
 * keep the most recent N entries (sorted ascending so the client still
 * receives them in chronological order) — older notes are simply dropped
 * from replay. Since orbit events are live-only (not persisted), truncated
 * history is unrecoverable; orbit is an ephemeral side-channel, not durable
 * state.
 */
export const MAX_REPLAY_NOTES = 200;

export const MAX_PROMOTION_NOTES = 50;
export const MAX_PROMOTION_BYTES = 8192;
export const MAX_PROMOTION_NOTE_TEXT = 500;

export interface SyntheticOrbitEvent {
  type: "orbit.note.created" | "orbit.like.changed" | "orbit.notes.quoted";
  actor_id: string;
  payload: Record<string, unknown>;
}

export interface OrbitNote {
  note_id: string;
  author_id: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface OrbitPromotionPayload {
  text: string;
  noteCount: number;
  noteIds: string[];
}

export class OrbitRoomState {
  private notes = new Map<string, OrbitNote>();
  private likes = new Map<string, boolean>();
  private quotedNoteIds = new Set<string>();

  constructor(_roomId: string) {}

  addNote(note: OrbitNote): OrbitNote {
    this.notes.set(note.note_id, note);
    return note;
  }

  getAllNotes(): OrbitNote[] {
    return [...this.notes.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  getNote(noteId: string): OrbitNote | undefined {
    return this.notes.get(noteId);
  }

  setLike(noteId: string, participantId: string, liked: boolean): { liked: boolean; count: number } {
    const key = `${noteId}:${participantId}`;
    const note = this.notes.get(noteId);
    if (!note) return { liked: false, count: 0 };
    if (note.author_id === participantId) return { liked: false, count: this.getLikeCount(noteId) };
    if (liked) {
      this.likes.set(key, true);
    } else {
      this.likes.delete(key);
    }
    return { liked, count: this.getLikeCount(noteId) };
  }

  getLikeCount(noteId: string): number {
    let count = 0;
    for (const [key] of this.likes) {
      if (key.startsWith(`${noteId}:`)) count++;
    }
    return count;
  }

  hasParticipantLiked(noteId: string, participantId: string): boolean {
    return this.likes.has(`${noteId}:${participantId}`);
  }

  /**
   * Mark the given note ids as quoted (already promoted into the main thread).
   * Returns the subset of ids that were freshly marked — ids that don't exist
   * in `this.notes` or that are already in `quotedNoteIds` are skipped. The
   * caller broadcasts an `orbit.notes.quoted` event using only the freshly
   * marked ids so clients don't double-count.
   *
   * Invariant: any id added to `quotedNoteIds` is guaranteed to exist in
   * `this.notes` (the `!this.notes.has(id)` guard above enforces this, and
   * there is no `removeNote` API). `replayFor` relies on this invariant.
   */
  markQuoted(noteIds: string[]): string[] {
    const fresh: string[] = [];
    for (const id of noteIds) {
      if (!this.notes.has(id)) continue;
      if (this.quotedNoteIds.has(id)) continue;
      this.quotedNoteIds.add(id);
      fresh.push(id);
    }
    return fresh;
  }

  isQuoted(noteId: string): boolean {
    return this.quotedNoteIds.has(noteId);
  }

  reset(): void {
    this.notes.clear();
    this.likes.clear();
    this.quotedNoteIds.clear();
  }

  /**
   * Build the `<CACP_ORBIT_DISCUSSION>` payload that gets injected as a
   * Send-to-Agent main input when a human promotes orbit notes into the
   * main thread. The returned `noteIds` mirror exactly the lines that
   * survived both the per-note caps and the byte-cap, so the caller can
   * `markQuoted(payload.noteIds)` and only mark what actually got promoted.
   */
  buildPromotionPayload(selectedNoteIds: string[]): OrbitPromotionPayload | null {
    const allNotes = this.getAllNotes();
    const requested = new Set(selectedNoteIds);
    let selected = allNotes.filter((n) => requested.has(n.note_id) && !this.quotedNoteIds.has(n.note_id));
    if (selected.length === 0) return null;

    if (selected.length > MAX_PROMOTION_NOTES) {
      // Keep the earliest 50 to anchor the discussion start; replayFor uses a
      // different policy (keep most recent) for active-room reconnect.
      selected = selected.slice(0, MAX_PROMOTION_NOTES);
    }

    const lines = selected.map((note, index) => {
      const count = this.getLikeCount(note.note_id);
      let safeText = this.escapeOrbitDiscussionText(note.text);
      if (safeText.length > MAX_PROMOTION_NOTE_TEXT) {
        safeText = safeText.slice(0, MAX_PROMOTION_NOTE_TEXT) + " [truncated]";
      }
      return `${index + 1}. ${note.author_name} (+${count}): ${safeText}`;
    });

    // Track each line's source note id in lockstep with `lines`, so when the
    // byte-cap loop pops the trailing line we also drop the corresponding id
    // from `noteIds`.
    const survivingIds = selected.map((note) => note.note_id);

    const encoder = new TextEncoder();
    let inner = lines.join("\n");
    let text = `<CACP_ORBIT_DISCUSSION>\n${inner}\n</CACP_ORBIT_DISCUSSION>`;

    while (encoder.encode(text).length > MAX_PROMOTION_BYTES && lines.length > 0) {
      lines.pop();
      survivingIds.pop();
      inner = lines.join("\n");
      text = `<CACP_ORBIT_DISCUSSION>\n${inner}\n[truncated]\n</CACP_ORBIT_DISCUSSION>`;
    }

    // Defensive: guarantees we never emit an empty discussion block if future
    // limit changes make all-popped possible.
    if (lines.length === 0) return null;

    return { text, noteCount: lines.length, noteIds: survivingIds };
  }

  escapeOrbitDiscussionText(text: string): string {
    return text
      .replace(/<CACP_ORBIT_DISCUSSION>/gi, "[CACP_ORBIT_DISCUSSION_OPEN]")
      .replace(/<\/CACP_ORBIT_DISCUSSION>/gi, "[CACP_ORBIT_DISCUSSION_CLOSE]");
  }

  /**
   * Build a bounded synthetic catch-up stream for a reconnecting participant.
   *
   * Orbit events are live-only (never persisted to the durable event log),
   * so without this method a refreshing client would see an empty orbit
   * panel after the WS handshake replay finishes. We cap notes at
   * `MAX_REPLAY_NOTES`, keeping the most recent entries.
   *
   * The primary human-vs-agent gate lives at the call site in `server.ts`
   * (the `HUMAN_ROLES.includes(participant.role)` check before invoking
   * `replayFor`). The early `role === "agent"` short-circuit here is a
   * secondary defense so any future caller that forgets the outer gate
   * still cannot leak orbit state to agents.
   *
   * Order:
   *   1. orbit.note.created (chronological)
   *   2. orbit.like.changed — one per note that has at least one like, with
   *      `participant_id` and `liked` reflecting the **reconnecting** user's
   *      personal state, and `likes` carrying the canonical total.
   *   3. orbit.notes.quoted — at most one event listing all currently quoted
   *      note ids, omitted entirely when nothing has been quoted.
   */
  replayFor(participant: OrbitReplayParticipant): SyntheticOrbitEvent[] {
    if (participant.role === "agent") return [];

    const allNotes = this.getAllNotes();
    if (allNotes.length === 0 && this.quotedNoteIds.size === 0) return [];

    const notes = allNotes.length > MAX_REPLAY_NOTES
      ? allNotes.slice(-MAX_REPLAY_NOTES)
      : allNotes;

    const out: SyntheticOrbitEvent[] = [];

    for (const note of notes) {
      out.push({
        type: "orbit.note.created",
        actor_id: note.author_id,
        payload: {
          note_id: note.note_id,
          author_id: note.author_id,
          author_name: note.author_name,
          text: note.text,
          created_at: note.created_at
        }
      });
    }

    for (const note of notes) {
      const total = this.getLikeCount(note.note_id);
      if (total <= 0) continue;
      out.push({
        type: "orbit.like.changed",
        actor_id: participant.id,
        payload: {
          note_id: note.note_id,
          participant_id: participant.id,
          liked: this.hasParticipantLiked(note.note_id, participant.id),
          likes: total
        }
      });
    }

    if (this.quotedNoteIds.size > 0) {
      // `markQuoted` only adds ids that exist in `this.notes`, and there is
      // no removeNote API — so every id in `quotedNoteIds` is guaranteed
      // valid. No filter needed.
      const noteIds = [...this.quotedNoteIds];
      out.push({
        type: "orbit.notes.quoted",
        actor_id: participant.id,
        payload: { note_ids: noteIds }
      });
    }

    return out;
  }
}
