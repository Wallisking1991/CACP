import { describe, expect, it } from "vitest";
import { parseConnectionCode } from "@cacp/protocol";
import { buildServer } from "../src/server.js";

describe("agent pairing connection codes", () => {
  it("returns a connection code without exposing a raw pairing token", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: {
      deploymentMode: "cloud",
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
    } });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_type: "codex", permission_level: "read_only", working_dir: ".", server_url: "https://cacp.example.com" }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { connection_code: string; pairing_token?: string; download_url: string; expires_at: string };
    expect(body.pairing_token).toBeUndefined();
    expect(body.download_url).toBe("/downloads/CACP-Local-Connector.exe");
    const parsed = parseConnectionCode(body.connection_code);
    expect(parsed.server_url).toBe("https://cacp.example.com");
    expect(parsed.room_id).toBe(room.room_id);
    expect(parsed.permission_level).toBe("read_only");
    await app.close();
  });
});
