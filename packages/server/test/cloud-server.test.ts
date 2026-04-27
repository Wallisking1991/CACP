import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

function cloudConfig() {
  return {
    deploymentMode: "cloud" as const,
    enableLocalLaunch: false,
    publicOrigin: "https://cacp.zuchongai.com",
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

async function createCloudRoom(dbPath: string) {
  const app = await buildServer({ dbPath, config: cloudConfig() });
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

      second = await buildServer({ dbPath, config: cloudConfig() });
      const joinResponse = await second.inject({
        method: "POST",
        url: `/rooms/${createdFirst.created.room_id}/join`,
        payload: { invite_token: inviteToken, display_name: "Bob" }
      });
      expect(joinResponse.statusCode).toBe(201);
      expect(joinResponse.json()).toMatchObject({ role: "member" });
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
        payload: { agent_type: "echo", permission_level: "read_only", working_dir: "." }
      });
      expect(pairingResponse.statusCode).toBe(201);
      const pairingToken = pairingResponse.json<{ pairing_token: string }>().pairing_token;
      await first.close();
      first = undefined;

      second = await buildServer({ dbPath, config: cloudConfig() });
      const claimResponse = await second.inject({
        method: "POST",
        url: `/agent-pairings/${pairingToken}/claim`,
        payload: { adapter_name: "Cloud Echo" }
      });
      expect(claimResponse.statusCode).toBe(201);
      expect(claimResponse.json()).toMatchObject({ room_id: createdFirst.created.room_id, agent_type: "echo", permission_level: "read_only" });

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
      config: cloudConfig(),
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
      payload: { agent_type: "echo", permission_level: "read_only", working_dir: "." }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "local_launch_disabled" });
    expect(launchCount).toBe(0);

    await app.close();
  });
});
