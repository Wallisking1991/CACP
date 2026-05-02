import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndOwner() {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Purge Room", display_name: "Owner" }
  });
  const room = roomResponse.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room };
}

async function registerClaudeAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: "Claude Code Agent", capabilities: ["claude-code", "claude.persistent_session"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

async function registerCodexAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      name: "Codex CLI Agent",
      capabilities: ["codex-cli", "code-agent.persistent_session", "code-agent.local_execution"]
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

async function listEventTypes(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string): Promise<string[]> {
  const response = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/events`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  expect(response.statusCode).toBe(200);
  const events = (response.json() as { events: Array<{ type: string }> }).events;
  return events.map((event) => event.type);
}

const ESSENTIAL_TYPES = new Set([
  "room.created",
  "participant.joined",
  "participant.left",
  "participant.removed",
  "participant.role_updated",
  "agent.registered",
  "agent.unregistered",
  "agent.disconnected",
  "room.agent_selected",
  "invite.created",
  "invite.revoked",
  "join_request.created",
  "join_request.approved",
  "join_request.rejected",
  "join_request.expired"
]);

describe("session-selection physically purges content events", () => {
  it("Claude session-selection deletes prior message/turn/orbit/main_input events from the store", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerClaudeAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };

    // Generate a content event: posting a message persists message.created
    const message = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: ownerAuth,
      payload: { text: "Hello agent" }
    });
    expect(message.statusCode).toBe(201);

    // Verify content exists before the selection
    const before = await listEventTypes(app, room.room_id, room.owner_token);
    expect(before).toContain("message.created");

    // Trigger purging via Claude session selection
    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const after = await listEventTypes(app, room.room_id, room.owner_token);
    // The new selection event must be present
    expect(after).toContain("claude.session_selected");
    // No content events from before the selection should survive
    expect(after).not.toContain("message.created");
    // Only essential foundation events plus the new claude.session_selected should remain
    for (const type of after) {
      expect(
        ESSENTIAL_TYPES.has(type) || type === "claude.session_selected",
        `unexpected surviving event type after purge: ${type}`
      ).toBe(true);
    }

    await app.close();
  });

  it("agent-sessions selection deletes prior content events from the store", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerCodexAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };

    const message = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: ownerAuth,
      payload: { text: "Hello codex" }
    });
    expect(message.statusCode).toBe(201);

    const before = await listEventTypes(app, room.room_id, room.owner_token);
    expect(before).toContain("message.created");

    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, provider: "codex-cli", mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const after = await listEventTypes(app, room.room_id, room.owner_token);
    expect(after).toContain("agent.session_selected");
    expect(after).not.toContain("message.created");
    for (const type of after) {
      expect(
        ESSENTIAL_TYPES.has(type) || type === "agent.session_selected",
        `unexpected surviving event type after purge: ${type}`
      ).toBe(true);
    }

    await app.close();
  });

  it("preserves claude.session_catalog.updated through purge so the picker can re-render after New Conversation", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerClaudeAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

    // Connector publishes the locally-discovered Claude session catalog
    const catalog = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-catalog`,
      headers: agentAuth,
      payload: {
        agent_id: agent.agent_id,
        working_dir: "C:\\dev\\example",
        sessions: [
          {
            session_id: "sess_1",
            title: "Earlier session",
            project_dir: "C:\\dev\\example",
            updated_at: "2026-05-01T00:00:00.000Z",
            message_count: 12,
            byte_size: 4096,
            importable: true
          }
        ]
      }
    });
    expect(catalog.statusCode).toBe(201);

    const before = await listEventTypes(app, room.room_id, room.owner_token);
    expect(before).toContain("claude.session_catalog.updated");

    // Trigger the New Conversation purge
    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const after = await listEventTypes(app, room.room_id, room.owner_token);
    // Catalog must survive: the picker UI renders nothing without it.
    expect(after).toContain("claude.session_catalog.updated");

    await app.close();
  });

  it("preserves agent.session_catalog.updated through purge so the picker can re-render after New Conversation", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerCodexAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

    const catalog = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/catalog`,
      headers: agentAuth,
      payload: {
        agent_id: agent.agent_id,
        provider: "codex-cli",
        working_dir: "C:\\dev\\example",
        sessions: [
          {
            session_id: "codex_sess_1",
            title: "Codex session",
            project_dir: "C:\\dev\\example",
            updated_at: "2026-05-01T00:00:00.000Z",
            message_count: 8,
            byte_size: 2048,
            importable: true
          }
        ]
      }
    });
    expect(catalog.statusCode).toBe(201);

    const before = await listEventTypes(app, room.room_id, room.owner_token);
    expect(before).toContain("agent.session_catalog.updated");

    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-sessions/selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, provider: "codex-cli", mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const after = await listEventTypes(app, room.room_id, room.owner_token);
    expect(after).toContain("agent.session_catalog.updated");

    await app.close();
  });

  it("preserves room.created, participant.joined, agent.registered, room.agent_selected after purge", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerClaudeAgent(app, room.room_id, room.owner_token);
    await selectAgent(app, room.room_id, room.owner_token, agent.agent_id);
    const ownerAuth = { authorization: `Bearer ${room.owner_token}` };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: ownerAuth,
      payload: { text: "noise" }
    });

    const selection = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id, mode: "fresh" }
    });
    expect(selection.statusCode).toBe(201);

    const after = await listEventTypes(app, room.room_id, room.owner_token);
    expect(after).toContain("room.created");
    expect(after).toContain("participant.joined");
    expect(after).toContain("agent.registered");
    expect(after).toContain("room.agent_selected");
    expect(after).toContain("claude.session_selected");

    await app.close();
  });
});
