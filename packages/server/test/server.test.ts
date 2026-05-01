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

async function joinViaApproval(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, inviteToken: string, displayName: string) {
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteToken, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${ownerToken}` }, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  return status.json() as { participant_id: string; participant_token: string; role: string };
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

    const bob = await joinViaApproval(app, created.room_id, created.owner_token, inviteResponse.json().invite_token, "Bob");

    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { text: "Protocol first." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: ownerAuth, payload: { text: "Collect owner input." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/ai-collection/cancel`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);

    const proposal = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals`, headers: ownerAuth, payload: { title: "Adopt protocol-first MVP", proposal_type: "proposal", policy: { type: "owner_approval" } } })).json();
    const voteResponse = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals/${proposal.proposal_id}/votes`, headers: ownerAuth, payload: { vote: "approve", comment: "Approved." } });
    expect(voteResponse.json().evaluation.status).toBe("approved");

    const agent = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Legacy Task Runner", capabilities: ["legacy.task_runner"] } })).json();
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

  it("creates invite with max_uses and auto-adjusts to room capacity", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    // Create a 10-person invite in an empty room (default maxParticipantsPerRoom = 20)
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", max_uses: 10 }
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteBody = inviteResponse.json() as { invite_token: string; role: string; max_uses: number };
    expect(inviteBody.max_uses).toBe(10);

    // Fill room with 19 more participants via invites (owner + 19 = 20)
    for (let i = 0; i < 19; i++) {
      const inv = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/invites`, headers: ownerAuth, payload: { role: "member", max_uses: 1 } });
      await joinViaApproval(app, created.room_id, created.owner_token, inv.json().invite_token, `User${i}`);
    }

    // Room now has 20 participants. Try to create a 5-person invite — should auto-adjust to 0
    const fullRoomInvite = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", max_uses: 5 }
    });
    expect(fullRoomInvite.statusCode).toBe(409);

    await app.close();
  });

  it("consumes invite at approval time and enforces pending limit", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    // Create a 3-person invite
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", max_uses: 3 }
    });
    expect(inviteResponse.statusCode).toBe(201);
    const inviteToken = (inviteResponse.json() as { invite_token: string }).invite_token;

    // 3 people can create join requests
    const req1 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Alice" } });
    const req2 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Bob" } });
    const req3 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Carol" } });
    expect(req1.statusCode).toBe(201);
    expect(req2.statusCode).toBe(201);
    expect(req3.statusCode).toBe(201);

    // 4th person is rejected due to pending limit
    const req4 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Dave" } });
    expect(req4.statusCode).toBe(409);

    // Approve only 2 of them
    const request1 = req1.json() as { request_id: string };
    const request2 = req2.json() as { request_id: string };
    const approve1 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests/${request1.request_id}/approve`, headers: ownerAuth, payload: {} });
    const approve2 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests/${request2.request_id}/approve`, headers: ownerAuth, payload: {} });
    expect(approve1.statusCode).toBe(201);
    expect(approve2.statusCode).toBe(201);

    // 3rd request can now be created because 2 were approved and 1 is still pending (total 3)
    // Actually, 1 pending (Carol) + 2 approved = 3, so no room. Let's reject Carol first.
    const request3 = req3.json() as { request_id: string };
    const reject3 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests/${request3.request_id}/reject`, headers: ownerAuth, payload: {} });
    expect(reject3.statusCode).toBe(201);

    // Now 2 approved + 0 pending = 2 < 3, so a new request should succeed
    const req5 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Eve" } });
    expect(req5.statusCode).toBe(201);

    // Approve Eve — now used_count = 3, invite should be auto-revoked
    const request5 = req5.json() as { request_id: string };
    const approve5 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests/${request5.request_id}/approve`, headers: ownerAuth, payload: {} });
    expect(approve5.statusCode).toBe(201);

    // Any further request should be rejected because invite is revoked
    const req6 = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/join-requests`, payload: { invite_token: inviteToken, display_name: "Frank" } });
    expect(req6.statusCode).toBe(409);

    await app.close();
  });

  it("auto-revokes invite when max_uses is reached and emits invite.revoked event", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    // Create a 1-person invite
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", max_uses: 1 }
    });
    const inviteToken = (inviteResponse.json() as { invite_token: string }).invite_token;

    // Join and approve
    const bob = await joinViaApproval(app, created.room_id, created.owner_token, inviteToken, "Bob");
    expect(bob.role).toBe("member");

    // Check events include invite.revoked
    const eventsResponse = await app.inject({ method: "GET", url: `/rooms/${created.room_id}/events`, headers: ownerAuth });
    const eventTypes = eventsResponse.json().events.map((event: { type: string }) => event.type);
    expect(eventTypes).toContain("invite.revoked");

    await app.close();
  });
});
