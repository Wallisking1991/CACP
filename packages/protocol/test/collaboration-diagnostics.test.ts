import { describe, expect, it } from "vitest";

import {
  CollaborationDiagnosticBatchSchema,
  CollaborationDiagnosticEventSchema,
} from "../src/schemas.js";

const validEvent = {
  client_session_id: "client-session-1234",
  sequence: 7,
  occurred_at: "2026-08-04T00:00:00.000Z",
  area: "whiteboard",
  action: "update_sent",
  connection_generation: 2,
  update_id: "whiteboard_update_1",
  base_revision: 4,
  element_count: 3,
};

describe("collaboration diagnostics", () => {
  it("accepts bounded metadata without collaboration content", () => {
    expect(CollaborationDiagnosticEventSchema.parse(validEvent)).toEqual(
      validEvent
    );
    expect(
      CollaborationDiagnosticBatchSchema.parse({ events: [validEvent] }).events
    ).toHaveLength(1);
  });

  it.each(["text", "content", "message", "token", "display_name"])(
    "rejects the sensitive or unbounded field %s",
    (field) => {
      expect(
        CollaborationDiagnosticEventSchema.safeParse({
          ...validEvent,
          [field]: "must never reach production logs",
        }).success
      ).toBe(false);
    }
  );

  it("bounds diagnostic batches", () => {
    expect(
      CollaborationDiagnosticBatchSchema.safeParse({
        events: Array.from({ length: 26 }, (_, sequence) => ({
          ...validEvent,
          sequence,
        })),
      }).success
    ).toBe(false);
  });
});
