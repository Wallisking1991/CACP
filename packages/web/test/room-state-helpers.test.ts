import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { isCollectionActive, isTurnInFlight, collectedMessageIds } from "../src/room-state.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

describe("isCollectionActive", () => {
  it("returns true after ai.collection.started", () => {
    const events = [event("ai.collection.started", { collection_id: "c1", started_by: "user_1" }, 1)];
    expect(isCollectionActive(events)).toBe(true);
  });

  it("returns false after ai.collection.submitted", () => {
    const events = [
      event("ai.collection.started", { collection_id: "c1", started_by: "user_1" }, 1),
      event("ai.collection.submitted", { collection_id: "c1", submitted_by: "user_1", message_ids: ["msg_1"] }, 2)
    ];
    expect(isCollectionActive(events)).toBe(false);
  });

  it("returns false after ai.collection.cancelled", () => {
    const events = [
      event("ai.collection.started", { collection_id: "c1", started_by: "user_1" }, 1),
      event("ai.collection.cancelled", { collection_id: "c1", cancelled_by: "user_1" }, 2)
    ];
    expect(isCollectionActive(events)).toBe(false);
  });

  it("handles multiple collections", () => {
    const events = [
      event("ai.collection.started", { collection_id: "c1", started_by: "user_1" }, 1),
      event("ai.collection.submitted", { collection_id: "c1", submitted_by: "user_1", message_ids: ["msg_1"] }, 2),
      event("ai.collection.started", { collection_id: "c2", started_by: "user_1" }, 3)
    ];
    expect(isCollectionActive(events)).toBe(true);
  });
});

describe("isTurnInFlight", () => {
  it("returns true after agent.turn.started", () => {
    const events = [event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1")];
    expect(isTurnInFlight(events)).toBe(true);
  });

  it("returns false after agent.turn.completed", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.completed", { turn_id: "t1", agent_id: "agent_1", message_id: "msg_1" }, 2, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(false);
  });

  it("returns false after agent.turn.failed", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.failed", { turn_id: "t1", agent_id: "agent_1", error: "boom" }, 2, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(false);
  });

  it("handles multiple turns", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.completed", { turn_id: "t1", agent_id: "agent_1", message_id: "msg_1" }, 2, "agent_1"),
      event("agent.turn.started", { turn_id: "t2", agent_id: "agent_1" }, 3, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(true);
  });
});

describe("collectedMessageIds", () => {
  it("returns message_ids matching the collection_id", () => {
    const events = [
      event("message.created", { message_id: "msg_1", text: "hello", kind: "human", collection_id: "c1" }, 1, "user_1"),
      event("message.created", { message_id: "msg_2", text: "world", kind: "human", collection_id: "c1" }, 2, "user_2"),
      event("message.created", { message_id: "msg_3", text: "other", kind: "human", collection_id: "c2" }, 3, "user_1")
    ];
    expect(collectedMessageIds(events, "c1")).toEqual(["msg_1", "msg_2"]);
  });

  it("returns empty array when no messages match", () => {
    const events = [
      event("message.created", { message_id: "msg_1", text: "hello", kind: "human", collection_id: "c1" }, 1, "user_1")
    ];
    expect(collectedMessageIds(events, "c2")).toEqual([]);
  });

  it("ignores non-message events", () => {
    const events = [
      event("ai.collection.started", { collection_id: "c1", started_by: "user_1" }, 1),
      event("message.created", { message_id: "msg_1", text: "hello", kind: "human", collection_id: "c1" }, 2, "user_1")
    ];
    expect(collectedMessageIds(events, "c1")).toEqual(["msg_1"]);
  });

  it("filters out non-string message_id values", () => {
    const events = [
      event("message.created", { message_id: "msg_1", text: "hello", kind: "human", collection_id: "c1" }, 1, "user_1"),
      event("message.created", { message_id: 123, text: "bad", kind: "human", collection_id: "c1" }, 2, "user_1")
    ];
    expect(collectedMessageIds(events, "c1")).toEqual(["msg_1"]);
  });
});
