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

async function inviteWithRole(app: FastifyInstance, roomId: string, ownerToken: string, role: "member" | "observer", displayName: string) {
  const invRes = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role }
  });
  const invite = invRes.json() as { invite_token: string };
  const pending = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: invite.invite_token, display_name: displayName }
  });
  const requestObj = pending.json() as { request_id: string; request_token: string };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${requestObj.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {}
  });
  const status = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${requestObj.request_id}?request_token=${encodeURIComponent(requestObj.request_token)}`
  });
  const finalised = status.json() as { participant_token: string; participant_id: string };
  return { participant_id: finalised.participant_id, token: finalised.participant_token };
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

async function drainReplay(ws: WebSocket, ms = 1500): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  // CI-tolerance polling deadline, NOT a known-good wait. The handshake
  // synthesises the orbit catch-up stream synchronously, so under normal
  // load this resolves well before the timeout. We pad the budget to 1.5s
  // so a slow CI runner (under load, cold start, fs contention) doesn't
  // flake by closing the socket before the synthetic events have been
  // flushed onto the wire. Negative-case tests (e.g. "agent must NOT
  // receive orbit replay") naturally pay the full timeout — that's fine.
  const replay: Array<{ type: string; payload: Record<string, unknown> }> = [];
  ws.addEventListener("message", (msg) => {
    replay.push(JSON.parse(msg.data as string));
  });
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return replay;
}

describe("orbit state TTL replay on WS reconnect", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("replays orbit.note.created on reconnect even though it is not persisted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    // Post a note BEFORE the reconnecting WS opens
    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "ephemeral note" }
    });
    expect(res.statusCode).toBe(201);

    // Sanity: durable log does NOT contain the orbit note (T2 invariant)
    const events = await listEvents(app, room.room_id, room.owner_token);
    expect(events.some((e) => e.type === "orbit.note.created")).toBe(false);

    // Reconnect and assert the synthetic replay carries the note
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    expect(replay.some((e) => e.type === "orbit.round.opened")).toBe(true);
    const noteEvent = replay.find((e) => e.type === "orbit.note.created");
    expect(noteEvent).toBeDefined();
    expect((noteEvent!.payload as { text: string }).text).toBe("ephemeral note");
  });

  it("orbit.round.opened arrives before orbit.note.created in the replay", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "first" }
    });
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "second" }
    });

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    const orbitTypes = replay.filter((e) => e.type.startsWith("orbit.")).map((e) => e.type);
    const openedIdx = orbitTypes.indexOf("orbit.round.opened");
    const firstNoteIdx = orbitTypes.indexOf("orbit.note.created");
    expect(openedIdx).toBeGreaterThanOrEqual(0);
    expect(firstNoteIdx).toBeGreaterThan(openedIdx);
  });

  it("observer role receives orbit replay (HUMAN_ROLES gate)", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);
    const observer = await inviteWithRole(app, room.room_id, room.owner_token, "observer", "Obs");

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "ephemeral note" }
    });

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${observer.token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    expect(replay.some((e) => e.type === "orbit.note.created")).toBe(true);
  });

  it("agent role does NOT receive orbit replay on reconnect", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithAgent(app);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "ephemeral note" }
    });

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${agent.agent_token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    expect(replay.some((e) => e.type.startsWith("orbit."))).toBe(false);
  });

  it("replays current per-note like total on reconnect", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithAgent(app);
    const liker = await inviteWithRole(app, room.room_id, room.owner_token, "member", "Liker");

    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "likeable" }
    });
    const noteId = (noteRes.json() as { note_id: string }).note_id;

    const likeRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes/${noteId}/like`,
      headers: { authorization: `Bearer ${liker.token}` },
      payload: {}
    });
    expect(likeRes.statusCode).toBe(201);

    // Owner reconnects — should see total likes = 1, but their own liked = false
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    const likeEvent = replay.find((e) => e.type === "orbit.like.changed" && (e.payload as { note_id: string }).note_id === noteId);
    expect(likeEvent).toBeDefined();
    const payload = likeEvent!.payload as { participant_id: string; liked: boolean; likes: number };
    expect(payload.likes).toBe(1);
    expect(payload.liked).toBe(false); // owner did not like it
    expect(payload.participant_id).toBe(room.owner_id);
  });
});
