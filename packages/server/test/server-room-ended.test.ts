import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FileSystemAttachmentStore } from "../src/attachment-store.js";
import { localTestConfig } from "./test-config.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function multipartImage() {
  const boundary = "cacp-room-ended-whiteboard";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      OnePixelPng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Room", display_name: "Owner" },
  });
  return created.json() as {
    room_id: string;
    owner_token: string;
    owner_id: string;
  };
}

async function inviteMember(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  displayName: string
) {
  const invRes = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" },
  });
  const invite = invRes.json() as { invite_token: string };
  const pending = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: invite.invite_token, display_name: displayName },
  });
  const requestObj = pending.json() as {
    request_id: string;
    request_token: string;
  };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${requestObj.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {},
  });
  const status = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${requestObj.request_id}?request_token=${encodeURIComponent(requestObj.request_token)}`,
  });
  const finalised = status.json() as {
    participant_token: string;
    participant_id: string;
  };
  return {
    participant_id: finalised.participant_id,
    token: finalised.participant_token,
  };
}

function addressOf(app: Awaited<ReturnType<typeof buildServer>>): string {
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("server did not bind to a TCP port");
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
    socket.addEventListener(
      "open",
      () => {
        opened = true;
      },
      { once: true }
    );
    socket.addEventListener(
      "close",
      () => {
        closed = true;
        clearTimeout(t);
        resolve({ opened, closed });
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      (e: Event & { message?: string }) => {
        clearTimeout(t);
        resolve({
          opened,
          closed,
          error: (e as { message?: string }).message ?? "ws error",
        });
      },
      { once: true }
    );
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
    const settle = (value: {
      message?: unknown;
      closed: boolean;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(value);
    };
    const t = setTimeout(() => settle({ closed: false }), timeoutMs);
    socket.addEventListener(
      "message",
      (msg) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse((msg as MessageEvent).data as string);
        } catch {
          parsed = (msg as MessageEvent).data;
        }
        settle({ message: parsed, closed: false });
      },
      { once: true }
    );
    socket.addEventListener("close", () => settle({ closed: true }), {
      once: true,
    });
    socket.addEventListener(
      "error",
      (e: Event & { message?: string }) => {
        settle({
          closed: false,
          error: (e as { message?: string }).message ?? "ws error",
        });
      },
      { once: true }
    );
  });
}

function waitForWhiteboardMessage(
  socket: WebSocket,
  type: string,
  timeoutMs = 2_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    socket.addEventListener("message", onMessage);
  });
}

describe("aliveRooms registry / room_ended responses (T4)", () => {
  let app: FastifyInstance | undefined;
  let secondApp: FastifyInstance | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    await Promise.allSettled([app?.close(), secondApp?.close()]);
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
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
      headers: { authorization: `Bearer ${room.owner_token}` },
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
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(evRes.statusCode).toBe(410);
    expect(evRes.json()).toEqual({ error: "room_ended" });
  });

  it("does not revive whiteboard runtime state or attachment references after restart", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cacp-t4-whiteboard-"));
    const dbPath = join(tmpDir, "test.db");
    const attachmentStore = new FileSystemAttachmentStore(
      join(tmpDir, "attachments")
    );
    app = await buildServer({
      dbPath,
      config: localTestConfig(),
      attachmentStore,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await ownerAndRoom(app);
    const multipart = multipartImage();
    const uploaded = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/attachments`,
      headers: {
        ...multipart.headers,
        authorization: `Bearer ${room.owner_token}`,
      },
      payload: multipart.payload,
    });
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = (
      uploaded.json() as { attachment: { attachment_id: string } }
    ).attachment.attachment_id;

    const socket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    const initialScene = waitForWhiteboardMessage(socket, "whiteboard.scene");
    await initialScene;
    const presenceUpdated = waitForWhiteboardMessage(
      socket,
      "whiteboard.presence.updated"
    );
    socket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: { x: 12, y: 24, button: "up" },
        selected_element_ids: ["restart-image"],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      })
    );
    await presenceUpdated;
    const sceneUpdate = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.elements.update",
      update_id: "restart-dedup",
      base_revision: 0,
      elements: [
        {
          id: "restart-image",
          type: "image",
          version: 1,
          versionNonce: 44,
          fileId: attachmentId,
        },
      ],
      app_state: {},
    };
    const firstAck = waitForWhiteboardMessage(socket, "whiteboard.ack");
    socket.send(JSON.stringify(sceneUpdate));
    await expect(firstAck).resolves.toMatchObject({
      update_id: "restart-dedup",
      revision: 1,
    });
    const replayAck = waitForWhiteboardMessage(socket, "whiteboard.ack");
    socket.send(JSON.stringify(sceneUpdate));
    await expect(replayAck).resolves.toMatchObject({
      update_id: "restart-dedup",
      revision: 1,
    });
    const beforeRestart = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/whiteboard/snapshots`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(beforeRestart.statusCode).toBe(200);
    expect(beforeRestart.json().snapshots).toHaveLength(1);
    expect(await attachmentStore.storedFiles()).toHaveLength(1);

    socket.close();
    await app.close();
    app = undefined;
    secondApp = await buildServer({
      dbPath,
      config: localTestConfig(),
      attachmentStore,
    });
    await secondApp.listen({ host: "127.0.0.1", port: 0 });

    for (const url of [
      `/rooms/${room.room_id}/whiteboard/snapshots`,
      `/rooms/${room.room_id}/attachments/${attachmentId}`,
    ]) {
      const response = await secondApp.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${room.owner_token}` },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual({ error: "room_ended" });
    }
    expect(await attachmentStore.storedFiles()).toEqual([]);

    const restartedSocket = new WebSocket(
      `ws://${addressOf(secondApp)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    const restartedClose = waitForOpenOrClose(restartedSocket);
    await expect(
      waitForWhiteboardMessage(restartedSocket, "whiteboard.error")
    ).resolves.toMatchObject({ code: "room_ended", recoverable: false });
    await expect(restartedClose).resolves.toMatchObject({ closed: true });
  });

  it("rejects every room-scoped REST mutation after server restart", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cacp-t4-"));
    const dbPath = join(tmpDir, "test.db");

    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = await ownerAndRoom(app);
    await app.close();
    app = undefined;

    secondApp = await buildServer({ dbPath, config: localTestConfig() });
    for (const request of [
      {
        method: "POST" as const,
        url: `/rooms/${room.room_id}/invites`,
        payload: { role: "member" },
      },
      {
        method: "POST" as const,
        url: `/rooms/${room.room_id}/activity/presence`,
        payload: { presence: "online" },
      },
      {
        method: "POST" as const,
        url: `/rooms/${room.room_id}/leave`,
        payload: {},
      },
    ]) {
      const response = await secondApp.inject({
        ...request,
        headers: { authorization: `Bearer ${room.owner_token}` },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual({ error: "room_ended" });
    }
  });

  it("happy path — /me and /events succeed for a freshly created (alive) room", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json() as { room_id: string };
    expect(meBody.room_id).toBe(room.room_id);

    const evRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(evRes.statusCode).toBe(200);
  });

  it("WebSocket /stream emits room_ended and closes for unknown roomId", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const ws = new WebSocket(
      `ws://${addressOf(app)}/rooms/room_does_not_exist/stream?token=anything`
    );
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
        if (ws.readyState === ws.CLOSED) {
          resolve({ closed: true });
          return;
        }
        const t = setTimeout(
          () => resolve({ closed: ws.readyState === ws.CLOSED }),
          500
        );
        ws.addEventListener(
          "close",
          () => {
            clearTimeout(t);
            resolve({ closed: true });
          },
          { once: true }
        );
      });
      closed = after.closed;
    }
    expect(closed).toBe(true);
    expect((first.message as { error?: string } | undefined)?.error).toBe(
      "room_ended"
    );
  });

  it("gate runs before auth — malformed token + unknown room returns 410 room_ended (not 401 invalid_token)", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/room_definitely_unknown/me`,
      headers: { authorization: `Bearer not-a-real-token` },
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
      payload: {},
    });
    expect(leaveRes.statusCode).toBe(201);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(meRes.statusCode).toBe(410);
    expect(meRes.json()).toEqual({ error: "room_ended" });
  });

  it("member-leave does NOT dissolve the room — owner /me still returns 200", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);
    const member = await inviteMember(
      app,
      room.room_id,
      room.owner_token,
      "Member"
    );

    // Member tries to leave. Note: existing /leave route only allows owner
    // (returns 403 for non-owners). Whatever the response, the room must
    // remain alive so long as the OWNER did not call /leave.
    const leaveRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {},
    });
    // Pin the contract: a future regression that lets members succeed at
    // /leave (which would dissolve the room) must fail this test instead
    // of silently passing.
    expect(leaveRes.statusCode).toBe(403);

    const meRes = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(meRes.statusCode).toBe(200);
  });
});
