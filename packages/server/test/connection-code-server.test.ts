import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parseConnectionCode } from "@cacp/protocol";
import { buildServer, type LocalAgentLaunchInput } from "../src/server.js";
import { cloudTestConfig } from "./test-config.js";

describe("agent pairing connection codes", () => {
  it("returns a connection code without exposing a raw pairing token", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: ".", server_url: "https://cacp.example.com" }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { connection_code: string; pairing_token?: string; download_url: string; expires_at: string };
    expect(body.pairing_token).toBeUndefined();
    expect(body.download_url).toBe("/downloads/CACP-Local-Connector-v0.5.0.zip");
    const parsed = parseConnectionCode(body.connection_code);
    expect(parsed.server_url).toBe("https://cacp.example.com");
    expect(parsed.room_id).toBe(room.room_id);
    expect(parsed.permission_level).toBe("read_only");
    await app.close();
  });

  it("rejects removed generic local command agent types", async () => {
    const app = await buildServer({ dbPath: ":memory:" });
    const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
    const room = roomResponse.json() as { room_id: string; owner_token: string };

    for (const removedType of ["codex", "opencode", "echo"]) {
      const response = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-pairings`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { agent_type: removedType, permission_level: "read_only", working_dir: "." }
      });
      expect(response.statusCode).toBe(400);
    }

    await app.close();
  });
});
