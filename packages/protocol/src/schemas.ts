import { z } from "zod";

export const ProtocolVersionSchema = z.enum(["0.1.0", "0.2.0"]);

export const ParticipantTypeSchema = z.enum(["human", "agent", "system", "observer"]);
export const ParticipantRoleSchema = z.enum(["owner", "admin", "member", "observer", "agent"]);
export const AgentTypeSchema = z.enum(["claude-code", "codex-cli", "llm-api", "llm-openai-compatible", "llm-anthropic-compatible"]);
export const ParticipantSchema = z.object({
  id: z.string().min(1),
  type: ParticipantTypeSchema,
  display_name: z.string().min(1),
  role: ParticipantRoleSchema
});

export const ParticipantPresenceSchema = z.enum(["online", "idle", "offline"]);
export const ParticipantActivityScopeSchema = z.enum(["room"]);

export const ParticipantPresenceChangedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  presence: ParticipantPresenceSchema,
  updated_at: z.string().datetime()
});

export const ParticipantTypingStartedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  started_at: z.string().datetime()
});

export const ParticipantTypingStoppedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  stopped_at: z.string().datetime()
});

export const EventTypeSchema = z.enum([
  "room.created", "room.configured", "room.agent_selected", "participant.joined", "participant.left", "participant.role_updated", "participant.presence_changed", "participant.typing_started", "participant.typing_stopped", "invite.created", "invite.revoked",
  "message.created",
  "proposal.created", "proposal.vote_cast", "proposal.approved", "proposal.rejected", "proposal.expired",
  "agent.registered", "agent.unregistered", "agent.disconnected", "agent.pairing_created", "agent.status_changed", "agent.action_approval_requested", "agent.action_approval_resolved",
  "agent.turn.requested", "agent.turn.followup_queued", "agent.turn.started", "agent.output.delta", "agent.turn.completed", "agent.turn.failed",
  "agent.session_catalog.updated",
  "agent.session_preview.requested",
  "agent.session_preview.message",
  "agent.session_preview.completed",
  "agent.session_preview.failed",
  "agent.session_selected",
  "agent.session_ready",
  "agent.session_import.started",
  "agent.session_import.message",
  "agent.session_import.completed",
  "agent.session_import.failed",
  "agent.runtime.status_changed",
  "agent.runtime.status_completed",
  "agent.runtime.status_failed",
  "claude.session_catalog.updated",
  "claude.session_preview.requested",
  "claude.session_preview.message",
  "claude.session_preview.completed",
  "claude.session_preview.failed",
  "claude.session_selected",
  "claude.session_ready",
  "claude.session_import.started",
  "claude.session_import.message",
  "claude.session_import.completed",
  "claude.session_import.failed",
  "claude.runtime.status_changed",
  "claude.runtime.status_completed",
  "claude.runtime.status_failed",
  "task.created", "task.started", "task.output", "task.completed", "task.failed", "task.cancelled",
  "artifact.created", "context.updated",
  "join_request.created", "join_request.approved", "join_request.rejected", "join_request.expired", "participant.removed",
  "main_input.accepted", "main_input.queued", "main_input.triggered", "main_input.cancelled", "main_input.failed",
  "connector.snapshot.requested", "connector.snapshot.started", "connector.snapshot.entry", "connector.snapshot.completed", "connector.snapshot.failed",
  "orbit.round.opened", "orbit.note.created", "orbit.like.changed", "orbit.round.promoted"
]);

export const CacpEventSchema = z.object({
  protocol: z.literal("cacp"),
  version: ProtocolVersionSchema,
  event_id: z.string().min(1),
  room_id: z.string().min(1),
  type: EventTypeSchema,
  actor_id: z.string().min(1),
  created_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown())
});

export const VoteValueSchema = z.enum(["approve", "reject", "abstain", "request_changes"]);
export const VoteRecordSchema = z.object({
  voter_id: z.string().min(1),
  vote: VoteValueSchema,
  comment: z.string().optional()
});

