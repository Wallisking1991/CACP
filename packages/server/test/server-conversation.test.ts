import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Conversation Room", display_name: "Alice" }
  });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_id: string; owner_token: string };
  return { app, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

async function registerAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, auth: { authorization: string }, name = "Claude Code Agent") {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: auth,
    payload: { name, capabilities: ["claude-code.print", "repo.read"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

async function joinMember(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, auth: { authorization: string }, displayName = "Bob") {
  const invite = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: auth,
    payload: { role: "member", expires_in_seconds: 3600 }
  });
  expect(invite.statusCode).toBe(201);
  const inviteBody = invite.json() as { invite_token: string };
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteBody.invite_token, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: auth, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  const joined = status.json() as { participant_id: string; participant_token: string; role: "member" };
  return { ...joined, auth: { authorization: `Bearer ${joined.participant_token}` } };
}

async function joinObserver(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, auth: { authorization: string }, displayName = "Olivia") {
  const invite = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: auth,
    payload: { role: "observer", expires_in_seconds: 3600 }
  });
  expect(invite.statusCode).toBe(201);
  const inviteBody = invite.json() as { invite_token: string };
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteBody.invite_token, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: auth, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  const joined = status.json() as { participant_id: string; participant_token: string; role: "observer" };
  return { ...joined, auth: { authorization: `Bearer ${joined.participant_token}` } };
}

