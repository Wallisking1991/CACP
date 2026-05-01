import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndOwner() {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Agent Room", display_name: "Owner" } });
  const room = roomResponse.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room };
}

async function registerLocalAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, provider: "claude-code" | "codex-cli") {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      name: provider === "codex-cli" ? "Codex CLI Agent" : "Claude Code Agent",
      capabilities: provider === "codex-cli"
        ? ["codex-cli", "code-agent.persistent_session", "code-agent.local_execution"]
        : ["claude-code", "claude.persistent_session"]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

async function selectAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, agentId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/select`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { agent_id: agentId }
  });
  expect(response.statusCode).toBe(201);
}

describe("generic local agent session routes", () => {
  it("lets a Codex connector publish a generic session catalog", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/catalog`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        working_dir: "D:\\Development\\2",
        sessions: [{
          session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187",
          title: "Codex thread 019de11a",
          project_dir: "D:\\Development\\2",
          updated_at: "2026-05-01T01:15:01.643Z",
          message_count: 3,
          byte_size: 71545,
          importable: true,
          provider: "codex-cli"
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    const events = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string; payload: { provider?: string } }>;
    expect(events.some((event) => event.type === "agent.session_catalog.updated" && event.payload.provider === "codex-cli")).toBe(true);
    await app.close();
  });

  it("rejects provider mismatch for generic session catalog publishing", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/catalog`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "claude-code",
        working_dir: "D:\\Development\\2",
        sessions: []
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "provider_mismatch" });
    await app.close();
  });

  it("lets managers select a generic Codex session and the connector report readiness", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        mode: "resume",
        session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187"
      }
    });
    expect(selection.statusCode).toBe(201);

    const ready = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/ready`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        mode: "resume",
        session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187",
        ready_at: "2026-05-01T01:15:02.000Z"
      }
    });
    expect(ready.statusCode).toBe(201);

    await app.close();
  });
});
