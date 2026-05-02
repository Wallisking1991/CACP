import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { roomDelivery, targetedDelivery, roleDelivery, canDeliverEnvelope, type RelayEnvelope } from "../src/relay.js";
import { EventBus } from "../src/event-bus.js";
import { EventStore } from "../src/event-store.js";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

describe("relay delivery", () => {
  it("roomDelivery returns kind room", () => {
    const d = roomDelivery();
    expect(d.kind).toBe("room");
  });

  it("targetedDelivery returns kind targeted with deduped ids", () => {
    const d = targetedDelivery(["user_1", "agent_1", "user_1"]);
    expect(d.kind).toBe("targeted");
    if (d.kind === "targeted") {
      expect(d.participant_ids).toEqual(["user_1", "agent_1"]);
    }
  });

  it("canDeliverEnvelope allows room delivery for any participant", () => {
    const envelope: RelayEnvelope = {
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_1",
        room_id: "room_1",
        type: "message.created",
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: roomDelivery()
    };
    expect(canDeliverEnvelope(envelope, { id: "user_2", room_id: "room_1", type: "human", display_name: "Bob", role: "member", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "agent_1", room_id: "room_1", type: "agent", display_name: "Agent", role: "agent", main_thread_history_access: "allowed" })).toBe(true);
  });

  it("canDeliverEnvelope allows targeted delivery only for listed participants", () => {
    const envelope: RelayEnvelope = {
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_1",
        room_id: "room_1",
        type: "connector.snapshot.entry",
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: targetedDelivery(["user_1", "agent_1"])
    };
    expect(canDeliverEnvelope(envelope, { id: "user_1", room_id: "room_1", type: "human", display_name: "Alice", role: "owner", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "agent_1", room_id: "room_1", type: "agent", display_name: "Agent", role: "agent", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "user_2", room_id: "room_1", type: "human", display_name: "Bob", role: "member", main_thread_history_access: "allowed" })).toBe(false);
  });

  it("roleDelivery({roles}) builds a role-kind RelayDelivery", () => {
    const d = roleDelivery(["owner", "member"]);
    expect(d).toEqual({ kind: "role", roles: ["owner", "member"] });
  });

  it("canDeliverEnvelope allows role delivery only for matching roles", () => {
    const envelope: RelayEnvelope = {
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_1",
        room_id: "room_1",
        type: "orbit.note.created",
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: roleDelivery(["owner", "admin", "member", "observer"])
    };
    expect(canDeliverEnvelope(envelope, { id: "user_1", room_id: "room_1", type: "human", display_name: "Alice", role: "owner", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "user_2", room_id: "room_1", type: "human", display_name: "Bob", role: "member", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "agent_1", room_id: "room_1", type: "agent", display_name: "Agent", role: "agent", main_thread_history_access: "allowed" })).toBe(false);
  });
});

describe("EventBus role filtering", () => {
  it("invokes subscribers regardless of role; filtering is delegated to canDeliverEnvelope", () => {
    // EventBus itself just dispatches envelopes; per-subscriber role filtering happens in
    // the WS dispatch via canDeliverEnvelope. This test asserts the dispatch contract:
    // when an envelope has a role delivery, only listeners whose participant role matches
    // should *act*. We model that by using canDeliverEnvelope inside the listener.
    const bus = new EventBus();
    const ownerCalls: string[] = [];
    const agentCalls: string[] = [];
    const ownerParticipant = { id: "u1", room_id: "room_1", type: "human" as const, display_name: "Owner", role: "owner" as const, main_thread_history_access: "allowed" as const };
    const agentParticipant = { id: "a1", room_id: "room_1", type: "agent" as const, display_name: "Agent", role: "agent" as const, main_thread_history_access: "allowed" as const };
    bus.subscribe("room_1", (envelope) => {
      if (canDeliverEnvelope(envelope, ownerParticipant)) ownerCalls.push(envelope.event.event_id);
    });
    bus.subscribe("room_1", (envelope) => {
      if (canDeliverEnvelope(envelope, agentParticipant)) agentCalls.push(envelope.event.event_id);
    });
    bus.publish({
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_role_1",
        room_id: "room_1",
        type: "orbit.note.created",
        actor_id: "u1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: roleDelivery(["owner", "admin", "member", "observer"])
    });
    expect(ownerCalls).toEqual(["evt_role_1"]);
    expect(agentCalls).toEqual([]);
  });
});

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

describe("orbit role-filtered delivery (integration)", () => {
  let app: FastifyInstance | undefined;
  // Uses afterEach via dynamic import would complicate; rely on manual close.
  it("orbit.note.created reaches owner socket but NOT agent socket", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });

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

      const ownerWs = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
      const agentWs = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${agent.agent_token}`);
      await Promise.all([waitForOpen(ownerWs), waitForOpen(agentWs)]);

      const ownerEvents: Array<{ type: string }> = [];
      const agentEvents: Array<{ type: string }> = [];
      ownerWs.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        ownerEvents.push(parsed);
      });
      agentWs.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        agentEvents.push(parsed);
      });

      const ownerNotePromise = new Promise<void>((resolve) => {
        ownerWs.addEventListener("message", (msg) => {
          const parsed = JSON.parse(msg.data as string);
          if (parsed.type === "orbit.note.created") resolve();
        });
      });

      const noteRes = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/orbit/notes`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { text: "Secret note" }
      });
      expect(noteRes.statusCode).toBe(201);

      await ownerNotePromise;
      // Allow any stray broadcast a tick to land
      await new Promise((r) => setTimeout(r, 50));

      ownerWs.close();
      agentWs.close();

      expect(ownerEvents.some((e) => e.type === "orbit.note.created")).toBe(true);
      expect(agentEvents.some((e) => e.type === "orbit.note.created")).toBe(false);
    } finally {
      await app.close();
      app = undefined;
    }
  });
});

describe("publishLiveOnly persistence guarantee", () => {
  it("orbit.note.created live broadcast is NOT persisted to event store", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cacp-relay-"));
    const dbPath = join(tmp, "events.db");
    const app = await buildServer({ dbPath, config: localTestConfig() });
    let roomId = "";
    try {
      const created = await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { name: "Room", display_name: "Owner" }
      });
      const room = created.json() as { room_id: string; owner_token: string };
      roomId = room.room_id;

      const agentReg = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agents/register`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { name: "TestAgent", capabilities: ["llm-api"] }
      });
      const agent = agentReg.json() as { agent_id: string };
      await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agents/select`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { agent_id: agent.agent_id }
      });

      const noteRes = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/orbit/notes`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { text: "Live only" }
      });
      expect(noteRes.statusCode).toBe(201);
    } finally {
      await app.close();
    }

    const store = new EventStore(dbPath);
    try {
      const events = store.listEvents(roomId);
      expect(events.some((e) => e.type === "orbit.note.created")).toBe(false);
    } finally {
      store.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
