import type { StoredParticipant } from "./event-store.js";

/**
 * Hard cap for the number of notes returned per round by `replayFor`.
 *
 * Spec §6 ("bounded active-room replay for refresh/reconnect") requires the
 * synthetic catch-up stream to be bounded so a long-running round with
 * thousands of notes cannot blow up handshake latency or socket buffers. We
 * keep the most recent N entries (sorted ascending so the client still
 * receives them in chronological order) — older notes are simply dropped
 * from replay. Since orbit events are now live-only (T2: not persisted),
 * truncated history is unrecoverable, but spec §6 explicitly accepts that
 * trade-off: orbit is an ephemeral side-channel, not durable state.
 */
export const MAX_REPLAY_NOTES_PER_ROUND = 200;

export interface SyntheticOrbitEvent {
  type: "orbit.round.opened" | "orbit.note.created" | "orbit.like.changed" | "orbit.round.promoted";
  actor_id: string;
  payload: Record<string, unknown>;
}

export interface OrbitNote {
  note_id: string;
  round_id: string;
  author_id: string;
  author_name: string;
  text: string;
  created_at: string;
}

export interface OrbitRound {
  round_id: string;
  opened_at: string;
  triggered_by_turn_id?: string;
  promoted_at?: string;
  promoted_by?: string;
  input_id?: string;
}

export class OrbitRoomState {
  private rounds = new Map<string, OrbitRound>();
  private notes = new Map<string, OrbitNote>();
  private likes = new Map<string, boolean>();
  private currentRoundId: string;

  constructor(roomId: string) {
    this.currentRoundId = `orbit_round_pre_${roomId}`;
    this.rounds.set(this.currentRoundId, {
      round_id: this.currentRoundId,
      opened_at: new Date().toISOString()
    });
  }

  getCurrentRoundId(): string {
    return this.currentRoundId;
  }

  openTurnRound(turnId: string): OrbitRound {
    const roundId = `orbit_round_turn_${turnId}`;
    const round: OrbitRound = {
      round_id: roundId,
      triggered_by_turn_id: turnId,
      opened_at: new Date().toISOString()
    };
    this.rounds.set(roundId, round);
    this.currentRoundId = roundId;
    return round;
  }

  addNote(note: OrbitNote): OrbitNote {
    this.notes.set(note.note_id, note);
    return note;
  }

  setLike(noteId: string, participantId: string, liked: boolean): { liked: boolean; count: number } {
    const key = `${noteId}:${participantId}`;
    const note = this.notes.get(noteId);
    if (!note) return { liked: false, count: 0 };
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

  getNotesForRound(roundId: string): OrbitNote[] {
    return [...this.notes.values()]
      .filter((note) => note.round_id === roundId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  getNote(noteId: string): OrbitNote | undefined {
    return this.notes.get(noteId);
  }

  hasParticipantLiked(noteId: string, participantId: string): boolean {
    return this.likes.has(`${noteId}:${participantId}`);
  }

  buildPromotionPayload(roundId: string, selectedNoteIds?: string[]): { text: string; noteCount: number } | null {
    const notes = this.getNotesForRound(roundId);
    const selected = selectedNoteIds ? notes.filter((n) => selectedNoteIds.includes(n.note_id)) : notes;
    if (selected.length === 0) return null;

    const lines = selected.map((note, index) => {
      const count = this.getLikeCount(note.note_id);
      const safeText = this.escapeOrbitDiscussionText(note.text);
      return `${index + 1}. ${note.author_name} (+${count}): ${safeText}`;
    });

    const text = `<CACP_ORBIT_DISCUSSION>\n${lines.join("\n")}\n</CACP_ORBIT_DISCUSSION>`;
    return { text, noteCount: selected.length };
  }

  escapeOrbitDiscussionText(text: string): string {
    return text.replace(/<\/CACP_ORBIT_DISCUSSION>/gi, "[CACP_ORBIT_DISCUSSION_CLOSE]");
  }

  promoteRound(roundId: string, promotedBy: string, inputId: string): void {
    const round = this.rounds.get(roundId);
    if (round) {
      round.promoted_at = new Date().toISOString();
      round.promoted_by = promotedBy;
      round.input_id = inputId;
    }
  }

  getRound(roundId: string): OrbitRound | undefined {
    return this.rounds.get(roundId);
  }

  /**
   * Build a bounded synthetic catch-up stream for a reconnecting participant.
   *
   * Orbit events are live-only (T2: never persisted to the durable event log),
   * so without this method a refreshing client would see an empty orbit layer
   * after the WS handshake replay finishes. Per spec §6, we replay only the
   * **current round** (older rounds are not relevant to the active-round
   * panel) and cap notes at MAX_REPLAY_NOTES_PER_ROUND, keeping the most
   * recent entries.
   *
   * Returns an empty array for agent participants — orbit is human-only
   * (HUMAN_ROLES gate). The caller (server.ts WS handshake) wraps each entry
   * with `event(...)` to produce a full CacpEvent. This keeps OrbitRoomState
   * free of dependencies on the `event` factory and matches the unit-test
   * style for the class.
   *
   * Order:
   *   1. orbit.round.opened (current round)
   *   2. orbit.note.created (chronological by created_at)
   *   3. orbit.like.changed — one per note that has at least one like, with
   *      `participant_id` and `liked` reflecting the **reconnecting** user's
   *      personal state, and `likes` carrying the canonical total. This lets
   *      the client reducer set `liked_by_me` correctly without a second
   *      round-trip.
   *   4. orbit.round.promoted (only if current round is already promoted)
   */
  replayFor(participant: StoredParticipant): SyntheticOrbitEvent[] {
    if (participant.role === "agent") return [];

    const round = this.rounds.get(this.currentRoundId);
    if (!round) return [];

    const out: SyntheticOrbitEvent[] = [];

    out.push({
      type: "orbit.round.opened",
      actor_id: participant.id,
      payload: {
        round_id: round.round_id,
        triggered_by_turn_id: round.triggered_by_turn_id,
        opened_at: round.opened_at
      }
    });

    const allNotes = this.getNotesForRound(round.round_id);
    const notes = allNotes.length > MAX_REPLAY_NOTES_PER_ROUND
      ? allNotes.slice(allNotes.length - MAX_REPLAY_NOTES_PER_ROUND)
      : allNotes;

    for (const note of notes) {
      out.push({
        type: "orbit.note.created",
        actor_id: note.author_id,
        payload: {
          note_id: note.note_id,
          round_id: note.round_id,
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

    if (round.promoted_at && round.promoted_by && round.input_id) {
      out.push({
        type: "orbit.round.promoted",
        actor_id: round.promoted_by,
        payload: {
          round_id: round.round_id,
          promoted_by: round.promoted_by,
          input_id: round.input_id,
          promoted_at: round.promoted_at
        }
      });
    }

    return out;
  }
}
