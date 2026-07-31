import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  WhiteboardServerMessageSchema,
  type WhiteboardServerMessage,
} from "@cacp/protocol";

import { buildServer } from "../src/server.js";
import { testConnectorCompatibility } from "./test-compatibility.js";
import { localTestConfig } from "./test-config.js";

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

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
    socket.close();
  });
}

function createInbox(socket: WebSocket) {
  const messages: WhiteboardServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener("message", (event) => {
    messages.push(
      WhiteboardServerMessageSchema.parse(JSON.parse(event.data as string))
    );
    for (const notify of waiters) notify();
  });

  async function next(
    type: WhiteboardServerMessage["type"]
  ): Promise<WhiteboardServerMessage> {
    const deadline = Date.now() + 2_000;
    while (true) {
      const index = messages.findIndex((message) => message.type === type);
      if (index !== -1) return messages.splice(index, 1)[0]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timed out waiting for ${type}`);
      }
      await new Promise<void>((resolve) => {
        const notify = () => {
          clearTimeout(timer);
          waiters.delete(notify);
          resolve();
        };
        const timer = setTimeout(notify, remaining);
        waiters.add(notify);
      });
    }
  }

  return { next };
}

async function joinHuman(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  role: "member" | "observer",
  displayName: string
) {
  const inviteResponse = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role },
  });
  expect(inviteResponse.statusCode).toBe(201);
  const invite = inviteResponse.json() as { invite_token: string };

  const requestResponse = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: {
      invite_token: invite.invite_token,
      display_name: displayName,
    },
  });
  expect(requestResponse.statusCode).toBe(201);
  const request = requestResponse.json() as {
    request_id: string;
    request_token: string;
  };

  const approval = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {},
  });
  expect(approval.statusCode).toBe(201);

  const status = await app.inject({
    method: "GET",
    url:
      `/rooms/${roomId}/join-requests/${request.request_id}` +
      `?request_token=${encodeURIComponent(request.request_token)}`,
  });
  expect(status.statusCode).toBe(200);
  return status.json() as {
    participant_id: string;
    participant_token: string;
    role: "member" | "observer";
  };
}

describe("collaborative whiteboard stream", () => {
  let app: FastifyInstance | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app?.close();
    app = undefined;
  });

  it("shares the first scene update between two human editors", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const roomResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Whiteboard room", display_name: "Owner" },
    });
    expect(roomResponse.statusCode).toBe(201);
    const room = roomResponse.json() as {
      room_id: string;
      owner_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );

    const ownerSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    const memberSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(ownerSocket, memberSocket);
    const ownerInbox = createInbox(ownerSocket);
    const memberInbox = createInbox(memberSocket);
    await Promise.all([waitForOpen(ownerSocket), waitForOpen(memberSocket)]);

    await expect(
      ownerInbox.next("whiteboard.connected")
    ).resolves.toMatchObject({
      participant_id: room.owner_id,
      role: "owner",
      can_edit: true,
    });
    await expect(ownerInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });
    await expect(
      memberInbox.next("whiteboard.connected")
    ).resolves.toMatchObject({
      participant_id: member.participant_id,
      role: "member",
      can_edit: true,
    });
    await expect(memberInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });

    const rectangle = {
      id: "shape-1",
      type: "rectangle",
      version: 1,
      versionNonce: 101,
      x: 80,
      y: 120,
      width: 180,
      height: 100,
    };
    ownerSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "update-1",
        base_revision: 0,
        elements: [rectangle],
        app_state: { viewBackgroundColor: "#ffffff" },
      })
    );

    await expect(ownerInbox.next("whiteboard.ack")).resolves.toMatchObject({
      update_id: "update-1",
      revision: 1,
    });
    await expect(
      memberInbox.next("whiteboard.elements.updated")
    ).resolves.toMatchObject({
      update_id: "update-1",
      participant_id: room.owner_id,
      revision: 1,
      elements: [rectangle],
      app_state: { viewBackgroundColor: "#ffffff" },
    });
  });

  it("keeps observers read-only and refuses agent sessions", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Permissions", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const observer = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "observer",
      "Viewer"
    );
    const agentResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        compatibility: testConnectorCompatibility,
        name: "Agent",
        capabilities: ["kimi-cli"],
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json() as { agent_token: string };

    const observerSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(observer.participant_token)}`
    );
    const agentSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(agent.agent_token)}`
    );
    sockets.push(observerSocket, agentSocket);
    const observerInbox = createInbox(observerSocket);
    const agentInbox = createInbox(agentSocket);
    await Promise.all([waitForOpen(observerSocket), waitForOpen(agentSocket)]);

    await expect(
      observerInbox.next("whiteboard.connected")
    ).resolves.toMatchObject({
      role: "observer",
      can_edit: false,
    });
    await observerInbox.next("whiteboard.scene");
    observerSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "observer-update",
        base_revision: 0,
        elements: [
          {
            id: "forbidden-shape",
            type: "ellipse",
            version: 1,
            versionNonce: 202,
          },
        ],
        app_state: {},
      })
    );
    await expect(observerInbox.next("whiteboard.error")).resolves.toMatchObject(
      {
        code: "forbidden",
        recoverable: false,
        update_id: "observer-update",
      }
    );
    await expect(agentInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "forbidden",
      recoverable: false,
    });

    const ownerSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(ownerSocket);
    const ownerInbox = createInbox(ownerSocket);
    await waitForOpen(ownerSocket);
    await ownerInbox.next("whiteboard.connected");
    await expect(ownerInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 0,
      scene: { elements: [] },
    });
  });

  it("lets an administrator edit the shared scene", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Admin board", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const joined = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Admin"
    );
    const roleResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "admin" },
    });
    expect(roleResponse.statusCode).toBe(201);

    const socket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(joined.participant_token)}`
    );
    sockets.push(socket);
    const inbox = createInbox(socket);
    await waitForOpen(socket);
    await expect(inbox.next("whiteboard.connected")).resolves.toMatchObject({
      role: "admin",
      can_edit: true,
    });
    await inbox.next("whiteboard.scene");
    socket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "admin-update",
        base_revision: 0,
        elements: [
          {
            id: "admin-text",
            type: "text",
            version: 1,
            versionNonce: 303,
            text: "Admin",
          },
        ],
        app_state: {},
      })
    );
    await expect(inbox.next("whiteboard.ack")).resolves.toMatchObject({
      update_id: "admin-update",
      revision: 1,
    });
  });

  it("reconnects with the authoritative scene and keeps it out of room events", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Reconnect board", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };

    const firstSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(firstSocket);
    const firstInbox = createInbox(firstSocket);
    await waitForOpen(firstSocket);
    await firstInbox.next("whiteboard.connected");
    await firstInbox.next("whiteboard.scene");
    const textElement = {
      id: "text-1",
      type: "text",
      version: 1,
      versionNonce: 404,
      text: "Shared thought",
      x: 40,
      y: 60,
    };
    firstSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "reconnect-update",
        base_revision: 0,
        elements: [textElement],
        app_state: {},
      })
    );
    await firstInbox.next("whiteboard.ack");
    await closeSocket(firstSocket);

    const reconnected = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(reconnected);
    const reconnectInbox = createInbox(reconnected);
    await waitForOpen(reconnected);
    await reconnectInbox.next("whiteboard.connected");
    await expect(
      reconnectInbox.next("whiteboard.scene")
    ).resolves.toMatchObject({
      revision: 1,
      scene: { elements: [textElement], app_state: {} },
    });

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(eventsResponse.statusCode).toBe(200);
    const events = eventsResponse.json() as {
      events: Array<{ type: string }>;
    };
    expect(
      events.events.some((event) => event.type.startsWith("whiteboard."))
    ).toBe(false);

    const agentResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        compatibility: testConnectorCompatibility,
        name: "Replay agent",
        capabilities: ["kimi-cli"],
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json() as { agent_token: string };
    const agentStream = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/stream` +
        `?token=${encodeURIComponent(agent.agent_token)}`
    );
    sockets.push(agentStream);
    const agentEvents: Array<{ type?: string }> = [];
    agentStream.addEventListener("message", (event) => {
      agentEvents.push(JSON.parse(event.data as string) as { type?: string });
    });
    await waitForOpen(agentStream);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agentEvents.length).toBeGreaterThan(0);
    expect(
      agentEvents.some((event) => event.type?.startsWith("whiteboard."))
    ).toBe(false);
  });

  it("ends whiteboard access and closes its socket with the live room", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Temporary board", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const socket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(socket);
    const inbox = createInbox(socket);
    await waitForOpen(socket);
    await inbox.next("whiteboard.connected");
    await inbox.next("whiteboard.scene");
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
    });

    const leaveResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(leaveResponse.statusCode).toBe(201);
    await closed;

    const endedSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(endedSocket);
    const endedInbox = createInbox(endedSocket);
    await waitForOpen(endedSocket);
    await expect(endedInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "room_ended",
      recoverable: false,
    });
  });
});
