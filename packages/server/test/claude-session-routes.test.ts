import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndOwner() {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Claude Room", display_name: "Owner" } });
  const room = roomResponse.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room };
}

async function inviteMember(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const inviteResponse = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" }
  });
  const invite = inviteResponse.json() as { invite_token: string };
  const pending = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: invite.invite_token, display_name: "Member" }
  });
  const request = pending.json() as { request_id: string; request_token: string };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {}
  });
  const status = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
  });
  return status.json() as { participant_token: string };
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

async function registerNonClaudeAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: "LLM Chat Agent", capabilities: ["llm-api"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

async function selectAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, agentId: string) {
  const selectResponse = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/select`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { agent_id: agentId }
  });
  expect(selectResponse.statusCode).toBe(201);
}

async function selectClaudeSession(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, agentId: string, sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/claude/session-selection`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { agent_id: agentId, mode: "resume", session_id: sessionId }
  });
  expect(response.statusCode).toBe(201);
}

describe("Claude session room routes", () => {
  it("lets the registered agent publish a Claude session catalog", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

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

  it("hides catalog events from non-manager participants", async () => {
    const { app, room } = await createRoomAndOwner();
    const member = await inviteMember(app, room.room_id, room.owner_token);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const catalogResponse = await app.inject({
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
    expect(catalogResponse.statusCode).toBe(201);

    const ownerEvents = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(ownerEvents.json().events.some((ev: { type: string }) => ev.type === "claude.session_catalog.updated")).toBe(true);

    const memberEvents = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${member.participant_token}` }
    });
    expect(memberEvents.json().events.some((ev: { type: string }) => ev.type === "claude.session_catalog.updated")).toBe(false);

    await app.close();
  });

  it("lets managers request a complete Claude session preview that is hidden from members", async () => {
    const { app, room } = await createRoomAndOwner();
    const member = await inviteMember(app, room.room_id, room.owner_token);
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const previewRequest = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-previews`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, session_id: "session_1" }
    });
    expect(previewRequest.statusCode).toBe(201);
    const preview = previewRequest.json() as { preview_id: string };

    const previewMessages = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-previews/${preview.preview_id}/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        preview_id: preview.preview_id,
        agent_id: agent.agent_id,
        session_id: "session_1",
        sequence: 0,
        author_role: "user",
        source_kind: "user",
        text: "Full owner-only preview content"
      }]
    });
    expect(previewMessages.statusCode).toBe(201);

    const ownerEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string }>;
    expect(ownerEvents.some((event) => event.type === "claude.session_preview.requested")).toBe(true);
    expect(ownerEvents.some((event) => event.type === "claude.session_preview.message")).toBe(true);

    const memberEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${member.participant_token}` }
    })).json().events as Array<{ type: string }>;
    expect(memberEvents.some((event) => event.type.startsWith("claude.session_preview."))).toBe(false);

    await app.close();
  });

  it("rejects completing a Claude session preview when uploaded messages are incomplete", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const previewRequest = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-previews`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, session_id: "session_1" }
    });
    expect(previewRequest.statusCode).toBe(201);
    const preview = previewRequest.json() as { preview_id: string };

    expect((await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-previews/${preview.preview_id}/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        preview_id: preview.preview_id,
        agent_id: agent.agent_id,
        session_id: "session_1",
        sequence: 0,
        author_role: "user",
        source_kind: "user",
        text: "Only one preview message"
      }]
    })).statusCode).toBe(201);

    const incomplete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-previews/${preview.preview_id}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        preview_id: preview.preview_id,
        agent_id: agent.agent_id,
        session_id: "session_1",
        previewed_message_count: 2,
        completed_at: "2026-04-29T00:00:00.000Z"
      }
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json()).toMatchObject({ error: "preview_incomplete" });

    await app.close();
  });


  it("lets only the selected Claude connector report session readiness", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    const other = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const ownerReady = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-ready`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, mode: "fresh", session_id: "session_1", ready_at: "2026-04-29T00:00:00.000Z" }
    });
    expect(ownerReady.statusCode).toBe(403);

    const inactiveReady = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-ready`,
      headers: { authorization: `Bearer ${other.agent_token}` },
      payload: { agent_id: other.agent_id, mode: "fresh", session_id: "session_2", ready_at: "2026-04-29T00:00:00.000Z" }
    });
    expect(inactiveReady.statusCode).toBe(403);

    const ready = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-ready`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { agent_id: agent.agent_id, mode: "fresh", session_id: "session_1", ready_at: "2026-04-29T00:00:00.000Z" }
    });
    expect(ready.statusCode).toBe(201);

    const events = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.some((event) => event.type === "claude.session_ready" && event.payload.agent_id === agent.agent_id)).toBe(true);

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

    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
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

  it("rejects Claude session selection for inactive or non-Claude agents", async () => {
    const { app, room } = await createRoomAndOwner();
    const activeClaude = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, activeClaude.agent_id);
    const inactiveClaude = await registerAgent(app, room.room_id, room.owner_token);
    const nonClaude = await registerNonClaudeAgent(app, room.room_id, room.owner_token);

    const inactiveSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: inactiveClaude.agent_id, mode: "fresh" }
    });
    expect(inactiveSelect.statusCode).toBe(403);
    expect(inactiveSelect.json()).toMatchObject({ error: "not_active_agent" });

    await selectAgent(app, room.room_id, room.owner_token, nonClaude.agent_id);
    const nonClaudeSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: nonClaude.agent_id, mode: "fresh" }
    });
    expect(nonClaudeSelect.statusCode).toBe(403);
    expect(nonClaudeSelect.json()).toMatchObject({ error: "missing_claude_code_capability" });

    await app.close();
  });

  it("lets only the matching agent publish import messages and runtime status", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const otherAgent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    // Trigger an agent turn to get a real turn_id for runtime status validation
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
    const sessionSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1" }
    });
    expect(sessionSelect.statusCode).toBe(201);
    const sessionReady = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-ready`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1", ready_at: "2026-04-29T00:00:00.000Z" }
    });
    expect(sessionReady.statusCode).toBe(201);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Hello" } });
    const eventsBefore = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const requestedTurn = eventsBefore.find((event) => event.type === "agent.turn.requested");
    const turnId = String(requestedTurn?.payload.turn_id ?? "turn_1");

    const wrongTurnStatus = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/runtime-status`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        kind: "changed",
        payload: {
          agent_id: agent.agent_id,
          turn_id: "turn_not_assigned_to_agent",
          status_id: "status_wrong_turn",
          phase: "thinking",
          current: "Should be rejected",
          recent: ["Should be rejected"],
          metrics: { files_read: 0, searches: 0, commands: 0 },
          started_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:00:01.000Z"
        }
      }
    });
    expect(wrongTurnStatus.statusCode).toBe(403);
    expect(wrongTurnStatus.json()).toMatchObject({ error: "turn_not_found" });

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
        kind: "completed",
        payload: {
          agent_id: agent.agent_id,
          turn_id: turnId,
          status_id: "status_turn_1",
          summary: "Completed",
          metrics: { files_read: 0, searches: 0, commands: 0 },
          completed_at: "2026-04-29T00:00:01.000Z"
        }
      }
    });
    expect(status.statusCode).toBe(201);

    await app.close();
  });

  it("rejects Claude session import unless it matches the owner-selected resume session", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const payload = {
      import_id: "import_unauthorized",
      agent_id: agent.agent_id,
      session_id: "session_1",
      title: "Imported",
      message_count: 1,
      started_at: "2026-04-29T00:00:00.000Z"
    };

    const beforeSelection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload
    });
    expect(beforeSelection.statusCode).toBe(409);
    expect(beforeSelection.json()).toMatchObject({ error: "claude_resume_session_not_selected" });

    const freshSelection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, mode: "fresh" }
    });
    expect(freshSelection.statusCode).toBe(201);
    const afterFreshSelection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload
    });
    expect(afterFreshSelection.statusCode).toBe(409);
    expect(afterFreshSelection.json()).toMatchObject({ error: "claude_resume_session_not_selected" });

    await selectClaudeSession(app, room.room_id, room.owner_token, agent.agent_id, "session_2");
    const mismatch = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: "claude_resume_session_mismatch" });

    await selectClaudeSession(app, room.room_id, room.owner_token, agent.agent_id, "session_1");
    const matching = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload
    });
    expect(matching.statusCode).toBe(201);

    await app.close();
  });

  it("rejects completing an import when uploaded messages are incomplete", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    await selectClaudeSession(app, room.room_id, room.owner_token, agent.agent_id, "session_1");

    const importStart = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        import_id: "import_incomplete",
        agent_id: agent.agent_id,
        session_id: "session_1",
        title: "Imported",
        message_count: 2,
        started_at: "2026-04-29T00:00:00.000Z"
      }
    });
    expect(importStart.statusCode).toBe(201);

    const firstMessage = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/import_incomplete/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        import_id: "import_incomplete",
        agent_id: agent.agent_id,
        session_id: "session_1",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Only first imported message"
      }]
    });
    expect(firstMessage.statusCode).toBe(201);

    const incompleteComplete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-imports/import_incomplete/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        import_id: "import_incomplete",
        agent_id: agent.agent_id,
        session_id: "session_1",
        imported_message_count: 1,
        completed_at: "2026-04-29T00:00:01.000Z"
      }
    });
    expect(incompleteComplete.statusCode).toBe(409);
    expect(incompleteComplete.json()).toMatchObject({ error: "import_incomplete" });

    await app.close();
  });
});
