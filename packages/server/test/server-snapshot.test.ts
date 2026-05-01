import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

async function registerAgent(app: FastifyInstance, roomId: string, token: string) {
  const res = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Agent", capabilities: ["llm.api"] }
  });
  return res.json() as { agent_id: string; agent_token: string };
}

async function selectAgent(app: FastifyInstance, roomId: string, token: string, agentId: string) {
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/select`,
    headers: { authorization: `Bearer ${token}` },
    payload: { agent_id: agentId }
  });
}

async function joinAsRole(app: FastifyInstance, roomId: string, ownerToken: string, role: "member" | "observer", historyAccess?: "allowed" | "denied") {
  const payload: Record<string, unknown> = { role, expires_in_seconds: 3600 };
  if (historyAccess) payload.main_thread_history_access = historyAccess;
  const inviteRes = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload
  });
  const invite = inviteRes.json() as { invite_token: string };

  const joinRes = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: invite.invite_token, display_name: "Participant" }
  });
  const request = joinRes.json() as { request_id: string; request_token: string };

  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {}
  });

  const statusRes = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
  });
  const { participant_token } = statusRes.json() as { participant_token: string };
  return participant_token;
}

describe("POST /rooms/:roomId/connector-snapshots", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("allows owner to request a snapshot", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { request_id: string };
    expect(body.request_id).toBeDefined();
  });

  it("allows member with allowed history access to request", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const memberToken = await joinAsRole(app, room.room_id, room.owner_token, "member", "allowed");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { since_sequence: 0 }
    });

    expect(res.statusCode).toBe(201);
  });

  it("denies member with denied history access", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const memberToken = await joinAsRole(app, room.room_id, room.owner_token, "member", "denied");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { since_sequence: 0 }
    });

    expect(res.statusCode).toBe(403);
  });

  it("denies observer", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const observerToken = await joinAsRole(app, room.room_id, room.owner_token, "observer");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${observerToken}` },
      payload: { since_sequence: 0 }
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when no active agent exists", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("connector snapshot events visibility", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("does not persist connector.snapshot.requested in /events", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });

    const eventsRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    const events = (eventsRes.json() as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type.startsWith("connector.snapshot"))).toBe(false);
  });
});

describe("POST /rooms/:roomId/connector-snapshots/:requestId/start", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("allows agent to start a requested snapshot", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const reqRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });
    const { request_id: requestId } = reqRes.json() as { request_id: string };

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots/${requestId}/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { first_sequence: 0, last_sequence: 5, total_count: 6 }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

describe("POST /rooms/:roomId/connector-snapshots/:requestId/complete", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("allows agent to complete a snapshot", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const reqRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });
    const { request_id: requestId } = reqRes.json() as { request_id: string };

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots/${requestId}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { last_sequence: 5 }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

describe("POST /rooms/:roomId/connector-snapshots/:requestId/fail", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("allows agent to fail a snapshot", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const reqRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { since_sequence: 0 }
    });
    const { request_id: requestId } = reqRes.json() as { request_id: string };

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/connector-snapshots/${requestId}/fail`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { error: "Ledger not found" }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true });
  });
});
