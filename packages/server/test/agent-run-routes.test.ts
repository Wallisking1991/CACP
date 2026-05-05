import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndAgent() {
  const app = await buildServer({ dbPath: ":memory:" });
  const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Run Trace Room", display_name: "Owner" } })).json();
  const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
  const agent = (await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agents/register`,
    headers: ownerAuth,
    payload: { name: "Claude Code Agent", capabilities: ["claude-code", "claude.persistent_session"] }
  })).json();
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/claude/session-selection`, headers: ownerAuth, payload: { agent_id: agent.agent_id, mode: "fresh" } });
  await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/claude/session-ready`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
    payload: { agent_id: agent.agent_id, mode: "fresh", session_id: "session_1", ready_at: "2026-05-05T00:00:00.000Z" }
  });
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Run now" } });
  return { app, room, ownerAuth, agent };
}

describe("agent run routes", () => {
  it("accepts run lifecycle and node publication for the active turn owner", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    expect((await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { run_id: turnId, turn_id: turnId, agent_id: agent.agent_id, provider: "claude-code", started_at: "2026-05-05T00:00:01.000Z" }
    })).statusCode).toBe(201);

    expect((await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        node_id: "toolu_1",
        kind: "tool",
        status: "running",
        title: "Read README.md",
        started_at: "2026-05-05T00:00:02.000Z",
        updated_at: "2026-05-05T00:00:02.000Z"
      }
    })).statusCode).toBe(201);

    await app.close();
  });

  it("lets only owner or admin resolve a pending approval", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        node_id: "toolu_1",
        kind: "tool",
        status: "running",
        title: "Bash npm install",
        started_at: "2026-05-05T00:00:02.000Z",
        updated_at: "2026-05-05T00:00:02.000Z"
      }
    });

  const approvalPromise = app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        tool_node_id: "toolu_1",
        tool_use_id: "toolu_1",
        tool_name: "Bash",
        title: "Claude wants to run Bash",
      requested_at: "2026-05-05T00:00:03.000Z"
    }
  });
  void approvalPromise.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const resolved = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/resolve`,
      headers: ownerAuth,
      payload: { decision: "allow" }
    });

    expect(resolved.statusCode).toBe(201);
    expect((await approvalPromise).json()).toMatchObject({ decision: "allow" });
    await app.close();
  });

  it("auto-closes pending interactions when the run fails", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

  const elicitationPromise = app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/request`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        message: "Open the auth URL and continue",
        mode: "url",
        url: "https://example.com/auth",
      requested_at: "2026-05-05T00:00:03.000Z"
    }
  });
  void elicitationPromise.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));

  await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-runs/${turnId}/fail`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        error: "run_failed",
        metrics: { files_read: 0, searches: 0, commands: 0 },
        failed_at: "2026-05-05T00:00:04.000Z"
      }
    });

    expect((await elicitationPromise).json()).toMatchObject({ action: "cancel", reason: "run_closed" });
    await app.close();
  });
});
