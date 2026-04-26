import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

type App = Awaited<ReturnType<typeof buildServer>>;
type Auth = { authorization: string };
type EventRecord = { type: string; actor_id: string; payload: Record<string, unknown> };

const decisionPayload = {
  title: "Choose first CLI integration",
  description: "Pick the first CLI adapter.",
  kind: "single_choice",
  options: [{ id: "A", label: "Claude Code CLI" }, { id: "B", label: "Codex CLI" }],
  policy: "room_default",
  blocking: true
};

async function createRoom(default_policy: "owner_approval" | "majority" | "unanimous" = "owner_approval") {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Decision Room", display_name: "Alice", default_policy }
  });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_id: string; owner_token: string };
  return { app, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

async function registerAndSelectAgent(app: App, roomId: string, ownerAuth: Auth) {
  const register = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: ownerAuth,
    payload: { name: "Codex Agent", capabilities: ["repo.read"] }
  });
  expect(register.statusCode).toBe(201);
  const agent = register.json() as { agent_id: string; agent_token: string };
  const select = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/select`,
    headers: ownerAuth,
    payload: { agent_id: agent.agent_id }
  });
  expect(select.statusCode).toBe(201);
  return { ...agent, agentAuth: { authorization: `Bearer ${agent.agent_token}` } };
}

async function inviteMember(app: App, roomId: string, ownerAuth: Auth, display_name = "Bob") {
  const invite = await app.inject({ method: "POST", url: `/rooms/${roomId}/invites`, headers: ownerAuth, payload: { role: "member" } });
  expect(invite.statusCode).toBe(201);
  const joined = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join`,
    payload: { invite_token: (invite.json() as { invite_token: string }).invite_token, display_name }
  });
  expect(joined.statusCode).toBe(201);
  const member = joined.json() as { participant_id: string; participant_token: string };
  return { ...member, auth: { authorization: `Bearer ${member.participant_token}` } };
}

async function listEvents(app: App, roomId: string, auth: Auth): Promise<EventRecord[]> {
  const response = await app.inject({ method: "GET", url: `/rooms/${roomId}/events`, headers: auth });
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: EventRecord[] }).events;
}

async function createDecision(app: App, roomId: string, auth: Auth) {
  return app.inject({ method: "POST", url: `/rooms/${roomId}/decisions`, headers: auth, payload: decisionPayload });
}

describe("CACP decision protocol integration", () => {
  it("creates a decision and rejects a second active decision", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAndSelectAgent(app, room.room_id, ownerAuth);

    const first = await createDecision(app, room.room_id, agent.agentAuth);
    expect(first.statusCode).toBe(201);
    expect((first.json() as { decision_id: string }).decision_id).toMatch(/^dec_/);

    const second = await createDecision(app, room.room_id, agent.agentAuth);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "active_decision_exists" });

    const events = await listEvents(app, room.room_id, ownerAuth);
    expect(events.filter((event) => event.type === "decision.requested")).toHaveLength(1);

    await app.close();
  });

  it("records chat answers and resolves majority decision", async () => {
    const { app, room, ownerAuth } = await createRoom("majority");
    const bob = await inviteMember(app, room.room_id, ownerAuth);
    const agent = await registerAndSelectAgent(app, room.room_id, ownerAuth);
    const created = await createDecision(app, room.room_id, agent.agentAuth);
    expect(created.statusCode).toBe(201);

    const aliceAnswer = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "I choose A" } });
    expect(aliceAnswer.statusCode).toBe(201);
    const bobAnswer = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: bob.auth, payload: { text: "A" } });
    expect(bobAnswer.statusCode).toBe(201);

    const events = await listEvents(app, room.room_id, ownerAuth);
    const responses = events.filter((event) => event.type === "decision.response_recorded");
    expect(responses).toHaveLength(2);
    const resolved = events.filter((event) => event.type === "decision.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].payload.result).toBe("A");
    expect(resolved[0].payload.result_label).toBe("Claude Code CLI");

    await app.close();
  });

  it("allows owner to cancel active decision and rejects member cancellation", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const bob = await inviteMember(app, room.room_id, ownerAuth);
    const agent = await registerAndSelectAgent(app, room.room_id, ownerAuth);
    const created = await createDecision(app, room.room_id, agent.agentAuth);
    expect(created.statusCode).toBe(201);
    const decisionId = (created.json() as { decision_id: string }).decision_id;

    const memberCancel = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/decisions/${decisionId}/cancel`,
      headers: bob.auth,
      payload: { reason: "Not my call" }
    });
    expect(memberCancel.statusCode).toBe(403);

    const ownerCancel = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/decisions/${decisionId}/cancel`,
      headers: ownerAuth,
      payload: { reason: "Owner stopped it" }
    });
    expect(ownerCancel.statusCode).toBe(201);

    const events = await listEvents(app, room.room_id, ownerAuth);
    const cancelled = events.find((event) => event.type === "decision.cancelled");
    expect(cancelled?.payload).toMatchObject({ decision_id: decisionId, reason: "Owner stopped it", cancelled_by: room.owner_id });

    await app.close();
  });

  it("parses a cacp-decision draft without decision_id from agent turn completion", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAndSelectAgent(app, room.room_id, ownerAuth);

    const humanMessage = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Please recommend a CLI." } });
    expect(humanMessage.statusCode).toBe(201);
    let events = await listEvents(app, room.room_id, ownerAuth);
    const turnId = String(events.find((event) => event.type === "agent.turn.requested")?.payload.turn_id);

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: agent.agentAuth, payload: {} })).statusCode).toBe(201);
    const complete = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`,
      headers: agent.agentAuth,
      payload: {
        final_text: [
          "I need a decision.",
          "```cacp-decision",
          JSON.stringify(decisionPayload),
          "```"
        ].join("\n"),
        exit_code: 0
      }
    });
    expect(complete.statusCode).toBe(201);
    const messageId = (complete.json() as { message_id: string }).message_id;

    events = await listEvents(app, room.room_id, ownerAuth);
    const requested = events.find((event) => event.type === "decision.requested");
    expect(requested?.payload.decision_id).toMatch(/^dec_/);
    expect(requested?.payload.source_turn_id).toBe(turnId);
    expect(requested?.payload.source_message_id).toBe(messageId);
    expect(requested?.payload.title).toBe("Choose first CLI integration");
    expect(requested?.payload.options).toEqual(decisionPayload.options);

    await app.close();
  });

  it("does not request a new agent turn for unrelated human messages while an active decision is open", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAndSelectAgent(app, room.room_id, ownerAuth);
    const created = await createDecision(app, room.room_id, agent.agentAuth);
    expect(created.statusCode).toBe(201);
    const beforeEvents = await listEvents(app, room.room_id, ownerAuth);
    const requestedBefore = beforeEvents.filter((event) => event.type === "agent.turn.requested").length;

    const unrelated = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Let's keep discussing" } });
    expect(unrelated.statusCode).toBe(201);

    const events = await listEvents(app, room.room_id, ownerAuth);
    const systemMessage = events.find((event) => event.type === "message.created" && event.payload.kind === "system");
    expect(systemMessage?.payload.text).toBe("Current decision is still open. Please answer with one of: A, B.");
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(requestedBefore);

    await app.close();
  });
});
