import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

describe("collaboration diagnostics route", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("authenticates, hashes identifiers, and emits no collaboration content", async () => {
    const records: Array<Record<string, unknown>> = [];
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      diagnosticSink: (record) => records.push(record),
    });
    const created = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Room", display_name: "Owner" },
    });
    const room = created.json() as {
      room_id: string;
      owner_id: string;
      owner_token: string;
    };
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/diagnostics`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        events: [
          {
            client_session_id: "client-session-1234",
            sequence: 2,
            occurred_at: "2026-08-04T00:00:00.000Z",
            area: "whiteboard",
            action: "update_broadcast_received",
            participant_id: room.owner_id,
            update_id: "whiteboard-update-raw",
            revision: 9,
            element_count: 4,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: "collaboration_diagnostic",
      source: "client",
      area: "whiteboard",
      action: "update_broadcast_received",
      sequence: 2,
      revision: 9,
      element_count: 4,
    });
    expect(records[0]?.room_ref).toMatch(/^[a-f0-9]{16}$/u);
    expect(records[0]?.participant_ref).toMatch(/^[a-f0-9]{16}$/u);
    expect(records[0]?.client_ref).toMatch(/^[a-f0-9]{16}$/u);
    expect(records[0]?.update_ref).toMatch(/^[a-f0-9]{16}$/u);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain(room.room_id);
    expect(serialized).not.toContain(room.owner_id);
    expect(serialized).not.toContain(room.owner_token);
    expect(serialized).not.toContain("whiteboard-update-raw");
  });

  it("rejects unauthenticated and content-bearing diagnostic requests", async () => {
    const records: Array<Record<string, unknown>> = [];
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      diagnosticSink: (record) => records.push(record),
    });
    const created = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Room", display_name: "Owner" },
    });
    const room = created.json() as {
      room_id: string;
      owner_token: string;
    };
    const body = {
      events: [
        {
          client_session_id: "client-session-1234",
          sequence: 0,
          occurred_at: "2026-08-04T00:00:00.000Z",
          area: "orbit",
          action: "event_received",
          text: "must not be logged",
        },
      ],
    };

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/rooms/${room.room_id}/diagnostics`,
          payload: body,
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/rooms/${room.room_id}/diagnostics`,
          headers: { authorization: `Bearer ${room.owner_token}` },
          payload: body,
        })
      ).statusCode
    ).toBe(400);
    expect(records).toEqual([]);
  });
});
