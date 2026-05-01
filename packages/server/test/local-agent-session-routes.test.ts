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

  it("supports generic Codex preview, import, and runtime status routes", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    const previewRequest = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/previews`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex"
      }
    });
    expect(previewRequest.statusCode).toBe(201);
    const preview = previewRequest.json() as { preview_id: string };

    const previewMessages = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/previews/${preview.preview_id}/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        preview_id: preview.preview_id,
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Preview answer"
      }]
    });
    expect(previewMessages.statusCode).toBe(201);

    const previewComplete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/previews/${preview.preview_id}/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        preview_id: preview.preview_id,
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex",
        previewed_message_count: 1,
        completed_at: "2026-05-01T01:15:03.000Z"
      }
    });
    expect(previewComplete.statusCode).toBe(201);

    const resumeSelection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        mode: "resume",
        session_id: "session_codex"
      }
    });
    expect(resumeSelection.statusCode).toBe(201);

    const importStart = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/imports/start`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        import_id: "import_codex",
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex",
        title: "Codex session",
        message_count: 1,
        started_at: "2026-05-01T01:15:04.000Z"
      }
    });
    expect(importStart.statusCode).toBe(201);

    const importMessages = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/imports/import_codex/messages`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: [{
        import_id: "import_codex",
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Imported answer"
      }]
    });
    expect(importMessages.statusCode).toBe(201);

    const importComplete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/imports/import_codex/complete`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        import_id: "import_codex",
        agent_id: agent.agent_id,
        provider: "codex-cli",
        session_id: "session_codex",
        imported_message_count: 1,
        completed_at: "2026-05-01T01:15:05.000Z"
      }
    });
    expect(importComplete.statusCode).toBe(201);

    const ready = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/ready`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        mode: "resume",
        session_id: "session_codex",
        ready_at: "2026-05-01T01:15:06.000Z"
      }
    });
    expect(ready.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Run Codex" }
    });
    const events = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string; payload: { turn_id?: string; provider?: string } }>;
    const turnId = events.find((event) => event.type === "agent.turn.requested")?.payload.turn_id;
    expect(turnId).toBeTruthy();

    const runtimeStatus = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-runtime/status`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        kind: "changed",
        payload: {
          agent_id: agent.agent_id,
          provider: "codex-cli",
          turn_id: turnId,
          status_id: `status_${turnId}`,
          phase: "running_command",
          current: "Codex running command: Get-ChildItem",
          recent: ["Codex running command: Get-ChildItem"],
          metrics: { files_read: 0, searches: 0, commands: 1 },
          started_at: "2026-05-01T01:15:07.000Z",
          updated_at: "2026-05-01T01:15:08.000Z"
        }
      }
    });
    expect(runtimeStatus.statusCode).toBe(201);

    await app.close();
  });

  it("does not request Codex turns until generic session readiness is reported", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "before ready" }
    });
    let events = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(0);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, provider: "codex-cli", mode: "fresh" }
    });
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/ready`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: { agent_id: agent.agent_id, provider: "codex-cli", mode: "fresh", ready_at: "2026-05-01T01:15:02.000Z" }
    });
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "after ready" }
    });
    events = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const requested = events.filter((event) => event.type === "agent.turn.requested");
    expect(requested).toHaveLength(1);
    expect(requested[0].payload).toMatchObject({
      agent_id: agent.agent_id,
      message_text: "after ready",
      speaker_name: "Owner",
      speaker_role: "owner",
      mode: "normal"
    });

    await app.close();
  });

  it("keeps generic local session catalogs hidden from non-managers", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerLocalAgent(app, room.room_id, room.owner_token, "codex-cli");
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/catalog`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        working_dir: "D:\\SecretProject",
        sessions: [{
          session_id: "session_private",
          title: "Private Codex thread",
          project_dir: "D:\\SecretProject",
          updated_at: "2026-05-01T01:15:02.000Z",
          message_count: 1,
          byte_size: 100,
          importable: true,
          provider: "codex-cli"
        }]
      }
    });

    const invite = (await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600, max_uses: 1 }
    })).json() as { invite_token: string };
    const joinRequest = (await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: invite.invite_token, display_name: "Member" }
    })).json() as { request_id: string; request_token: string };
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${joinRequest.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    const approved = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${joinRequest.request_id}?request_token=${joinRequest.request_token}`
    })).json() as { participant_token: string };
    const memberEvents = (await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${approved.participant_token}` }
    })).json().events as Array<{ type: string }>;

    expect(memberEvents.some((event) => event.type === "agent.session_catalog.updated")).toBe(false);
    await app.close();
  });
});
