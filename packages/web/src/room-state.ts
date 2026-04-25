import type { CacpEvent } from "@cacp/protocol";

export interface ParticipantView {
  id: string;
  display_name: string;
  role: string;
  type: string;
}

export interface AgentView {
  agent_id: string;
  name: string;
  capabilities: string[];
}

export interface MessageView {
  message_id?: string;
  actor_id: string;
  text: string;
  kind: string;
  created_at: string;
}

export interface StreamingTurnView {
  turn_id: string;
  agent_id: string;
  text: string;
}

export interface QuestionView {
  question_id: string;
  question: string;
  options: string[];
}

export interface RoomViewState {
  participants: ParticipantView[];
  agents: AgentView[];
  activeAgentId?: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  questions: QuestionView[];
}

function isParticipant(value: unknown): value is ParticipantView {
  if (!value || typeof value !== "object") return false;
  const participant = value as Partial<ParticipantView>;
  return typeof participant.id === "string"
    && typeof participant.display_name === "string"
    && typeof participant.role === "string"
    && typeof participant.type === "string";
}

export function deriveRoomState(events: CacpEvent[]): RoomViewState {
  const participants = new Map<string, ParticipantView>();
  const agents = new Map<string, AgentView>();
  const messages: MessageView[] = [];
  const streamingTurns = new Map<string, StreamingTurnView>();
  const questions = new Map<string, QuestionView>();
  let activeAgentId: string | undefined;

  for (const event of events) {
    if (event.type === "participant.joined" && isParticipant(event.payload.participant)) {
      participants.set(event.payload.participant.id, event.payload.participant);
    }
    if (event.type === "agent.registered" && typeof event.payload.agent_id === "string" && typeof event.payload.name === "string") {
      agents.set(event.payload.agent_id, {
        agent_id: event.payload.agent_id,
        name: event.payload.name,
        capabilities: Array.isArray(event.payload.capabilities) ? event.payload.capabilities.filter((item): item is string => typeof item === "string") : []
      });
    }
    if (event.type === "room.agent_selected" && typeof event.payload.agent_id === "string") {
      activeAgentId = event.payload.agent_id;
    }
    if (event.type === "message.created" && typeof event.payload.text === "string") {
      messages.push({
        message_id: typeof event.payload.message_id === "string" ? event.payload.message_id : undefined,
        actor_id: event.actor_id,
        text: event.payload.text,
        kind: typeof event.payload.kind === "string" ? event.payload.kind : "human",
        created_at: event.created_at
      });
    }
    if (event.type === "agent.turn.started" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string") {
      streamingTurns.set(event.payload.turn_id, { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" });
    }
    if (event.type === "agent.output.delta" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.chunk === "string") {
      const current = streamingTurns.get(event.payload.turn_id) ?? { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" };
      streamingTurns.set(event.payload.turn_id, { ...current, text: current.text + event.payload.chunk });
    }
    if ((event.type === "agent.turn.completed" || event.type === "agent.turn.failed") && typeof event.payload.turn_id === "string") {
      streamingTurns.delete(event.payload.turn_id);
    }
    if (event.type === "question.created" && typeof event.payload.question_id === "string" && typeof event.payload.question === "string") {
      questions.set(event.payload.question_id, {
        question_id: event.payload.question_id,
        question: event.payload.question,
        options: Array.isArray(event.payload.options) ? event.payload.options.filter((item): item is string => typeof item === "string") : []
      });
    }
  }

  return {
    participants: [...participants.values()],
    agents: [...agents.values()],
    activeAgentId,
    messages,
    streamingTurns: [...streamingTurns.values()],
    questions: [...questions.values()]
  };
}
