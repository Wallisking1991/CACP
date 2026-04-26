import type { CacpEvent } from "@cacp/protocol";

export interface ParticipantView { id: string; display_name: string; role: string; type: string }
export interface AgentView { agent_id: string; name: string; capabilities: string[]; status: "online" | "offline" | "unknown"; last_status_at?: string }
export interface MessageView { message_id?: string; actor_id: string; text: string; kind: string; created_at: string }
export interface StreamingTurnView { turn_id: string; agent_id: string; text: string }
export interface QuestionResponseView { respondent_id: string; response: unknown; comment?: string }
export interface DecisionOptionView { id: string; label: string }
export interface DecisionResponseView {
  respondent_id: string;
  response: unknown;
  response_label?: string;
  source_message_id?: string;
  interpretation?: unknown;
  created_at: string;
}
export interface DecisionView {
  decision_id: string;
  title: string;
  description: string;
  kind: string;
  options: DecisionOptionView[];
  policy?: unknown;
  blocking: boolean;
  decision_type?: string;
  action_id?: string;
  source_turn_id?: string;
  source_message_id?: string;
  responses: DecisionResponseView[];
  created_at: string;
  terminal_status?: "resolved" | "cancelled";
  result?: unknown;
  result_label?: string;
  decided_by?: string[];
  resolved_at?: string;
  cancelled_by?: string;
  cancelled_reason?: string;
  cancelled_at?: string;
}
export interface QuestionView {
  question_id: string;
  question: string;
  options: string[];
  blocking: boolean;
  question_type?: string;
  action_id?: string;
  responses: QuestionResponseView[];
  closed: boolean;
  selected_response?: unknown;
}
export interface RoomViewState {
  participants: ParticipantView[];
  agents: AgentView[];
  activeAgentId?: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  questions: QuestionView[];
  currentDecision?: DecisionView;
  decisionHistory: DecisionView[];
  lastHistoryClearedAt?: string;
  inviteCount: number;
  roomPolicy?: unknown;
}

function isParticipant(value: unknown): value is ParticipantView {
  if (!value || typeof value !== "object") return false;
  const participant = value as Partial<ParticipantView>;
  return typeof participant.id === "string" && typeof participant.display_name === "string" && typeof participant.role === "string" && typeof participant.type === "string";
}

function decisionOptions(value: unknown): DecisionOptionView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DecisionOptionView => {
    if (!item || typeof item !== "object") return false;
    const option = item as Partial<DecisionOptionView>;
    return typeof option.id === "string" && typeof option.label === "string";
  });
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length === value.length ? items : undefined;
}

function lastHistoryClear(events: CacpEvent[]): { index: number; clearedAt?: string } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const storedEvent = events[index];
    if (storedEvent.type !== "room.history_cleared") continue;
    if (storedEvent.payload.scope !== undefined && storedEvent.payload.scope !== "messages_and_decisions") continue;
    return {
      index,
      clearedAt: typeof storedEvent.payload.cleared_at === "string" ? storedEvent.payload.cleared_at : storedEvent.created_at
    };
  }
  return { index: -1 };
}

