import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndOwner() {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Claude Room", display_name: "Owner" } });
  const room = roomResponse.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room };
}

async function registerAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: "Claude Code Agent", capabilities: ["claude-code", "claude.persistent_session"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

describe("Claude session room routes", () => {
  it("lets the registered agent publish a Claude session catalog", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-catalog`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        working_dir: "D:\\Development\\2",
        sessions: [{
          session_id: "session_1",
          title: "Planning",
          project_dir: "D:\\Development\\2",
          updated_at: "2026-04-29T00:00:00.000Z",
          message_count: 2,
          byte_size: 1000,
          importable: true
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    const events = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(events.body).toContain("claude.session_catalog.updated");
    await app.close();
  });

  it("lets only owner or admin select a Claude session", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    const agentSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1" }
    });
    expect(agentSelect.statusCode).toBe(403);

    const ownerSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1" }
    });
    expect(ownerSelect.statusCode).toBe(201);
    expect(ownerSelect.json()).toEqual({ ok: true });
    await app.close();
  });

  it("lets only the matching agent publish import messages and runtime status", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    const otherAgent = await registerAgent(app, room.room_id, room.owner_token);

    const importStart = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        import_id: "import_1",
        agent_id: agent.agent_id,
        session_id: "session_1",
        title: "Imported",
        message_count: 1,
        started_at: "2026-04-29T00:00:00.000Z"
      }
    });
    expect(importStart.statusCode).toBe(201);

    const wrongAgentMessage = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/import_1/messages`,
      headers: { authorization: `Bearer ${otherAgent.agent_token}` },
      payload: [{
        import_id: "import_1",
        agent_id: agent.agent_id,
        session_id: "session_1",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Should be rejected"
      }]
    });
    expect(wrongAgentMessage.statusCode).toBe(403);

    const messageBatch = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/import_1/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        import_id: "import_1",
        agent_id: agent.agent_id,
        session_id: "session_1",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Imported visible answer"
      }]
    });
    expect(messageBatch.statusCode).toBe(201);
    expect(messageBatch.json()).toEqual({ ok: true, imported: 1 });

    const status = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/runtime-status`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        kind: "changed",
        payload: {
          agent_id: agent.agent_id,
          turn_id: "turn_1",
          status_id: "status_turn_1",
          phase: "thinking",
          current: "Thinking",
          recent: ["Thinking"],
          metrics: { files_read: 0, searches: 0, commands: 0 },
          started_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:00:01.000Z"
        }
      }
    });
    expect(status.statusCode).toBe(201);

    await app.close();
  });
});
