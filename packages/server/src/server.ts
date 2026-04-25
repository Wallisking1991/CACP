import Fastify, { type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { evaluatePolicy, PolicySchema, VoteRecordSchema, type CacpEvent, type Participant, type Policy, type VoteRecord } from "@cacp/protocol";
import { requireParticipant, hasAnyRole, hasHumanRole } from "./auth.js";
import { EventBus } from "./event-bus.js";
import { EventStore } from "./event-store.js";
import { event, prefixedId, token } from "./ids.js";

const CreateRoomSchema = z.object({ name: z.string().min(1), display_name: z.string().min(1).default("Owner") });
const CreateInviteSchema = z.object({ role: z.enum(["admin", "member", "observer"]).default("member"), display_name: z.string().min(1) });
const JoinSchema = z.object({ invite_token: z.string().min(1) });
const MessageSchema = z.object({ text: z.string().min(1) });
const QuestionSchema = z.object({ question: z.string().min(1), expected_response: z.enum(["free_text", "single_choice", "multiple_choice"]).default("free_text"), options: z.array(z.string()).default([]) });
const QuestionResponseSchema = z.object({ response: z.unknown(), comment: z.string().optional() });
const ProposalSchema = z.object({ title: z.string().min(1), proposal_type: z.string().min(1), policy: PolicySchema });
const AgentRegisterSchema = z.object({ name: z.string().min(1), capabilities: z.array(z.string()).default([]) });
const TaskCreateSchema = z.object({ target_agent_id: z.string().min(1), prompt: z.string().min(1), mode: z.literal("oneshot").default("oneshot"), requires_approval: z.boolean().default(false) });
const TaskOutputSchema = z.object({ stream: z.enum(["stdout", "stderr"]), chunk: z.string() });
const TaskCompleteSchema = z.object({ exit_code: z.number().int() });
const TaskFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });

export interface BuildServerOptions { dbPath?: string }

type Invite = { room_id: string; role: "admin" | "member" | "observer"; display_name: string };
type ProposalTerminalStatus = "approved" | "rejected" | "expired";
type ProposalState = { policy: Policy; votes: VoteRecord[]; terminal_status?: ProposalTerminalStatus };
type TaskTerminalStatus = "completed" | "failed" | "cancelled";
type TaskState = { target_agent_id: string; started: boolean; terminal_status?: TaskTerminalStatus };

