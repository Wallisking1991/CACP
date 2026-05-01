import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

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

async function setupRoomWithAgent(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Room", display_name: "Owner" }
  });
  const room = created.json() as { room_id: string; owner_token: string; owner_id: string };

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

describe("POST /rooms/:roomId/orbit/notes rate limiting", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("returns 429 when orbit event limit is exceeded", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig({ orbitEventLimit: 1, rateLimitWindowMs: 60_000 }) });
    const { room } = await setupRoomWithAgent(app);

    const first = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "First note" }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Second note" }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("POST /rooms/:roomId/orbit/notes/:noteId/like", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("returns likes count in response", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const { room } = await setupRoomWithAgent(app);

    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Hello orbit" }
    });
    const note = noteRes.json() as { note_id: string };

    const inviteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    });
    const invite = inviteRes.json() as { invite_token: string };

    const joinRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: invite.invite_token, display_name: "Member" }
    });
    const joinRequest = joinRes.json() as { request_id: string; request_token: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${joinRequest.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });

    const statusRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${joinRequest.request_id}?request_token=${joinRequest.request_token}`
    });
    const status = statusRes.json() as { participant_token: string };

    const likeRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes/${note.note_id}/like`,
      headers: { authorization: `Bearer ${status.participant_token}` },
      payload: {}
    });

    expect(likeRes.statusCode).toBe(201);
    const body = likeRes.json() as { liked: boolean; count: number };
    expect(body.liked).toBe(true);
    expect(body.count).toBe(1);
  });

  it("broadcasts orbit.like.changed with likes count", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);

    const receivedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const messagePromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        receivedEvents.push(parsed);
        if (parsed.type === "orbit.like.changed") resolve();
      });
    });

    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Test note" }
    });
    const note = noteRes.json() as { note_id: string };

    const inviteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    });
    const invite = inviteRes.json() as { invite_token: string };

    const joinRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: invite.invite_token, display_name: "Liker" }
    });
    const jr = joinRes.json() as { request_id: string; request_token: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${jr.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });

    const stRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${jr.request_id}?request_token=${jr.request_token}`
    });
    const st = stRes.json() as { participant_token: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes/${note.note_id}/like`,
      headers: { authorization: `Bearer ${st.participant_token}` },
      payload: {}
    });

    await messagePromise;
    ws.close();

    const likeEvents = receivedEvents.filter((e) => e.type === "orbit.like.changed");
    expect(likeEvents.length).toBeGreaterThanOrEqual(1);
    const likeEvent = likeEvents[likeEvents.length - 1];
    expect(likeEvent.payload.likes).toBe(1);
  });
});
