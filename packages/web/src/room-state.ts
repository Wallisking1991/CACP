import type { CacpEvent } from "@cacp/protocol";

export interface ParticipantView { id: string; display_name: string; role: string; type: string }
export interface AgentView { agent_id: string; name: string; capabilities: string[]; status: "online" | "offline" | "unknown"; last_status_at?: string }
export interface MessageView { message_id?: string; actor_id: string; text: string; kind: string; created_at: string; collection_id?: string; cancelledMessageCount?: number }
export interface StreamingTurnView { turn_id: string; agent_id: string; text: string }
export interface JoinRequestView {
  request_id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
}
export interface AiCollectionView {
  collection_id: string;
  started_by: string;
  started_at: string;
  messages: MessageView[];
  submitted_by?: string;
  submitted_at?: string;
  cancelled_by?: string;
  cancelled_at?: string;
  message_ids?: string[];
}
export interface RoundtableRequestView { request_id: string; requested_by: string; requester_name: string; created_at: string }
export interface RoomViewState {
  participants: ParticipantView[];
  agents: AgentView[];
  activeAgentId?: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  activeCollection?: AiCollectionView;
  collectionHistory: AiCollectionView[];
  lastHistoryClearedAt?: string;
  inviteCount: number;
  roomName?: string;
  joinRequests: JoinRequestView[];
  pendingRoundtableRequest?: RoundtableRequestView;
}

function failedTurnMessage(event: CacpEvent, streamedText: string | undefined): MessageView | undefined {
  if (typeof event.payload.turn_id !== "string") return undefined;
  const error = typeof event.payload.error === "string" ? event.payload.error : "unknown error";
  const exitCode = typeof event.payload.exit_code === "number" ? ` (exit code ${event.payload.exit_code})` : "";
  const output = streamedText?.trim();
  return {
    message_id: `failed-${event.payload.turn_id}`,
    actor_id: typeof event.payload.agent_id === "string" ? event.payload.agent_id : event.actor_id,
    text: `Agent turn failed${exitCode}: ${error}${output ? `\n\nOutput before failure:\n${output}` : ""}`,
    kind: "system",
    created_at: event.created_at
  };
}

function isParticipant(value: unknown): value is ParticipantView {
  if (!value || typeof value !== "object") return false;
  const participant = value as Partial<ParticipantView>;
  return typeof participant.id === "string" && typeof participant.display_name === "string" && typeof participant.role === "string" && typeof participant.type === "string";
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length === value.length ? items : undefined;
}

function isHistoryClearScope(value: unknown): boolean {
  return value === undefined || value === "messages" || value === "messages_and_decisions";
}

function lastHistoryClear(events: CacpEvent[]): { index: number; clearedAt?: string } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const storedEvent = events[index];
    if (storedEvent.type !== "room.history_cleared") continue;
    if (!isHistoryClearScope(storedEvent.payload.scope)) continue;
    return {
      index,
      clearedAt: typeof storedEvent.payload.cleared_at === "string" ? storedEvent.payload.cleared_at : storedEvent.created_at
    };
  }
  return { index: -1 };
}

function isValidJoinRequestStatus(value: unknown): value is JoinRequestView["status"] {
  return value === "pending" || value === "approved" || value === "rejected" || value === "expired";
}

