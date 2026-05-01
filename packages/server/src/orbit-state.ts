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
}
