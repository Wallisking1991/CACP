import { describe, expect, it } from "vitest";
import { mergeEvent } from "../src/event-log.js";

describe("event log", () => {
  it("deduplicates events by event_id", () => {
    const event = {
      protocol: "cacp" as const,
      version: "0.1.0" as const,
      event_id: "evt_1",
      room_id: "room_1",
      type: "message.created" as const,
      actor_id: "user_1",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: { text: "hello" }
    };
    expect(mergeEvent(mergeEvent([], event), event)).toHaveLength(1);
  });
});
