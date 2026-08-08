import { describe, expect, it } from "vitest";
import { mergeEvent, reconcileAuthoritativeEvents } from "../src/event-log.js";

function messageEvent(event_id: string, created_at: string) {
  return {
    protocol: "cacp" as const,
    version: "0.3.0" as const,
    event_id,
    room_id: "room_1",
    type: "message.created" as const,
    actor_id: "user_1",
    created_at,
    payload: { content: { text: "hello", attachments: [] } },
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
    expect(
      mergeEvent(mergeEvent([], later), earlier).map((event) => event.event_id)
    ).toEqual(["evt_1", "evt_2"]);
  });

  it("deduplicates a live orbit note against its synthetic reconnect replay", () => {
    const live = {
      ...messageEvent("evt_live", "2026-04-25T00:00:01.000Z"),
      type: "orbit.note.created" as const,
      payload: {
        note_id: "note_1",
        text: "live-only",
        created_at: "2026-04-25T00:00:01.000Z",
      },
    };
    const replay = { ...live, event_id: "synth_note_1" };

    expect(mergeEvent([live], replay)).toEqual([live]);
  });

  it("preserves live-only orbit state while replacing purged durable content", () => {
    const oldMessage = messageEvent("evt_old", "2026-04-25T00:00:00.000Z");
    const currentMessage = messageEvent(
      "evt_current",
      "2026-04-25T00:00:02.000Z"
    );
    const orbitNote = {
      ...messageEvent("evt_orbit", "2026-04-25T00:00:01.000Z"),
      type: "orbit.note.created" as const,
      payload: {
        note_id: "note_1",
        text: "still live",
        created_at: "2026-04-25T00:00:01.000Z",
      },
    };

    expect(
      reconcileAuthoritativeEvents(
        [oldMessage, orbitNote],
        [currentMessage]
      ).map((event) => event.event_id)
    ).toEqual(["evt_orbit", "evt_current"]);
  });

  it("deduplicates an authoritative replay in one pass", () => {
    let eventIdReads = 0;
    const replay = Array.from({ length: 40 }, (_, index) => {
      const source = messageEvent(
        `evt_${index}`,
        `2026-04-25T00:00:${String(39 - index).padStart(2, "0")}.000Z`
      );
      return Object.defineProperty({ ...source }, "event_id", {
        enumerable: true,
        get() {
          eventIdReads += 1;
          return source.event_id;
        },
      });
    });

    const reconciled = reconcileAuthoritativeEvents([], replay);

    expect(reconciled).toHaveLength(40);
    expect(eventIdReads).toBeLessThanOrEqual(80);
  });
});
