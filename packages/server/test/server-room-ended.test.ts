import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

async function inviteMember(app: FastifyInstance, roomId: string, ownerToken: string, displayName: string) {
  const invRes = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" }
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

function waitForOpenOrClose(
  socket: WebSocket,
  timeoutMs = 2000
): Promise<{ opened: boolean; closed: boolean; error?: string }> {
  return new Promise((resolve) => {
    let opened = false;
    let closed = false;
    const t = setTimeout(() => resolve({ opened, closed }), timeoutMs);
    socket.addEventListener("open", () => { opened = true; }, { once: true });
    socket.addEventListener("close", () => {
      closed = true;
      clearTimeout(t);
      resolve({ opened, closed });
    }, { once: true });
    socket.addEventListener("error", (e: Event & { message?: string }) => {
      clearTimeout(t);
      resolve({ opened, closed, error: (e as { message?: string }).message ?? "ws error" });
    }, { once: true });
  });
}

// Resolves when the socket either receives its first message or closes,
// whichever happens first. Used by the gate-WS test so it does not need
// an unconditional sleep — robust on slow CI.
function waitForFirstMessageOrClose(
  socket: WebSocket,
  timeoutMs = 2000
): Promise<{ message?: unknown; closed: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: { message?: unknown; closed: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(value);
    };
    const t = setTimeout(() => settle({ closed: false }), timeoutMs);
    socket.addEventListener("message", (msg) => {
      let parsed: unknown;
      try { parsed = JSON.parse((msg as MessageEvent).data as string); } catch { parsed = (msg as MessageEvent).data; }
      settle({ message: parsed, closed: false });
    }, { once: true });
    socket.addEventListener("close", () => settle({ closed: true }), { once: true });
    socket.addEventListener("error", (e: Event & { message?: string }) => {
      settle({ closed: false, error: (e as { message?: string }).message ?? "ws error" });
    }, { once: true });
  });
}

describe("aliveRooms registry / room_ended responses (T4)", () => {
  let app: FastifyInstance | undefined;
  let secondApp: FastifyInstance | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    await Promise.allSettled([app?.close(), secondApp?.close()]);
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    app = undefined;
    secondApp = undefined;
    tmpDir = undefined;
  });

  it("returns 410 room_ended on /me for rooms that pre-existed in the SQLite file before this process started", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cacp-t4-"));
    const dbPath = join(tmpDir, "test.db");

    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = await ownerAndRoom(app);
    await app.close();
    app = undefined;

    secondApp = await buildServer({ dbPath, config: localTestConfig() });
    const meRes = await secondApp.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(meRes.statusCode).toBe(410);
    expect(meRes.json()).toEqual({ error: "room_ended" });
  });

  it("returns 410 room_ended on /events after server restart", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cacp-t4-"));
    const dbPath = join(tmpDir, "test.db");

    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = await ownerAndRoom(app);
    await app.close();
    app = undefined;

    secondApp = await buildServer({ dbPath, config: localTestConfig() });
    const evRes = await secondApp.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(evRes.statusCode).toBe(410);
    expect(evRes.json()).toEqual({ error: "room_ended" });
  });

  it("happy path — /me and /events succeed for a freshly created (alive) room", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json() as { room_id: string };
    expect(meBody.room_id).toBe(room.room_id);

    const evRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(evRes.statusCode).toBe(200);
  });

  it("WebSocket /stream emits room_ended and closes for unknown roomId", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/room_does_not_exist/stream?token=anything`);
    // Wait exactly until the first frame arrives or the socket closes —
    // no unconditional sleep, robust on slow CI. The gate path always
    // sends a single { error: "room_ended" } frame and then closes, so
    // we capture the message via the same promise.
    const first = await waitForFirstMessageOrClose(ws);
    // If we got a message first, give the close handler a microtask tick
    // to follow (close always trails the gate's send by one event-loop
    // turn). If we got close first, no message will arrive.
    let closed = first.closed;
    if (!closed) {
      const after = await new Promise<{ closed: boolean }>((resolve) => {
        if (ws.readyState === ws.CLOSED) { resolve({ closed: true }); return; }
        const t = setTimeout(() => resolve({ closed: ws.readyState === ws.CLOSED }), 500);
        ws.addEventListener("close", () => { clearTimeout(t); resolve({ closed: true }); }, { once: true });
      });
      closed = after.closed;
    }
    expect(closed).toBe(true);
    expect((first.message as { error?: string } | undefined)?.error).toBe("room_ended");
  });

  it("gate runs before auth — malformed token + unknown room returns 410 room_ended (not 401 invalid_token)", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/room_definitely_unknown/me`,
      headers: { authorization: `Bearer not-a-real-token` }
    });
    expect(meRes.statusCode).toBe(410);
    expect(meRes.json()).toEqual({ error: "room_ended" });
  });

  it("owner explicit /leave dissolves the room — subsequent /me returns 410", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const leaveRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(leaveRes.statusCode).toBe(201);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(meRes.statusCode).toBe(410);
    expect(meRes.json()).toEqual({ error: "room_ended" });
  });

  it("member-leave does NOT dissolve the room — owner /me still returns 200", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const member = await inviteMember(app, room.room_id, room.owner_token, "Member");

    // Member tries to leave. Note: existing /leave route only allows owner
    // (returns 403 for non-owners). Whatever the response, the room must
    // remain alive so long as the OWNER did not call /leave.
    const leaveRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {}
    });
    // Pin the contract: a future regression that lets members succeed at
    // /leave (which would dissolve the room) must fail this test instead
    // of silently passing.
    expect(leaveRes.statusCode).toBe(403);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(meRes.statusCode).toBe(200);
  });
});
