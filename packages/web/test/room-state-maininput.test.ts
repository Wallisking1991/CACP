import { describe, expect, it } from "vitest";
import { deriveRoomState } from "../src/room-state.js";
import type { CacpEvent } from "@cacp/protocol";

describe("deriveRoomState mainInputQueue → messages", () => {
  const baseEvent = (type: string, payload: Record<string, unknown>, actorId = "p1"): CacpEvent => ({
    event_id: `${type}-1`,
    room_id: "room-1",
    type,
    actor_id: actorId,
    created_at: "2026-05-02T00:00:00.000Z",
    payload
  });

  it("maps main_input.accepted to a queued message when not yet queued", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello Agent" })
    ];
    const state = deriveRoomState(events, { currentParticipantId: "p1" });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      message_id: "in1",
      actor_id: "p1",
      text: "Hello Agent",
      kind: "queued"
    });
  });

  it("hides queued main-input from Thread messages, keeps in mainInputQueue", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" })
    ];
    const state = deriveRoomState(events);
    expect(state.messages).toHaveLength(0);
    expect(state.mainInputQueue).toHaveLength(1);
    expect(state.mainInputQueue[0]).toMatchObject({
      input_id: "in1",
      text: "Hello",
      status: "queued"
    });
  });

  it("excludes cancelled main-input from messages", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello" }),
      baseEvent("main_input.cancelled", { input_id: "in1" })
    ];
    const state = deriveRoomState(events);
    expect(state.messages).toHaveLength(0);
  });

  it("excludes failed main-input from messages", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello" }),
      baseEvent("main_input.failed", { input_id: "in1" })
    ];
    const state = deriveRoomState(events);
    expect(state.messages).toHaveLength(0);
  });

  it("maps main_input.triggered to a human message in Thread", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      baseEvent("main_input.triggered", { input_id: "in1", trigger_turn_id: "t2" })
    ];
    const state = deriveRoomState(events, { currentParticipantId: "p1" });
    const msg = state.messages.find((m) => m.message_id === "in1");
    expect(msg).toBeDefined();
    expect(msg!.kind).toBe("human");
  });

  it("removes triggered main-input from mainInputQueue", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      baseEvent("main_input.triggered", { input_id: "in1", trigger_turn_id: "t2" })
    ];
    const state = deriveRoomState(events);
    expect(state.mainInputQueue).toHaveLength(0);
  });

  it("does not duplicate-render when message.created exists for the same main_input", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      { ...baseEvent("message.created", { message_id: "in1", text: "Hello", kind: "human" }), created_at: "2026-05-02T00:00:01.000Z" },
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello", author_id: "p1", source: "composer", created_at: "2026-05-02T00:00:01.000Z" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" })
    ];
    const state = deriveRoomState(events, { currentParticipantId: "p1" });
    const msgs = state.messages.filter((m) => m.message_id === "in1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe("human");
  });

  it("shows kind human when main_input is triggered and message.created exists", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      { ...baseEvent("message.created", { message_id: "in1", text: "Hello", kind: "human" }), created_at: "2026-05-02T00:00:01.000Z" },
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello", author_id: "p1", source: "composer", created_at: "2026-05-02T00:00:01.000Z" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      baseEvent("main_input.triggered", { input_id: "in1", trigger_turn_id: "t2" })
    ];
    const state = deriveRoomState(events, { currentParticipantId: "p1" });
    const msgs = state.messages.filter((m) => m.message_id === "in1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe("human");
  });

  it("hides message.created when main_input is cancelled", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      { ...baseEvent("message.created", { message_id: "in1", text: "Hello", kind: "human" }), created_at: "2026-05-02T00:00:01.000Z" },
      baseEvent("main_input.accepted", { input_id: "in1", text: "Hello", author_id: "p1", source: "composer", created_at: "2026-05-02T00:00:01.000Z" }),
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      baseEvent("main_input.cancelled", { input_id: "in1", cancelled_by: "p1" })
    ];
    const state = deriveRoomState(events, { currentParticipantId: "p1" });
    const msgs = state.messages.filter((m) => m.message_id === "in1");
    expect(msgs).toHaveLength(0);
  });

  it("interleaves triggered messages with regular messages by created_at", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      { ...baseEvent("message.created", { message_id: "m1", text: "First", kind: "human" }), created_at: "2026-05-02T00:00:01.000Z" },
      { ...baseEvent("main_input.accepted", { input_id: "in1", text: "Queue", author_id: "p1", source: "composer" }), created_at: "2026-05-02T00:00:02.000Z" },
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      baseEvent("main_input.triggered", { input_id: "in1", trigger_turn_id: "t2" }),
      { ...baseEvent("message.created", { message_id: "m2", text: "Second", kind: "human" }), created_at: "2026-05-02T00:00:03.000Z" }
    ];
    const state = deriveRoomState(events);
    expect(state.messages.map((m) => m.text)).toEqual(["First", "Queue", "Second"]);
  });

  it("does not interleave queued-only messages with regular messages", () => {
    const events: CacpEvent[] = [
      baseEvent("room.created", { name: "Test Room" }),
      { ...baseEvent("message.created", { message_id: "m1", text: "First", kind: "human" }), created_at: "2026-05-02T00:00:01.000Z" },
      { ...baseEvent("main_input.accepted", { input_id: "in1", text: "Queue", author_id: "p1", source: "composer" }), created_at: "2026-05-02T00:00:02.000Z" },
      baseEvent("main_input.queued", { input_id: "in1", queued_after_turn_id: "t1" }),
      { ...baseEvent("message.created", { message_id: "m2", text: "Second", kind: "human" }), created_at: "2026-05-02T00:00:03.000Z" }
    ];
    const state = deriveRoomState(events);
    expect(state.messages.map((m) => m.text)).toEqual(["First", "Second"]);
    expect(state.mainInputQueue).toHaveLength(1);
    expect(state.mainInputQueue[0].text).toBe("Queue");
  });
});
