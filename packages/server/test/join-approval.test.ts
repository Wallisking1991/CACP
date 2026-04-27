import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

function cloudConfig() {
  return {
    deploymentMode: "cloud" as const,
    enableLocalLaunch: false,
    publicOrigin: "https://cacp.example.com",
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

async function owner(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  const body = created.json() as { room_id: string; owner_token: string; owner_id: string };
  return body;
}

async function invite(app: FastifyInstance, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member", expires_in_seconds: 3600 }
  });
  return response.json() as { invite_token: string };
}

describe("join approval endpoints", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("requires owner approval before returning a participant token", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);

    const pending = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: createdInvite.invite_token, display_name: "Alice" }
    });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string; request_token: string; status: string };
    expect(request.status).toBe("pending");

    const beforeApproval = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    expect(beforeApproval.json()).toMatchObject({ status: "pending" });
    expect(beforeApproval.json()).not.toHaveProperty("participant_token");

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(approved.statusCode).toBe(201);

    const afterApproval = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    const approvedBody = afterApproval.json() as { status: string; participant_token?: string; participant_id?: string };
    expect(approvedBody.status).toBe("approved");
    expect(approvedBody.participant_token).toMatch(/^cacp_/);
    expect(approvedBody.participant_id).toMatch(/^user_/);
  });

  it("makes each invite token single-use", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);
    const first = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Alice" } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Bob" } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "invite_use_limit_reached" });
  });

  it("rejects and expires pending requests without issuing tokens", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);
    const pending = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Alice" } });
    const request = pending.json() as { request_id: string; request_token: string };
    const rejected = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/reject`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(rejected.statusCode).toBe(201);
    const status = await app.inject({ method: "GET", url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
    expect(status.json()).toMatchObject({ status: "rejected" });
    const approveRejected = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(approveRejected.statusCode).toBe(409);
  });
});
