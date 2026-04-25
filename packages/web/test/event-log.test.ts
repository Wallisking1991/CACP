import { describe, expect, it } from "vitest";
import { mergeEvent } from "../src/event-log.js";

function messageEvent(event_id: string, created_at: string) {
  return {
    protocol: "cacp" as const,
    version: "0.1.0" as const,
    event_id,
    room_id: "room_1",
    type: "message.created" as const,
    actor_id: "user_1",
    created_at,
    payload: { text: "hello" }
  };
}

describe("event log", () => {
  it("deduplicates events by event_id", () => {
    const event = messageEvent("evt_1", "2026-04-25T00:00:00.000Z");
    expect(mergeEvent(mergeEvent([], event), event)).toHaveLength(1);
  });

  it("orders events by creation time", () => {
    const later = messageEvent("evt_2", "2026-04-25T00:00:01.000Z");
    const earlier = messageEvent("evt_1", "2026-04-25T00:00:00.000Z");
    expect(mergeEvent(mergeEvent([], later), earlier).map((event) => event.event_id)).toEqual(["evt_1", "evt_2"]);
  });
});