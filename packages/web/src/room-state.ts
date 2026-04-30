import type {
  CacpEvent,
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionPreviewMessagePayload,
  ClaudeSessionSummary
} from "@cacp/protocol";

export interface ParticipantView { id: string; display_name: string; role: string; type: string }
export interface AgentView { agent_id: string; name: string; capabilities: string[]; status: "online" | "offline" | "unknown"; last_status_at?: string }
export interface MessageView {
  message_id?: string;
  actor_id: string;
  text: string;
  kind: string;
  created_at: string;
  collection_id?: string;
  cancelledMessageCount?: number;
  claudeImportId?: string;
  claudeSessionId?: string;
  claudeSourceKind?: string;
  claudeImportSequence?: number;
}
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

export interface ClaudeSessionCatalogView {
  agent_id: string;
  working_dir: string;
  sessions: ClaudeSessionSummary[];
}

export type ClaudeSessionSelectionView =
  | { agent_id: string; mode: "fresh"; selected_by: string }
  | { agent_id: string; mode: "resume"; session_id: string; selected_by: string };

export interface ClaudeImportView {
  import_id: string;
  agent_id: string;
  session_id: string;
  title: string;
  message_count: number;
  imported_message_count?: number;
  status: "started" | "completed" | "failed";
  error?: string;
}

export interface ClaudeSessionPreviewView {
  preview_id: string;
  agent_id: string;
  session_id: string;
  requested_by?: string;
  status: "requested" | "completed" | "failed";
  messages: ClaudeSessionPreviewMessagePayload[];
  previewed_message_count?: number;
  error?: string;
}

export interface ClaudeRuntimeStatusView {
  agent_id: string;
  turn_id: string;
  status_id: string;
  phase: ClaudeRuntimePhase;
  current: string;
  recent: string[];
  metrics: ClaudeRuntimeMetrics;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  failed_at?: string;
  summary?: string;
  error?: string;
}

export type ParticipantPresenceView = "online" | "idle" | "offline";
export type AvatarStatusKind = "working" | "typing" | "roundtable" | "online" | "idle" | "offline";
export type AvatarStatusGroup = "humans" | "agents";

export interface ParticipantActivityView {
  participant_id: string;
  presence: ParticipantPresenceView;
  typing: boolean;
  typing_updated_at?: string;
  updated_at?: string;
}

export interface AvatarStatusView {
  id: string;
  display_name: string;
  role: string;
  kind: "human" | "agent";
  group: AvatarStatusGroup;
  status: AvatarStatusKind;
  capabilities?: string[];
  active: boolean;
}

export interface DeriveRoomStateOptions {
  now?: string;
  typingTtlMs?: number;
}

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
  claudeSessionCatalog?: ClaudeSessionCatalogView;
  claudeSessionSelection?: ClaudeSessionSelectionView;
  claudeSessionPreviews: ClaudeSessionPreviewView[];
  claudeImports: ClaudeImportView[];
  claudeRuntimeStatuses: ClaudeRuntimeStatusView[];
  participantActivity: Map<string, ParticipantActivityView>;
  avatarStatuses: AvatarStatusView[];
  latestSenderId?: string;
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