describe("CACP server conversation room", () => {
  it("selects an active agent and runs a streaming AI turn from a human message", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);

    const select = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: ownerAuth,
      payload: { agent_id: agent.agent_id }
    });
    expect(select.statusCode).toBe(201);

    const humanMessage = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: ownerAuth,
      payload: { text: "我们下一步应该怎么设计多人 AI 协同？" }
    });
    expect(humanMessage.statusCode).toBe(201);

    let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown>; actor_id: string }>;
    const requested = events.find((event) => event.type === "agent.turn.requested");
    expect(requested?.payload.agent_id).toBe(agent.agent_id);
    expect(String(requested?.payload.context_prompt)).toContain("我们下一步应该怎么设计多人 AI 协同？");
    const turnId = String(requested?.payload.turn_id);
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/delta`, headers: agentAuth, payload: { chunk: "建议先做主聊天框。" } })).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`,
      headers: agentAuth,
      payload: {
        final_text: [
          "建议先做主聊天框。",
          "```cacp-decision",
          "{\"title\":\"\u4e0b\u4e00\u6b65\u4f18\u5148\u5b9e\u73b0\u4ec0\u4e48\uff1f\",\"description\":\"\u8bf7\u9009\u62e9\u4e0b\u4e00\u6b65\u4f18\u5148\u5b9e\u73b0\u7684\u529f\u80fd\u3002\",\"kind\":\"single_choice\",\"options\":[{\"id\":\"chat\",\"label\":\"\u4e3b\u804a\u5929\u6846\"},{\"id\":\"invite\",\"label\":\"\u9080\u8bf7\u52a0\u5165\"}],\"policy\":\"room_default\",\"blocking\":true}",
          "```"
        ].join("\n"),
        exit_code: 0
      }
    })).statusCode).toBe(201);

    events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "room.agent_selected",
      "message.created",
      "agent.turn.requested",
      "agent.turn.started",
      "agent.output.delta",
      "agent.turn.completed"
    ]));
    const finalMessage = events.find((event) => event.type === "message.created" && event.actor_id === agent.agent_id);
    expect(finalMessage?.payload.text).toContain("建议先做主聊天框");
    expect(finalMessage?.payload.kind).toBe("agent");
    expect(events.some((event) => event.type.startsWith("decision."))).toBe(false);

    await app.close();
  });

  it("queues one followup instead of starting duplicate turns while an agent is running", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });

    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "第一条" } });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "第二条" } });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "第三条" } });

    let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent.turn.followup_queued")).toHaveLength(1);
    const firstTurn = events.find((event) => event.type === "agent.turn.requested")!;
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };
    const turnId = String(firstTurn.payload.turn_id);

    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: agentAuth, payload: {} });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`, headers: agentAuth, payload: { final_text: "收到。", exit_code: 0 } });

    events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(2);
    expect(String(events.at(-1)?.payload.context_prompt)).toContain("第三条");

    await app.close();
  });

  it("collects room messages without triggering AI until owner submits", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
    const member = await joinMember(app, room.room_id, ownerAuth, "Bob");

    const start = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} });
    expect(start.statusCode).toBe(201);
    const collectionId = (start.json() as { collection_id: string }).collection_id;

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Owner answer: prioritize shared context." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: member.auth, payload: { text: "Bob answer: invite flow matters." } })).statusCode).toBe(201);

    let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown>; actor_id: string }>;
    const collectedMessages = events.filter((event) => event.type === "message.created" && event.payload.kind === "human");
    expect(collectedMessages).toHaveLength(2);
    expect(collectedMessages.map((event) => event.payload.collection_id)).toEqual([collectionId, collectionId]);
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(0);

    const submit = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/submit`, headers: ownerAuth, payload: {} });
    expect(submit.statusCode).toBe(201);

    events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const submitted = events.find((event) => event.type === "ai.collection.submitted");
    expect(submitted?.payload.collection_id).toBe(collectionId);
    expect(submitted?.payload.message_ids).toEqual(collectedMessages.map((event) => event.payload.message_id));
    const requestedTurns = events.filter((event) => event.type === "agent.turn.requested");
    expect(requestedTurns).toHaveLength(1);
    expect(requestedTurns[0].payload.reason).toBe("collected_answers");
    expect(String(requestedTurns[0].payload.context_prompt)).toContain("Alice: Owner answer: prioritize shared context.");
    expect(String(requestedTurns[0].payload.context_prompt)).toContain("Bob: Bob answer: invite flow matters.");

    await app.close();
  });

  it("lets owner cancel collection without sending to AI", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });

    const start = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} });
    const collectionId = (start.json() as { collection_id: string }).collection_id;
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Collect this but do not send." } });

    const cancel = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/cancel`, headers: ownerAuth, payload: {} });
    expect(cancel.statusCode).toBe(201);

    let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.find((event) => event.type === "ai.collection.cancelled")?.payload.collection_id).toBe(collectionId);
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(0);

    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Live mode is back." } });

    events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(1);
    expect(String(events.find((event) => event.type === "agent.turn.requested")?.payload.context_prompt)).toContain("Live mode is back.");

    await app.close();
  });

  it("queues followup for old open turns without stale recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
      const { app, room, ownerAuth } = await createRoom();
      const agent = await registerAgent(app, room.room_id, ownerAuth);
      await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
      await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "First slow question" } });

      vi.setSystemTime(new Date("2026-04-28T00:03:10.000Z"));
      expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Second queued question" } })).statusCode).toBe(201);

      const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
      expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(1);
      expect(events.filter((event) => event.type === "agent.turn.followup_queued")).toHaveLength(1);
      expect(events.some((event) => event.type === "agent.turn.failed" && event.payload.error === "stale_turn_recovered")).toBe(false);
      await app.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a queued followup after an agent turn fails", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "First question" } });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Second queued question" } });

    let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const turnId = String(events.find((event) => event.type === "agent.turn.requested")!.payload.turn_id);
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/fail`, headers: agentAuth, payload: { error: "CLI exited", exit_code: 1 } })).statusCode).toBe(201);

    events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
    const requestedTurns = events.filter((event) => event.type === "agent.turn.requested");
    expect(requestedTurns).toHaveLength(2);
    expect(requestedTurns[1].payload.reason).toBe("queued_followup");
    expect(String(requestedTurns[1].payload.context_prompt)).toContain("Second queued question");
    await app.close();
  });

  it("rejects member collection control", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const member = await joinMember(app, room.room_id, ownerAuth, "Bob");

    const memberStart = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: member.auth, payload: {} });
    expect(memberStart.statusCode).toBe(403);

    const ownerStart = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} });
    expect(ownerStart.statusCode).toBe(201);

    const memberSubmit = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/submit`, headers: member.auth, payload: {} });
    expect(memberSubmit.statusCode).toBe(403);
    const memberCancel = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/cancel`, headers: member.auth, payload: {} });
    expect(memberCancel.statusCode).toBe(403);

    await app.close();
  });

  it("lets members request Roundtable Mode and owner approval starts it atomically", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const member = await joinMember(app, room.room_id, ownerAuth, "Bob");
    const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
    expect(request.statusCode).toBe(201);
    const requestId = (request.json() as { request_id: string }).request_id;

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(409);

    const approve = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/approve`, headers: ownerAuth, payload: {} });
    expect(approve.statusCode).toBe(201);
    const collectionId = (approve.json() as { collection_id: string }).collection_id;

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const approvedIndex = events.findIndex((event) => event.type === "ai.collection.request_approved");
    const startedIndex = events.findIndex((event) => event.type === "ai.collection.started");
    expect(startedIndex).toBe(approvedIndex + 1);
    expect(events[approvedIndex].payload).toMatchObject({ request_id: requestId, collection_id: collectionId });
    expect(events[startedIndex].payload).toMatchObject({ request_id: requestId, collection_id: collectionId });
    await app.close();
  });

  it("rejects Roundtable requests without starting a collection", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const member = await joinMember(app, room.room_id, ownerAuth, "Bob");
    const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
    const requestId = (request.json() as { request_id: string }).request_id;
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/reject`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.some((event) => event.type === "ai.collection.request_rejected" && event.payload.request_id === requestId)).toBe(true);
    expect(events.some((event) => event.type === "ai.collection.started")).toBe(false);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
    await app.close();
  });

  it("rejects observers and active-turn Roundtable approval", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
    const observer = await joinObserver(app, room.room_id, ownerAuth, "Olivia");
    const member = await joinMember(app, room.room_id, ownerAuth, "Bob");

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: observer.auth, payload: {} })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "AI should answer this first." } });
    const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
    const requestId = (request.json() as { request_id: string }).request_id;
    const approve = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/approve`, headers: ownerAuth, payload: {} });
    expect(approve.statusCode).toBe(409);
    expect(approve.json()).toMatchObject({ error: "active_turn_in_flight" });
    await app.close();
  });
});
