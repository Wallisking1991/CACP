import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Room", display_name: "Owner" }
  });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

async function setupRoomWithAgent(app: FastifyInstance) {
  const room = await ownerAndRoom(app);
  const agentReg = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agents/register`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { name: "TestAgent", capabilities: ["llm-api"] }
  });
  const agent = agentReg.json() as { agent_id: string; agent_token: string };
  await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agents/select`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { agent_id: agent.agent_id }
  });
  return { room, agent };
}

function addressOf(app: Awaited<ReturnType<typeof buildServer>>): string {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
  return `127.0.0.1:${address.port}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("websocket failed to open")), { once: true });
  });
}

async function listEvents(app: FastifyInstance, roomId: string, token: string) {
  const res = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/events`,
    headers: { authorization: `Bearer ${token}` }
  });
  return (res.json() as { events: Array<{ type: string; payload: Record<string, unknown> }> }).events;
}

describe("main_input.* events are live-only (no durable persistence)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("POST /rooms/:roomId/main-inputs does not persist main_input.accepted in /events", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const { room } = await setupRoomWithAgent(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "hello agent" }
    });
    expect(res.statusCode).toBe(201);

    const events = await listEvents(app, room.room_id, room.owner_token);
    expect(events.some((e) => e.type.startsWith("main_input."))).toBe(false);
  });

  it("WS handshake replay does not include main_input.* events", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "ephemeral body" }
    });
    expect(res.statusCode).toBe(201);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const replay: Array<{ type: string }> = [];
    await new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        replay.push(JSON.parse(msg.data as string));
      });
      // Drain initial replay buffer for a tick
      setTimeout(resolve, 100);
    });
    ws.close();

    expect(replay.some((e) => e.type.startsWith("main_input."))).toBe(false);
  });

  it("main_input.queued and main_input.triggered are delivered live but not persisted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const liveEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    ws.addEventListener("message", (msg) => {
      liveEvents.push(JSON.parse(msg.data as string));
    });

    // First main input — triggers a turn (queued + triggered)
    const first = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "first" }
    });
    expect(first.statusCode).toBe(201);

    // Second main input — should be queued because turn is open
    const second = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "second" }
    });
    expect(second.statusCode).toBe(201);

    // Allow live messages to arrive
    await new Promise((r) => setTimeout(r, 100));
    ws.close();

    // Live wire should carry both queued and triggered for the first input
    const queuedLive = liveEvents.filter((e) => e.type === "main_input.queued");
    const triggeredLive = liveEvents.filter((e) => e.type === "main_input.triggered");
    expect(queuedLive.length).toBeGreaterThanOrEqual(2);
    expect(triggeredLive.length).toBeGreaterThanOrEqual(1);

    // But /events must NOT contain any main_input.* type
    const events = await listEvents(app, room.room_id, room.owner_token);
    expect(events.some((e) => e.type.startsWith("main_input."))).toBe(false);
  });

  it("main_input.cancelled is delivered live but not persisted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    // First input opens a turn, second gets queued
    const first = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "first" }
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "queued" }
    });
    expect(second.statusCode).toBe(201);
    const queuedInputId = (second.json() as { input_id: string }).input_id;

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const liveEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const cancelledLive = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        liveEvents.push(parsed);
        if (parsed.type === "main_input.cancelled") resolve();
      });
    });

    const cancelRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs/${queuedInputId}/cancel`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(cancelRes.statusCode).toBe(201);

    await cancelledLive;
    ws.close();

    expect(liveEvents.some((e) => e.type === "main_input.cancelled")).toBe(true);

    const events = await listEvents(app, room.room_id, room.owner_token);
    expect(events.some((e) => e.type === "main_input.cancelled")).toBe(false);
    expect(events.some((e) => e.type.startsWith("main_input."))).toBe(false);
  });

  it("orbit.note.created is delivered live but not persisted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const liveEvents: Array<{ type: string }> = [];
    const noteLive = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        liveEvents.push(parsed);
        if (parsed.type === "orbit.note.created") resolve();
      });
    });

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "ephemeral note" }
    });
    expect(res.statusCode).toBe(201);

    await noteLive;
    ws.close();

    expect(liveEvents.some((e) => e.type === "orbit.note.created")).toBe(true);

    const events = await listEvents(app, room.room_id, room.owner_token);
    expect(events.some((e) => e.type === "orbit.note.created")).toBe(false);
  });
});

describe("connector.snapshot.entry validates entry shape", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("rejects malformed entry body with 400", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithAgent(app);

    const reqRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });
    expect(reqRes.statusCode).toBe(201);
    const { request_id: requestId } = reqRes.json() as { request_id: string };

    // Subscribe as the requester to verify nothing is broadcast
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const liveEvents: Array<{ type: string }> = [];
    ws.addEventListener("message", (msg) => {
      liveEvents.push(JSON.parse(msg.data as string));
    });

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots/${requestId}/entries`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { entry: { foo: "bar" } }
    });

    expect([400, 422]).toContain(res.statusCode);

    // Allow a tick to confirm no event reached the bus
    await new Promise((r) => setTimeout(r, 80));
    ws.close();

    expect(liveEvents.some((e) => e.type === "connector.snapshot.entry")).toBe(false);
  });

  it("accepts a well-formed ConnectorLedgerEntry and broadcasts to the requester", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithAgent(app);

    const reqRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });
    const { request_id: requestId } = reqRes.json() as { request_id: string };

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const liveEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const entryLive = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        liveEvents.push(parsed);
        if (parsed.type === "connector.snapshot.entry") resolve();
      });
    });

    const goodEntry = {
      ledger_version: 1 as const,
      room_id: room.room_id,
      connector_id: agent.agent_id,
      agent_id: agent.agent_id,
      sequence: 0,
      entry_id: "ledger_entry_1",
      entry_type: "human_input" as const,
      actor_id: "user_owner",
      actor_name: "Owner",
      actor_role: "owner" as const,
      text: "hello",
      source: "composer" as const,
      created_at: "2026-05-02T00:00:00.000Z"
    };

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots/${requestId}/entries`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { entry: goodEntry }
    });
    expect(res.statusCode).toBe(201);

    await entryLive;
    ws.close();

    expect(liveEvents.some((e) => e.type === "connector.snapshot.entry")).toBe(true);
  });
});
