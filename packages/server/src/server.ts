import Fastify, { type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { evaluatePolicy, PolicySchema, VoteRecordSchema, type CacpEvent, type Participant, type Policy, type VoteRecord } from "@cacp/protocol";
import { requireParticipant, hasAnyRole, hasHumanRole } from "./auth.js";
import { buildAgentContextPrompt, extractCacpQuestions, findActiveAgentId, findOpenTurn, hasQueuedFollowup, recentConversationMessages } from "./conversation.js";
import { EventBus } from "./event-bus.js";
import { EventStore } from "./event-store.js";
import { event, prefixedId, token } from "./ids.js";
import { evaluateQuestionPolicy, type QuestionResponseRecord } from "./policies.js";
import { AgentTypeValues, PermissionLevelValues, buildAgentProfile, type AgentType, type PermissionLevel } from "./pairing.js";

const CreateRoomSchema = z.object({ name: z.string().min(1), display_name: z.string().min(1).default("Owner"), default_policy: z.enum(["owner_approval", "majority", "unanimous"]).default("owner_approval") });
const CreateInviteSchema = z.object({ role: z.enum(["member", "observer"]).default("member"), expires_in_seconds: z.number().int().positive().max(60 * 60 * 24 * 7).default(60 * 60 * 24) });
const JoinSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1) });
const MessageSchema = z.object({ text: z.string().min(1) });
const QuestionSchema = z.object({ question: z.string().min(1), expected_response: z.enum(["free_text", "single_choice", "multiple_choice"]).default("free_text"), options: z.array(z.string()).default([]) });
const QuestionResponseSchema = z.object({ response: z.unknown(), comment: z.string().optional() });
const ProposalSchema = z.object({ title: z.string().min(1), proposal_type: z.string().min(1), policy: PolicySchema });
const AgentRegisterSchema = z.object({ name: z.string().min(1), capabilities: z.array(z.string()).default([]) });
const AgentPairingCreateSchema = z.object({
  agent_type: z.enum(AgentTypeValues).default("claude-code"),
  permission_level: z.enum(PermissionLevelValues).default("read_only"),
  working_dir: z.string().default("."),
  server_url: z.string().url().optional()
});
const AgentActionApprovalSchema = z.object({ tool_name: z.string().min(1), tool_input: z.unknown().optional(), description: z.string().optional() });
const AgentActionApprovalQuerySchema = z.object({ token: z.string().optional(), wait_ms: z.coerce.number().int().min(0).max(5 * 60 * 1000).default(0) });
const SelectAgentSchema = z.object({ agent_id: z.string().min(1) });
const TaskCreateSchema = z.object({ target_agent_id: z.string().min(1), prompt: z.string().min(1), mode: z.literal("oneshot").default("oneshot"), requires_approval: z.boolean().default(false) });
const TaskOutputSchema = z.object({ stream: z.enum(["stdout", "stderr"]), chunk: z.string() });
const TaskCompleteSchema = z.object({ exit_code: z.number().int() });
const TaskFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });
const TurnOutputSchema = z.object({ chunk: z.string() });
const TurnCompleteSchema = z.object({ final_text: z.string(), exit_code: z.number().int().default(0) });
const TurnFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });

export interface BuildServerOptions { dbPath?: string }

type Invite = { room_id: string; role: "member" | "observer"; expires_at: string };
type Pairing = { room_id: string; created_by: string; agent_type: AgentType; permission_level: PermissionLevel; working_dir: string; expires_at: string; claimed?: boolean };
type ProposalTerminalStatus = "approved" | "rejected" | "expired";
type ProposalState = { policy: Policy; votes: VoteRecord[]; terminal_status?: ProposalTerminalStatus };
type TaskTerminalStatus = "completed" | "failed" | "cancelled";
type TaskState = { target_agent_id: string; started: boolean; terminal_status?: TaskTerminalStatus };
type TurnTerminalStatus = "completed" | "failed";
type TurnState = { agent_id: string; started: boolean; terminal_status?: TurnTerminalStatus };

