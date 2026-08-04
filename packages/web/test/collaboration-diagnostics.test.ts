import { describe, expect, it, vi } from "vitest";

import { createCollaborationDiagnostics } from "../src/collaboration-diagnostics.js";

describe("collaboration diagnostics reporter", () => {
  it("batches bounded structured events and assigns a monotonic sequence", async () => {
    vi.useFakeTimers();
    try {
      const batches: Array<Array<Record<string, unknown>>> = [];
      const reporter = createCollaborationDiagnostics({
        clientSessionId: "client-session-1234",
        flushIntervalMs: 1_000,
        now: () => new Date("2026-08-04T00:00:00.000Z"),
        send: async (batch) => {
          batches.push(batch.events);
        },
      });

      reporter.record({
        area: "room_stream",
        action: "stream_connecting",
        connection_generation: 1,
      });
      reporter.record({
        area: "whiteboard",
        action: "update_sent",
        update_id: "update_1",
        base_revision: 3,
        element_count: 2,
      });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([
        expect.objectContaining({
          client_session_id: "client-session-1234",
          sequence: 0,
          action: "stream_connecting",
        }),
        expect.objectContaining({
          client_session_id: "client-session-1234",
          sequence: 1,
          action: "update_sent",
          update_id: "update_1",
        }),
      ]);
      await reporter.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops records that attempt to add message content", () => {
    const reporter = createCollaborationDiagnostics({
      clientSessionId: "client-session-1234",
      send: async () => {},
    });

    expect(
      reporter.record({
        area: "orbit",
        action: "event_received",
        text: "private discussion text",
      } as never)
    ).toBe(false);
    expect(reporter.pendingCount()).toBe(0);
  });
});
