import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { EventStore } from "../src/event-store.js";

function testEvent(eventId: string, type: CacpEvent["type"]): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.1.0",
    event_id: eventId,
    room_id: "room_order",
    type,
    actor_id: "user_owner",
    created_at: "2026-04-25T10:00:00.000Z",
    payload: {}
  };
}

describe("EventStore", () => {
  it("preserves insertion order for events with identical created_at timestamps", () => {
    const store = new EventStore(":memory:");

    store.appendEvent(testEvent("evt_z", "message.created"));
    store.appendEvent(testEvent("evt_a", "ai.collection.started"));
    store.appendEvent(testEvent("evt_m", "proposal.created"));

    expect(store.listEvents("room_order").map((event) => event.event_id)).toEqual(["evt_z", "evt_a", "evt_m"]);

    store.close();
  });
});