export const PolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("owner_approval"), expires_at: z.string().datetime().optional() }),
  z.object({ type: z.literal("majority"), expires_at: z.string().datetime().optional() }),
  z.object({
    type: z.literal("role_quorum"),
    required_roles: z.array(ParticipantRoleSchema).min(1),
    min_approvals: z.number().int().positive(),
    expires_at: z.string().datetime().optional()
  }),
  z.object({ type: z.literal("unanimous"), expires_at: z.string().datetime().optional() }),
  z.object({ type: z.literal("no_approval"), expires_at: z.string().datetime().optional() })
]);

export const RequiredUnknownSchema = z.unknown().refine((value) => value !== undefined, "Required");
export const RoomHistoryClearedPayloadSchema = z.object({
  cleared_by: z.string().min(1),
  cleared_at: z.string().datetime(),
  scope: z.enum(["messages", "messages_and_decisions"])
});

export const ClaudeSessionSummarySchema = z.object({
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  project_dir: z.string().min(1).max(500),
  updated_at: z.string().datetime(),
  message_count: z.number().int().nonnegative(),
  byte_size: z.number().int().nonnegative(),
  importable: z.boolean()
});

export const ClaudeSessionCatalogUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  working_dir: z.string().min(1).max(500),
  sessions: z.array(ClaudeSessionSummarySchema).max(100)
});

export const ClaudeSessionSelectedPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh"),
    selected_by: z.string().min(1)
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    selected_by: z.string().min(1)
  })
]);

export const ClaudeSessionReadyPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh"),
    session_id: z.string().min(1).optional(),
    ready_at: z.string().datetime()
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    ready_at: z.string().datetime()
  })
]);

export const ClaudeSessionPreviewRequestedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  requested_by: z.string().min(1),
  requested_at: z.string().datetime()
});

export const ClaudeSessionImportMaxMessages = 1000;

export const ClaudeSessionImportStartedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  message_count: z.number().int().nonnegative().max(ClaudeSessionImportMaxMessages),
  started_at: z.string().datetime()
});

export const ClaudeSessionImportAuthorRoleSchema = z.enum(["user", "assistant", "tool", "command", "system"]);
export const ClaudeSessionImportSourceKindSchema = z.enum(["user", "assistant", "tool_use", "tool_result", "command", "system"]);

export const ClaudeSessionImportMessagePayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  source_message_id: z.string().min(1).optional(),
  original_created_at: z.string().datetime().optional(),
  author_role: ClaudeSessionImportAuthorRoleSchema,
  source_kind: ClaudeSessionImportSourceKindSchema,
  text: z.string().min(1).max(20000),
  part_index: z.number().int().nonnegative().optional(),
  part_count: z.number().int().positive().optional(),
  truncated: z.boolean().optional()
});

export const ClaudeSessionPreviewMessagePayloadSchema = ClaudeSessionImportMessagePayloadSchema.omit({ import_id: true }).extend({
  preview_id: z.string().min(1)
});

export const ClaudeSessionPreviewCompletedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  previewed_message_count: z.number().int().nonnegative(),
  completed_at: z.string().datetime()
});

export const ClaudeSessionPreviewFailedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  error: z.string().min(1).max(2000),
  failed_at: z.string().datetime()
});

export const ClaudeSessionImportCompletedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  imported_message_count: z.number().int().nonnegative(),
  completed_at: z.string().datetime()
});

export const ClaudeSessionImportFailedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1).optional(),
  error: z.string().min(1).max(2000),
  failed_at: z.string().datetime()
});

export const ClaudeRuntimePhaseSchema = z.enum([
  "connecting",
  "resuming_session",
  "importing_session",
  "thinking",
  "reading_files",
  "searching",
  "running_command",
  "waiting_for_approval",
  "generating_answer",
  "completed",
  "failed"
]);

export const ClaudeRuntimeMetricsSchema = z.object({
  files_read: z.number().int().nonnegative().default(0),
  searches: z.number().int().nonnegative().default(0),
  commands: z.number().int().nonnegative().default(0)
});

export const ClaudeRuntimeStatusChangedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  phase: ClaudeRuntimePhaseSchema,
  current: z.string().min(1).max(500),
  recent: z.array(z.string().min(1).max(500)).max(10),
  metrics: ClaudeRuntimeMetricsSchema,
  started_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const ClaudeRuntimeStatusCompletedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  metrics: ClaudeRuntimeMetricsSchema,
  completed_at: z.string().datetime()
});

export const ClaudeRuntimeStatusFailedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  error: z.string().min(1).max(2000),
  metrics: ClaudeRuntimeMetricsSchema,
  failed_at: z.string().datetime()
});

export const LocalAgentProviderSchema = z.enum(["claude-code", "codex-cli"]);

export const AgentSessionSummarySchema = ClaudeSessionSummarySchema.extend({
  provider: LocalAgentProviderSchema.optional()
});

export const AgentSessionCatalogUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  provider: LocalAgentProviderSchema,
  working_dir: z.string().min(1).max(500),
  sessions: z.array(AgentSessionSummarySchema).max(100)
});

export const AgentSessionSelectedPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("fresh"),
    selected_by: z.string().min(1)
  }),
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    selected_by: z.string().min(1)
  })
]);

export const AgentSessionReadyPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("fresh"),
    session_id: z.string().min(1).optional(),
    ready_at: z.string().datetime()
  }),
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    ready_at: z.string().datetime()
  })
]);

export const AgentSessionPreviewRequestedPayloadSchema = ClaudeSessionPreviewRequestedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionImportStartedPayloadSchema = ClaudeSessionImportStartedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionImportAuthorRoleSchema = ClaudeSessionImportAuthorRoleSchema;
export const AgentSessionImportSourceKindSchema = ClaudeSessionImportSourceKindSchema;

export const AgentSessionImportMessagePayloadSchema = ClaudeSessionImportMessagePayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionPreviewMessagePayloadSchema = AgentSessionImportMessagePayloadSchema.omit({ import_id: true }).extend({
  preview_id: z.string().min(1)
});

export const AgentSessionPreviewCompletedPayloadSchema = ClaudeSessionPreviewCompletedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionPreviewFailedPayloadSchema = ClaudeSessionPreviewFailedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionImportCompletedPayloadSchema = ClaudeSessionImportCompletedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentSessionImportFailedPayloadSchema = ClaudeSessionImportFailedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentRuntimePhaseSchema = ClaudeRuntimePhaseSchema;
export const AgentRuntimeMetricsSchema = ClaudeRuntimeMetricsSchema;

