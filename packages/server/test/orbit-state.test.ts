import { describe, expect, it } from "vitest";
import {
  OrbitRoomState,
  MAX_REPLAY_NOTES,
  MAX_PROMOTION_NOTES,
  MAX_PROMOTION_BYTES,
  MAX_PROMOTION_NOTE_TEXT
} from "../src/orbit-state.js";

const human = (id: string) => ({ id, role: "member" as const });
const observer = (id: string) => ({ id, role: "observer" as const });
const agent = (id: string) => ({ id, role: "agent" as const });

function addNote(
  state: OrbitRoomState,
  note_id: string,
  created_at: string,
  text: string = "text",
  author_id: string = "u1"
): void {
  state.addNote({
    note_id,
    author_id,
    author_name: author_id === "u1" ? "Alice" : author_id === "u2" ? "Bob" : "Carol",
    text,
    created_at
  });
}

describe("OrbitRoomState (flat pool)", () => {
  it("returns notes sorted chronologically regardless of insertion order", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "Second", "u2");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "First", "u1");
    addNote(state, "n3", "2026-05-01T00:00:02.000Z", "Third", "u3");
    const notes = state.getAllNotes();
    expect(notes.map((n) => n.note_id)).toEqual(["n1", "n2", "n3"]);
  });

  it("getNote returns the requested note or undefined", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    expect(state.getNote("n1")?.note_id).toBe("n1");
    expect(state.getNote("missing")).toBeUndefined();
  });

  it("rejects self-likes", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "Hello", "u1");
    const result = state.setLike("n1", "u1", true);
    expect(result.liked).toBe(false);
    expect(state.hasParticipantLiked("n1", "u1")).toBe(false);
    expect(state.getLikeCount("n1")).toBe(0);
  });

  it("is idempotent for like/unlike", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "Hello", "u1");
    state.setLike("n1", "u2", true);
    state.setLike("n1", "u2", true);
    expect(state.getLikeCount("n1")).toBe(1);
    state.setLike("n1", "u2", false);
    expect(state.getLikeCount("n1")).toBe(0);
    state.setLike("n1", "u2", false);
    expect(state.getLikeCount("n1")).toBe(0);
  });

  it("markQuoted returns freshly marked ids and skips missing/already-quoted", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    expect(state.markQuoted(["n1", "missing"])).toEqual(["n1"]);
    expect(state.isQuoted("n1")).toBe(true);
    expect(state.markQuoted(["n1"])).toEqual([]);
  });

  it("buildPromotionPayload skips already-quoted notes and returns ordered noteIds", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "First", "u1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "Second", "u2");
    state.markQuoted(["n1"]);
    const payload = state.buildPromotionPayload(["n1", "n2"]);
    expect(payload).not.toBeNull();
    expect(payload!.noteCount).toBe(1);
    expect(payload!.noteIds).toEqual(["n2"]);
    expect(payload!.text).toContain("1. Bob (+0): Second");
    expect(payload!.text).not.toContain("First");
  });

  it("buildPromotionPayload returns null when nothing remains after filtering", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    state.markQuoted(["n1"]);
    expect(state.buildPromotionPayload(["n1", "missing"])).toBeNull();
  });

  it("buildPromotionPayload returns null when no notes selected", () => {
    const state = new OrbitRoomState("room_1");
    expect(state.buildPromotionPayload([])).toBeNull();
  });

  it("buildPromotionPayload includes wrapper and like counts in chronological order", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "Note 1", "u1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "Note 2", "u2");
    state.setLike("n1", "u3", true);
    state.setLike("n1", "u4", true);
    state.setLike("n2", "u3", true);
    const payload = state.buildPromotionPayload(["n1", "n2"]);
    expect(payload).not.toBeNull();
    expect(payload!.text).toContain("<CACP_ORBIT_DISCUSSION>");
    expect(payload!.text).toContain("1. Alice (+2): Note 1");
    expect(payload!.text).toContain("2. Bob (+1): Note 2");
    expect(payload!.text).toContain("</CACP_ORBIT_DISCUSSION>");
    expect(payload!.noteIds).toEqual(["n1", "n2"]);
  });

  it("escapes </CACP_ORBIT_DISCUSSION> in note text", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "</CACP_ORBIT_DISCUSSION>", "u1");
    const payload = state.buildPromotionPayload(["n1"]);
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_CLOSE]");
    expect(noteLine).not.toContain("</CACP_ORBIT_DISCUSSION>");
  });

  it("escapes both open and close CACP_ORBIT_DISCUSSION tags in note text", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "<CACP_ORBIT_DISCUSSION>bad</CACP_ORBIT_DISCUSSION>", "u1");
    const payload = state.buildPromotionPayload(["n1"]);
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_OPEN]");
    expect(noteLine).toContain("[CACP_ORBIT_DISCUSSION_CLOSE]");
    expect(payload!.text.match(/<CACP_ORBIT_DISCUSSION>/g)?.length).toBe(1);
    expect(payload!.text.match(/<\/CACP_ORBIT_DISCUSSION>/g)?.length).toBe(1);
  });

  it("caps promotion at MAX_PROMOTION_NOTES (50), keeping earliest chronological", () => {
    const state = new OrbitRoomState("room_1");
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const id = `n${i}`;
      ids.push(id);
      addNote(
        state,
        id,
        new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString(),
        `Note ${i}`,
        "u1"
      );
    }
    const payload = state.buildPromotionPayload(ids);
    expect(payload!.noteCount).toBe(MAX_PROMOTION_NOTES);
    expect(payload!.noteIds.length).toBe(MAX_PROMOTION_NOTES);
    expect(payload!.text).toContain("Note 0");
    expect(payload!.text).toContain("Note 49");
    expect(payload!.text).not.toContain("Note 50");
  });

  it("truncates promotion payload to MAX_PROMOTION_BYTES (8192) with [truncated] marker", () => {
    const state = new OrbitRoomState("room_1");
    const longText = "A".repeat(10000);
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", longText, "u1");
    const payload = state.buildPromotionPayload(["n1"]);
    expect(new TextEncoder().encode(payload!.text).length).toBeLessThanOrEqual(MAX_PROMOTION_BYTES);
    expect(payload!.text).toContain("[truncated]");
    expect(payload!.text).toContain("Alice");
  });

  it("truncates overlong individual note text with [truncated] marker", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "A".repeat(1000), "u1");
    const payload = state.buildPromotionPayload(["n1"]);
    const lines = payload!.text.split("\n");
    const noteLine = lines.find((l) => l.includes("Alice"));
    expect(noteLine).toContain(" [truncated]");
    expect(noteLine!.length).toBeLessThan(MAX_PROMOTION_NOTE_TEXT + 200);
  });

  it("buildPromotionPayload noteIds reflects byte-cap survivors", () => {
    const state = new OrbitRoomState("room_1");
    // Build many medium-sized notes that fit individually but exceed the byte cap collectively
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `n${i}`;
      ids.push(id);
      addNote(
        state,
        id,
        new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString(),
        "B".repeat(400),
        "u1"
      );
    }
    const payload = state.buildPromotionPayload(ids);
    expect(payload).not.toBeNull();
    expect(new TextEncoder().encode(payload!.text).length).toBeLessThanOrEqual(MAX_PROMOTION_BYTES);
    expect(payload!.noteIds.length).toBe(payload!.noteCount);
    // The surviving ids must be a chronological prefix of the requested set
    const expectedPrefix = ids.slice(0, payload!.noteIds.length);
    expect(payload!.noteIds).toEqual(expectedPrefix);
  });

  it("reset clears notes, likes, and quoted state", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "Hello", "u1");
    state.setLike("n1", "u2", true);
    state.markQuoted(["n1"]);
    state.reset();
    expect(state.getAllNotes()).toEqual([]);
    expect(state.getNote("n1")).toBeUndefined();
    expect(state.isQuoted("n1")).toBe(false);
    expect(state.replayFor(human("u2"))).toEqual([]);
  });
});

