import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Test Room", display_name: "Alice" }
  });
  return { app, created: response.json() as { room_id: string; owner_id: string; owner_token: string } };
}

async function joinAsMember(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const inviteResponse = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member" }
  });
  const inviteToken = (inviteResponse.json() as { invite_token: string }).invite_token;

  const pending = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: { invite_token: inviteToken, display_name: "Bob" }
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

describe("POST /rooms/:roomId/agents/:agentId/thinking", () => {
  it("lets owner toggle agent thinking mode", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const agent = (await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/register`,
      headers: ownerAuth,
      payload: { name: "Kimi Agent", capabilities: ["kimi-cli"] }
    })).json() as { agent_id: string };

    const toggleOff = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/${agent.agent_id}/thinking`,
      headers: ownerAuth,
      payload: { thinking_enabled: false }
    });
    expect(toggleOff.statusCode).toBe(201);
    expect(toggleOff.json()).toEqual({ ok: true });

    const events = (await app.inject({
      method: "GET",
      url: `/rooms/${created.room_id}/events`,
      headers: ownerAuth
    })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const updatedEvent = events.find((e) => e.type === "agent.updated");
    expect(updatedEvent).toBeDefined();
    expect(updatedEvent?.payload.thinking_enabled).toBe(false);

    await app.close();
  });

  it("returns 403 for non-owner", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const agent = (await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/register`,
      headers: ownerAuth,
      payload: { name: "Kimi Agent", capabilities: ["kimi-cli"] }
    })).json() as { agent_id: string };

    const member = await joinAsMember(app, created.room_id, created.owner_token);

    const toggle = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/${agent.agent_id}/thinking`,
      headers: { authorization: `Bearer ${member.participant_token}` },
      payload: { thinking_enabled: false }
    });
    expect(toggle.statusCode).toBe(403);

    await app.close();
  });

  it("returns 404 for unknown agent", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const toggle = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agents/nonexistent/thinking`,
      headers: ownerAuth,
      payload: { thinking_enabled: false }
    });
    expect(toggle.statusCode).toBe(404);

    await app.close();
  });
});
