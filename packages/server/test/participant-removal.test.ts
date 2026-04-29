import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { EventStore } from "../src/event-store.js";
import { buildServer } from "../src/server.js";

function config() {
  return {
    deploymentMode: "local" as const,
    enableLocalLaunch: true,
    tokenSecret: "0123456789abcdef0123456789abcdef",
    bodyLimitBytes: 1024 * 1024,
    maxMessageLength: 4000,
    maxParticipantsPerRoom: 20,
    maxAgentsPerRoom: 3,
    maxSocketsPerRoom: 50,
    rateLimitWindowMs: 60_000,
    roomCreateLimit: 20,
    inviteCreateLimit: 60,
    joinAttemptLimit: 60,
    pairingCreateLimit: 30,
    messageCreateLimit: 120
  };
}

async function joinViaApproval(app: FastifyInstance, roomId: string, ownerToken: string, inviteToken: string, displayName: string) {
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteToken, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${ownerToken}` }, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  return status.json() as { participant_id: string; participant_token: string; role: string };
}

describe("participant removal", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("revokes a member token and records a removal event", async () => {
    app = await buildServer({ dbPath: ":memory:", config: config() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");

    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { reason: "owner_removed" }
    });
    expect(removed.statusCode).toBe(201);

    const message = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: { authorization: `Bearer ${joined.participant_token}` },
      payload: { text: "after removal" }
    });
    expect(message.statusCode).toBe(401);

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: { authorization: `Bearer ${room.owner_token}` } })).json() as { events: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(events.events.some((event) => event.type === "participant.removed" && event.payload.participant_id === joined.participant_id)).toBe(true);
  });


  it("owner leave revokes everyone and records room shutdown events", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-owner-leave-"));
    const dbPath = join(tempDir, "room.db");
    try {
      app = await buildServer({ dbPath, config: config() });
      const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
      const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
      const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member" } })).json() as { invite_token: string };
      const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");
      const agentResponse = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Claude", capabilities: ["claude-code"] } });
      expect(agentResponse.statusCode).toBe(201);
      const agent = agentResponse.json() as { agent_id: string; agent_token: string };

      const left = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/leave`, headers: ownerAuth, payload: {} });
      expect(left.statusCode).toBe(201);
      expect(left.json()).toEqual({ ok: true, status: "room_closed" });

      const ownerMessage = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "owner after leave" } });
      expect(ownerMessage.statusCode).toBe(401);
      expect(ownerMessage.json()).toEqual({ error: "invalid_token" });

      const memberMessage = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/messages`,
        headers: { authorization: `Bearer ${joined.participant_token}` },
        payload: { text: "member after owner leave" }
      });
      expect(memberMessage.statusCode).toBe(401);
      expect(memberMessage.json()).toEqual({ error: "invalid_token" });

      const agentTurnStart = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-turns/turn_missing/start`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {}
      });
      expect(agentTurnStart.statusCode).toBe(401);
      expect(agentTurnStart.json()).toEqual({ error: "invalid_token" });

      await app.close();
      app = undefined;
      const store = new EventStore(dbPath);
      try {
        const events = store.listEvents(room.room_id);
        const removals = events.filter((event) => event.type === "participant.removed");
        expect(removals).toEqual(expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: room.owner_id, removed_by: room.owner_id, reason: "owner_left_room" }) }),
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: joined.participant_id, removed_by: room.owner_id, reason: "owner_left_room" }) }),
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: agent.agent_id, removed_by: room.owner_id, reason: "owner_left_room" }) })
        ]));
        expect(events).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "agent.status_changed", payload: expect.objectContaining({ agent_id: agent.agent_id, status: "offline" }) })
        ]));
      } finally {
        store.close();
      }
    } finally {
      await app?.close();
      app = undefined;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not allow removing the owner", async () => {
    app = await buildServer({ dbPath: ":memory:", config: config() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${room.owner_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({ error: "cannot_remove_owner" });
  });
});