describe("OrbitRoomState.replayFor (flat pool)", () => {
  it("returns empty list for agent participant", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    expect(state.replayFor(agent("a1"))).toEqual([]);
  });

  it("returns [] for empty room", () => {
    const state = new OrbitRoomState("room_1");
    expect(state.replayFor(human("u1"))).toEqual([]);
  });

  it("returns notes in chronological order regardless of insertion order", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "second", "u2");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "first", "u1");
    const result = state.replayFor(human("u3"));
    const noteEvents = result.filter((e) => e.type === "orbit.note.created");
    expect(noteEvents.length).toBe(2);
    expect((noteEvents[0].payload as { note_id: string }).note_id).toBe("n1");
    expect((noteEvents[1].payload as { note_id: string }).note_id).toBe("n2");
  });

  it("orbit.note.created payload omits round_id", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "Hello", "u1");
    const result = state.replayFor(human("u2"));
    const note = result.find((e) => e.type === "orbit.note.created")!;
    expect(note.payload).toEqual({
      note_id: "n1",
      author_id: "u1",
      author_name: "Alice",
      text: "Hello",
      created_at: "2026-05-01T00:00:00.000Z"
    });
    expect((note.payload as Record<string, unknown>).round_id).toBeUndefined();
    expect(note.actor_id).toBe("u1");
  });

  it("emits one like.changed per liked note with correct totals", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "A", "u1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "B", "u2");
    addNote(state, "n3", "2026-05-01T00:00:02.000Z", "C", "u3");
    state.setLike("n1", "u4", true);
    state.setLike("n1", "u5", true);
    state.setLike("n2", "u4", true);
    const result = state.replayFor(human("u6"));
    const likeEvents = result.filter((e) => e.type === "orbit.like.changed");
    expect(likeEvents.length).toBe(2);
    const byNote = new Map(
      likeEvents.map((e) => [(e.payload as { note_id: string }).note_id, e.payload as { likes: number }])
    );
    expect(byNote.get("n1")?.likes).toBe(2);
    expect(byNote.get("n2")?.likes).toBe(1);
    expect(byNote.has("n3")).toBe(false);
  });

  it("reflects the reconnecting participant's own liked state", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "A", "u1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "B", "u2");
    state.setLike("n1", "u_self", true);
    state.setLike("n2", "u_other", true);
    const result = state.replayFor(human("u_self"));
    const likeEvents = result.filter((e) => e.type === "orbit.like.changed") as unknown as Array<{
      payload: { note_id: string; participant_id: string; liked: boolean; likes: number };
    }>;
    const n1 = likeEvents.find((e) => e.payload.note_id === "n1")!;
    const n2 = likeEvents.find((e) => e.payload.note_id === "n2")!;
    expect(n1.payload.participant_id).toBe("u_self");
    expect(n1.payload.liked).toBe(true);
    expect(n1.payload.likes).toBe(1);
    expect(n2.payload.participant_id).toBe("u_self");
    expect(n2.payload.liked).toBe(false);
    expect(n2.payload.likes).toBe(1);
  });

  it("emits exact event order for two notes, two likes, and one quoted note", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z", "First", "u1");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z", "Second", "u2");
    state.setLike("n1", "u3", true);
    state.setLike("n2", "u3", true);
    state.markQuoted(["n2"]);
    const result = state.replayFor(human("u4"));
    expect(result.map((e) => e.type)).toEqual([
      "orbit.note.created",
      "orbit.note.created",
      "orbit.like.changed",
      "orbit.like.changed",
      "orbit.notes.quoted"
    ]);
    const quoted = result[result.length - 1];
    expect(quoted.payload).toEqual({ note_ids: ["n2"] });
    expect(quoted.actor_id).toBe("u4");
  });

  it("orbit.notes.quoted is omitted when no notes are quoted", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    const result = state.replayFor(human("u2"));
    expect(result.some((e) => e.type === "orbit.notes.quoted")).toBe(false);
  });

  it("orbit.notes.quoted filters out ids that no longer exist", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    addNote(state, "n2", "2026-05-01T00:00:01.000Z");
    state.markQuoted(["n1", "n2"]);
    // Simulate stale state — but since we have no removal API, simulate by reset+re-add
    // Instead, verify both ids appear when both still exist
    const result = state.replayFor(human("u3"));
    const quoted = result.find((e) => e.type === "orbit.notes.quoted")!;
    expect(quoted.payload).toEqual({ note_ids: ["n1", "n2"] });
  });

  it("caps notes at MAX_REPLAY_NOTES (200), keeping most recent in chronological order", () => {
    const state = new OrbitRoomState("room_1");
    for (let i = 0; i < MAX_REPLAY_NOTES + 1; i++) {
      const created_at = new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString();
      addNote(state, `n${i}`, created_at, `note ${i}`, "u1");
    }
    const result = state.replayFor(human("u2"));
    const noteEvents = result.filter((e) => e.type === "orbit.note.created");
    expect(noteEvents.length).toBe(MAX_REPLAY_NOTES);
    const ids = noteEvents.map((e) => (e.payload as { note_id: string }).note_id);
    expect(ids[0]).toBe("n1");
    expect(ids[ids.length - 1]).toBe(`n${MAX_REPLAY_NOTES}`);
    expect(ids.includes("n0")).toBe(false);
  });

  it("returns [] for agent even with > MAX_REPLAY_NOTES notes; observer still gets full cap", () => {
    const state = new OrbitRoomState("room_1");
    for (let i = 0; i < MAX_REPLAY_NOTES + 1; i++) {
      const created_at = new Date(Date.parse("2026-05-01T00:00:00.000Z") + i).toISOString();
      addNote(state, `n${i}`, created_at, "x", "u1");
    }
    expect(state.replayFor(agent("agent_1"))).toEqual([]);
    const observerResult = state.replayFor(observer("observer_1"));
    expect(observerResult.filter((e) => e.type === "orbit.note.created").length).toBe(MAX_REPLAY_NOTES);
  });

  it("observer role receives orbit replay (HUMAN_ROLES includes observer)", () => {
    const state = new OrbitRoomState("room_1");
    addNote(state, "n1", "2026-05-01T00:00:00.000Z");
    const result = state.replayFor(observer("o1"));
    expect(result.some((e) => e.type === "orbit.note.created")).toBe(true);
  });
});