function deny(reply: FastifyReply, error: string, status = 401) {
  return reply.code(status).send({ error });
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: false });
  const store = new EventStore(options.dbPath ?? "cacp.db");
  const bus = new EventBus();
  const invites = new Map<string, Invite>();
  const pairings = new Map<string, Pairing>();
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

  function findTurnState(roomId: string, turnId: string): TurnState | undefined {
    let turn: TurnState | undefined;
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.payload.turn_id !== turnId) continue;
      if (storedEvent.type === "agent.turn.requested" && typeof storedEvent.payload.agent_id === "string") {
        turn = { agent_id: storedEvent.payload.agent_id, started: false };
        continue;
      }
      if (!turn) continue;
      if (storedEvent.type === "agent.turn.started") turn.started = true;
      if (storedEvent.type === "agent.turn.completed") turn.terminal_status = "completed";
      if (storedEvent.type === "agent.turn.failed") turn.terminal_status = "failed";
    }
    return turn;
  }

  function roomPolicy(roomId: string): Policy {
    const configured = [...store.listEvents(roomId)].reverse().find((storedEvent) => storedEvent.type === "room.configured");
    const parsed = PolicySchema.safeParse(configured?.payload.default_policy);
    return parsed.success ? parsed.data : { type: "owner_approval" };
  }

  function isQuestionClosed(roomId: string, questionId: string): boolean {
    return store.listEvents(roomId).some((storedEvent) => storedEvent.type === "question.closed" && storedEvent.payload.question_id === questionId);
  }

  function questionResponses(roomId: string, questionId: string): QuestionResponseRecord[] {
    return store.listEvents(roomId)
      .filter((storedEvent) => storedEvent.type === "question.response_submitted" && storedEvent.payload.question_id === questionId)
      .map((storedEvent) => ({ respondent_id: String(storedEvent.payload.respondent_id), response: storedEvent.payload.response }));
  }

  function questionExists(roomId: string, questionId: string): boolean {
    return store.listEvents(roomId).some((storedEvent) => storedEvent.type === "question.created" && storedEvent.payload.question_id === questionId);
  }

  function questionPayload(roomId: string, questionId: string): Record<string, unknown> | undefined {
    return store.listEvents(roomId).find((storedEvent) => storedEvent.type === "question.created" && storedEvent.payload.question_id === questionId)?.payload;
  }

  function normalizeActionDecision(value: unknown): "approve" | "reject" {
    if (typeof value === "object" && value !== null && "choice" in value) return normalizeActionDecision((value as { choice: unknown }).choice);
    if (typeof value === "object" && value !== null && "decision" in value) return normalizeActionDecision((value as { decision: unknown }).decision);
    return value === "approve" ? "approve" : "reject";
  }

  function findActionApprovalStatus(roomId: string, actionId: string): { status: "pending"; question_id?: string } | { status: "resolved"; question_id?: string; decision: "approve" | "reject"; raw_decision: unknown } | undefined {
    let questionId: string | undefined;
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.type === "question.created" && storedEvent.payload.action_id === actionId && typeof storedEvent.payload.question_id === "string") {
        questionId = storedEvent.payload.question_id;
      }
      if (storedEvent.type === "agent.action_approval_resolved" && storedEvent.payload.action_id === actionId) {
        if (typeof storedEvent.payload.question_id === "string") questionId = storedEvent.payload.question_id;
        return {
          status: "resolved",
          question_id: questionId,
          decision: normalizeActionDecision(storedEvent.payload.decision),
          raw_decision: storedEvent.payload.decision
        };
      }
    }
    return questionId ? { status: "pending", question_id: questionId } : undefined;
  }

  async function waitForActionApprovalResolution(roomId: string, actionId: string, timeoutMs: number): Promise<{ status: "resolved"; question_id?: string; decision: "approve" | "reject"; raw_decision: unknown } | undefined> {
    const current = findActionApprovalStatus(roomId, actionId);
    if (current?.status === "resolved") return current;
    if (timeoutMs <= 0) return undefined;
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value: { status: "resolved"; question_id?: string; decision: "approve" | "reject"; raw_decision: unknown } | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const unsubscribe = bus.subscribe(roomId, (nextEvent) => {
        if (nextEvent.type !== "agent.action_approval_resolved" || nextEvent.payload.action_id !== actionId) return;
        const resolved = findActionApprovalStatus(roomId, actionId);
        settle(resolved?.status === "resolved" ? resolved : {
          status: "resolved",
          question_id: typeof nextEvent.payload.question_id === "string" ? nextEvent.payload.question_id : undefined,
          decision: normalizeActionDecision(nextEvent.payload.decision),
          raw_decision: nextEvent.payload.decision
        });
      });
      const timer = setTimeout(() => settle(undefined), timeoutMs);
      const afterSubscribe = findActionApprovalStatus(roomId, actionId);
      if (afterSubscribe?.status === "resolved") settle(afterSubscribe);
    });
  }

  function isAgentOnline(events: CacpEvent[], agentId: string): boolean {
    for (const storedEvent of [...events].reverse()) {
      if (storedEvent.type === "agent.status_changed" && storedEvent.payload.agent_id === agentId) {
        return storedEvent.payload.status === "online";
      }
    }
    return true;
  }

  function isOpenTurnStale(events: CacpEvent[], turnId: string, agentId: string): boolean {
    const requested = events.find((storedEvent) => storedEvent.type === "agent.turn.requested" && storedEvent.payload.turn_id === turnId);
    if (!requested) return false;
    const ageMs = Date.now() - Date.parse(requested.created_at);
    return ageMs > 2 * 60 * 1000 || !isAgentOnline(events, agentId);
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

  function requireAssignedAgentTurn(roomId: string, turnId: string, participant: Participant, reply: FastifyReply): TurnState | undefined {
    if (participant.role !== "agent") {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    const turn = findTurnState(roomId, turnId);
    if (!turn) {
      deny(reply, "unknown_turn", 404);
      return undefined;
    }
    if (turn.agent_id !== participant.id) {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    return turn;
  }

  function buildContextPrompt(roomId: string, agentId: string): string {
    const events = store.listEvents(roomId);
    const participants = store.getParticipants(roomId);
    const names = new Map(participants.map((participant) => [participant.id, participant.display_name]));
    const agent = participants.find((participant) => participant.id === agentId);
    const messages = recentConversationMessages(events, 20).map((message) => ({
      actorName: names.get(message.actor_id) ?? message.actor_id,
      kind: message.kind,
      text: message.text
    }));
    return buildAgentContextPrompt({ participants: participants.map(publicParticipant), messages, agentName: agent?.display_name ?? agentId });
  }

  function createAgentTurnRequestEvents(roomId: string, actorId: string, reason: "human_message" | "queued_followup"): CacpEvent[] {
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return [];
    const activeAgent = findParticipant(roomId, activeAgentId);
    if (!activeAgent || activeAgent.role !== "agent" || activeAgent.type !== "agent") return [];
    if (!isAgentOnline(events, activeAgentId)) {
      const openTurn = findOpenTurn(events, activeAgentId);
      return openTurn ? [event(roomId, "agent.turn.failed", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId, error: "active_agent_offline" })] : [];
    }
    const openTurn = findOpenTurn(events, activeAgentId);
    if (openTurn) {
      if (isOpenTurnStale(events, openTurn.turn_id, activeAgentId)) {
        const turnId = prefixedId("turn");
        return [
          event(roomId, "agent.turn.failed", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId, error: "stale_turn_recovered" }),
          event(roomId, "agent.turn.requested", actorId, {
            turn_id: turnId,
            agent_id: activeAgentId,
            reason,
            context_prompt: buildContextPrompt(roomId, activeAgentId)
          })
        ];
      }
      if (hasQueuedFollowup(events, openTurn.turn_id)) return [];
      return [event(roomId, "agent.turn.followup_queued", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId })];
    }
    const turnId = prefixedId("turn");
    return [event(roomId, "agent.turn.requested", actorId, {
      turn_id: turnId,
      agent_id: activeAgentId,
      reason,
      context_prompt: buildContextPrompt(roomId, activeAgentId)
    })];
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
        store.appendEvent(event(roomId, "room.configured", ownerId, { default_policy: { type: body.default_policy } })),
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
    if (participant.role === "agent") {
      appendAndPublish(event(request.params.roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "online" }));
    }
    for (const existingEvent of store.listEvents(request.params.roomId)) socket.send(JSON.stringify(existingEvent));
    const unsubscribe = bus.subscribe(request.params.roomId, (nextEvent) => socket.send(JSON.stringify(nextEvent)));
    socket.on("close", () => {
      unsubscribe();
      if (participant.role === "agent") {
        appendAndPublish(event(request.params.roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "offline" }));
      }
    });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/invites", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = CreateInviteSchema.parse(request.body);
    const inviteToken = token();
    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000).toISOString();
    invites.set(inviteToken, { room_id: request.params.roomId, role: body.role, expires_at: expiresAt });
    appendAndPublish(event(request.params.roomId, "invite.created", participant.id, { role: body.role, expires_at: expiresAt }));
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, expires_at: expiresAt });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join", async (request, reply) => {
    const body = JoinSchema.parse(request.body);
    const invite = invites.get(body.invite_token);
    if (!invite || invite.room_id !== request.params.roomId) return deny(reply, "invalid_invite");
    if (Date.parse(invite.expires_at) <= Date.now()) return deny(reply, "invite_expired");
    const participantId = prefixedId("user");
    const participantToken = token();
    const storedEvents = store.transaction(() => {
      const participant = store.addParticipant({ room_id: request.params.roomId, id: participantId, token: participantToken, display_name: body.display_name, type: invite.role === "observer" ? "observer" : "human", role: invite.role });
      return [store.appendEvent(event(request.params.roomId, "participant.joined", participant.id, { participant: publicParticipant(participant) }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ participant_id: participantId, participant_token: participantToken, role: invite.role });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = MessageSchema.parse(request.body);
    const storedEvents = store.transaction(() => {
      const message = store.appendEvent(event(request.params.roomId, "message.created", participant.id, {
        message_id: prefixedId("msg"),
        text: body.text,
        kind: "human"
      }));
      return [message, ...createAgentTurnRequestEvents(request.params.roomId, participant.id, "human_message").map((nextEvent) => store.appendEvent(nextEvent))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send(storedEvents[0]);
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
    if (!questionExists(request.params.roomId, request.params.questionId)) return deny(reply, "unknown_question", 404);
    if (isQuestionClosed(request.params.roomId, request.params.questionId)) return deny(reply, "question_closed", 409);
    const body = QuestionResponseSchema.parse(request.body);
    const storedEvents = store.transaction(() => {
      const submitted = store.appendEvent(event(request.params.roomId, "question.response_submitted", participant.id, { question_id: request.params.questionId, respondent_id: participant.id, ...body }));
      const evaluation = evaluateQuestionPolicy({
        policy: roomPolicy(request.params.roomId),
        participants: store.getParticipants(request.params.roomId).map(publicParticipant),
        responses: [...questionResponses(request.params.roomId, request.params.questionId), { respondent_id: participant.id, response: body.response }]
      });
      const closed: CacpEvent[] = [];
      if (evaluation.status === "closed") {
        const payload = questionPayload(request.params.roomId, request.params.questionId);
        closed.push(store.appendEvent(event(request.params.roomId, "question.closed", participant.id, { question_id: request.params.questionId, evaluation })));
        if (typeof payload?.action_id === "string") {
          closed.push(store.appendEvent(event(request.params.roomId, "agent.action_approval_resolved", participant.id, {
            action_id: payload.action_id,
            question_id: request.params.questionId,
            decision: evaluation.selected_response
          })));
        }
      }
      return [submitted, ...closed];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, closed: storedEvents.some((storedEvent) => storedEvent.type === "question.closed") });
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

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-pairings", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = AgentPairingCreateSchema.parse(request.body);
    const pairingToken = token();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    pairings.set(pairingToken, {
      room_id: request.params.roomId,
      created_by: participant.id,
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      working_dir: body.working_dir,
      expires_at: expiresAt
    });
    appendAndPublish(event(request.params.roomId, "agent.pairing_created", participant.id, {
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      expires_at: expiresAt
    }));
    const serverUrl = body.server_url ?? `${request.protocol}://${request.headers.host}`;
    const command = `corepack pnpm --filter @cacp/cli-adapter dev -- --server ${serverUrl} --pair ${pairingToken}`;
    return reply.code(201).send({ pairing_token: pairingToken, expires_at: expiresAt, command });
  });

  app.post<{ Params: { pairingToken: string }; Body: { adapter_name?: string }; Querystring: { server_url?: string } }>("/agent-pairings/:pairingToken/claim", async (request, reply) => {
    const pairing = pairings.get(request.params.pairingToken);
    if (!pairing) return deny(reply, "invalid_pairing");
    if (pairing.claimed) return deny(reply, "pairing_claimed", 409);
    if (Date.parse(pairing.expires_at) <= Date.now()) return deny(reply, "pairing_expired");
    const agentId = prefixedId("agent");
    const agentToken = token();
    const serverUrl = request.query.server_url ?? `${request.protocol}://${request.headers.host}`;
    const hookUrl = `${serverUrl}/rooms/${pairing.room_id}/agent-action-approvals?token=${encodeURIComponent(agentToken)}`;
    const profile = buildAgentProfile({
      agentType: pairing.agent_type,
      permissionLevel: pairing.permission_level,
      workingDir: pairing.working_dir,
      hookUrl
    });
    const storedEvents = store.transaction(() => {
      pairing.claimed = true;
      store.addParticipant({ room_id: pairing.room_id, id: agentId, token: agentToken, display_name: request.body?.adapter_name ?? profile.name, type: "agent", role: "agent" });
      return [
        store.appendEvent(event(pairing.room_id, "agent.registered", pairing.created_by, {
          agent_id: agentId,
          name: request.body?.adapter_name ?? profile.name,
          capabilities: profile.capabilities,
          agent_type: pairing.agent_type,
          permission_level: pairing.permission_level
        })),
        store.appendEvent(event(pairing.room_id, "agent.status_changed", agentId, { agent_id: agentId, status: "online" }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ room_id: pairing.room_id, agent_id: agentId, agent_token: agentToken, agent: profile, agent_type: pairing.agent_type, permission_level: pairing.permission_level, hook_url: hookUrl });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/select", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = SelectAgentSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    appendAndPublish(event(request.params.roomId, "room.agent_selected", participant.id, { agent_id: body.agent_id }));
    return reply.code(201).send({ ok: true, agent_id: body.agent_id });
  });

  app.post<{ Params: { roomId: string }; Querystring: { token?: string; wait_ms?: string | number } }>("/rooms/:roomId/agent-action-approvals", async (request, reply) => {
    const query = AgentActionApprovalQuerySchema.parse(request.query);
    const participant = query.token ? store.getParticipantByToken(request.params.roomId, query.token) : requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent" || participant.type !== "agent") return deny(reply, "forbidden", 403);
    const body = AgentActionApprovalSchema.parse(request.body);
    const actionId = prefixedId("action");
    const questionId = prefixedId("q");
    const storedEvents = store.transaction(() => [
      store.appendEvent(event(request.params.roomId, "agent.action_approval_requested", participant.id, {
        action_id: actionId,
        agent_id: participant.id,
        tool_name: body.tool_name,
        tool_input: body.tool_input,
        description: body.description
      })),
      store.appendEvent(event(request.params.roomId, "question.created", participant.id, {
        question_id: questionId,
        action_id: actionId,
        question: body.description ?? `允许 Agent 执行 ${body.tool_name} 吗？`,
        expected_response: "single_choice",
        options: ["approve", "reject"],
        blocking: true,
        policy: roomPolicy(request.params.roomId),
        question_type: "agent_action_approval"
      }))
    ]);
    publishEvents(storedEvents);
    const resolved = await waitForActionApprovalResolution(request.params.roomId, actionId, query.wait_ms);
    if (resolved) {
      return reply.code(201).send({ action_id: actionId, question_id: resolved.question_id ?? questionId, status: "resolved", decision: resolved.decision, raw_decision: resolved.raw_decision });
    }
    return reply.code(201).send({ action_id: actionId, question_id: questionId, status: "pending" });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (turn.started) return deny(reply, "turn_already_started", 409);
    appendAndPublish(event(request.params.roomId, "agent.turn.started", participant.id, { turn_id: request.params.turnId, agent_id: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/delta", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    const body = TurnOutputSchema.parse(request.body);
    appendAndPublish(event(request.params.roomId, "agent.output.delta", participant.id, { turn_id: request.params.turnId, agent_id: participant.id, chunk: body.chunk }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    const body = TurnCompleteSchema.parse(request.body);
    const messageId = prefixedId("msg");
    const storedEvents = store.transaction(() => {
      const completed = store.appendEvent(event(request.params.roomId, "agent.turn.completed", participant.id, {
        turn_id: request.params.turnId,
        agent_id: participant.id,
        message_id: messageId,
        exit_code: body.exit_code
      }));
      const finalMessage = store.appendEvent(event(request.params.roomId, "message.created", participant.id, {
        message_id: messageId,
        text: body.final_text,
        kind: "agent",
        turn_id: request.params.turnId
      }));
      const questionEvents = extractCacpQuestions(body.final_text).map((question) => store.appendEvent(event(request.params.roomId, "question.created", participant.id, {
        question_id: prefixedId("q"),
        question: question.question,
        expected_response: "single_choice",
        options: question.options,
        blocking: true,
        policy: roomPolicy(request.params.roomId)
      })));
      const followupEvents = hasQueuedFollowup(store.listEvents(request.params.roomId), request.params.turnId)
        ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup").map((nextEvent) => store.appendEvent(nextEvent))
        : [];
      return [completed, finalMessage, ...questionEvents, ...followupEvents];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, message_id: messageId });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    appendAndPublish(event(request.params.roomId, "agent.turn.failed", participant.id, { turn_id: request.params.turnId, agent_id: participant.id, ...TurnFailedSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
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

function publicParticipant(participant: Participant): Participant {
  return { id: participant.id, type: participant.type, display_name: participant.display_name, role: participant.role };
}
