import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const apps: Awaited<ReturnType<typeof buildServer>>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function trackedServer(dbPath = ":memory:") {
  const app = await buildServer({ dbPath });
  apps.push(app);
  return app;
}

function untrack(app: Awaited<ReturnType<typeof buildServer>>) {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
}

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "cacp-server-hardening-"));
  tempDirs.push(dir);
  return join(dir, "cacp.db");
}

async function createRoom(app?: Awaited<ReturnType<typeof buildServer>>, displayName = "Owner") {
  const server = app ?? await trackedServer();
  const response = await server.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: `${displayName} Room`, display_name: displayName }
  });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_id: string; owner_token: string };
  return { app: server, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

async function registerAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerAuth: { authorization: string }, name: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: ownerAuth,
    payload: { name, capabilities: ["shell.oneshot"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}



async function createProposal(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerAuth: { authorization: string }) {
  const response = await app.inject({ method: "POST", url: `/rooms/${roomId}/proposals`, headers: ownerAuth, payload: { title: "Close once", proposal_type: "decision", policy: { type: "owner_approval" } } });
  expect(response.statusCode).toBe(201);
  return response.json() as { proposal_id: string };
}

async function approveProposal(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, proposalId: string, ownerAuth: { authorization: string }) {
  const response = await app.inject({ method: "POST", url: `/rooms/${roomId}/proposals/${proposalId}/votes`, headers: ownerAuth, payload: { vote: "approve" } });
  expect(response.statusCode).toBe(201);
  expect(response.json().evaluation.status).toBe("approved");
  return response;
}

async function createTask(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerAuth: { authorization: string }, targetAgentId: string) {
  const response = await app.inject({ method: "POST", url: `/rooms/${roomId}/tasks`, headers: ownerAuth, payload: { target_agent_id: targetAgentId, prompt: "Do work", mode: "oneshot" } });
  expect(response.statusCode).toBe(201);
  return response.json() as { task_id: string };
}

describe("CACP server hardening", () => {

  it("rejects additional votes on a terminal proposal without appending duplicate events", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const proposal = await createProposal(app, room.room_id, ownerAuth);
    await approveProposal(app, room.room_id, proposal.proposal_id, ownerAuth);

    const secondVote = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals/${proposal.proposal_id}/votes`, headers: ownerAuth, payload: { vote: "reject" } });

    expect(secondVote.statusCode).toBe(409);
    expect(secondVote.json()).toEqual({ error: "proposal_closed" });
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: { proposal_id?: string } }>;
    const proposalEvents = events.filter((event) => event.payload.proposal_id === proposal.proposal_id);
    expect(proposalEvents.filter((event) => event.type === "proposal.vote_cast")).toHaveLength(1);
    expect(proposalEvents.filter((event) => event.type === "proposal.approved")).toHaveLength(1);
  });

  it("rejects additional votes on a terminal proposal after restart", async () => {
    const dbPath = tempDbPath();
    const first = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(first, "Closed Proposal Owner");
    const proposal = await createProposal(first, room.room_id, ownerAuth);
    await approveProposal(first, room.room_id, proposal.proposal_id, ownerAuth);

    await first.close();
    untrack(first);

    const second = await trackedServer(dbPath);
    const secondVote = await second.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals/${proposal.proposal_id}/votes`, headers: ownerAuth, payload: { vote: "reject" } });

    expect(secondVote.statusCode).toBe(409);
    expect(secondVote.json()).toEqual({ error: "proposal_closed" });
  });

  it("does not share invite state across buildServer instances but recovers persisted proposal state", async () => {
    const dbPath = tempDbPath();
    const first = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(first, "First Owner");

    const invite = await first.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member", display_name: "Bob" } });
    expect(invite.statusCode).toBe(201);
    const proposal = await first.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals`, headers: ownerAuth, payload: { title: "Persisted proposal", proposal_type: "decision", policy: { type: "owner_approval" } } });
    expect(proposal.statusCode).toBe(201);

    await first.close();
    untrack(first);

    const second = await trackedServer(dbPath);
    expect((await second.inject({ method: "POST", url: `/rooms/${room.room_id}/join`, payload: { invite_token: invite.json().invite_token } })).statusCode).toBe(401);
    const vote = await second.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals/${proposal.json().proposal_id}/votes`, headers: ownerAuth, payload: { vote: "approve" } });
    expect(vote.statusCode).toBe(201);
    expect(vote.json().evaluation.status).toBe("approved");
  });

  it("recovers task assignment from persisted events after restart", async () => {
    const dbPath = tempDbPath();
    const first = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(first, "Task Owner");
    const agent = await registerAgent(first, room.room_id, ownerAuth, "Persistent Agent");
    const task = await createTask(first, room.room_id, ownerAuth, agent.agent_id);

    await first.close();
    untrack(first);

    const second = await trackedServer(dbPath);
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };
    expect((await second.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
    expect((await second.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/complete`, headers: agentAuth, payload: { exit_code: 0 } })).statusCode).toBe(201);
  });

  it("rejects voting on a proposal through another room route", async () => {
    const app = await trackedServer();
    const roomA = await createRoom(app, "A Owner");
    const roomB = await createRoom(app, "B Owner");
    const proposal = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/proposals`, headers: roomA.ownerAuth, payload: { title: "Room A only", proposal_type: "decision", policy: { type: "owner_approval" } } });
    expect(proposal.statusCode).toBe(201);

    const wrongRoomVote = await app.inject({ method: "POST", url: `/rooms/${roomB.room.room_id}/proposals/${proposal.json().proposal_id}/votes`, headers: roomB.ownerAuth, payload: { vote: "approve" } });

    expect(wrongRoomVote.statusCode).toBe(404);
  });

  it("allows only the assigned agent to emit task lifecycle events for existing tasks", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const assigned = await registerAgent(app, room.room_id, ownerAuth, "Assigned Agent");
    const other = await registerAgent(app, room.room_id, ownerAuth, "Other Agent");
    const task = await createTask(app, room.room_id, ownerAuth, assigned.agent_id);
    const otherAuth = { authorization: `Bearer ${other.agent_token}` };
    const assignedAuth = { authorization: `Bearer ${assigned.agent_token}` };

    for (const [action, payload] of [
      ["start", {}],
      ["output", { stream: "stdout", chunk: "nope" }],
      ["complete", { exit_code: 0 }],
      ["fail", { error: "nope" }]
    ] as const) {
      expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/${action}`, headers: otherAuth, payload })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/task_missing/${action}`, headers: assignedAuth, payload })).statusCode).toBe(404);
    }

    const failTask = await createTask(app, room.room_id, ownerAuth, assigned.agent_id);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${failTask.task_id}/fail`, headers: assignedAuth, payload: { error: "expected failure", exit_code: 1 } })).statusCode).toBe(201);
  });

  it("rejects task creation for missing, human, observer, or cross-room target agents", async () => {
    const app = await trackedServer();
    const roomA = await createRoom(app, "A Owner");
    const roomB = await createRoom(app, "B Owner");
    const roomBAgent = await registerAgent(app, roomB.room.room_id, roomB.ownerAuth, "Room B Agent");
    const observerInvite = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/invites`, headers: roomA.ownerAuth, payload: { role: "observer", display_name: "Watcher" } });
    const observerJoin = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/join`, payload: { invite_token: observerInvite.json().invite_token } });
    expect(observerJoin.statusCode).toBe(201);

    const targetIds = ["agent_missing", roomA.room.owner_id, observerJoin.json().participant_id, roomBAgent.agent_id];
    for (const targetAgentId of targetIds) {
      const response = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/tasks`, headers: roomA.ownerAuth, payload: { target_agent_id: targetAgentId, prompt: "No", mode: "oneshot" } });
      expect(response.statusCode).toBe(400);
    }
  });

  it("denies a token from one room when reading another room events", async () => {
    const app = await trackedServer();
    const roomA = await createRoom(app, "A Owner");
    const roomB = await createRoom(app, "B Owner");

    const response = await app.inject({ method: "GET", url: `/rooms/${roomB.room.room_id}/events`, headers: roomA.ownerAuth });

    expect(response.statusCode).toBe(401);
  });

  it("prevents observers from creating collaborative content or tasks", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const invite = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "observer", display_name: "Watcher" } });
    const join = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join`, payload: { invite_token: invite.json().invite_token } });
    expect(join.statusCode).toBe(201);
    const observerAuth = { authorization: `Bearer ${join.json().participant_token}` };

    const attempts = [
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: observerAuth, payload: { text: "hi" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/questions`, headers: observerAuth, payload: { question: "Q?" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals`, headers: observerAuth, payload: { title: "No", proposal_type: "decision", policy: { type: "owner_approval" } } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks`, headers: observerAuth, payload: { target_agent_id: "agent_missing", prompt: "No", mode: "oneshot" } })
    ];

    const responses = await Promise.all(attempts);
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
  });
});