export function deriveRoomState(events: CacpEvent[]): RoomViewState {
  const participants = new Map<string, ParticipantView>();
  const agents = new Map<string, AgentView>();
  const messages: MessageView[] = [];
  const streamingTurns = new Map<string, StreamingTurnView>();
  const collections = new Map<string, AiCollectionView>();
  const joinRequests = new Map<string, JoinRequestView>();
  const roundtableRequests = new Map<string, RoundtableRequestView>();
  let activeAgentId: string | undefined;
  let inviteCount = 0;
  let roomName: string | undefined;
  const historyClear = lastHistoryClear(events);
  const scopedEvents = events.slice(historyClear.index + 1);

  for (const event of events) {
    if (event.type === "room.created" && typeof event.payload.name === "string") roomName = event.payload.name;
    if (event.type === "participant.joined" && isParticipant(event.payload.participant)) participants.set(event.payload.participant.id, event.payload.participant);
    if (event.type === "participant.left" && typeof event.payload.participant_id === "string") participants.delete(event.payload.participant_id);
    if (event.type === "participant.removed" && typeof event.payload.participant_id === "string") participants.delete(event.payload.participant_id);
    if (event.type === "participant.role_updated" && typeof event.payload.participant_id === "string" && typeof event.payload.role === "string") {
      const participant = participants.get(event.payload.participant_id);
      if (participant) participants.set(participant.id, { ...participant, role: event.payload.role });
    }
    if (event.type === "invite.created") inviteCount += 1;
    if (event.type === "join_request.created" && typeof event.payload.request_id === "string" && typeof event.payload.display_name === "string") {
      joinRequests.set(event.payload.request_id, {
        request_id: event.payload.request_id,
        display_name: event.payload.display_name,
        status: "pending",
        created_at: event.created_at
      });
    }
    if ((event.type === "join_request.approved" || event.type === "join_request.rejected" || event.type === "join_request.expired") && typeof event.payload.request_id === "string") {
      const request = joinRequests.get(event.payload.request_id);
      if (request) {
        const newStatus = event.type === "join_request.approved" ? "approved" : event.type === "join_request.rejected" ? "rejected" : "expired";
        joinRequests.set(event.payload.request_id, { ...request, status: newStatus });
      }
    }
    if (event.type === "ai.collection.requested" && typeof event.payload.request_id === "string" && typeof event.payload.requested_by === "string") {
      const requester = participants.get(event.payload.requested_by);
      roundtableRequests.set(event.payload.request_id, {
        request_id: event.payload.request_id,
        requested_by: event.payload.requested_by,
        requester_name: requester?.display_name ?? event.payload.requested_by,
        created_at: event.created_at
      });
    }
    if ((event.type === "ai.collection.request_approved" || event.type === "ai.collection.request_rejected") && typeof event.payload.request_id === "string") {
      roundtableRequests.delete(event.payload.request_id);
    }
    if (event.type === "room.history_cleared" && isHistoryClearScope(event.payload.scope)) {
      roundtableRequests.clear();
      joinRequests.clear();
    }
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
    if (event.type === "ai.collection.started" && typeof event.payload.collection_id === "string") {
      collections.set(event.payload.collection_id, {
        collection_id: event.payload.collection_id,
        started_by: typeof event.payload.started_by === "string" ? event.payload.started_by : event.actor_id,
        started_at: event.created_at,
        messages: []
      });
    }
    if (event.type === "message.created" && typeof event.payload.text === "string") {
      const message: MessageView = {
        message_id: typeof event.payload.message_id === "string" ? event.payload.message_id : undefined,
        actor_id: event.actor_id,
        text: event.payload.text,
        kind: typeof event.payload.kind === "string" ? event.payload.kind : "human",
        created_at: event.created_at,
        ...(typeof event.payload.collection_id === "string" ? { collection_id: event.payload.collection_id } : {})
      };
      messages.push(message);
      if (message.collection_id) {
        const collection = collections.get(message.collection_id);
        if (collection) collections.set(message.collection_id, { ...collection, messages: [...collection.messages, message] });
      }
    }
    if (event.type === "ai.collection.submitted" && typeof event.payload.collection_id === "string") {
      const collection = collections.get(event.payload.collection_id);
      if (collection) {
        collections.set(event.payload.collection_id, {
          ...collection,
          submitted_by: typeof event.payload.submitted_by === "string" ? event.payload.submitted_by : event.actor_id,
          submitted_at: event.created_at,
          message_ids: stringArray(event.payload.message_ids) ?? []
        });
      }
    }
    if (event.type === "ai.collection.cancelled" && typeof event.payload.collection_id === "string") {
      const collection = collections.get(event.payload.collection_id);
      if (collection) {
        collections.set(event.payload.collection_id, {
          ...collection,
          cancelled_by: typeof event.payload.cancelled_by === "string" ? event.payload.cancelled_by : event.actor_id,
          cancelled_at: event.created_at
        });
        messages.push({
          message_id: `cancelled-${event.payload.collection_id}`,
          actor_id: "system",
          text: "__CACP_COLLECTION_CANCELLED__",
          kind: "system",
          created_at: event.created_at,
          cancelledMessageCount: collection.messages.length
        });
      }
    }
    if (event.type === "agent.turn.started" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string") streamingTurns.set(event.payload.turn_id, { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" });
    if (event.type === "agent.output.delta" && typeof event.payload.turn_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.chunk === "string") {
      const current = streamingTurns.get(event.payload.turn_id) ?? { turn_id: event.payload.turn_id, agent_id: event.payload.agent_id, text: "" };
      streamingTurns.set(event.payload.turn_id, { ...current, text: current.text + event.payload.chunk });
    }
    if (event.type === "agent.turn.completed" && typeof event.payload.turn_id === "string") streamingTurns.delete(event.payload.turn_id);
    if (event.type === "agent.turn.failed" && typeof event.payload.turn_id === "string") {
      const failedMessage = failedTurnMessage(event, streamingTurns.get(event.payload.turn_id)?.text);
      if (failedMessage) messages.push(failedMessage);
      streamingTurns.delete(event.payload.turn_id);
    }
  }

  const collectionViews = [...collections.values()];
  const activeCollection = [...collectionViews].reverse().find((collection) => !collection.submitted_at && !collection.cancelled_at);
  const collectionHistory = collectionViews.filter((collection) => Boolean(collection.submitted_at || collection.cancelled_at));
  // Only one pending Roundtable request is allowed per room in this version.
  // We intentionally expose only the first (oldest) pending request.
  const pendingRoundtableRequest = [...roundtableRequests.values()][0];

  return {
    participants: [...participants.values()],
    agents: [...agents.values()],
    activeAgentId,
    messages,
    streamingTurns: [...streamingTurns.values()],
    activeCollection,
    collectionHistory,
    lastHistoryClearedAt: historyClear.clearedAt,
    inviteCount,
    roomName,
    joinRequests: [...joinRequests.values()].filter((r) => r.status === "pending"),
    pendingRoundtableRequest
  };
}

export function isHumanParticipant(participant: ParticipantView): boolean {
  return participant.role !== "agent" && participant.type !== "agent";
}

export function humanParticipants(participants: ParticipantView[]): ParticipantView[] {
  return participants.filter(isHumanParticipant);
}

export function isCollectionActive(events: CacpEvent[]): boolean {
  let active = false;
  for (const event of events) {
    if (event.type === "ai.collection.started") active = true;
    if (event.type === "ai.collection.submitted" || event.type === "ai.collection.cancelled") active = false;
  }
  return active;
}

export function isTurnInFlight(events: CacpEvent[]): boolean {
  let inFlight = false;
  for (const event of events) {
    if (event.type === "agent.turn.requested" || event.type === "agent.turn.started") inFlight = true;
    if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") inFlight = false;
  }
  return inFlight;
}

export function collectedMessageIds(events: CacpEvent[], collectionId: string): string[] {
  return events
    .filter((event) => event.type === "message.created" && (event.payload as Record<string, unknown>).collection_id === collectionId)
    .map((event) => typeof (event.payload as Record<string, unknown>).message_id === "string" ? (event.payload as Record<string, unknown>).message_id as string : "")
    .filter(Boolean);
}
