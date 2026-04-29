import { z } from "zod";

export const ProtocolVersionSchema = z.enum(["0.1.0", "0.2.0"]);

export const ParticipantTypeSchema = z.enum(["human", "agent", "system", "observer"]);
export const ParticipantRoleSchema = z.enum(["owner", "admin", "member", "observer", "agent"]);
export const AgentTypeSchema = z.enum(["claude-code", "llm-api", "llm-openai-compatible", "llm-anthropic-compatible"]);
export const ParticipantSchema = z.object({
  id: z.string().min(1),
  type: ParticipantTypeSchema,
  display_name: z.string().min(1),
  role: ParticipantRoleSchema
});

export const EventTypeSchema = z.enum([
  "room.created", "room.configured", "room.agent_selected", "participant.joined", "participant.left", "participant.role_updated", "invite.created",
  "message.created",
  "ai.collection.started", "ai.collection.submitted", "ai.collection.cancelled", "ai.collection.requested", "ai.collection.request_approved", "ai.collection.request_rejected",
  "proposal.created", "proposal.vote_cast", "proposal.approved", "proposal.rejected", "proposal.expired",
  "agent.registered", "agent.unregistered", "agent.disconnected", "agent.pairing_created", "agent.status_changed", "agent.action_approval_requested", "agent.action_approval_resolved",
  "agent.turn.requested", "agent.turn.followup_queued", "agent.turn.started", "agent.output.delta", "agent.turn.completed", "agent.turn.failed",
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
  "artifact.created", "context.updated", "room.history_cleared",
  "join_request.created", "join_request.approved", "join_request.rejected", "join_request.expired", "participant.removed"
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

export const AiCollectionRequestedPayloadSchema = z.object({
  request_id: z.string().min(1),
  requested_by: z.string().min(1)
});

export const AiCollectionRequestApprovedPayloadSchema = z.object({
  request_id: z.string().min(1),
  approved_by: z.string().min(1),
  collection_id: z.string().min(1)
});

export const AiCollectionRequestRejectedPayloadSchema = z.object({
  request_id: z.string().min(1),
  rejected_by: z.string().min(1)
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
export type AiCollectionRequestedPayload = z.infer<typeof AiCollectionRequestedPayloadSchema>;
export type AiCollectionRequestApprovedPayload = z.infer<typeof AiCollectionRequestApprovedPayloadSchema>;
export type AiCollectionRequestRejectedPayload = z.infer<typeof AiCollectionRequestRejectedPayloadSchema>;
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
