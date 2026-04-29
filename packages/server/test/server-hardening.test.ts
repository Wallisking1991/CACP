import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
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

function updateParticipantRole(dbPath: string, roomId: string, participantId: string, role: "admin" | "member" | "observer") {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE participants SET role = ? WHERE room_id = ? AND participant_id = ?").run(role, roomId, participantId);
  } finally {
    db.close();
  }
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
  const response = await app.inject({ method: "POST", url: `/rooms/${roomId}/proposals`, headers: ownerAuth, payload: { title: "Close once", proposal_type: "proposal", policy: { type: "owner_approval" } } });
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

async function joinViaApproval(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerAuth: { authorization: string }, inviteToken: string, displayName: string) {
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteToken, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: ownerAuth, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  return status.json() as { participant_id: string; participant_token: string; role: string };
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

  it("recovers persisted invite and proposal state after restart", async () => {
    const dbPath = tempDbPath();
    const first = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(first, "First Owner");

    const invite = await first.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member" } });
    expect(invite.statusCode).toBe(201);
    const proposal = await first.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals`, headers: ownerAuth, payload: { title: "Persisted proposal", proposal_type: "proposal", policy: { type: "owner_approval" } } });
    expect(proposal.statusCode).toBe(201);

    await first.close();
    untrack(first);

    const second = await trackedServer(dbPath);
    const join = await joinViaApproval(second, room.room_id, ownerAuth, invite.json().invite_token, "Bob");
    expect(join.role).toBe("member");
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
    const proposal = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/proposals`, headers: roomA.ownerAuth, payload: { title: "Room A only", proposal_type: "proposal", policy: { type: "owner_approval" } } });
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
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${failTask.task_id}/start`, headers: assignedAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${failTask.task_id}/fail`, headers: assignedAuth, payload: { error: "expected failure", exit_code: 1 } })).statusCode).toBe(201);
  });

  it("rejects task creation for missing, human, observer, or cross-room target agents", async () => {
    const app = await trackedServer();
    const roomA = await createRoom(app, "A Owner");
    const roomB = await createRoom(app, "B Owner");
    const roomBAgent = await registerAgent(app, roomB.room.room_id, roomB.ownerAuth, "Room B Agent");
    const observerInvite = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/invites`, headers: roomA.ownerAuth, payload: { role: "observer" } });
    const observerJoin = await joinViaApproval(app, roomA.room.room_id, roomA.ownerAuth, observerInvite.json().invite_token, "Watcher");

    const targetIds = ["agent_missing", roomA.room.owner_id, observerJoin.participant_id, roomBAgent.agent_id];
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
    const invite = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "observer" } });
    const join = await joinViaApproval(app, room.room_id, ownerAuth, invite.json().invite_token, "Bob");
    const observerAuth = { authorization: `Bearer ${join.participant_token}` };

    const attempts = [
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: observerAuth, payload: { text: "hi" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals`, headers: observerAuth, payload: { title: "No", proposal_type: "proposal", policy: { type: "owner_approval" } } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks`, headers: observerAuth, payload: { target_agent_id: "agent_missing", prompt: "No", mode: "oneshot" } })
    ];

    const responses = await Promise.all(attempts);
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
  });

  it("restricts control APIs to owners/admins while Roundtable Mode remains owner-only", async () => {
    const dbPath = tempDbPath();
    const app = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(app, "Control Owner");
    const invite = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member" } });
    expect(invite.statusCode).toBe(201);
    const join = await joinViaApproval(app, room.room_id, ownerAuth, invite.json().invite_token, "Bob");
    const memberAuth = { authorization: `Bearer ${join.participant_token}` };

    const ownerAgent = await registerAgent(app, room.room_id, ownerAuth, "Owner Agent");
    const memberAttempts = [
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: memberAuth, payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: memberAuth, payload: { name: "Member Agent", capabilities: [] } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: memberAuth, payload: { agent_id: ownerAgent.agent_id } })
    ];
    expect((await Promise.all(memberAttempts)).map((response) => response.statusCode)).toEqual([403, 403, 403]);

    updateParticipantRole(dbPath, room.room_id, join.participant_id, "admin");
    const adminAuth = memberAuth;
    const adminAgent = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: adminAuth, payload: { name: "Admin Agent", capabilities: [] } });
    expect(adminAgent.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: adminAuth, payload: { agent_type: "claude-code", permission_level: "read_only", working_dir: "." } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: adminAuth, payload: { agent_id: adminAgent.json().agent_id } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: adminAuth, payload: { role: "observer" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: adminAuth, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
  });

  it("prevents registered agent tokens from creating human collaboration content", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth, "Collaboration Blocked Agent");
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };
    const proposal = await createProposal(app, room.room_id, ownerAuth);

    const attempts = [
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: agentAuth, payload: { text: "agent message" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals`, headers: agentAuth, payload: { title: "Agent proposal", proposal_type: "proposal", policy: { type: "owner_approval" } } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/proposals/${proposal.proposal_id}/votes`, headers: agentAuth, payload: { vote: "approve" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks`, headers: agentAuth, payload: { target_agent_id: agent.agent_id, prompt: "self assign", mode: "oneshot" } }),
      app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: agentAuth, payload: { name: "Nested Agent", capabilities: [] } })
    ];

    const responses = await Promise.all(attempts);
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403]);
  });

  it("restricts room active agent selection to human collaborators and same-room agents", async () => {
    const app = await trackedServer();
    const roomA = await createRoom(app, "A Owner");
    const roomB = await createRoom(app, "B Owner");
    const roomAAgent = await registerAgent(app, roomA.room.room_id, roomA.ownerAuth, "Room A Agent");
    const roomBAgent = await registerAgent(app, roomB.room.room_id, roomB.ownerAuth, "Room B Agent");
    const observerInvite = await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/invites`, headers: roomA.ownerAuth, payload: { role: "observer" } });
    const observerJoin = await joinViaApproval(app, roomA.room.room_id, roomA.ownerAuth, observerInvite.json().invite_token, "Watcher");

    expect((await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/agents/select`, headers: roomA.ownerAuth, payload: { agent_id: roomAAgent.agent_id } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/agents/select`, headers: { authorization: `Bearer ${observerJoin.participant_token}` }, payload: { agent_id: roomAAgent.agent_id } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/agents/select`, headers: { authorization: `Bearer ${roomAAgent.agent_token}` }, payload: { agent_id: roomAAgent.agent_id } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/agents/select`, headers: roomA.ownerAuth, payload: { agent_id: roomBAgent.agent_id } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/rooms/${roomA.room.room_id}/agents/select`, headers: roomA.ownerAuth, payload: { agent_id: "agent_missing" } })).statusCode).toBe(400);
  });

  it("allows only the assigned agent to emit turn lifecycle events and enforces ordering", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const assigned = await registerAgent(app, room.room_id, ownerAuth, "Assigned Turn Agent");
    const other = await registerAgent(app, room.room_id, ownerAuth, "Other Turn Agent");
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: assigned.agent_id } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Trigger turn" } })).statusCode).toBe(201);
    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: { turn_id?: string } }>;
    const turnId = events.find((event) => event.type === "agent.turn.requested")?.payload.turn_id;
    expect(turnId).toBeTruthy();

    const assignedAuth = { authorization: `Bearer ${assigned.agent_token}` };
    const otherAuth = { authorization: `Bearer ${other.agent_token}` };
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: otherAuth, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/delta`, headers: assignedAuth, payload: { chunk: "too early" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`, headers: assignedAuth, payload: { final_text: "too early", exit_code: 0 } })).statusCode).toBe(409);

    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: assignedAuth, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: assignedAuth, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/delta`, headers: assignedAuth, payload: { chunk: "ok" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/complete`, headers: assignedAuth, payload: { final_text: "done", exit_code: 0 } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/delta`, headers: assignedAuth, payload: { chunk: "too late" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/fail`, headers: assignedAuth, payload: { error: "too late" } })).statusCode).toBe(409);
  });

  it("enforces task lifecycle ordering and terminal state", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth, "Lifecycle Agent");
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

    const beforeStartTask = await createTask(app, room.room_id, ownerAuth, agent.agent_id);
    const outputBeforeStart = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${beforeStartTask.task_id}/output`, headers: agentAuth, payload: { stream: "stdout", chunk: "too early" } });
    expect(outputBeforeStart.statusCode).toBe(409);
    expect(outputBeforeStart.json()).toEqual({ error: "task_not_started" });
    const completeBeforeStart = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${beforeStartTask.task_id}/complete`, headers: agentAuth, payload: { exit_code: 0 } });
    expect(completeBeforeStart.statusCode).toBe(409);
    expect(completeBeforeStart.json()).toEqual({ error: "task_not_started" });

    const task = await createTask(app, room.room_id, ownerAuth, agent.agent_id);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
    const duplicateStart = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/start`, headers: agentAuth, payload: {} });
    expect(duplicateStart.statusCode).toBe(409);
    expect(duplicateStart.json()).toEqual({ error: "task_already_started" });
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/output`, headers: agentAuth, payload: { stream: "stdout", chunk: "ok" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/complete`, headers: agentAuth, payload: { exit_code: 0 } })).statusCode).toBe(201);

    for (const [action, payload] of [
      ["complete", { exit_code: 0 }],
      ["output", { stream: "stdout", chunk: "too late" }],
      ["fail", { error: "too late", exit_code: 1 }]
    ] as const) {
      const response = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/${action}`, headers: agentAuth, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "task_closed" });
    }
  });

  it("recovers completed task terminal state after restart", async () => {
    const dbPath = tempDbPath();
    const first = await trackedServer(dbPath);
    const { room, ownerAuth } = await createRoom(first, "Restarted Task Owner");
    const agent = await registerAgent(first, room.room_id, ownerAuth, "Restarted Lifecycle Agent");
    const agentAuth = { authorization: `Bearer ${agent.agent_token}` };
    const task = await createTask(first, room.room_id, ownerAuth, agent.agent_id);
    expect((await first.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
    expect((await first.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/complete`, headers: agentAuth, payload: { exit_code: 0 } })).statusCode).toBe(201);

    await first.close();
    untrack(first);

    const second = await trackedServer(dbPath);
    for (const [action, payload] of [
      ["output", { stream: "stdout", chunk: "after restart" }],
      ["complete", { exit_code: 0 }],
      ["fail", { error: "after restart", exit_code: 1 }]
    ] as const) {
      const response = await second.inject({ method: "POST", url: `/rooms/${room.room_id}/tasks/${task.task_id}/${action}`, headers: agentAuth, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "task_closed" });
    }
  });
});