function orderClaudeImportMessages(messages: MessageView[]): MessageView[] {
  const importMessages = new Map<string, MessageView[]>();
  for (const message of messages) {
    if (message.kind !== "claude_import_banner" && message.kind.startsWith("claude_import_") && message.claudeImportId) {
      const current = importMessages.get(message.claudeImportId) ?? [];
      current.push(message);
      importMessages.set(message.claudeImportId, current);
    }
  }
  for (const grouped of importMessages.values()) {
    grouped.sort((a, b) => (a.claudeImportSequence ?? 0) - (b.claudeImportSequence ?? 0));
  }

  const emittedImports = new Set<string>();
  const ordered: MessageView[] = [];
  for (const message of messages) {
    if (message.kind !== "claude_import_banner" && message.kind.startsWith("claude_import_") && message.claudeImportId) {
      continue;
    }
    ordered.push(message);
    if (message.kind === "claude_import_banner" && message.claudeImportId && !emittedImports.has(message.claudeImportId)) {
      ordered.push(...(importMessages.get(message.claudeImportId) ?? []));
      emittedImports.add(message.claudeImportId);
    }
  }
  for (const [importId, grouped] of importMessages) {
    if (!emittedImports.has(importId)) ordered.push(...grouped);
  }
  return ordered;
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

function eventsAfterLastHistoryClear(events: CacpEvent[]): CacpEvent[] {
  const historyClear = lastHistoryClear(events);
  return events.slice(historyClear.index + 1);
}

function isValidJoinRequestStatus(value: unknown): value is JoinRequestView["status"] {
  return value === "pending" || value === "approved" || value === "rejected" || value === "expired";
}

function activityFor(activity: Map<string, ParticipantActivityView>, participantId: string): ParticipantActivityView {
  const existing = activity.get(participantId);
  if (existing) return existing;
  const next: ParticipantActivityView = { participant_id: participantId, presence: "online", typing: false };
  activity.set(participantId, next);
  return next;
}

function typingIsFresh(typingAt: string | undefined, nowMs: number, ttlMs: number): boolean {
  if (!typingAt) return false;
  const started = Date.parse(typingAt);
  if (Number.isNaN(started)) return false;
  return nowMs - started <= ttlMs;
}

function avatarPriority(status: AvatarStatusKind): number {
  switch (status) {
    case "working": return 0;
    case "typing": return 1;
    case "roundtable": return 2;
    case "online": return 3;
    case "idle": return 4;
    case "offline": return 5;
  }
}

export function deriveRoomState(events: CacpEvent[], options: DeriveRoomStateOptions = {}): RoomViewState {
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
  let claudeSessionCatalog: ClaudeSessionCatalogView | undefined;
  let claudeSessionSelection: ClaudeSessionSelectionView | undefined;
  const claudeSessionPreviews = new Map<string, ClaudeSessionPreviewView>();
  const claudeImports = new Map<string, ClaudeImportView>();
  const claudeRuntimeStatuses = new Map<string, ClaudeRuntimeStatusView>();
  const participantActivity = new Map<string, ParticipantActivityView>();
  let latestSenderId: string | undefined;
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const typingTtlMs = options.typingTtlMs ?? 5000;
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
    if (event.type === "participant.presence_changed") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      const presence = event.payload.presence === "online" || event.payload.presence === "idle" || event.payload.presence === "offline" ? event.payload.presence : undefined;
      if (participantId && presence) {
        const activity = activityFor(participantActivity, participantId);
        activity.presence = presence;
        activity.updated_at = typeof event.payload.updated_at === "string" ? event.payload.updated_at : event.created_at;
      }
    }
    if (event.type === "participant.typing_started") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      if (participantId) {
        const activity = activityFor(participantActivity, participantId);
        activity.typing = true;
        activity.typing_updated_at = typeof event.payload.started_at === "string" ? event.payload.started_at : event.created_at;
      }
    }
    if (event.type === "participant.typing_stopped") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      if (participantId) {
        const activity = activityFor(participantActivity, participantId);
        activity.typing = false;
        activity.typing_updated_at = typeof event.payload.stopped_at === "string" ? event.payload.stopped_at : event.created_at;
      }
    }
    if (event.type === "claude.session_catalog.updated" && typeof event.payload.agent_id === "string" && typeof event.payload.working_dir === "string" && Array.isArray(event.payload.sessions)) {
      claudeSessionCatalog = {
        agent_id: event.payload.agent_id,
        working_dir: event.payload.working_dir,
        sessions: event.payload.sessions as ClaudeSessionSummary[]
      };
    }
    if (event.type === "claude.session_selected" && typeof event.payload.agent_id === "string" && typeof event.payload.mode === "string" && typeof event.payload.selected_by === "string") {
      if (event.payload.mode === "fresh") {
        claudeSessionSelection = { agent_id: event.payload.agent_id, mode: "fresh", selected_by: event.payload.selected_by };
      }
      if (event.payload.mode === "resume" && typeof event.payload.session_id === "string") {
        claudeSessionSelection = { agent_id: event.payload.agent_id, mode: "resume", session_id: event.payload.session_id, selected_by: event.payload.selected_by };
      }
    }
  }

  for (const event of scopedEvents) {
    if (event.type === "claude.session_preview.requested" && typeof event.payload.preview_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.session_id === "string") {
      claudeSessionPreviews.set(event.payload.preview_id, {
        preview_id: event.payload.preview_id,
        agent_id: event.payload.agent_id,
        session_id: event.payload.session_id,
        requested_by: typeof event.payload.requested_by === "string" ? event.payload.requested_by : undefined,
        status: "requested",
        messages: []
      });
    }
    if (event.type === "claude.session_preview.message" && typeof event.payload.preview_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.session_id === "string" && typeof event.payload.text === "string") {
      const existing = claudeSessionPreviews.get(event.payload.preview_id) ?? {
        preview_id: event.payload.preview_id,
        agent_id: event.payload.agent_id,
        session_id: event.payload.session_id,
        status: "requested" as const,
        messages: []
      };
      claudeSessionPreviews.set(event.payload.preview_id, {
        ...existing,
        messages: [...existing.messages, event.payload as unknown as ClaudeSessionPreviewMessagePayload].sort((a, b) => a.sequence - b.sequence)
      });
    }
    if (event.type === "claude.session_preview.completed" && typeof event.payload.preview_id === "string") {
      const existing = claudeSessionPreviews.get(event.payload.preview_id);
      if (existing) claudeSessionPreviews.set(event.payload.preview_id, {
        ...existing,
        status: "completed",
        previewed_message_count: typeof event.payload.previewed_message_count === "number" ? event.payload.previewed_message_count : existing.messages.length
      });
    }
    if (event.type === "claude.session_preview.failed" && typeof event.payload.preview_id === "string") {
      const existing = claudeSessionPreviews.get(event.payload.preview_id);
      claudeSessionPreviews.set(event.payload.preview_id, {
        preview_id: event.payload.preview_id,
        agent_id: typeof event.payload.agent_id === "string" ? event.payload.agent_id : existing?.agent_id ?? event.actor_id,
        session_id: typeof event.payload.session_id === "string" ? event.payload.session_id : existing?.session_id ?? "unknown",
        requested_by: existing?.requested_by,
        messages: existing?.messages ?? [],
        status: "failed",
        error: typeof event.payload.error === "string" ? event.payload.error : "Preview failed"
      });
    }
    if (event.type === "claude.session_import.started" && typeof event.payload.import_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.session_id === "string" && typeof event.payload.title === "string") {
      claudeImports.set(event.payload.import_id, {
        import_id: event.payload.import_id,
        agent_id: event.payload.agent_id,
        session_id: event.payload.session_id,
        title: event.payload.title,
        message_count: typeof event.payload.message_count === "number" ? event.payload.message_count : 0,
        status: "started"
      });
      messages.push({
        message_id: `claude-import-banner-${event.payload.import_id}`,
        actor_id: "system",
        text: "__CLAUDE_IMPORT_BANNER__",
        kind: "claude_import_banner",
        created_at: event.created_at,
        claudeImportId: event.payload.import_id,
        claudeSessionId: event.payload.session_id
      });
    }
    if (event.type === "claude.session_import.message" && typeof event.payload.import_id === "string" && typeof event.payload.session_id === "string" && typeof event.payload.text === "string") {
      messages.push({
        message_id: `claude-import-${event.payload.import_id}-${typeof event.payload.sequence === "number" ? event.payload.sequence : messages.length}`,
        actor_id: typeof event.payload.agent_id === "string" ? event.payload.agent_id : event.actor_id,
        text: event.payload.text,
        kind: `claude_import_${typeof event.payload.author_role === "string" ? event.payload.author_role : "system"}`,
        created_at: typeof event.payload.original_created_at === "string" ? event.payload.original_created_at : event.created_at,
        claudeImportId: event.payload.import_id,
        claudeSessionId: event.payload.session_id,
        claudeSourceKind: typeof event.payload.source_kind === "string" ? event.payload.source_kind : undefined,
        claudeImportSequence: typeof event.payload.sequence === "number" ? event.payload.sequence : undefined
      });
    }
    if (event.type === "claude.session_import.completed" && typeof event.payload.import_id === "string") {
      const existing = claudeImports.get(event.payload.import_id);
      if (existing) claudeImports.set(event.payload.import_id, {
        ...existing,
        status: "completed",
        imported_message_count: typeof event.payload.imported_message_count === "number" ? event.payload.imported_message_count : existing.message_count
      });
    }
    if (event.type === "claude.session_import.failed" && typeof event.payload.import_id === "string") {
      const existing = claudeImports.get(event.payload.import_id);
      const sessionId = typeof event.payload.session_id === "string" ? event.payload.session_id : existing?.session_id ?? "unknown";
      if (!existing) {
        messages.push({
          message_id: `claude-import-banner-${event.payload.import_id}`,
          actor_id: "system",
          text: "__CLAUDE_IMPORT_BANNER__",
          kind: "claude_import_banner",
          created_at: event.created_at,
          claudeImportId: event.payload.import_id,
          claudeSessionId: sessionId
        });
      }
      claudeImports.set(event.payload.import_id, {
        import_id: event.payload.import_id,
        agent_id: typeof event.payload.agent_id === "string" ? event.payload.agent_id : existing?.agent_id ?? event.actor_id,
        session_id: sessionId,
        title: existing?.title ?? `Claude session ${sessionId.slice(0, 8)}`,
        message_count: existing?.message_count ?? 0,
        imported_message_count: existing?.imported_message_count,
        status: "failed",
        error: typeof event.payload.error === "string" ? event.payload.error : "Import failed"
      });
    }
    if (event.type === "claude.runtime.status_changed" && typeof event.payload.turn_id === "string" && typeof event.payload.status_id === "string") {
      claudeRuntimeStatuses.set(event.payload.status_id, event.payload as unknown as ClaudeRuntimeStatusView);
    }
    if (event.type === "claude.runtime.status_completed" && typeof event.payload.status_id === "string") {
      const existing = claudeRuntimeStatuses.get(event.payload.status_id);
      if (existing) claudeRuntimeStatuses.set(event.payload.status_id, {
        ...existing,
        phase: "completed",
        summary: typeof event.payload.summary === "string" ? event.payload.summary : "Claude Code completed",
        completed_at: typeof event.payload.completed_at === "string" ? event.payload.completed_at : event.created_at
      });
    }
    if (event.type === "claude.runtime.status_failed" && typeof event.payload.status_id === "string") {
      const existing = claudeRuntimeStatuses.get(event.payload.status_id);
      if (existing) claudeRuntimeStatuses.set(event.payload.status_id, {
        ...existing,
        phase: "failed",
        error: typeof event.payload.error === "string" ? event.payload.error : "Claude Code failed",
        failed_at: typeof event.payload.failed_at === "string" ? event.payload.failed_at : event.created_at
      });
    }
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
    if (event.type === "message.created" && typeof event.payload.text === "string") {
      latestSenderId = event.actor_id;
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

  for (const activity of participantActivity.values()) {
    if (activity.typing && !typingIsFresh(activity.typing_updated_at, nowMs, typingTtlMs)) {
      activity.typing = false;
    }
  }

  const collectionViews = [...collections.values()];
  const activeCollection = [...collectionViews].reverse().find((collection) => !collection.submitted_at && !collection.cancelled_at);
  const collectionHistory = collectionViews.filter((collection) => Boolean(collection.submitted_at || collection.cancelled_at));
  // Only one pending Roundtable request is allowed per room in this version.
  // We intentionally expose only the first (oldest) pending request.
  const pendingRoundtableRequest = [...roundtableRequests.values()][0];

  const workingAgentIds = new Set<string>([...streamingTurns.values()].map((turn) => turn.agent_id));
  for (const status of claudeRuntimeStatuses.values()) {
    if (status.phase !== "completed" && status.phase !== "failed") workingAgentIds.add(status.agent_id);
  }

  const roundtableParticipantIds = new Set<string>();
  if (activeCollection) {
    for (const participant of participants.values()) {
      if (participant.type !== "agent") roundtableParticipantIds.add(participant.id);
    }
  }
  if (pendingRoundtableRequest) roundtableParticipantIds.add(pendingRoundtableRequest.requested_by);

  const avatarStatuses: AvatarStatusView[] = [
    ...[...participants.values()].map((participant): AvatarStatusView => {
      const activity = participantActivity.get(participant.id);
      const status: AvatarStatusKind = activity?.typing
        ? "typing"
        : roundtableParticipantIds.has(participant.id)
          ? "roundtable"
          : activity?.presence === "idle"
            ? "idle"
            : activity?.presence === "offline"
              ? "offline"
              : "online";
      return {
        id: participant.id,
        display_name: participant.display_name,
        role: participant.role,
        kind: "human",
        group: "humans",
        status,
        active: status === "typing" || status === "roundtable" || participant.id === latestSenderId
      };
    }),
    ...[...agents.values()].map((agent): AvatarStatusView => {
      const status: AvatarStatusKind = workingAgentIds.has(agent.agent_id)
        ? "working"
        : agent.status === "offline"
          ? "offline"
          : agent.status === "online"
            ? "online"
            : "idle";
      return {
        id: agent.agent_id,
        display_name: agent.name,
        role: "agent",
        kind: "agent",
        group: "agents",
        status,
        capabilities: agent.capabilities,
        active: status === "working" || agent.agent_id === activeAgentId
      };
    })
  ].sort((a, b) => avatarPriority(a.status) - avatarPriority(b.status) || a.display_name.localeCompare(b.display_name));

  return {
    participants: [...participants.values()],
    agents: [...agents.values()],
    activeAgentId,
    messages: orderClaudeImportMessages(messages),
    streamingTurns: [...streamingTurns.values()],
    activeCollection,
    collectionHistory,
    lastHistoryClearedAt: historyClear.clearedAt,
    inviteCount,
    roomName,
    joinRequests: [...joinRequests.values()].filter((r) => r.status === "pending"),
    pendingRoundtableRequest,
    claudeSessionCatalog,
    claudeSessionSelection,
    claudeSessionPreviews: [...claudeSessionPreviews.values()],
    claudeImports: [...claudeImports.values()],
    claudeRuntimeStatuses: [...claudeRuntimeStatuses.values()]
      .sort((a, b) => (b.updated_at ?? b.started_at ?? "").localeCompare(a.updated_at ?? a.started_at ?? ""))
      .slice(0, 1),
    participantActivity,
    avatarStatuses,
    latestSenderId
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
  for (const event of eventsAfterLastHistoryClear(events)) {
    if (event.type === "ai.collection.started") active = true;
    if (event.type === "ai.collection.submitted" || event.type === "ai.collection.cancelled") active = false;
  }
  return active;
}

export function isTurnInFlight(events: CacpEvent[]): boolean {
  const turns = new Map<string, boolean>();
  for (const event of eventsAfterLastHistoryClear(events)) {
    const turnId = typeof event.payload.turn_id === "string" ? event.payload.turn_id : undefined;
    if (!turnId) continue;
    if (event.type === "agent.turn.requested" || event.type === "agent.turn.started") {
      turns.set(turnId, true);
    }
    if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") {
      turns.set(turnId, false);
    }
  }
  return [...turns.values()].some((open) => open);
}

export function collectedMessageIds(events: CacpEvent[], collectionId: string): string[] {
  return events
    .filter((event) => event.type === "message.created" && (event.payload as Record<string, unknown>).collection_id === collectionId)
    .map((event) => typeof (event.payload as Record<string, unknown>).message_id === "string" ? (event.payload as Record<string, unknown>).message_id as string : "")
    .filter(Boolean);
}
