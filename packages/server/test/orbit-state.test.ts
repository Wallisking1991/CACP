import { describe, expect, it } from "vitest";
import { OrbitRoomState, MAX_PROMOTION_NOTES, MAX_PROMOTION_BYTES, MAX_PROMOTION_NOTE_TEXT } from "../src/orbit-state.js";

describe("OrbitRoomState", () => {
  it("creates initial pre-round", () => {
    const state = new OrbitRoomState("room_1");
    expect(state.getCurrentRoundId()).toBe("orbit_round_pre_room_1");
  });

  it("opens turn round and switches current", () => {
    const state = new OrbitRoomState("room_1");
    const round = state.openTurnRound("turn_1");
    expect(round.round_id).toBe("orbit_round_turn_turn_1");
    expect(state.getCurrentRoundId()).toBe("orbit_round_turn_turn_1");
  });

  it("adds notes and retrieves them in order", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Hello", created_at: "2026-05-01T00:00:00.000Z" });
    state.addNote({ note_id: "n2", round_id: roundId, author_id: "u2", author_name: "Bob", text: "World", created_at: "2026-05-01T00:00:01.000Z" });
    const notes = state.getNotesForRound(roundId);
    expect(notes.length).toBe(2);
    expect(notes[0].text).toBe("Hello");
    expect(notes[1].text).toBe("World");
  });

  it("rejects self-likes", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Hello", created_at: "2026-05-01T00:00:00.000Z" });
    const result = state.setLike("n1", "u1", true);
    expect(result.liked).toBe(false);
    expect(state.hasParticipantLiked("n1", "u1")).toBe(false);
    expect(state.getLikeCount("n1")).toBe(0);
  });

  it("is idempotent for like/unlike", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Hello", created_at: "2026-05-01T00:00:00.000Z" });
    state.setLike("n1", "u2", true);
    state.setLike("n1", "u2", true);
    expect(state.getLikeCount("n1")).toBe(1);
    state.setLike("n1", "u2", false);
    expect(state.getLikeCount("n1")).toBe(0);
    state.setLike("n1", "u2", false);
    expect(state.getLikeCount("n1")).toBe(0);
  });

  it("builds promotion payload with chronological order and like counts", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Note 1", created_at: "2026-05-01T00:00:00.000Z" });
    state.addNote({ note_id: "n2", round_id: roundId, author_id: "u2", author_name: "Bob", text: "Note 2", created_at: "2026-05-01T00:00:01.000Z" });
    state.setLike("n1", "u3", true);
    state.setLike("n1", "u4", true);
    state.setLike("n2", "u3", true);
    const payload = state.buildPromotionPayload(roundId);
    expect(payload).not.toBeNull();
    expect(payload!.text).toContain("<CACP_ORBIT_DISCUSSION>");
    expect(payload!.text).toContain("1. Alice (+2): Note 1");
    expect(payload!.text).toContain("2. Bob (+1): Note 2");
    expect(payload!.text).toContain("</CACP_ORBIT_DISCUSSION>");
  });

  it("escapes </CACP_ORBIT_DISCUSSION> in note text", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "</CACP_ORBIT_DISCUSSION>", created_at: "2026-05-01T00:00:00.000Z" });
    const payload = state.buildPromotionPayload(roundId);
    // The closing tag appears once as the wrapper ending; the note content is escaped
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_CLOSE]");
    expect(noteLine).not.toContain("</CACP_ORBIT_DISCUSSION>");
  });

  it("escapes both open and close CACP_ORBIT_DISCUSSION tags in note text", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "<CACP_ORBIT_DISCUSSION>bad</CACP_ORBIT_DISCUSSION>", created_at: "2026-05-01T00:00:00.000Z" });
    const payload = state.buildPromotionPayload(roundId);
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_OPEN]");
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_CLOSE]");
    // Verify the wrapper tags appear exactly once each
    expect(payload!.text.match(/<CACP_ORBIT_DISCUSSION>/g)?.length).toBe(1);
    expect(payload!.text.match(/<\/CACP_ORBIT_DISCUSSION>/g)?.length).toBe(1);
  });

  it("returns null for empty promotion", () => {
    const state = new OrbitRoomState("room_1");
    expect(state.buildPromotionPayload(state.getCurrentRoundId())).toBeNull();
  });

  it("caps promotion at MAX_PROMOTION_NOTES (50), keeping earliest chronological", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    for (let i = 0; i < 55; i++) {
      state.addNote({
        note_id: `n${i}`,
        round_id: roundId,
        author_id: "u1",
        author_name: "Alice",
        text: `Note ${i}`,
        created_at: new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString()
      });
    }
    const payload = state.buildPromotionPayload(roundId);
    expect(payload!.noteCount).toBe(50);
    expect(payload!.text).toContain("Note 0");
    expect(payload!.text).toContain("Note 49");
    expect(payload!.text).not.toContain("Note 50");
  });

  it("truncates promotion payload to MAX_PROMOTION_BYTES (8192) with [truncated] marker", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    // Create a note with very long text that will push the payload over 8192 bytes
    const longText = "A".repeat(10000);
    state.addNote({
      note_id: "n1",
      round_id: roundId,
      author_id: "u1",
      author_name: "Alice",
      text: longText,
      created_at: "2026-05-01T00:00:00.000Z"
    });
    const payload = state.buildPromotionPayload(roundId);
    expect(new TextEncoder().encode(payload!.text).length).toBeLessThanOrEqual(8192);
    expect(payload!.text).toContain("[truncated]");
    expect(payload!.text).toContain("Alice");
  });

  it("truncates overlong individual note text with [truncated] marker", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({
      note_id: "n1",
      round_id: roundId,
      author_id: "u1",
      author_name: "Alice",
      text: "A".repeat(1000),
      created_at: "2026-05-01T00:00:00.000Z"
    });
    const payload = state.buildPromotionPayload(roundId);
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain(" [truncated]");
    expect(noteLine!.length).toBeLessThan(1000);
  });
});