export const AgentRuntimeStatusChangedPayloadSchema = ClaudeRuntimeStatusChangedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentRuntimeStatusCompletedPayloadSchema = ClaudeRuntimeStatusCompletedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export const AgentRuntimeStatusFailedPayloadSchema = ClaudeRuntimeStatusFailedPayloadSchema.extend({
  provider: LocalAgentProviderSchema
});

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type CacpEvent = z.infer<typeof CacpEventSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteRecord = z.infer<typeof VoteRecordSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type RequiredUnknown = z.infer<typeof RequiredUnknownSchema>;
export type RoomHistoryClearedPayload = z.infer<typeof RoomHistoryClearedPayloadSchema>;
export type ClaudeSessionSummary = z.infer<typeof ClaudeSessionSummarySchema>;
export type ClaudeSessionCatalogUpdatedPayload = z.infer<typeof ClaudeSessionCatalogUpdatedPayloadSchema>;
export type ClaudeSessionSelectedPayload = z.infer<typeof ClaudeSessionSelectedPayloadSchema>;
export type ClaudeSessionReadyPayload = z.infer<typeof ClaudeSessionReadyPayloadSchema>;
export type ClaudeSessionPreviewRequestedPayload = z.infer<typeof ClaudeSessionPreviewRequestedPayloadSchema>;
export type ClaudeSessionPreviewMessagePayload = z.infer<typeof ClaudeSessionPreviewMessagePayloadSchema>;
export type ClaudeSessionPreviewCompletedPayload = z.infer<typeof ClaudeSessionPreviewCompletedPayloadSchema>;
export type ClaudeSessionPreviewFailedPayload = z.infer<typeof ClaudeSessionPreviewFailedPayloadSchema>;
export type ClaudeSessionImportStartedPayload = z.infer<typeof ClaudeSessionImportStartedPayloadSchema>;
export type ClaudeSessionImportMessagePayload = z.infer<typeof ClaudeSessionImportMessagePayloadSchema>;
export type ClaudeSessionImportCompletedPayload = z.infer<typeof ClaudeSessionImportCompletedPayloadSchema>;
export type ClaudeSessionImportFailedPayload = z.infer<typeof ClaudeSessionImportFailedPayloadSchema>;
export type ClaudeRuntimePhase = z.infer<typeof ClaudeRuntimePhaseSchema>;
export type ClaudeRuntimeMetrics = z.infer<typeof ClaudeRuntimeMetricsSchema>;
export type ClaudeRuntimeStatusChangedPayload = z.infer<typeof ClaudeRuntimeStatusChangedPayloadSchema>;
export type ClaudeRuntimeStatusCompletedPayload = z.infer<typeof ClaudeRuntimeStatusCompletedPayloadSchema>;
export type ClaudeRuntimeStatusFailedPayload = z.infer<typeof ClaudeRuntimeStatusFailedPayloadSchema>;
export type LocalAgentProvider = z.infer<typeof LocalAgentProviderSchema>;
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;
export type AgentSessionCatalogUpdatedPayload = z.infer<typeof AgentSessionCatalogUpdatedPayloadSchema>;
export type AgentSessionSelectedPayload = z.infer<typeof AgentSessionSelectedPayloadSchema>;
export type AgentSessionReadyPayload = z.infer<typeof AgentSessionReadyPayloadSchema>;
export type AgentSessionPreviewRequestedPayload = z.infer<typeof AgentSessionPreviewRequestedPayloadSchema>;
export type AgentSessionPreviewMessagePayload = z.infer<typeof AgentSessionPreviewMessagePayloadSchema>;
export type AgentSessionPreviewCompletedPayload = z.infer<typeof AgentSessionPreviewCompletedPayloadSchema>;
export type AgentSessionPreviewFailedPayload = z.infer<typeof AgentSessionPreviewFailedPayloadSchema>;
export type AgentSessionImportStartedPayload = z.infer<typeof AgentSessionImportStartedPayloadSchema>;
export type AgentSessionImportMessagePayload = z.infer<typeof AgentSessionImportMessagePayloadSchema>;
export type AgentSessionImportCompletedPayload = z.infer<typeof AgentSessionImportCompletedPayloadSchema>;
export type AgentSessionImportFailedPayload = z.infer<typeof AgentSessionImportFailedPayloadSchema>;
export type AgentRuntimePhase = z.infer<typeof AgentRuntimePhaseSchema>;
export type AgentRuntimeMetrics = z.infer<typeof AgentRuntimeMetricsSchema>;
export type AgentRuntimeStatusChangedPayload = z.infer<typeof AgentRuntimeStatusChangedPayloadSchema>;
export type AgentRuntimeStatusCompletedPayload = z.infer<typeof AgentRuntimeStatusCompletedPayloadSchema>;
export type AgentRuntimeStatusFailedPayload = z.infer<typeof AgentRuntimeStatusFailedPayloadSchema>;
export type ParticipantPresence = z.infer<typeof ParticipantPresenceSchema>;
export type ParticipantActivityScope = z.infer<typeof ParticipantActivityScopeSchema>;
export type ParticipantPresenceChangedPayload = z.infer<typeof ParticipantPresenceChangedPayloadSchema>;
export type ParticipantTypingStartedPayload = z.infer<typeof ParticipantTypingStartedPayloadSchema>;
export type ParticipantTypingStoppedPayload = z.infer<typeof ParticipantTypingStoppedPayloadSchema>;

export const MainInputSourceSchema = z.enum(["composer", "orbit_promote"]);
export const MainInputStatusSchema = z.enum(["accepted", "queued", "triggered", "cancelled", "failed"]);

export const MainInputAcceptedPayloadSchema = z.object({
  input_id: z.string().min(1),
  author_id: z.string().min(1),
  text: z.string().min(1),
  source: MainInputSourceSchema,
  created_at: z.string().datetime()
});

export const MainInputQueuedPayloadSchema = z.object({
  input_id: z.string().min(1),
  queued_after_turn_id: z.string().min(1)
});

export const MainInputTriggeredPayloadSchema = z.object({
  input_id: z.string().min(1),
  trigger_turn_id: z.string().min(1)
});

export const MainInputCancelledPayloadSchema = z.object({
  input_id: z.string().min(1),
  cancelled_by: z.string().min(1)
});

