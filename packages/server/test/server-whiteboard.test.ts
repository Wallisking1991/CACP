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

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
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
    type: WhiteboardServerMessage["type"],
    predicate: (message: WhiteboardServerMessage) => boolean = () => true
  ): Promise<WhiteboardServerMessage> {
    const deadline = Date.now() + 2_000;
    while (true) {
      const index = messages.findIndex(
        (message) => message.type === type && predicate(message)
      );
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

  async function none(
    type: WhiteboardServerMessage["type"],
    durationMs = 100
  ): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return !messages.some((message) => message.type === type);
  }

  return { next, none };
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

  it("merges independent concurrent edits and deterministically resolves one element", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Convergent board", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const ownerSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    const memberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(ownerSocket, memberSocket);
    const ownerInbox = createInbox(ownerSocket);
    const memberInbox = createInbox(memberSocket);
    await Promise.all([waitForOpen(ownerSocket), waitForOpen(memberSocket)]);
    for (const inbox of [ownerInbox, memberInbox]) {
      await inbox.next("whiteboard.connected");
      await inbox.next("whiteboard.scene");
      await inbox.next("whiteboard.presence.snapshot");
    }

    const shapeA = {
      id: "shape-a",
      type: "rectangle",
      version: 1,
      versionNonce: 300,
      x: 20,
    };
    const shapeB = {
      id: "shape-b",
      type: "ellipse",
      version: 1,
      versionNonce: 400,
      y: 40,
    };
    ownerSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "owner-independent",
        base_revision: 0,
        elements: [shapeA],
        app_state: { viewBackgroundColor: "#ffffff" },
      })
    );
    await ownerInbox.next("whiteboard.elements.updated");
    await ownerInbox.next("whiteboard.ack");
    await memberInbox.next("whiteboard.elements.updated");

    memberSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "member-independent",
        base_revision: 0,
        elements: [shapeB],
        app_state: { viewBackgroundColor: "#000000" },
      })
    );
    await expect(
      memberInbox.next("whiteboard.elements.updated")
    ).resolves.toMatchObject({
      revision: 2,
      elements: [shapeA, shapeB],
      app_state: { viewBackgroundColor: "#ffffff" },
    });
    await expect(memberInbox.next("whiteboard.ack")).resolves.toMatchObject({
      revision: 2,
    });
    await expect(
      ownerInbox.next("whiteboard.elements.updated")
    ).resolves.toMatchObject({ revision: 2, elements: [shapeA, shapeB] });

    ownerSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "owner-conflict",
        base_revision: 2,
        elements: [{ ...shapeA, version: 2, versionNonce: 900, x: 90 }, shapeB],
        app_state: { viewBackgroundColor: "#ffffff" },
      })
    );
    await ownerInbox.next("whiteboard.elements.updated");
    await ownerInbox.next("whiteboard.ack");
    await memberInbox.next("whiteboard.elements.updated");

    memberSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "member-conflict",
        base_revision: 2,
        elements: [
          { ...shapeA, version: 2, versionNonce: 100, x: 100 },
          shapeB,
        ],
        app_state: { viewBackgroundColor: "#000000" },
      })
    );
    await expect(
      memberInbox.next("whiteboard.elements.updated")
    ).resolves.toMatchObject({
      revision: 4,
      elements: [
        expect.objectContaining({
          id: "shape-a",
          version: 2,
          versionNonce: 100,
          x: 100,
        }),
        shapeB,
      ],
    });
    await memberInbox.next("whiteboard.ack");
    await expect(
      ownerInbox.next("whiteboard.elements.updated")
    ).resolves.toMatchObject({
      revision: 4,
      elements: [
        expect.objectContaining({ id: "shape-a", versionNonce: 100, x: 100 }),
        shapeB,
      ],
    });
  });

  it("deduplicates retried update identifiers without another revision or broadcast", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Idempotent board", display_name: "Owner" },
      })
    ).json() as { room_id: string; owner_token: string };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const ownerSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    const memberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(ownerSocket, memberSocket);
    const ownerInbox = createInbox(ownerSocket);
    const memberInbox = createInbox(memberSocket);
    await Promise.all([waitForOpen(ownerSocket), waitForOpen(memberSocket)]);
    for (const inbox of [ownerInbox, memberInbox]) {
      await inbox.next("whiteboard.connected");
      await inbox.next("whiteboard.scene");
      await inbox.next("whiteboard.presence.snapshot");
    }

    const frame = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.elements.update",
      update_id: "retry-me",
      base_revision: 0,
      elements: [
        {
          id: "shape-1",
          type: "rectangle",
          version: 1,
          versionNonce: 701,
        },
      ],
      app_state: {},
    };
    ownerSocket.send(JSON.stringify(frame));
    await ownerInbox.next("whiteboard.elements.updated");
    await expect(ownerInbox.next("whiteboard.ack")).resolves.toMatchObject({
      revision: 1,
    });
    await memberInbox.next("whiteboard.elements.updated");

    ownerSocket.send(JSON.stringify(frame));
    await expect(ownerInbox.next("whiteboard.ack")).resolves.toMatchObject({
      update_id: "retry-me",
      revision: 1,
    });
    await expect(memberInbox.none("whiteboard.elements.updated")).resolves.toBe(
      true
    );

    ownerSocket.send(
      JSON.stringify({
        ...frame,
        elements: [
          {
            id: "shape-2",
            type: "ellipse",
            version: 1,
            versionNonce: 702,
          },
        ],
      })
    );
    await expect(ownerInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "invalid_message",
      update_id: "retry-me",
      current_revision: 1,
    });

    const lateSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(lateSocket);
    const lateInbox = createInbox(lateSocket);
    await waitForOpen(lateSocket);
    await lateInbox.next("whiteboard.connected");
    await expect(lateInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 1,
      scene: {
        elements: [expect.objectContaining({ id: "shape-1" })],
      },
    });
  });

  it("isolates over-rate, future-revision, and oversized updates before resync", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        bodyLimitBytes: 512,
        whiteboardSceneUpdateLimit: 1,
        whiteboardSceneWindowMs: 1_000,
      }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Bounded board", display_name: "Owner" },
      })
    ).json() as { room_id: string; owner_token: string };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const secondMember = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Bob"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const ownerSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    const memberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    const secondMemberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(secondMember.participant_token)}`
    );
    sockets.push(ownerSocket, memberSocket, secondMemberSocket);
    const ownerInbox = createInbox(ownerSocket);
    const memberInbox = createInbox(memberSocket);
    const secondMemberInbox = createInbox(secondMemberSocket);
    await Promise.all([
      waitForOpen(ownerSocket),
      waitForOpen(memberSocket),
      waitForOpen(secondMemberSocket),
    ]);
    for (const inbox of [ownerInbox, memberInbox, secondMemberInbox]) {
      await inbox.next("whiteboard.connected");
      await inbox.next("whiteboard.scene");
      await inbox.next("whiteboard.presence.snapshot");
    }

    const firstUpdate = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.elements.update",
      update_id: "accepted-update",
      base_revision: 0,
      elements: [
        {
          id: "accepted-shape",
          type: "rectangle",
          version: 1,
          versionNonce: 801,
        },
      ],
      app_state: {},
    };
    ownerSocket.send(JSON.stringify(firstUpdate));
    await ownerInbox.next("whiteboard.elements.updated");
    await ownerInbox.next("whiteboard.ack");
    await memberInbox.next("whiteboard.elements.updated");
    await secondMemberInbox.next("whiteboard.elements.updated");

    ownerSocket.send(
      JSON.stringify({
        ...firstUpdate,
        update_id: "too-fast",
        base_revision: 1,
      })
    );
    await expect(ownerInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "rate_limited",
      update_id: "too-fast",
      current_revision: 1,
      recoverable: true,
    });

    memberSocket.send(
      JSON.stringify({
        ...firstUpdate,
        update_id: "future-update",
        base_revision: 99,
      })
    );
    await expect(memberInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "not_synchronized",
      update_id: "future-update",
      current_revision: 1,
      recoverable: true,
    });

    secondMemberSocket.send(
      JSON.stringify({
        ...firstUpdate,
        update_id: "oversized-update",
        base_revision: 1,
        elements: [
          {
            id: "oversized-text",
            type: "text",
            version: 1,
            versionNonce: 802,
            text: "x".repeat(700),
          },
        ],
      })
    );
    await expect(
      secondMemberInbox.next("whiteboard.error")
    ).resolves.toMatchObject({
      code: "invalid_message",
      recoverable: true,
    });

    await closeSocket(memberSocket);
    const resynchronized = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(resynchronized);
    const resyncInbox = createInbox(resynchronized);
    await waitForOpen(resynchronized);
    await resyncInbox.next("whiteboard.connected");
    await expect(resyncInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 1,
      scene: {
        elements: [expect.objectContaining({ id: "accepted-shape" })],
      },
    });
  });

  it("broadcasts live presence and removes it on disconnect or heartbeat expiry", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        whiteboardPresenceHeartbeatMs: 25,
        whiteboardPresenceTtlMs: 100,
        whiteboardPresenceSweepMs: 10,
      }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Presence board", display_name: "Owner" },
      })
    ).json() as {
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
    sockets.push(ownerSocket);
    const ownerInbox = createInbox(ownerSocket);
    await waitForOpen(ownerSocket);
    await ownerInbox.next("whiteboard.connected");
    await ownerInbox.next("whiteboard.scene");
    await expect(
      ownerInbox.next("whiteboard.presence.snapshot")
    ).resolves.toMatchObject({
      collaborators: [],
    });
    ownerSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: null,
        selected_element_ids: [],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      })
    );
    await expect(
      ownerInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: room.owner_id,
        can_edit: true,
      },
    });

    const memberSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(memberSocket);
    const memberInbox = createInbox(memberSocket);
    await waitForOpen(memberSocket);
    await memberInbox.next("whiteboard.connected");
    await memberInbox.next("whiteboard.scene");
    await expect(
      memberInbox.next("whiteboard.presence.snapshot")
    ).resolves.toMatchObject({
      collaborators: [
        expect.objectContaining({
          participant_id: room.owner_id,
          display_name: "Owner",
        }),
      ],
    });

    memberSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: { x: 320, y: 180, button: "down" },
        selected_element_ids: ["shape_1"],
        viewport: { scroll_x: -50, scroll_y: 25, zoom: 1.5 },
      })
    );
    const active = await ownerInbox.next("whiteboard.presence.updated");
    expect(active).toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        display_name: "Alice",
        color: {
          background: expect.stringMatching(/^#[0-9a-f]{6}$/i),
          stroke: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        },
        cursor: { x: 320, y: 180, button: "down" },
        selected_element_ids: ["shape_1"],
        viewport: { scroll_x: -50, scroll_y: 25, zoom: 1.5 },
      },
    });
    expect(active).not.toHaveProperty("revision");
    const activeMemberColor =
      active.type === "whiteboard.presence.updated"
        ? active.collaborator.color
        : undefined;

    await expect(
      ownerInbox.next(
        "whiteboard.presence.left",
        (message) =>
          message.type === "whiteboard.presence.left" &&
          message.participant_id === member.participant_id
      )
    ).resolves.toMatchObject({
      participant_id: member.participant_id,
    });

    memberSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: null,
        selected_element_ids: [],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      })
    );
    await expect(
      ownerInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        cursor: null,
      },
    });
    await closeSocket(memberSocket);
    await expect(
      ownerInbox.next(
        "whiteboard.presence.left",
        (message) =>
          message.type === "whiteboard.presence.left" &&
          message.participant_id === member.participant_id
      )
    ).resolves.toMatchObject({
      participant_id: member.participant_id,
    });

    const reconnect = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(reconnect);
    const reconnectInbox = createInbox(reconnect);
    await waitForOpen(reconnect);
    await reconnectInbox.next("whiteboard.connected");
    await reconnectInbox.next("whiteboard.scene");
    const reconnectedPresence = await reconnectInbox.next(
      "whiteboard.presence.snapshot"
    );
    expect(reconnectedPresence).toMatchObject({ collaborators: [] });
    const reconnectedMember = (
      reconnectedPresence as {
        collaborators: Array<{
          participant_id: string;
          color: { background: string; stroke: string };
          cursor?: unknown;
          selected_element_ids?: string[];
          viewport?: unknown;
        }>;
      }
    ).collaborators.find(
      (collaborator) => collaborator.participant_id === member.participant_id
    );
    expect(reconnectedMember).toBeUndefined();
    reconnect.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: null,
        selected_element_ids: [],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      })
    );
    await expect(
      ownerInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        color: activeMemberColor,
        cursor: null,
        selected_element_ids: [],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      },
    });
  });

  it("bounds presence broadcasts without mutating the shared scene", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        whiteboardPresenceUpdateLimit: 1,
        whiteboardPresenceWindowMs: 1_000,
      }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Bounded presence", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
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
    await ownerInbox.next("whiteboard.connected");
    await ownerInbox.next("whiteboard.scene");
    await ownerInbox.next("whiteboard.presence.snapshot");
    await memberInbox.next("whiteboard.connected");
    await memberInbox.next("whiteboard.scene");
    await memberInbox.next("whiteboard.presence.snapshot");

    const presence = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.presence.update",
      cursor: { x: 30, y: 40, button: "up" },
      selected_element_ids: [],
      viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
    };
    memberSocket.send(JSON.stringify(presence));
    await expect(
      ownerInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        cursor: presence.cursor,
      },
    });

    memberSocket.send(
      JSON.stringify({
        ...presence,
        cursor: { x: 31, y: 41, button: "down" },
      })
    );
    await expect(
      memberInbox.next(
        "whiteboard.error",
        (message) =>
          message.type === "whiteboard.error" && message.code === "rate_limited"
      )
    ).resolves.toMatchObject({
      code: "rate_limited",
      recoverable: true,
    });

    const lateJoiner = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "observer",
      "Viewer"
    );
    const lateSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(lateJoiner.participant_token)}`
    );
    sockets.push(lateSocket);
    const lateInbox = createInbox(lateSocket);
    await waitForOpen(lateSocket);
    await lateInbox.next("whiteboard.connected");
    await expect(lateInbox.next("whiteboard.scene")).resolves.toMatchObject({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });
  });

  it("keeps observers passive and shares presence limits across participant sockets", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        whiteboardPresenceUpdateLimit: 1,
        whiteboardPresenceWindowMs: 1_000,
      }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Passive presence", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const ownerSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    const firstMemberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    const secondMemberSocket = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(ownerSocket, firstMemberSocket, secondMemberSocket);
    const ownerInbox = createInbox(ownerSocket);
    const firstMemberInbox = createInbox(firstMemberSocket);
    const secondMemberInbox = createInbox(secondMemberSocket);
    await Promise.all([
      waitForOpen(ownerSocket),
      waitForOpen(firstMemberSocket),
      waitForOpen(secondMemberSocket),
    ]);
    await ownerInbox.next("whiteboard.connected");
    await ownerInbox.next("whiteboard.scene");
    await expect(
      ownerInbox.next("whiteboard.presence.snapshot")
    ).resolves.toMatchObject({ collaborators: [] });
    for (const inbox of [firstMemberInbox, secondMemberInbox]) {
      await inbox.next("whiteboard.connected");
      await inbox.next("whiteboard.scene");
      await inbox.next("whiteboard.presence.snapshot");
    }

    const presence = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.presence.update",
      cursor: { x: 10, y: 20, button: "up" },
      selected_element_ids: [],
      viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
    };
    firstMemberSocket.send(JSON.stringify(presence));
    await expect(
      ownerInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: { participant_id: member.participant_id },
    });

    secondMemberSocket.send(
      JSON.stringify({
        ...presence,
        cursor: { x: 30, y: 40, button: "down" },
      })
    );
    await expect(
      secondMemberInbox.next("whiteboard.error")
    ).resolves.toMatchObject({
      code: "rate_limited",
      recoverable: true,
    });

    firstMemberSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.leave",
      })
    );
    await expect(
      ownerInbox.next(
        "whiteboard.presence.left",
        (message) =>
          message.type === "whiteboard.presence.left" &&
          message.participant_id === member.participant_id
      )
    ).resolves.toMatchObject({
      participant_id: member.participant_id,
    });
  });

  it("keeps the latest changed presence authoritative across participant sockets", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        whiteboardPresenceUpdateLimit: 10,
        whiteboardPresenceWindowMs: 1_000,
      }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Presence authority", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const watcher = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}&mode=observe`
    );
    const first = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    const second = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(watcher, first, second);
    const watcherInbox = createInbox(watcher);
    const firstInbox = createInbox(first);
    const secondInbox = createInbox(second);
    await Promise.all([
      waitForOpen(watcher),
      waitForOpen(first),
      waitForOpen(second),
    ]);
    await watcherInbox.next("whiteboard.connected");
    await watcherInbox.next("whiteboard.presence.snapshot");
    for (const inbox of [firstInbox, secondInbox]) {
      await inbox.next("whiteboard.connected");
      await inbox.next("whiteboard.scene");
      await inbox.next("whiteboard.presence.snapshot");
    }

    const presence = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.presence.update",
      cursor: { x: 10, y: 20, button: "up" },
      selected_element_ids: [],
      viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
    };
    first.send(JSON.stringify(presence));
    await watcherInbox.next("whiteboard.presence.updated");
    second.send(
      JSON.stringify({
        ...presence,
        cursor: { x: 30, y: 40, button: "down" },
      })
    );
    await watcherInbox.next("whiteboard.presence.updated");

    first.send(JSON.stringify(presence));
    first.send("{");
    await expect(firstInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "invalid_message",
    });

    const lateWatcher = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}&mode=observe`
    );
    sockets.push(lateWatcher);
    const lateInbox = createInbox(lateWatcher);
    await waitForOpen(lateWatcher);
    await lateInbox.next("whiteboard.connected");
    await expect(
      lateInbox.next("whiteboard.presence.snapshot")
    ).resolves.toMatchObject({
      collaborators: [
        expect.objectContaining({
          participant_id: member.participant_id,
          cursor: { x: 30, y: 40, button: "down" },
        }),
      ],
    });
  });

  it("reserves socket capacity for one observe-to-active handoff", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({ maxSocketsPerRoom: 1 }),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Atomic handoff", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Alice"
    );
    const url = `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard`;
    const observer = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}&mode=observe`
    );
    sockets.push(observer);
    const observerInbox = createInbox(observer);
    await waitForOpen(observer);
    await observerInbox.next("whiteboard.connected");
    await observerInbox.next("whiteboard.presence.snapshot");

    const active = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(active);
    const activeInbox = createInbox(active);
    await waitForOpen(active);
    await activeInbox.next("whiteboard.connected");
    await activeInbox.next("whiteboard.scene");
    await waitForClose(observer);
    expect(observer.readyState).toBe(WebSocket.CLOSED);

    const blocked = new WebSocket(
      `${url}?token=${encodeURIComponent(member.participant_token)}`
    );
    sockets.push(blocked);
    const blockedInbox = createInbox(blocked);
    await waitForOpen(blocked);
    await expect(blockedInbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "room_full",
    });

    await closeSocket(active);
    const retry = new WebSocket(
      `${url}?token=${encodeURIComponent(room.owner_token)}`
    );
    sockets.push(retry);
    const retryInbox = createInbox(retry);
    await waitForOpen(retry);
    await retryInbox.next("whiteboard.connected");
    await retryInbox.next("whiteboard.scene");
  });

  it("sends compact scene activity to an observe-only connection", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Compact observer", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_id: string;
      owner_token: string;
    };
    const baseUrl =
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
      `?token=${encodeURIComponent(room.owner_token)}`;
    const observerSocket = new WebSocket(`${baseUrl}&mode=observe`);
    const editorSocket = new WebSocket(baseUrl);
    sockets.push(observerSocket, editorSocket);
    const observerInbox = createInbox(observerSocket);
    const editorInbox = createInbox(editorSocket);
    await Promise.all([waitForOpen(observerSocket), waitForOpen(editorSocket)]);

    await expect(
      observerInbox.next("whiteboard.connected")
    ).resolves.toMatchObject({ observe_only: true });
    await observerInbox.next("whiteboard.presence.snapshot");
    await editorInbox.next("whiteboard.connected");
    await editorInbox.next("whiteboard.scene");
    await editorInbox.next("whiteboard.presence.snapshot");

    editorSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "compact-update",
        base_revision: 0,
        elements: [
          {
            id: "compact-shape",
            type: "rectangle",
            version: 1,
            versionNonce: 601,
          },
        ],
        app_state: {},
      })
    );
    await editorInbox.next("whiteboard.ack");
    await expect(
      observerInbox.next("whiteboard.scene.activity")
    ).resolves.toEqual(
      expect.objectContaining({
        participant_id: room.owner_id,
        revision: 1,
      })
    );
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

  it("enforces role changes on an already-open whiteboard connection", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const room = (
      await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Live permissions", display_name: "Owner" },
      })
    ).json() as {
      room_id: string;
      owner_token: string;
    };
    const member = await joinHuman(
      app,
      room.room_id,
      room.owner_token,
      "member",
      "Changing role"
    );
    const socket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(member.participant_token)}`
    );
    const watcherSocket = new WebSocket(
      `ws://${addressOf(app)}/rooms/${room.room_id}/whiteboard` +
        `?token=${encodeURIComponent(room.owner_token)}&mode=observe`
    );
    sockets.push(socket, watcherSocket);
    const inbox = createInbox(socket);
    const watcherInbox = createInbox(watcherSocket);
    await Promise.all([waitForOpen(socket), waitForOpen(watcherSocket)]);
    await inbox.next("whiteboard.connected");
    await inbox.next("whiteboard.scene");
    await watcherInbox.next("whiteboard.connected");
    await watcherInbox.next("whiteboard.presence.snapshot");
    const memberPresence = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: room.room_id,
      type: "whiteboard.presence.update",
      cursor: null,
      selected_element_ids: [],
      viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
    };
    socket.send(JSON.stringify(memberPresence));
    await expect(
      watcherInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        can_edit: true,
      },
    });

    const demotion = await app.inject({
      method: "POST",
      url:
        `/rooms/${room.room_id}/participants/` +
        `${member.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "observer" },
    });
    expect(demotion.statusCode).toBe(201);
    socket.send(JSON.stringify(memberPresence));
    await expect(
      watcherInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        can_edit: false,
      },
    });
    socket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "demoted-update",
        base_revision: 0,
        elements: [
          {
            id: "not-allowed",
            type: "rectangle",
            version: 1,
            versionNonce: 501,
          },
        ],
        app_state: {},
      })
    );
    await expect(inbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "forbidden",
      update_id: "demoted-update",
    });

    const promotion = await app.inject({
      method: "POST",
      url:
        `/rooms/${room.room_id}/participants/` +
        `${member.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member" },
    });
    expect(promotion.statusCode).toBe(201);
    socket.send(JSON.stringify(memberPresence));
    await expect(
      watcherInbox.next("whiteboard.presence.updated")
    ).resolves.toMatchObject({
      collaborator: {
        participant_id: member.participant_id,
        can_edit: true,
      },
    });
    socket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.elements.update",
        update_id: "promoted-update",
        base_revision: 0,
        elements: [
          {
            id: "now-allowed",
            type: "rectangle",
            version: 1,
            versionNonce: 502,
          },
        ],
        app_state: {},
      })
    );
    await expect(inbox.next("whiteboard.ack")).resolves.toMatchObject({
      update_id: "promoted-update",
      revision: 1,
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
    await firstInbox.next("whiteboard.presence.snapshot");
    firstSocket.send(
      JSON.stringify({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: room.room_id,
        type: "whiteboard.presence.update",
        cursor: { x: 10, y: 20, button: "up" },
        selected_element_ids: [],
        viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
      })
    );
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
    await expect(inbox.next("whiteboard.error")).resolves.toMatchObject({
      code: "room_ended",
      recoverable: false,
    });
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
