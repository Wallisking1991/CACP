import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

const tempDirs: string[] = [];

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "cacp-orbit-open-"));
  tempDirs.push(dir);
  return join(dir, "cacp.db");
}

function updateParticipantRole(dbPath: string, roomId: string, participantId: string, role: "admin" | "member" | "observer") {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE participants SET role = ? WHERE room_id = ? AND participant_id = ?").run(role, roomId, participantId);
  } finally {
    db.close();
  }
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Room", display_name: "Owner" }
  });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

async function setupRoomWithReadyAgent(app: FastifyInstance) {
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

async function inviteWithRole(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  role: "member" | "observer",
  displayName: string
) {
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

async function inviteAdmin(
  app: FastifyInstance,
  dbPath: string,
  roomId: string,
  ownerToken: string,
  displayName: string
) {
  const member = await inviteWithRole(app, roomId, ownerToken, "member", displayName);
  updateParticipantRole(dbPath, roomId, member.participant_id, "admin");
  return member;
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

function collectWsEvents(ws: WebSocket): Array<{ type: string; payload: Record<string, unknown> }> {
  const arr: Array<{ type: string; payload: Record<string, unknown> }> = [];
  ws.addEventListener("message", (msg) => {
    arr.push(JSON.parse(msg.data as string));
  });
  return arr;
}

async function waitForEvent(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
  predicate: (ev: { type: string; payload: Record<string, unknown> }) => boolean,
  timeoutMs = 1500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (events.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for predicate; received: ${events.map((e) => e.type).join(",")}`);
}

async function drainReplay(ws: WebSocket, ms = 1500): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  const replay: Array<{ type: string; payload: Record<string, unknown> }> = [];
  ws.addEventListener("message", (msg) => {
    replay.push(JSON.parse(msg.data as string));
  });
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return replay;
}

describe("POST /rooms/:roomId/orbit/notes — flat pool (no round_id)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("publishes orbit.note.created without round_id", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await ownerAndRoom(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "flat note" }
    });
    expect(res.statusCode).toBe(201);

    await waitForEvent(received, (e) => e.type === "orbit.note.created");
    const note = received.find((e) => e.type === "orbit.note.created")!;
    expect(note.payload).not.toHaveProperty("round_id");
    expect(note.payload.text).toBe("flat note");
    ws.close();
  });
});

describe("POST /rooms/:roomId/orbit/clear", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("owner can clear (201, { ok: true })", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
  });

  it("admin can clear (201)", async () => {
    const dbPath = tempDbPath();
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const admin = await inviteAdmin(app, dbPath, room.room_id, room.owner_token, "Admin");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
  });

  it("member is rejected with 403", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const member = await inviteWithRole(app, room.room_id, room.owner_token, "member", "Mem");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it("observer is rejected with 403", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const observer = await inviteWithRole(app, room.room_id, room.owner_token, "observer", "Obs");

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${observer.token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent is rejected with 403", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const { room, agent } = await setupRoomWithReadyAgent(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it("broadcasts orbit.cleared to humans with cleared_by + cleared_at", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await ownerAndRoom(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(201);

    await waitForEvent(received, (e) => e.type === "orbit.cleared");
    const cleared = received.find((e) => e.type === "orbit.cleared")!;
    expect(cleared.payload).toMatchObject({ cleared_by: room.owner_id });
    expect(typeof cleared.payload.cleared_at).toBe("string");
    ws.close();
  });

  it("after clear, replayFor returns no orbit events", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await ownerAndRoom(app);

    // Post a note then clear
    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "to be cleared" }
    });
    expect(noteRes.statusCode).toBe(201);

    const clearRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(clearRes.statusCode).toBe(201);

    // Reconnect a fresh WS — the replay should be empty for orbit.*
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const replay = await drainReplay(ws);
    ws.close();

    expect(replay.filter((e) => e.type.startsWith("orbit.")).length).toBe(0);
  });
});

describe("POST /rooms/:roomId/orbit/promote — flat pool", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("happy path: promotes a single note and broadcasts orbit.notes.quoted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithReadyAgent(app);

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "promote-me" }
    });
    const note = noteRes.json() as { note_id: string };

    const promoteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { note_ids: [note.note_id] }
    });

    expect(promoteRes.statusCode).toBe(201);
    const body = promoteRes.json() as { input_id: string; status: string; note_count: number };
    expect(body.input_id).toMatch(/^input_/);
    expect(body.note_count).toBe(1);
    expect(body.status).toBe("triggered");

    await waitForEvent(received, (e) => e.type === "orbit.notes.quoted");
    const quoted = received.find((e) => e.type === "orbit.notes.quoted")!;
    expect(quoted.payload).toEqual({ note_ids: [note.note_id] });
    ws.close();
  });

  it("returns 409 all_already_quoted when every note id is already quoted", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithReadyAgent(app);

    const noteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "single-shot" }
    });
    const note = noteRes.json() as { note_id: string };

    const first = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { note_ids: [note.note_id] }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { note_ids: [note.note_id] }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "all_already_quoted" });
  });

  it("returns 409 no_notes_selected when filtered ids cannot build a payload", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room } = await setupRoomWithReadyAgent(app);

    // Promote a non-existent note id. isQuoted returns false (so it survives the
    // all_already_quoted gate), but buildPromotionPayload filters it out as
    // unknown, returning null -> no_notes_selected.
    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { note_ids: ["note_does_not_exist"] }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no_notes_selected" });
  });
});
