import { describe, expect, it } from "vitest";
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
          "```cacp-question",
          "{\"question\":\"下一步优先实现什么？\",\"options\":[\"主聊天框\",\"邀请加入\"]}",
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
      "agent.turn.completed",
      "question.created"
    ]));
    const finalMessage = events.find((event) => event.type === "message.created" && event.actor_id === agent.agent_id);
    expect(finalMessage?.payload.text).toContain("建议先做主聊天框");
    expect(finalMessage?.payload.kind).toBe("agent");
    const question = events.find((event) => event.type === "question.created");
    expect(question?.payload.question).toBe("下一步优先实现什么？");

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
});
