import { describe, expect, it } from "vitest";
import { deriveMainInputQueue, nextQueuedMainInput } from "../src/main-inputs.js";
import type { CacpEvent } from "@cacp/protocol";

function makeEvent(type: string, payload: Record<string, unknown>): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${type}`,
    room_id: "room_1",
    type: type as CacpEvent["type"],
    actor_id: "user_1",
    created_at: "2026-05-01T00:00:00.000Z",
    payload
  };
}

describe("deriveMainInputQueue", () => {
  it("returns empty queue when no events", () => {
    expect(deriveMainInputQueue([])).toEqual([]);
  });

  it("returns queued items in FIFO order", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Hello", source: "composer", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" }),
      makeEvent("main_input.accepted", { input_id: "i2", author_id: "u2", text: "World", source: "composer", created_at: "2026-05-01T00:00:01.000Z" }),
      makeEvent("main_input.queued", { input_id: "i2", queued_after_turn_id: "t2" })
    ];
    const queue = deriveMainInputQueue(events);
    expect(queue.length).toBe(2);
    expect(queue[0].input_id).toBe("i1");
    expect(queue[1].input_id).toBe("i2");
  });

  it("excludes cancelled inputs", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Hello", source: "composer", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" }),
      makeEvent("main_input.cancelled", { input_id: "i1", cancelled_by: "u_owner" })
    ];
    expect(deriveMainInputQueue(events)).toEqual([]);
  });

  it("excludes triggered inputs", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Hello", source: "composer", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" }),
      makeEvent("main_input.triggered", { input_id: "i1", trigger_turn_id: "t2" })
    ];
    expect(deriveMainInputQueue(events)).toEqual([]);
  });

  it("excludes failed inputs", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Hello", source: "composer", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" }),
      makeEvent("main_input.failed", { input_id: "i1", failure_reason: "agent_offline" })
    ];
    expect(deriveMainInputQueue(events)).toEqual([]);
  });

  it("returns only accepted but not queued items", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Hello", source: "composer", created_at: "2026-05-01T00:00:00.000Z" })
    ];
    expect(deriveMainInputQueue(events)).toEqual([]);
  });

  it("returns orbit_promote source correctly", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "Promoted", source: "orbit_promote", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" })
    ];
    const queue = deriveMainInputQueue(events);
    expect(queue[0].source).toBe("orbit_promote");
  });
});

describe("nextQueuedMainInput", () => {
  it("returns undefined when queue is empty", () => {
    expect(nextQueuedMainInput([])).toBeUndefined();
  });

  it("returns the first queued item", () => {
    const events = [
      makeEvent("main_input.accepted", { input_id: "i1", author_id: "u1", text: "First", source: "composer", created_at: "2026-05-01T00:00:00.000Z" }),
      makeEvent("main_input.queued", { input_id: "i1", queued_after_turn_id: "t1" }),
      makeEvent("main_input.accepted", { input_id: "i2", author_id: "u2", text: "Second", source: "composer", created_at: "2026-05-01T00:00:01.000Z" }),
      makeEvent("main_input.queued", { input_id: "i2", queued_after_turn_id: "t2" })
    ];
    const next = nextQueuedMainInput(events);
    expect(next?.input_id).toBe("i1");
    expect(next?.text).toBe("First");
  });
});