export function deriveRoomState(events: CacpEvent[]): RoomViewState {
  const participants = new Map<string, ParticipantView>();
  const agents = new Map<string, AgentView>();
  const messages: MessageView[] = [];
  const streamingTurns = new Map<string, StreamingTurnView>();
  const questions = new Map<string, QuestionView>();
  const decisions = new Map<string, DecisionView>();
  const responseMaps = new Map<string, Map<string, DecisionResponseView>>();
  let activeAgentId: string | undefined;
  let roomPolicy: unknown;
  let inviteCount = 0;
  const historyClear = lastHistoryClear(events);
  const scopedEvents = events.slice(historyClear.index + 1);

  for (const event of events) {
    if (event.type === "room.configured") roomPolicy = event.payload.default_policy;
    if (event.type === "participant.joined" && isParticipant(event.payload.participant)) participants.set(event.payload.participant.id, event.payload.participant);
    if (event.type === "participant.left" && typeof event.payload.participant_id === "string") participants.delete(event.payload.participant_id);
    if (event.type === "participant.role_updated" && typeof event.payload.participant_id === "string" && typeof event.payload.role === "string") {
      const participant = participants.get(event.payload.participant_id);
      if (participant) participants.set(participant.id, { ...participant, role: event.payload.role });
    }
    if (event.type === "invite.created") inviteCount += 1;
    if (event.type === "agent.registered" && typeof event.payload.agent_id === "string" && typeof event.payload.name === "string") {
      const existing = agents.get(event.payload.agent_id);
      agents.set(event.payload.agent_id, {
        agent_id: event.payload.agent_id,
        name: event.payload.name,
        capabilities: Array.isArray(event.payload.capabilities) ? event.payload.capabilities.filter((item): item is string => typeof item === "string") : [],
        status: existing?.status ?? "unknown",
        last_status_at: existing?.last_status_at
      });
    }
    if ((event.type === "agent.unregistered" || event.type === "agent.disconnected") && typeof event.payload.agent_id === "string") {
      const existing = agents.get(event.payload.agent_id);
      if (existing) agents.set(event.payload.agent_id, { ...existing, status: "offline", last_status_at: event.created_at });
    }
    if (event.type === "agent.status_changed" && typeof event.payload.agent_id === "string") {
      const existing = agents.get(event.payload.agent_id) ?? { agent_id: event.payload.agent_id, name: event.payload.agent_id, capabilities: [], status: "unknown" as const };
      agents.set(event.payload.agent_id, { ...existing, status: event.payload.status === "online" ? "online" : "offline", last_status_at: event.created_at });
    }
    if (event.type === "room.agent_selected" && typeof event.payload.agent_id === "string") activeAgentId = event.payload.agent_id;
  }

  for (const event of scopedEvents) {
    if (event.type === "message.created" && typeof event.payload.text === "string") {
      messages.push({ message_id: typeof event.payload.message_id === "string" ? event.payload.message_id : undefined, actor_id: event.actor_id, text: event.payload.text, kind: typeof event.payload.kind === "string" ? event.payload.kind : "human", created_at: event.created_at });
    }
    if (event.type === "agent.turn.started" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string") streamingTurns.set(event.payload.turn_id, { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" });
    if (event.type === "agent.output.delta" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.chunk === "string") {
      const current = streamingTurns.get(event.payload.turn_id) ?? { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" };
      streamingTurns.set(event.payload.turn_id, { ...current, text: current.text + event.payload.chunk });
    }
    if ((event.type === "agent.turn.completed" || event.type === "agent.turn.failed") && typeof event.payload.turn_id === "string") streamingTurns.delete(event.payload.turn_id);
    if (event.type === "question.created" && typeof event.payload.question_id === "string" && typeof event.payload.question === "string") {
      questions.set(event.payload.question_id, {
        question_id: event.payload.question_id,
        question: event.payload.question,
        options: Array.isArray(event.payload.options) ? event.payload.options.filter((item): item is string => typeof item === "string") : [],
        blocking: event.payload.blocking === true,
        question_type: typeof event.payload.question_type === "string" ? event.payload.question_type : undefined,
        action_id: typeof event.payload.action_id === "string" ? event.payload.action_id : undefined,
        responses: [],
        closed: false
      });
    }
    if (event.type === "question.response_submitted" && typeof event.payload.question_id === "string" && typeof event.payload.respondent_id === "string") {
      const question = questions.get(event.payload.question_id);
      if (question) {
        const nextResponses = question.responses.filter((response) => response.respondent_id !== event.payload.respondent_id);
        nextResponses.push({ respondent_id: event.payload.respondent_id, response: event.payload.response, comment: typeof event.payload.comment === "string" ? event.payload.comment : undefined });
        questions.set(event.payload.question_id, { ...question, responses: nextResponses });
      }
    }
    if (event.type === "question.closed" && typeof event.payload.question_id === "string") {
      const question = questions.get(event.payload.question_id);
      if (question) {
        const evaluation = event.payload.evaluation as { selected_response?: unknown } | undefined;
        questions.set(event.payload.question_id, { ...question, closed: true, selected_response: evaluation?.selected_response });
      }
    }
    if (event.type === "decision.requested" && typeof event.payload.decision_id === "string" && typeof event.payload.title === "string" && typeof event.payload.description === "string" && typeof event.payload.kind === "string") {
      const existingResponses = responseMaps.get(event.payload.decision_id) ?? new Map<string, DecisionResponseView>();
      decisions.set(event.payload.decision_id, {
        decision_id: event.payload.decision_id,
        title: event.payload.title,
        description: event.payload.description,
        kind: event.payload.kind,
        options: decisionOptions(event.payload.options),
        policy: event.payload.policy,
        blocking: event.payload.blocking !== false,
        decision_type: typeof event.payload.decision_type === "string" ? event.payload.decision_type : undefined,
        action_id: typeof event.payload.action_id === "string" ? event.payload.action_id : undefined,
        source_turn_id: typeof event.payload.source_turn_id === "string" ? event.payload.source_turn_id : undefined,
        source_message_id: typeof event.payload.source_message_id === "string" ? event.payload.source_message_id : undefined,
        responses: [...existingResponses.values()],
        created_at: event.created_at
      });
      responseMaps.set(event.payload.decision_id, existingResponses);
    }
    if (event.type === "decision.response_recorded" && typeof event.payload.decision_id === "string" && typeof event.payload.respondent_id === "string" && event.payload.response !== undefined) {
      const decision = decisions.get(event.payload.decision_id);
      if (decision) {
        const byRespondent = responseMaps.get(event.payload.decision_id) ?? new Map<string, DecisionResponseView>();
        byRespondent.set(event.payload.respondent_id, {
          respondent_id: event.payload.respondent_id,
          response: event.payload.response,
          response_label: typeof event.payload.response_label === "string" ? event.payload.response_label : undefined,
          source_message_id: typeof event.payload.source_message_id === "string" ? event.payload.source_message_id : undefined,
          interpretation: event.payload.interpretation,
          created_at: event.created_at
        });
        responseMaps.set(event.payload.decision_id, byRespondent);
        decisions.set(event.payload.decision_id, { ...decision, responses: [...byRespondent.values()] });
      }
    }
    if (event.type === "decision.resolved" && typeof event.payload.decision_id === "string" && event.payload.result !== undefined) {
      const decision = decisions.get(event.payload.decision_id);
      if (decision) {
        decisions.set(event.payload.decision_id, {
          ...decision,
          terminal_status: "resolved",
          result: event.payload.result,
          result_label: typeof event.payload.result_label === "string" ? event.payload.result_label : undefined,
          decided_by: stringArray(event.payload.decided_by) ?? [],
          resolved_at: event.created_at
        });
      }
    }
    if (event.type === "decision.cancelled" && typeof event.payload.decision_id === "string") {
      const decision = decisions.get(event.payload.decision_id);
      if (decision) {
        decisions.set(event.payload.decision_id, {
          ...decision,
          terminal_status: "cancelled",
          cancelled_by: typeof event.payload.cancelled_by === "string" ? event.payload.cancelled_by : undefined,
          cancelled_reason: typeof event.payload.reason === "string" ? event.payload.reason : undefined,
          cancelled_at: event.created_at
        });
      }
    }
  }

  const decisionViews = [...decisions.values()];
  const currentDecision = [...decisionViews].reverse().find((decision) => !decision.terminal_status);
  const decisionHistory = decisionViews.filter((decision) => Boolean(decision.terminal_status));

  return {
    participants: [...participants.values()],
    agents: [...agents.values()],
    activeAgentId,
    messages,
    streamingTurns: [...streamingTurns.values()],
    questions: [...questions.values()],
    currentDecision,
    decisionHistory,
    lastHistoryClearedAt: historyClear.clearedAt,
    inviteCount,
    roomPolicy
  };
}
