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
      payload: { role: "member" }
    });
    expect(inviteResponse.statusCode).toBe(201);

    const joinResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join`,
      payload: { invite_token: inviteResponse.json().invite_token, display_name: "Bob" }
    });
    expect(joinResponse.statusCode).toBe(201);
    const bob = joinResponse.json();

    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { text: "Protocol first." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: ownerAuth, payload: { text: "Collect owner input." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/ai-collection/cancel`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);

    const proposal = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals`, headers: ownerAuth, payload: { title: "Adopt protocol-first MVP", proposal_type: "proposal", policy: { type: "owner_approval" } } })).json();
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
      "ai.collection.started", "ai.collection.cancelled", "proposal.created", "proposal.vote_cast", "proposal.approved",
      "agent.registered", "task.created", "task.started", "task.output", "task.completed"
    ]));
    expect(eventTypes.some((type: string) => type.startsWith("decision.") || type.startsWith("question."))).toBe(false);

    await app.close();
  });
});