function deny(reply: FastifyReply, error: string, status = 401) {
  return reply.code(status).send({ error });
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: false });
  const store = new EventStore(options.dbPath ?? "cacp.db");
  const bus = new EventBus();
  const invites = new Map<string, Invite>();
  await app.register(websocket);
  app.addHook("onClose", async () => store.close());

  function publishEvents(events: CacpEvent[]): void {
    for (const stored of events) bus.publish(stored);
  }

  function appendAndPublish(input: CacpEvent): CacpEvent {
    const stored = store.appendEvent(input);
    bus.publish(stored);
    return stored;
  }

  function findProposalState(roomId: string, proposalId: string): ProposalState | undefined {
    let policy: Policy | undefined;
    let terminalStatus: ProposalTerminalStatus | undefined;
    const votes: VoteRecord[] = [];
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.payload.proposal_id !== proposalId) continue;
      if (storedEvent.type === "proposal.created") {
        policy = PolicySchema.parse(storedEvent.payload.policy);
      }
      if (storedEvent.type === "proposal.vote_cast") {
        votes.push(VoteRecordSchema.parse({
          voter_id: storedEvent.payload.voter_id,
          vote: storedEvent.payload.vote,
          comment: storedEvent.payload.comment
        }));
      }
      if (storedEvent.type === "proposal.approved") terminalStatus = "approved";
      if (storedEvent.type === "proposal.rejected") terminalStatus = "rejected";
      if (storedEvent.type === "proposal.expired") terminalStatus = "expired";
    }
    return policy ? { policy, votes, terminal_status: terminalStatus } : undefined;
  }

  function findTaskState(roomId: string, taskId: string): TaskState | undefined {
    let task: TaskState | undefined;
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.type === "task.created" && storedEvent.payload.task_id === taskId && typeof storedEvent.payload.target_agent_id === "string") {
        task = { target_agent_id: storedEvent.payload.target_agent_id, started: false };
        continue;
      }
      if (!task || storedEvent.payload.task_id !== taskId) continue;
      if (storedEvent.type === "task.started") task.started = true;
      if (storedEvent.type === "task.completed") task.terminal_status = "completed";
      if (storedEvent.type === "task.failed") task.terminal_status = "failed";
      if (storedEvent.type === "task.cancelled") task.terminal_status = "cancelled";
    }
    return task;
  }

  function findParticipant(roomId: string, participantId: string): Participant | undefined {
    return store.getParticipants(roomId).find((participant) => participant.id === participantId);
  }

  function requireAssignedAgentTask(roomId: string, taskId: string, participant: Participant, reply: FastifyReply): TaskState | undefined {
    if (participant.role !== "agent") {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    const task = findTaskState(roomId, taskId);
    if (!task) {
      deny(reply, "unknown_task", 404);
      return undefined;
    }
    if (task.target_agent_id !== participant.id) {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    return task;
  }

  app.get("/health", async () => ({ ok: true, protocol: "cacp", version: "0.1.0" }));

  app.post("/rooms", async (request, reply) => {
    const body = CreateRoomSchema.parse(request.body);
    const roomId = prefixedId("room");
    const ownerId = prefixedId("user");
    const ownerToken = token();
    const storedEvents = store.transaction(() => {
      const owner = store.addParticipant({ room_id: roomId, id: ownerId, token: ownerToken, display_name: body.display_name, type: "human", role: "owner" });
      return [
        store.appendEvent(event(roomId, "room.created", ownerId, { name: body.name, created_by: ownerId })),
        store.appendEvent(event(roomId, "participant.joined", ownerId, { participant: publicParticipant(owner) }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ room_id: roomId, owner_id: ownerId, owner_token: ownerToken });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/events", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    return { events: store.listEvents(request.params.roomId), participant: publicParticipant(participant) };
  });

  app.get<{ Params: { roomId: string }; Querystring: { token?: string } }>("/rooms/:roomId/stream", { websocket: true }, (socket, request) => {
    const participant = request.query.token ? store.getParticipantByToken(request.params.roomId, request.query.token) : undefined;
    if (!participant) {
      socket.send(JSON.stringify({ error: "invalid_token" }));
      socket.close();
      return;
    }
    for (const existingEvent of store.listEvents(request.params.roomId)) socket.send(JSON.stringify(existingEvent));
    const unsubscribe = bus.subscribe(request.params.roomId, (nextEvent) => socket.send(JSON.stringify(nextEvent)));
    socket.on("close", unsubscribe);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/invites", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = CreateInviteSchema.parse(request.body);
    const inviteToken = token();
    invites.set(inviteToken, { room_id: request.params.roomId, role: body.role, display_name: body.display_name });
    appendAndPublish(event(request.params.roomId, "invite.created", participant.id, { role: body.role, display_name: body.display_name }));
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, display_name: body.display_name });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join", async (request, reply) => {
    const body = JoinSchema.parse(request.body);
    const invite = invites.get(body.invite_token);
    if (!invite || invite.room_id !== request.params.roomId) return deny(reply, "invalid_invite");
    const participantId = prefixedId("user");
    const participantToken = token();
    const storedEvents = store.transaction(() => {
      const participant = store.addParticipant({ room_id: request.params.roomId, id: participantId, token: participantToken, display_name: invite.display_name, type: invite.role === "observer" ? "observer" : "human", role: invite.role });
      return [store.appendEvent(event(request.params.roomId, "participant.joined", participant.id, { participant: publicParticipant(participant) }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ participant_id: participantId, participant_token: participantToken, role: invite.role });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    return reply.code(201).send(appendAndPublish(event(request.params.roomId, "message.created", participant.id, MessageSchema.parse(request.body))));
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/questions", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const questionId = prefixedId("q");
    appendAndPublish(event(request.params.roomId, "question.created", participant.id, { question_id: questionId, ...QuestionSchema.parse(request.body) }));
    return reply.code(201).send({ question_id: questionId });
  });

  app.post<{ Params: { roomId: string; questionId: string } }>("/rooms/:roomId/questions/:questionId/responses", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "question.response_submitted", participant.id, { question_id: request.params.questionId, respondent_id: participant.id, ...QuestionResponseSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/proposals", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = ProposalSchema.parse(request.body);
    const proposalId = prefixedId("prop");
    appendAndPublish(event(request.params.roomId, "proposal.created", participant.id, { proposal_id: proposalId, ...body }));
    return reply.code(201).send({ proposal_id: proposalId });
  });

  app.post<{ Params: { roomId: string; proposalId: string } }>("/rooms/:roomId/proposals/:proposalId/votes", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const state = findProposalState(request.params.roomId, request.params.proposalId);
    if (!state) return deny(reply, "unknown_proposal", 404);
    if (state.terminal_status) return deny(reply, "proposal_closed", 409);
    const vote = VoteRecordSchema.parse({ ...(request.body as object), voter_id: participant.id });
    const votes = [...state.votes, vote];
    const evaluation = evaluatePolicy(state.policy, store.getParticipants(request.params.roomId), votes);
    const eventsToAppend = [event(request.params.roomId, "proposal.vote_cast", participant.id, { proposal_id: request.params.proposalId, ...vote })];
    if (evaluation.status === "approved") eventsToAppend.push(event(request.params.roomId, "proposal.approved", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "rejected") eventsToAppend.push(event(request.params.roomId, "proposal.rejected", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "expired") eventsToAppend.push(event(request.params.roomId, "proposal.expired", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    const storedEvents = store.transaction(() => eventsToAppend.map((nextEvent) => store.appendEvent(nextEvent)));
    publishEvents(storedEvents);
    return reply.code(201).send({ evaluation });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/register", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = AgentRegisterSchema.parse(request.body);
    const agentId = prefixedId("agent");
    const agentToken = token();
    const storedEvents = store.transaction(() => {
      store.addParticipant({ room_id: request.params.roomId, id: agentId, token: agentToken, display_name: body.name, type: "agent", role: "agent" });
      return [store.appendEvent(event(request.params.roomId, "agent.registered", participant.id, { agent_id: agentId, name: body.name, capabilities: body.capabilities }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ agent_id: agentId, agent_token: agentToken });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/tasks", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = TaskCreateSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.target_agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    const taskId = prefixedId("task");
    appendAndPublish(event(request.params.roomId, "task.created", participant.id, { task_id: taskId, created_by: participant.id, ...body }));
    return reply.code(201).send({ task_id: taskId });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (task.started) return deny(reply, "task_already_started", 409);
    appendAndPublish(event(request.params.roomId, "task.started", participant.id, { task_id: request.params.taskId, agent_id: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/output", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.output", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskOutputSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.completed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskCompleteSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.failed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskFailedSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  return app;
}

function publicParticipant(participant: { id: string; type: string; display_name: string; role: string }) {
  return { id: participant.id, type: participant.type, display_name: participant.display_name, role: participant.role };
}
