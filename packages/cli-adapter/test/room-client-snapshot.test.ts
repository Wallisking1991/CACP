import { describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/room-client.js";

describe("RoomClient snapshot methods", () => {
  it("startSnapshot posts to the correct URL", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = new RoomClient({ serverUrl: "http://127.0.0.1:3737", roomId: "room_1", agentToken: "token_1" });

    await client.startSnapshot("req_1", { first_sequence: 0, last_sequence: 5, total_count: 6 });

    globalThis.fetch = originalFetch;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/connector-snapshots/req_1/start",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("first_sequence")
      })
    );
  });

  it("uploadSnapshotEntry posts a single entry", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = new RoomClient({ serverUrl: "http://127.0.0.1:3737", roomId: "room_1", agentToken: "token_1" });

    await client.uploadSnapshotEntry("req_1", {
      ledger_version: 1,
      room_id: "room_1",
      connector_id: "conn_1",
      agent_id: "agent_1",
      sequence: 0,
      entry_id: "entry_1",
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Hello",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    globalThis.fetch = originalFetch;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/connector-snapshots/req_1/entries",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("entry_1")
      })
    );
  });

  it("completeSnapshot posts completion", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = new RoomClient({ serverUrl: "http://127.0.0.1:3737", roomId: "room_1", agentToken: "token_1" });

    await client.completeSnapshot("req_1", { last_sequence: 5 });

    globalThis.fetch = originalFetch;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/connector-snapshots/req_1/complete",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("last_sequence")
      })
    );
  });

  it("failSnapshot posts failure", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = new RoomClient({ serverUrl: "http://127.0.0.1:3737", roomId: "room_1", agentToken: "token_1" });

    await client.failSnapshot("req_1", { error: "Ledger not found" });

    globalThis.fetch = originalFetch;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/connector-snapshots/req_1/fail",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Ledger not found")
      })
    );
  });
});
