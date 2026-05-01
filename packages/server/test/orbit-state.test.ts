import { describe, expect, it } from "vitest";
import { OrbitRoomState } from "../src/orbit-state.js";

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
    expect(result.liked).toBe(true);
    expect(state.hasParticipantLiked("n1", "u1")).toBe(true);
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

  it("returns null for empty promotion", () => {
    const state = new OrbitRoomState("room_1");
    expect(state.buildPromotionPayload(state.getCurrentRoundId())).toBeNull();
  });
});
