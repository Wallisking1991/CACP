import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { parseConnectionCode } from "@cacp/protocol";
import { buildServer } from "../src/server.js";
import { cloudTestConfig } from "./test-config.js";

async function createCloudRoom(dbPath: string) {
  const app = await buildServer({ dbPath, config: cloudTestConfig() });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Cloud Room", display_name: "Alice" }
  });
  expect(response.statusCode).toBe(201);
  return { app, created: response.json() as { room_id: string; owner_id: string; owner_token: string } };
}

describe("cloud server endpoints", () => {
  it("creates durable invite links that work after restart", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cloud-server-"));
    const dbPath = join(tempDir, "cloud.db");

    let first: FastifyInstance | undefined;
    let second: FastifyInstance | undefined;

    try {
      const createdFirst = await createCloudRoom(dbPath);
      first = createdFirst.app;
      const inviteResponse = await first.inject({
        method: "POST",
        url: `/rooms/${createdFirst.created.room_id}/invites`,
        headers: { authorization: `Bearer ${createdFirst.created.owner_token}` },
        payload: { role: "member" }
      });
      expect(inviteResponse.statusCode).toBe(201);
      const inviteToken = inviteResponse.json<{ invite_token: string }>().invite_token;
      await first.close();
      first = undefined;

      second = await buildServer({ dbPath, config: cloudTestConfig() });
      const pending = await second.inject({ method: "POST", url: `/rooms/${createdFirst.created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Bob" } });
      expect(pending.statusCode).toBe(201);
      const request = pending.json() as { request_id: string; request_token: string };
      const approved = await second.inject({ method: "POST", url: `/rooms/${createdFirst.created.room_id}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${createdFirst.created.owner_token}` }, payload: {} });
      expect(approved.statusCode).toBe(201);
      const status = await second.inject({ method: "GET", url: `/rooms/${createdFirst.created.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ status: "approved", role: "member" });
      await second.close();
      second = undefined;
    } finally {
      await first?.close();
      await second?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not expose plaintext invite tokens in events", async () => {
    const { app, created } = await createCloudRoom(":memory:");

    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "observer" }
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteToken = inviteResponse.json<{ invite_token: string }>().invite_token;

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/rooms/${created.room_id}/events`,
      headers: { authorization: `Bearer ${created.owner_token}` }
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(JSON.stringify(eventsResponse.json().events)).not.toContain(inviteToken);

    await app.close();
  });

  it("creates durable single-use pairings that work after restart", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cloud-server-"));
    const dbPath = join(tempDir, "cloud.db");

    let first: FastifyInstance | undefined;
    let second: FastifyInstance | undefined;

    try {
      const createdFirst = await createCloudRoom(dbPath);
      first = createdFirst.app;
      const pairingResponse = await first.inject({
        method: "POST",
        url: `/rooms/${createdFirst.created.room_id}/agent-pairings`,
        headers: { authorization: `Bearer ${createdFirst.created.owner_token}` },
        payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." }
      });
      expect(pairingResponse.statusCode).toBe(201);
      const body = pairingResponse.json() as { connection_code: string };
      const parsed = parseConnectionCode(body.connection_code);
      const pairingToken = parsed.pairing_token;
      await first.close();
      first = undefined;

      second = await buildServer({ dbPath, config: cloudTestConfig() });
      const claimResponse = await second.inject({
        method: "POST",
        url: `/agent-pairings/${pairingToken}/claim`,
        payload: { adapter_name: "Cloud Echo" }
      });
      expect(claimResponse.statusCode).toBe(201);
      expect(claimResponse.json()).toMatchObject({ room_id: createdFirst.created.room_id, agent_type: "claude-code", permission_level: "read_only" });

      const secondClaimResponse = await second.inject({
        method: "POST",
        url: `/agent-pairings/${pairingToken}/claim`,
        payload: { adapter_name: "Cloud Echo Again" }
      });
      expect(secondClaimResponse.statusCode).toBe(409);
      expect(secondClaimResponse.json()).toMatchObject({ error: "pairing_claimed" });
      await second.close();
      second = undefined;
    } finally {
      await first?.close();
      await second?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("disables start-local in cloud mode", async () => {
    let launchCount = 0;
    const app = await buildServer({
      dbPath: ":memory:",
      config: cloudTestConfig(),
      localAgentLauncher: () => {
        launchCount += 1;
        return { pid: 12345 };
      }
    });
    const roomResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Cloud Room", display_name: "Alice" }
    });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings/start-local`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "local_launch_disabled" });
    expect(launchCount).toBe(0);

    await app.close();
  });

  it("rejects messages longer than configured max", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Limit Room", display_name: "Alice" } });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const longText = "x".repeat(4001);
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/messages`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { text: longText }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rate limits room creation", async () => {
    const limitedConfig = { ...cloudTestConfig(), roomCreateLimit: 1 };
    const app = await buildServer({ dbPath: ":memory:", config: limitedConfig });

    const first = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room A", display_name: "Alice" } });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room B", display_name: "Bob" } });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: "rate_limited" });

    await app.close();
  });

  it("enforces max participants per room at invite creation and approval", async () => {
    const limitedConfig = { ...cloudTestConfig(), maxParticipantsPerRoom: 2 };
    const app = await buildServer({ dbPath: ":memory:", config: limitedConfig });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Small Room", display_name: "Alice" } });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    // Can create invite when room has space
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", max_uses: 1 }
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteToken = inviteResponse.json<{ invite_token: string }>().invite_token;

    // Fill the room
    const pending = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Bob" } });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string; request_token: string };
    const approved = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${created.owner_token}` }, payload: {} });
    expect(approved.statusCode).toBe(201);

    // Cannot create more invites when room is full
    const fullRoomInvite = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", max_uses: 1 }
    });
    expect(fullRoomInvite.statusCode).toBe(409);
    expect(fullRoomInvite.json()).toMatchObject({ error: "max_participants_reached" });

    await app.close();
  });

  it("enforces max agents per room", async () => {
    const limitedConfig = { ...cloudTestConfig(), maxAgentsPerRoom: 1 };
    const app = await buildServer({ dbPath: ":memory:", config: limitedConfig });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Agent Room", display_name: "Alice" } });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const firstPairing = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." }
    });
    expect(firstPairing.statusCode).toBe(201);
    const firstToken = parseConnectionCode((firstPairing.json() as { connection_code: string }).connection_code).pairing_token;

    const claim1 = await app.inject({
      method: "POST",
      url: `/agent-pairings/${firstToken}/claim`,
      payload: { adapter_name: "Echo 1" }
    });
    expect(claim1.statusCode).toBe(201);

    const secondPairing = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." }
    });
    expect(secondPairing.statusCode).toBe(201);
    const secondToken = parseConnectionCode((secondPairing.json() as { connection_code: string }).connection_code).pairing_token;

    const claim2 = await app.inject({
      method: "POST",
      url: `/agent-pairings/${secondToken}/claim`,
      payload: { adapter_name: "Echo 2" }
    });
    expect(claim2.statusCode).toBe(409);
    expect(claim2.json()).toMatchObject({ error: "max_agents_reached" });

    const register = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/register`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { name: "Direct Agent", capabilities: [] }
    });
    expect(register.statusCode).toBe(409);
    expect(register.json()).toMatchObject({ error: "max_agents_reached" });

    await app.close();
  });

  it("uses connector claim working directory when building the agent profile", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const roomResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Connector Room", display_name: "Alice" }
    });
    expect(roomResponse.statusCode).toBe(201);
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const pairingResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." }
    });
    expect(pairingResponse.statusCode).toBe(201);
    const pairingToken = parseConnectionCode((pairingResponse.json() as { connection_code: string }).connection_code).pairing_token;

    const localWorkingDir = "D:\\Projects\\my-app";
    const claimResponse = await app.inject({
      method: "POST",
      url: `/agent-pairings/${pairingToken}/claim`,
      payload: { adapter_name: "Local Echo", working_dir: localWorkingDir }
    });

    expect(claimResponse.statusCode).toBe(201);
    expect(claimResponse.json()).toMatchObject({
      room_id: created.room_id,
      agent: { working_dir: localWorkingDir }
    });

    await app.close();
  });

  it("falls back to pairing working_dir when claim omits working_dir", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const roomResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Fallback Room", display_name: "Alice" }
    });
    expect(roomResponse.statusCode).toBe(201);
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const pairingResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "D:\\Projects\\fallback" }
    });
    expect(pairingResponse.statusCode).toBe(201);
    const pairingToken = parseConnectionCode((pairingResponse.json() as { connection_code: string }).connection_code).pairing_token;

    const claimResponse = await app.inject({
      method: "POST",
      url: `/agent-pairings/${pairingToken}/claim`,
      payload: { adapter_name: "Fallback Echo" }
    });

    expect(claimResponse.statusCode).toBe(201);
    expect(claimResponse.json()).toMatchObject({
      room_id: created.room_id,
      agent: { working_dir: "D:\\Projects\\fallback" }
    });

    await app.close();
  });

  it("verifies invite status without authentication", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Verify Room", display_name: "Alice" } });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    // Valid invite
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteToken = inviteResponse.json<{ invite_token: string }>().invite_token;

    const validCheck = await app.inject({ method: "GET", url: `/invites/verify?token=${encodeURIComponent(inviteToken)}` });
    expect(validCheck.statusCode).toBe(200);
    expect(validCheck.json()).toEqual({ valid: true });

    // Not found
    const notFoundCheck = await app.inject({ method: "GET", url: "/invites/verify?token=invalid_token_xyz" });
    expect(notFoundCheck.statusCode).toBe(200);
    expect(notFoundCheck.json()).toEqual({ valid: false, reason: "not_found" });

    await app.close();
  });

  it("reports expired, revoked, and limit_reached invite states", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "States Room", display_name: "Alice" } });
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    // Expired invite
    const expiredInviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", expires_in_seconds: 1, max_uses: 1 }
    });
    expect(expiredInviteResponse.statusCode).toBe(201);
    const expiredToken = expiredInviteResponse.json<{ invite_token: string }>().invite_token;

    await new Promise((r) => setTimeout(r, 1100));

    const expiredCheck = await app.inject({ method: "GET", url: `/invites/verify?token=${encodeURIComponent(expiredToken)}` });
    expect(expiredCheck.statusCode).toBe(200);
    expect(expiredCheck.json()).toEqual({ valid: false, reason: "expired" });

    // Limit reached / auto-revoked invite
    const limitedInviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    });
    expect(limitedInviteResponse.statusCode).toBe(201);
    const limitedToken = limitedInviteResponse.json<{ invite_token: string }>().invite_token;

    const pending = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: limitedToken, display_name: "Bob" } });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string };

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: {}
    });
    expect(approved.statusCode).toBe(201);

    // After approval, invite is auto-revoked (used_count >= max_uses)
    const revokedCheck = await app.inject({ method: "GET", url: `/invites/verify?token=${encodeURIComponent(limitedToken)}` });
    expect(revokedCheck.statusCode).toBe(200);
    expect(revokedCheck.json()).toEqual({ valid: false, reason: "revoked" });

    // Limit reached via pending requests
    const freshInviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    });
    expect(freshInviteResponse.statusCode).toBe(201);
    const freshToken = freshInviteResponse.json<{ invite_token: string }>().invite_token;

    const freshPending = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: freshToken, display_name: "Charlie" } });
    expect(freshPending.statusCode).toBe(201);

    // Now there is 1 pending request and max_uses=1, so limit is reached
    const limitCheck = await app.inject({ method: "GET", url: `/invites/verify?token=${encodeURIComponent(freshToken)}` });
    expect(limitCheck.statusCode).toBe(200);
    expect(limitCheck.json()).toEqual({ valid: false, reason: "limit_reached" });

    await app.close();
  });
});
