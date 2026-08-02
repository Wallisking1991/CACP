import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";
import {
  markTestAgentReady,
  testConnectorCompatibility,
} from "./test-compatibility.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function multipartFile(name: string, mediaType: string, bytes: Buffer) {
  const boundary = `cacp-whiteboard-promotion-${name.replace(/\W/gu, "-")}`;
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mediaType}\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function addressOf(app: FastifyInstance): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }
  return `127.0.0.1:${address.port}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("websocket failed to open")),
      { once: true }
    );
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("timed out waiting for websocket message"));
    }, 2_000);
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function createRoom(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Whiteboard promotion", display_name: "Owner" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    room_id: string;
    owner_id: string;
    owner_token: string;
  };
}

async function registerAgent(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  name: string
) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      compatibility: testConnectorCompatibility,
      name,
      capabilities: ["kimi-cli"],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

async function joinMember(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string
) {
  const invitation = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" },
  });
  const { invite_token } = invitation.json() as { invite_token: string };
  const requested = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token, display_name: "Member" },
  });
  const request = requested.json() as {
    request_id: string;
    request_token: string;
  };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {},
  });
  const joined = await app.inject({
    method: "GET",
    url:
      `/rooms/${roomId}/join-requests/${request.request_id}` +
      `?request_token=${encodeURIComponent(request.request_token)}`,
  });
  return joined.json() as {
    participant_id: string;
    participant_token: string;
  };
}

async function upload(
  app: FastifyInstance,
  roomId: string,
  token: string,
  name: string,
  mediaType: string,
  bytes: Buffer
): Promise<string> {
  const multipart = multipartFile(name, mediaType, bytes);
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/attachments`,
    headers: {
      ...multipart.headers,
      authorization: `Bearer ${token}`,
    },
    payload: multipart.payload,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { attachment: { attachment_id: string } })
    .attachment.attachment_id;
}

describe("POST /rooms/:roomId/whiteboard/promotions", () => {
  let app: FastifyInstance | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app?.close();
    app = undefined;
  });

  it("atomically promotes a live Frame once and grants only the target Agent", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await createRoom(app);
    const target = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Target"
    );
    const other = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Other"
    );
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: target.agent_id },
    });
    await markTestAgentReady(
      app,
      room.room_id,
      room.owner_token,
      target.agent_id,
      target.agent_token
    );
    const member = await joinMember(app, room.room_id, room.owner_token);

    const board = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(board);
    await waitForOpen(board);
    await waitForMessage(
      board,
      (message) => message.type === "whiteboard.scene"
    );
    const frame = {
      id: "frame-1",
      type: "frame",
      version: 1,
      versionNonce: 101,
      x: 20,
      y: 20,
      width: 420,
      height: 260,
    };
    const text = {
      id: "text-1",
      type: "text",
      version: 1,
      versionNonce: 102,
      x: 60,
      y: 80,
      width: 180,
      height: 30,
      frameId: "frame-1",
    };
    board.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "frame-update",
        base_revision: 0,
        elements: [frame, text],
        app_state: {},
      })
    );
    await waitForMessage(
      board,
      (message) =>
        message.type === "whiteboard.ack" &&
        message.update_id === "frame-update"
    );

    const pngId = await upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng
    );
    const sourceId = await upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.excalidraw",
      "application/vnd.excalidraw+json",
      Buffer.from(
        JSON.stringify({ type: "excalidraw", elements: [frame, text] })
      )
    );
    const payload = {
      expected_revision: 1,
      selected_element_ids: ["frame-1", "text-1"],
      frame_id: "frame-1",
      png_attachment_id: pngId,
      source_attachment_id: sourceId,
      agent_id: target.agent_id,
      instruction: "Turn this frame into an implementation plan.",
      idempotency_key: "promote-frame-once",
    };

    const first = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/whiteboard/promotions`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      status: "triggered",
      attachment_count: 2,
    });
    const retry = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/whiteboard/promotions`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    const events = (
      eventsResponse.json() as {
        events: Array<{ type: string; payload: Record<string, unknown> }>;
      }
    ).events;
    const accepted = events.filter(
      (event) =>
        event.type === "main_input.accepted" &&
        event.payload.source === "whiteboard_promote"
    );
    const requested = events.filter(
      (event) =>
        event.type === "agent.turn.requested" &&
        event.payload.source === "whiteboard_promote"
    );
    expect(accepted).toHaveLength(1);
    expect(requested).toHaveLength(1);
    expect(accepted[0]?.payload).toMatchObject({
      content: {
        text: "Turn this frame into an implementation plan.",
        attachments: [
          { attachment_id: pngId, kind: "image" },
          { attachment_id: sourceId, kind: "text" },
        ],
      },
    });

    for (const attachmentId of [pngId, sourceId]) {
      const targetRead = await app.inject({
        method: "GET",
        url: `/rooms/${room.room_id}/attachments/${attachmentId}`,
        headers: { authorization: `Bearer ${target.agent_token}` },
      });
      expect(targetRead.statusCode).toBe(200);
      const otherRead = await app.inject({
        method: "GET",
        url: `/rooms/${room.room_id}/attachments/${attachmentId}`,
        headers: { authorization: `Bearer ${other.agent_token}` },
      });
      expect(otherRead.statusCode).toBe(403);
    }

    const forged = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/whiteboard/promotions`,
      headers: { authorization: `Bearer ${member.participant_token}` },
      payload: { ...payload, idempotency_key: "member-forgery" },
    });
    expect(forged.statusCode).toBe(403);

    const stalePngId = await upload(
      app,
      room.room_id,
      room.owner_token,
      "stale.png",
      "image/png",
      OnePixelPng
    );
    const staleSourceId = await upload(
      app,
      room.room_id,
      room.owner_token,
      "stale.excalidraw",
      "application/vnd.excalidraw+json",
      Buffer.from('{"type":"excalidraw","elements":[]}')
    );
    const stale = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/whiteboard/promotions`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        ...payload,
        expected_revision: 0,
        png_attachment_id: stalePngId,
        source_attachment_id: staleSourceId,
        idempotency_key: "stale-revision",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: "stale_revision",
      current_revision: 1,
    });
    for (const attachmentId of [stalePngId, staleSourceId]) {
      const noGrant = await app.inject({
        method: "GET",
        url: `/rooms/${room.room_id}/attachments/${attachmentId}`,
        headers: { authorization: `Bearer ${target.agent_token}` },
      });
      expect(noGrant.statusCode).toBe(403);
      const cleanup = await app.inject({
        method: "DELETE",
        url: `/rooms/${room.room_id}/attachments/${attachmentId}`,
        headers: { authorization: `Bearer ${room.owner_token}` },
      });
      expect(cleanup.statusCode).toBe(204);
    }
  });
});
