import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "MVP Room", display_name: "Alice" }
  });
  return { app, created: response.json() as { room_id: string; owner_id: string; owner_token: string } };
}

describe("CACP server", () => {
  it("runs the full room, collaboration, proposal, agent, and task event flow", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", display_name: "Bob" }
    });
    expect(inviteResponse.statusCode).toBe(201);

    const joinResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join`,
      payload: { invite_token: inviteResponse.json().invite_token }
    });
    expect(joinResponse.statusCode).toBe(201);
    const bob = joinResponse.json();

    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { text: "Protocol first." } })).statusCode).toBe(201);
    const question = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/questions`, headers: ownerAuth, payload: { question: "Which MVP path?", expected_response: "single_choice", options: ["API", "Web"] } })).json();
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/questions/${question.question_id}/responses`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { response: "API", comment: "Standard first." } })).statusCode).toBe(201);

    const proposal = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals`, headers: ownerAuth, payload: { title: "Adopt protocol-first MVP", proposal_type: "decision", policy: { type: "owner_approval" } } })).json();
    const voteResponse = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals/${proposal.proposal_id}/votes`, headers: ownerAuth, payload: { vote: "approve", comment: "Approved." } });
    expect(voteResponse.json().evaluation.status).toBe("approved");

    const agent = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Local Echo Agent", capabilities: ["shell.oneshot"] } })).json();
    const task = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks`, headers: ownerAuth, payload: { target_agent_id: agent.agent_id, prompt: "Say hello", mode: "oneshot" } })).json();
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/start`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/output`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: { stream: "stdout", chunk: "hello\n" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/complete`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: { exit_code: 0 } })).statusCode).toBe(201);

    const eventsResponse = await app.inject({ method: "GET", url: `/rooms/${created.room_id}/events`, headers: ownerAuth });
    const eventTypes = eventsResponse.json().events.map((event: { type: string }) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "room.created", "participant.joined", "invite.created", "message.created",
      "question.created", "question.response_submitted", "proposal.created", "proposal.vote_cast", "proposal.approved",
      "agent.registered", "task.created", "task.started", "task.output", "task.completed"
    ]));

    await app.close();
  });
});