export const MainInputFailedPayloadSchema = z.object({
  input_id: z.string().min(1),
  failure_reason: z.string().min(1)
});

export const ConnectorLedgerEntrySchema = z.object({
  ledger_version: z.literal(1),
  room_id: z.string().min(1),
  connector_id: z.string().min(1),
  agent_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  entry_id: z.string().min(1),
  entry_type: z.enum(["human_input", "agent_final", "imported_session_message", "system_marker"]),
  actor_id: z.string().min(1),
  actor_name: z.string().min(1).max(120),
  actor_role: ParticipantRoleSchema,
  text: z.string().min(1).max(8000),
  source: z.enum(["composer", "orbit_promote", "session_import", "system"]),
  created_at: z.string().datetime(),
  turn_id: z.string().min(1).optional(),
  input_id: z.string().min(1).optional(),
  source_session_id: z.string().min(1).optional()
});

export const ConnectorSnapshotRequestedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  since_sequence: z.number().int().nonnegative(),
  requested_by: z.string().min(1)
});

export const ConnectorSnapshotStartedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  first_sequence: z.number().int().nonnegative(),
  last_sequence: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative().optional()
});

export const ConnectorSnapshotEntryPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  entry: ConnectorLedgerEntrySchema
});

export const ConnectorSnapshotCompletedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  last_sequence: z.number().int().nonnegative()
});

export const ConnectorSnapshotFailedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  error: z.string().min(1).max(2000)
});

export const OrbitRoundOpenedPayloadSchema = z.object({
  round_id: z.string().min(1),
  triggered_by_turn_id: z.string().min(1).optional(),
  opened_at: z.string().datetime()
});

export const OrbitNoteCreatedPayloadSchema = z.object({
  note_id: z.string().min(1),
  round_id: z.string().min(1),
  author_id: z.string().min(1),
  author_name: z.string().min(1),
  text: z.string().min(1).max(2000),
  created_at: z.string().datetime()
});

export const OrbitLikeChangedPayloadSchema = z.object({
  note_id: z.string().min(1),
  participant_id: z.string().min(1),
  liked: z.boolean(),
  likes: z.number().int().nonnegative()
});

export const OrbitRoundPromotedPayloadSchema = z.object({
  round_id: z.string().min(1),
  promoted_by: z.string().min(1),
  input_id: z.string().min(1),
  promoted_at: z.string().datetime()
});

export type MainInputSource = z.infer<typeof MainInputSourceSchema>;
export type MainInputStatus = z.infer<typeof MainInputStatusSchema>;
export type MainInputAcceptedPayload = z.infer<typeof MainInputAcceptedPayloadSchema>;
export type MainInputQueuedPayload = z.infer<typeof MainInputQueuedPayloadSchema>;
export type MainInputTriggeredPayload = z.infer<typeof MainInputTriggeredPayloadSchema>;
export type MainInputCancelledPayload = z.infer<typeof MainInputCancelledPayloadSchema>;
export type MainInputFailedPayload = z.infer<typeof MainInputFailedPayloadSchema>;
export type ConnectorLedgerEntry = z.infer<typeof ConnectorLedgerEntrySchema>;
export type ConnectorSnapshotRequestedPayload = z.infer<typeof ConnectorSnapshotRequestedPayloadSchema>;
export type ConnectorSnapshotStartedPayload = z.infer<typeof ConnectorSnapshotStartedPayloadSchema>;
export type ConnectorSnapshotEntryPayload = z.infer<typeof ConnectorSnapshotEntryPayloadSchema>;
export type ConnectorSnapshotCompletedPayload = z.infer<typeof ConnectorSnapshotCompletedPayloadSchema>;
export type ConnectorSnapshotFailedPayload = z.infer<typeof ConnectorSnapshotFailedPayloadSchema>;
export type OrbitRoundOpenedPayload = z.infer<typeof OrbitRoundOpenedPayloadSchema>;
export type OrbitNoteCreatedPayload = z.infer<typeof OrbitNoteCreatedPayloadSchema>;
export type OrbitLikeChangedPayload = z.infer<typeof OrbitLikeChangedPayloadSchema>;
export type OrbitRoundPromotedPayload = z.infer<typeof OrbitRoundPromotedPayloadSchema>;