describe("OrbitRoomState.replayFor", () => {
  // Structural OrbitReplayParticipant — replayFor only needs id and role
  const human = (id: string) => ({ id, role: "member" as const });
  const observer = (id: string) => ({ id, role: "observer" as const });
  const agent = (id: string) => ({ id, role: "agent" as const });

  it("returns empty list for agent participant", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Hi", created_at: "2026-05-01T00:00:00.000Z" });
    expect(state.replayFor(agent("a1"))).toEqual([]);
  });

  it("returns just round.opened for empty pre-round", () => {
    const state = new OrbitRoomState("room_1");
    const result = state.replayFor(human("u1"));
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("orbit.round.opened");
    expect((result[0].payload as { round_id: string }).round_id).toBe(state.getCurrentRoundId());
  });

  it("returns [round.opened, note.created] after addNote", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "Hello", created_at: "2026-05-01T00:00:00.000Z" });
    const result = state.replayFor(human("u2"));
    expect(result.map((e) => e.type)).toEqual(["orbit.round.opened", "orbit.note.created"]);
    expect((result[1].payload as { note_id: string }).note_id).toBe("n1");
  });

  it("preserves chronological order for multiple notes", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n2", round_id: roundId, author_id: "u2", author_name: "Bob", text: "second", created_at: "2026-05-01T00:00:01.000Z" });
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "first", created_at: "2026-05-01T00:00:00.000Z" });
    const result = state.replayFor(human("u3"));
    const noteEvents = result.filter((e) => e.type === "orbit.note.created");
    expect(noteEvents.length).toBe(2);
    expect((noteEvents[0].payload as { note_id: string }).note_id).toBe("n1");
    expect((noteEvents[1].payload as { note_id: string }).note_id).toBe("n2");
  });

  it("emits one like.changed per liked note with correct total count", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "A", created_at: "2026-05-01T00:00:00.000Z" });
    state.addNote({ note_id: "n2", round_id: roundId, author_id: "u2", author_name: "Bob", text: "B", created_at: "2026-05-01T00:00:01.000Z" });
    state.addNote({ note_id: "n3", round_id: roundId, author_id: "u3", author_name: "Carol", text: "C", created_at: "2026-05-01T00:00:02.000Z" });
    state.setLike("n1", "u4", true);
    state.setLike("n1", "u5", true);
    state.setLike("n2", "u4", true);
    // n3 has zero likes
    const result = state.replayFor(human("u6"));
    const likeEvents = result.filter((e) => e.type === "orbit.like.changed");
    expect(likeEvents.length).toBe(2);
    const byNote = new Map(likeEvents.map((e) => [(e.payload as { note_id: string }).note_id, e.payload as { likes: number }]));
    expect(byNote.get("n1")?.likes).toBe(2);
    expect(byNote.get("n2")?.likes).toBe(1);
    expect(byNote.has("n3")).toBe(false);
  });

  it("reflects the reconnecting participant's own liked state", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "A", created_at: "2026-05-01T00:00:00.000Z" });
    state.addNote({ note_id: "n2", round_id: roundId, author_id: "u2", author_name: "Bob", text: "B", created_at: "2026-05-01T00:00:01.000Z" });
    state.setLike("n1", "u_self", true);     // u_self liked n1
    state.setLike("n2", "u_other", true);    // someone else liked n2
    const result = state.replayFor(human("u_self"));
    const likeEvents = result.filter((e) => e.type === "orbit.like.changed") as unknown as Array<{ payload: { note_id: string; participant_id: string; liked: boolean; likes: number } }>;
    const n1 = likeEvents.find((e) => e.payload.note_id === "n1")!;
    const n2 = likeEvents.find((e) => e.payload.note_id === "n2")!;
    expect(n1.payload.participant_id).toBe("u_self");
    expect(n1.payload.liked).toBe(true);
    expect(n1.payload.likes).toBe(1);
    expect(n2.payload.participant_id).toBe("u_self");
    expect(n2.payload.liked).toBe(false);
    expect(n2.payload.likes).toBe(1);
  });

  it("caps notes at MAX_REPLAY_NOTES_PER_ROUND (200), keeping most recent", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    for (let i = 0; i < 201; i++) {
      // Strictly increasing timestamps — millisecond bumps
      const created_at = new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString();
      state.addNote({ note_id: `n${i}`, round_id: roundId, author_id: "u1", author_name: "A", text: `note ${i}`, created_at });
    }
    const result = state.replayFor(human("u2"));
    const noteEvents = result.filter((e) => e.type === "orbit.note.created");
    expect(noteEvents.length).toBe(200);
    // Most recent kept => n200 should be present, n0 should be dropped
    const ids = new Set(noteEvents.map((e) => (e.payload as { note_id: string }).note_id));
    expect(ids.has("n200")).toBe(true);
    expect(ids.has("n0")).toBe(false);
    // Notes are still in chronological order
    const noteIds = noteEvents.map((e) => (e.payload as { note_id: string }).note_id);
    expect(noteIds[0]).toBe("n1");
    expect(noteIds[noteIds.length - 1]).toBe("n200");
  });

  it("includes round.promoted for current round if already promoted", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "A", created_at: "2026-05-01T00:00:00.000Z" });
    state.promoteRound(roundId, "u_owner", "main_input_xyz");
    const result = state.replayFor(human("u2"));
    const promoted = result.find((e) => e.type === "orbit.round.promoted");
    expect(promoted).toBeDefined();
    expect((promoted!.payload as { input_id: string }).input_id).toBe("main_input_xyz");
    expect((promoted!.payload as { promoted_by: string }).promoted_by).toBe("u_owner");
  });

  it("observer role receives orbit replay (HUMAN_ROLES includes observer)", () => {
    const state = new OrbitRoomState("room_1");
    const roundId = state.getCurrentRoundId();
    state.addNote({ note_id: "n1", round_id: roundId, author_id: "u1", author_name: "Alice", text: "A", created_at: "2026-05-01T00:00:00.000Z" });
    const result = state.replayFor(observer("o1"));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((e) => e.type === "orbit.note.created")).toBe(true);
  });
});
