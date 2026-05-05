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

  it("reuses pending approval requests, nests the approval under the tool node, and replays the stored decision", async () => {
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

    const approvalPayload = {
      agent_id: agent.agent_id,
      turn_id: turnId,
      tool_node_id: "toolu_1",
      tool_use_id: "toolu_1",
      tool_name: "Bash",
      title: "Claude wants to run Bash",
      requested_at: "2026-05-05T00:00:03.000Z"
    };

    const approvalPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: approvalPayload
    });
    const duplicateApprovalPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: approvalPayload
    });
    void approvalPromise.catch(() => undefined);
    void duplicateApprovalPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resolved = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/resolve`,
      headers: ownerAuth,
      payload: {
        decision: "allow"
      }
    });

    expect(resolved.statusCode).toBe(201);
    expect((await approvalPromise).json()).toMatchObject({ decision: "allow" });
    expect((await duplicateApprovalPromise).json()).toMatchObject({ decision: "allow" });

    const replayed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: approvalPayload
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toMatchObject({ decision: "allow" });

    const publishedEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: ownerAuth
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const approvalStartedEvents = publishedEvents.filter((event) => event.type === "agent.run.node.started" && event.payload.node_id === "approval_1");
    expect(approvalStartedEvents).toHaveLength(1);
    expect(approvalStartedEvents[0]?.payload).toMatchObject({
      node_id: "approval_1",
      kind: "approval",
      parent_node_id: "toolu_1",
      source_refs: {
        tool_use_id: "toolu_1"
      }
    });
    expect(approvalStartedEvents[0]?.payload).not.toHaveProperty("source_refs.parent_tool_use_id");

    const approvalCompletedEvent = publishedEvents.find((event) => event.type === "agent.run.node.completed" && event.payload.node_id === "approval_1");
    expect(approvalCompletedEvent?.payload).toMatchObject({
      node_id: "approval_1",
      summary: "Approved",
      detail: expect.objectContaining({
        decision: "allow"
      })
    });
    expect(approvalCompletedEvent?.payload).not.toHaveProperty("status");
    expect(approvalCompletedEvent?.payload).not.toHaveProperty("updated_at");

    await app.close();
  });

  it("rejects conflicting interaction node ids instead of aliasing them", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    for (const node_id of ["toolu_1", "approval_1", "elicit_1"]) {
      const response = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/start`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id,
          kind: "tool",
          status: "running",
          title: `Tool ${node_id}`,
          started_at: "2026-05-05T00:00:02.000Z",
          updated_at: "2026-05-05T00:00:02.000Z"
        }
      });
      expect(response.statusCode).toBe(201);
    }

    const approvalConflict = await app.inject({
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
    expect(approvalConflict.statusCode).toBe(409);
    expect(approvalConflict.json()).toMatchObject({ error: "node_id_conflict" });

    const elicitationConflict = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        message: "Need more input",
        requested_at: "2026-05-05T00:00:03.000Z"
      }
    });
    expect(elicitationConflict.statusCode).toBe(409);
    expect(elicitationConflict.json()).toMatchObject({ error: "node_id_conflict" });

    await app.close();
  });

  it("auto-closes pending interactions when the run fails", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    const elicitationPayload = {
      agent_id: agent.agent_id,
      turn_id: turnId,
      message: "Open the auth URL and continue",
      mode: "url",
      url: "https://example.com/auth",
      requested_at: "2026-05-05T00:00:03.000Z"
    };

    const elicitationPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: elicitationPayload
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

    const replayed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: elicitationPayload
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toMatchObject({ action: "cancel", reason: "run_closed" });

    const publishedEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: ownerAuth
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const elicitationCompletedEvent = publishedEvents.find((event) => event.type === "agent.run.node.completed" && event.payload.node_id === "elicit_1");
    expect(elicitationCompletedEvent?.payload).toMatchObject({
      node_id: "elicit_1",
      detail: expect.objectContaining({
        action: "cancel",
        reason: "run_closed"
      })
    });
    expect(elicitationCompletedEvent?.payload).not.toHaveProperty("status");
    expect(elicitationCompletedEvent?.payload).not.toHaveProperty("updated_at");

    await app.close();
  });
});
