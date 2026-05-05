import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndAgent(options?: Parameters<typeof buildServer>[0]) {
  const app = await buildServer({ dbPath: ":memory:", ...options });
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

async function joinApprovedMember(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, displayName: string) {
  const invite = (await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" }
  })).json() as { invite_token: string };
  const pending = (await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: invite.invite_token, display_name: displayName }
  })).json() as { request_id: string; request_token: string };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${pending.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {}
  });
  return (await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${pending.request_id}?request_token=${encodeURIComponent(pending.request_token)}`
  })).json() as { participant_id: string; participant_token: string };
}

async function currentTurnId(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerAuth: { authorization: string }) {
  const events = (await app.inject({ method: "GET", url: `/rooms/${roomId}/events`, headers: ownerAuth })).json().events;
  return events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id as string;
}

async function startRun(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, agentToken: string, agentId: string, turnId: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-runs/${turnId}/start`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: {
      run_id: turnId,
      turn_id: turnId,
      agent_id: agentId,
      provider: "claude-code",
      started_at: "2026-05-05T00:00:01.000Z",
      ...overrides
    }
  });
}

async function startNode(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, agentToken: string, agentId: string, turnId: string, nodeId: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-runs/${turnId}/nodes/start`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: {
      run_id: turnId,
      turn_id: turnId,
      agent_id: agentId,
      provider: "claude-code",
      node_id: nodeId,
      kind: "tool",
      status: "running",
      title: `Tool ${nodeId}`,
      started_at: "2026-05-05T00:00:02.000Z",
      updated_at: "2026-05-05T00:00:02.000Z",
      ...overrides
    }
  });
}

describe("agent run routes", () => {
  it("accepts run lifecycle and node publication for the active turn owner", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    expect((await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId)).statusCode).toBe(201);

    expect((await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1", {
      title: "Read README.md"
    })).statusCode).toBe(201);

    await app.close();
  });

  it("replays identical run starts and rejects conflicting ones", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    const first = await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);
    const replay = await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);
    const conflict = await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId, {
      started_at: "2026-05-05T00:00:09.000Z"
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "run_id_conflict" });

    await app.close();
  });

  it("rejects provider mismatches on run publication routes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    const mismatchedStart = await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId, {
      provider: "codex-cli"
    });
    expect(mismatchedStart.statusCode).toBe(403);
    expect(mismatchedStart.json()).toMatchObject({ error: "provider_mismatch" });

    await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);

    const complete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "codex-cli",
        message_id: "msg_1",
        summary: "Run complete",
        metrics: { files_read: 0, searches: 0, commands: 0 },
        completed_at: "2026-05-05T00:00:04.000Z"
      }
    });
    expect(complete.statusCode).toBe(403);
    expect(complete.json()).toMatchObject({ error: "provider_mismatch" });

    const fail = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/fail`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "codex-cli",
        error: "run_failed",
        failed_at: "2026-05-05T00:00:04.000Z"
      }
    });
    expect(fail.statusCode).toBe(403);
    expect(fail.json()).toMatchObject({ error: "provider_mismatch" });

    await app.close();
  });

  it("replays identical node starts and rejects conflicting ones", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);

    const first = await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");
    const replay = await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");
    const conflict = await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1", {
      title: "Updated Tool"
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "node_id_conflict" });

    await app.close();
  });

  it("rejects provider mismatches on node publication routes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);

    const mismatchedStart = await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1", {
      provider: "codex-cli"
    });
    expect(mismatchedStart.statusCode).toBe(403);
    expect(mismatchedStart.json()).toMatchObject({ error: "provider_mismatch" });

    await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/delta`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "codex-cli",
          node_id: "toolu_1",
          delta_type: "text",
          chunk: "hello",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/update`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "codex-cli",
          node_id: "toolu_1",
          status: "running",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/complete`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "codex-cli",
          node_id: "toolu_1",
          summary: "done",
          completed_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/fail`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "codex-cli",
          node_id: "toolu_1",
          error: "node_failed",
          failed_at: "2026-05-05T00:00:05.000Z"
        }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: "provider_mismatch" });
    }

    await app.close();
  });

  it("rejects further run and node mutations after the run completes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);
    await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");

    const completed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        message_id: "msg_1",
        summary: "Run complete",
        metrics: { files_read: 0, searches: 0, commands: 0 },
        completed_at: "2026-05-05T00:00:04.000Z"
      }
    });
    expect(completed.statusCode).toBe(201);

    const responses = await Promise.all([
      startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/complete`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          message_id: "msg_2",
          summary: "Run complete again",
          metrics: { files_read: 0, searches: 0, commands: 0 },
          completed_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/fail`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          error: "run_failed",
          failed_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_2"),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/delta`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          delta_type: "text",
          chunk: "hello",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/update`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          status: "running",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/complete`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          summary: "done",
          completed_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/fail`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          error: "node_failed",
          failed_at: "2026-05-05T00:00:05.000Z"
        }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "run_closed" });
    }

    await app.close();
  });

  it("rejects further node mutations after the node completes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    await startRun(app, room.room_id, agent.agent_token, agent.agent_id, turnId);
    await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");

    const completed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        node_id: "toolu_1",
        summary: "done",
        completed_at: "2026-05-05T00:00:04.000Z"
      }
    });
    expect(completed.statusCode).toBe(201);

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/delta`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          delta_type: "text",
          chunk: "hello",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/update`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          status: "running",
          updated_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/complete`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          summary: "done again",
          completed_at: "2026-05-05T00:00:05.000Z"
        }
      }),
      app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-runs/${turnId}/nodes/toolu_1/fail`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {
          run_id: turnId,
          turn_id: turnId,
          agent_id: agent.agent_id,
          provider: "claude-code",
          node_id: "toolu_1",
          error: "node_failed",
          failed_at: "2026-05-05T00:00:05.000Z"
        }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "node_closed" });
    }

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

  it("lets only owner or admin resolve a pending approval", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const member = await joinApprovedMember(app, room.room_id, room.owner_token, "Member");
    const admin = await joinApprovedMember(app, room.room_id, room.owner_token, "Admin");
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${admin.participant_id}/role`,
      headers: ownerAuth,
      payload: { role: "admin" }
    });

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
        node_id: "toolu_admin",
        kind: "tool",
        status: "running",
        title: "Bash npm install",
        started_at: "2026-05-05T00:00:02.000Z",
        updated_at: "2026-05-05T00:00:02.000Z"
      }
    });

    const approvalPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_admin/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        tool_node_id: "toolu_admin",
        tool_use_id: "toolu_admin",
        tool_name: "Bash",
        title: "Claude wants to run Bash",
        requested_at: "2026-05-05T00:00:03.000Z"
      }
    });
    void approvalPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const memberResolve = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_admin/resolve`,
      headers: { authorization: `Bearer ${member.participant_token}` },
      payload: { decision: "deny" }
    });
    expect(memberResolve.statusCode).toBe(403);
    expect(memberResolve.json()).toMatchObject({ error: "forbidden" });

    const adminResolve = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_admin/resolve`,
      headers: { authorization: `Bearer ${admin.participant_token}` },
      payload: { decision: "allow" }
    });
    expect(adminResolve.statusCode).toBe(201);
    expect((await approvalPromise).json()).toMatchObject({ decision: "allow" });

    await app.close();
  });

  it("rejects approval retries when the same node id changes the original request payload", async () => {
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
      description: "Execute npm install",
      requested_at: "2026-05-05T00:00:03.000Z"
    };

    const approvalPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: approvalPayload
    });
    void approvalPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const conflict = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        ...approvalPayload,
        description: "Execute pnpm install"
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "node_id_conflict" });

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_1/resolve`,
      headers: ownerAuth,
      payload: { decision: "allow" }
    });
    expect((await approvalPromise).json()).toMatchObject({ decision: "allow" });

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

  it("rejects elicitation retries when the same node id changes the original request payload", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    const elicitationPayload = {
      agent_id: agent.agent_id,
      turn_id: turnId,
      title: "Authentication required",
      description: "Open the auth page and confirm",
      message: "Open the auth URL and continue",
      mode: "url",
      url: "https://example.com/auth",
      requested_schema: { type: "object", properties: { confirmed: { type: "boolean" } } },
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

    const conflict = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        ...elicitationPayload,
        message: "Open the updated auth URL and continue"
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "node_id_conflict" });

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_1/resolve`,
      headers: ownerAuth,
      payload: { action: "accept", content: { confirmed: true } }
    });
    expect((await elicitationPromise).json()).toMatchObject({ action: "accept" });

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

  it("auto-closes pending interactions when the run completes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

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
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        run_id: turnId,
        turn_id: turnId,
        agent_id: agent.agent_id,
        provider: "claude-code",
        message_id: "msg_1",
        summary: "Run complete",
        metrics: { files_read: 0, searches: 0, commands: 0 },
        completed_at: "2026-05-05T00:00:04.000Z"
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

    await app.close();
  });

  it("auto-closes pending interactions when the legacy turn completes", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

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
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_legacy_complete/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: elicitationPayload
    });
    void elicitationPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {}
    });
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        final_text: "Done",
        exit_code: 0
      }
    });

    expect((await elicitationPromise).json()).toMatchObject({ action: "cancel", reason: "run_closed" });

    await app.close();
  });

  it("auto-closes pending interactions when the legacy turn fails", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent();
    const turnId = await currentTurnId(app, room.room_id, ownerAuth);

    await startNode(app, room.room_id, agent.agent_token, agent.agent_id, turnId, "toolu_1");

    const approvalPromise = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_legacy_fail/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        tool_node_id: "toolu_1",
        tool_use_id: "toolu_1",
        tool_name: "Bash",
        requested_at: "2026-05-05T00:00:03.000Z"
      }
    });
    void approvalPromise.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {}
    });
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/fail`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        error: "turn_failed"
      }
    });

    expect((await approvalPromise).json()).toMatchObject({ decision: "deny", reason: "run_closed" });

    await app.close();
  });

  it("times out approval requests with approval_timeout", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent({ approvalTimeoutMs: 25 });
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

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/approvals/approval_timeout/request`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        turn_id: turnId,
        tool_node_id: "toolu_1",
        tool_use_id: "toolu_1",
        tool_name: "Bash",
        requested_at: "2026-05-05T00:00:03.000Z"
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ decision: "deny", reason: "approval_timeout", resolved_by: "system" });

    const publishedEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: ownerAuth
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const completed = publishedEvents.find((event) => event.type === "agent.run.node.completed" && event.payload.node_id === "approval_timeout");
    expect(completed?.payload).toMatchObject({
      detail: expect.objectContaining({
        decision: "deny",
        reason: "approval_timeout",
        resolved_by: "system"
      })
    });

    await app.close();
  });

  it("times out elicitation requests with elicitation_timeout", async () => {
    const { app, room, ownerAuth, agent } = await createRoomAndAgent({ elicitationTimeoutMs: 25 });
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const turnId = events.find((event: { type: string }) => event.type === "agent.turn.requested").payload.turn_id;

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runs/${turnId}/elicitations/elicit_timeout/request`,
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
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ action: "cancel", reason: "elicitation_timeout", resolved_by: "system" });

    const publishedEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: ownerAuth
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const completed = publishedEvents.find((event) => event.type === "agent.run.node.completed" && event.payload.node_id === "elicit_timeout");
    expect(completed?.payload).toMatchObject({
      detail: expect.objectContaining({
        action: "cancel",
        reason: "elicitation_timeout",
        resolved_by: "system"
      })
    });

    await app.close();
  });
});
