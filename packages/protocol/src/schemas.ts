import { z } from "zod";

export const ProtocolVersion = "0.3.0" as const;
export const ProtocolVersionSchema = z.literal(ProtocolVersion);

export const ParticipantTypeSchema = z.enum([
  "human",
  "agent",
  "system",
  "observer",
]);
export const ParticipantRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "observer",
  "agent",
]);
export const AgentTypeSchema = z.enum([
  "claude-code",
  "codex-cli",
  "github-copilot",
  "kimi-cli",
]);
export const PermissionLevelSchema = z.enum([
  "read_only",
  "limited_write",
  "full_access",
]);

export const AttachmentKindSchema = z.enum([
  "image",
  "pdf",
  "text",
  "office",
  "file",
]);
export const AttachmentDispositionSchema = z.enum(["inline", "download"]);
export const AttachmentRefSchema = z.object({
  attachment_id: z.string().min(1),
  name: z.string().min(1).max(255),
  media_type: z.string().min(1).max(200),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: AttachmentKindSchema,
  disposition: AttachmentDispositionSchema,
});
export const StructuredMessageContentSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  attachments: z.array(AttachmentRefSchema).max(5).default([]),
});

export const AgentAttachmentInputModeSchema = z.enum([
  "native",
  "file_path",
  "unsupported",
]);
export const AgentInputCapabilitiesSchema = z.object({
  image: AgentAttachmentInputModeSchema,
  pdf: AgentAttachmentInputModeSchema,
  text: AgentAttachmentInputModeSchema,
  office: AgentAttachmentInputModeSchema,
  file: AgentAttachmentInputModeSchema,
  max_attachments: z.number().int().positive().max(5),
});
export const AgentAdapterCompatibilitySchema = z.object({
  provider: AgentTypeSchema,
  sdk_package: z.string().min(1).max(100),
  sdk_version: z.string().min(1).max(50),
  input_capabilities: AgentInputCapabilitiesSchema,
});
export const ConnectorCompatibilitySchema = z.object({
  protocol_version: ProtocolVersionSchema,
  connector_version: z.string().min(1).max(50),
  adapters: z.array(AgentAdapterCompatibilitySchema).min(1).max(4),
});

export const MessageCreatedPayloadSchema = z.object({
  message_id: z.string().min(1),
  content: StructuredMessageContentSchema,
  kind: z.enum(["human", "agent", "system"]),
  created_at: z.string().datetime(),
});

export const AgentTurnRequestedPayloadSchema = z.object({
  turn_id: z.string().min(1),
  agent_id: z.string().min(1),
  reason: z.enum(["human_message", "queued_followup"]),
  source: z.enum(["composer", "orbit_promote"]),
  speaker_name: z.string().min(1).max(100),
  speaker_role: ParticipantRoleSchema,
  room_name: z.string().min(1).max(200),
  mode: z.string().min(1).max(50),
  content: StructuredMessageContentSchema,
});
export const ParticipantSchema = z.object({
  id: z.string().min(1),
  type: ParticipantTypeSchema,
  display_name: z.string().min(1),
  role: ParticipantRoleSchema,
});

export const ParticipantPresenceSchema = z.enum(["online", "idle", "offline"]);
export const ParticipantActivityScopeSchema = z.enum(["room"]);

export const ParticipantPresenceChangedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  presence: ParticipantPresenceSchema,
  updated_at: z.string().datetime(),
});

export const ParticipantTypingStartedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  started_at: z.string().datetime(),
});

export const ParticipantTypingStoppedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  stopped_at: z.string().datetime(),
});

export const EventTypeSchema = z.enum([
  "room.created",
  "room.configured",
  "room.agent_selected",
  "participant.joined",
  "participant.left",
  "participant.role_updated",
  "participant.presence_changed",
  "participant.typing_started",
  "participant.typing_stopped",
  "invite.created",
  "invite.revoked",
  "message.created",
  "proposal.created",
  "proposal.vote_cast",
  "proposal.approved",
  "proposal.rejected",
  "proposal.expired",
  "agent.registered",
  "agent.unregistered",
  "agent.disconnected",
  "agent.pairing_created",
  "agent.status_changed",
  "agent.updated",
  "agent.turn.requested",
  "agent.turn.followup_queued",
  "agent.turn.started",
  "agent.output.delta",
  "agent.turn.completed",
  "agent.turn.failed",
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
  "agent.run.started",
  "agent.run.completed",
  "agent.run.failed",
  "agent.run.node.started",
  "agent.run.node.delta",
  "agent.run.node.updated",
  "agent.run.node.completed",
  "agent.run.node.failed",
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
  "task.created",
  "task.started",
  "task.output",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "artifact.created",
  "context.updated",
  "join_request.created",
  "join_request.approved",
  "join_request.rejected",
  "join_request.expired",
  "participant.removed",
  "main_input.accepted",
  "main_input.queued",
  "main_input.triggered",
  "main_input.cancelled",
  "main_input.failed",
  "connector.snapshot.requested",
  "connector.snapshot.started",
  "connector.snapshot.entry",
  "connector.snapshot.completed",
  "connector.snapshot.failed",
  "orbit.note.created",
  "orbit.like.changed",
  "orbit.cleared",
  "orbit.notes.quoted",
]);

export const CacpEventSchema = z.object({
  protocol: z.literal("cacp"),
  version: ProtocolVersionSchema,
  event_id: z.string().min(1),
  room_id: z.string().min(1),
  type: EventTypeSchema,
  actor_id: z.string().min(1),
  created_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export const VoteValueSchema = z.enum([
  "approve",
  "reject",
  "abstain",
  "request_changes",
]);
export const VoteRecordSchema = z.object({
  voter_id: z.string().min(1),
  vote: VoteValueSchema,
  comment: z.string().optional(),
});

export const PolicySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("owner_approval"),
    expires_at: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("majority"),
    expires_at: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("role_quorum"),
    required_roles: z.array(ParticipantRoleSchema).min(1),
    min_approvals: z.number().int().positive(),
    expires_at: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("unanimous"),
    expires_at: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("no_approval"),
    expires_at: z.string().datetime().optional(),
  }),
]);

export const RequiredUnknownSchema = z
  .unknown()
  .refine((value) => value !== undefined, "Required");
export const RoomHistoryClearedPayloadSchema = z.object({
  cleared_by: z.string().min(1),
  cleared_at: z.string().datetime(),
  scope: z.enum(["messages", "messages_and_decisions"]),
});

export const ClaudeSessionSummarySchema = z.object({
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  project_dir: z.string().min(1).max(500),
  updated_at: z.string().datetime(),
  message_count: z.number().int().nonnegative(),
  byte_size: z.number().int().nonnegative(),
  importable: z.boolean(),
});

export const ClaudeSessionCatalogUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  working_dir: z.string().min(1).max(500),
  sessions: z.array(ClaudeSessionSummarySchema).max(100),
});

export const ClaudeSessionSelectedPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh"),
    selected_by: z.string().min(1),
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    selected_by: z.string().min(1),
  }),
]);

export const ClaudeSessionReadyPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh"),
    session_id: z.string().min(1).optional(),
    ready_at: z.string().datetime(),
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    ready_at: z.string().datetime(),
  }),
]);

export const ClaudeSessionPreviewRequestedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  requested_by: z.string().min(1),
  requested_at: z.string().datetime(),
});

export const ClaudeSessionImportMaxMessages = 1000;

export const ClaudeSessionImportStartedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  message_count: z
    .number()
    .int()
    .nonnegative()
    .max(ClaudeSessionImportMaxMessages),
  started_at: z.string().datetime(),
});

export const ClaudeSessionImportAuthorRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "command",
  "system",
]);
export const ClaudeSessionImportSourceKindSchema = z.enum([
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  "command",
  "system",
]);

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
  truncated: z.boolean().optional(),
});

export const ClaudeSessionPreviewMessagePayloadSchema =
  ClaudeSessionImportMessagePayloadSchema.omit({ import_id: true }).extend({
    preview_id: z.string().min(1),
  });

export const ClaudeSessionPreviewCompletedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  previewed_message_count: z.number().int().nonnegative(),
  completed_at: z.string().datetime(),
});

export const ClaudeSessionPreviewFailedPayloadSchema = z.object({
  preview_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  error: z.string().min(1).max(2000),
  failed_at: z.string().datetime(),
});

export const ClaudeSessionImportCompletedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  imported_message_count: z.number().int().nonnegative(),
  completed_at: z.string().datetime(),
});

export const ClaudeSessionImportFailedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1).optional(),
  error: z.string().min(1).max(2000),
  failed_at: z.string().datetime(),
});

export const AgentRunNodeKindSchema = z.enum([
  "reasoning_summary",
  "tool",
  "subagent",
  "subagent_message",
  "hook",
  "approval",
  "elicitation",
  "memory",
  "compaction",
  "api_retry",
  "status",
]);

export const AgentRunNodeStatusSchema = z.enum([
  "pending",
  "waiting_input",
  "running",
  "streaming",
  "completed",
  "failed",
]);
const AgentRunNodeActiveStatusSchema = z.enum([
  "pending",
  "waiting_input",
  "running",
  "streaming",
]);

export const AgentRunMetricsSchema = z.object({
  files_read: z.number().int().nonnegative().default(0),
  searches: z.number().int().nonnegative().default(0),
  commands: z.number().int().nonnegative().default(0),
});

export const AgentRunSourceRefsSchema = z
  .object({
    tool_use_id: z.string().min(1).optional(),
    parent_tool_use_id: z.string().min(1).nullable().optional(),
    task_id: z.string().min(1).optional(),
    hook_id: z.string().min(1).optional(),
    elicitation_id: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some(
        (entry) => entry !== undefined && entry !== null
      ),
    {
      message: "At least one source ref is required",
    }
  );

const AgentRunBasePayloadSchema = z.object({
  run_id: z.string().min(1),
  turn_id: z.string().min(1),
  agent_id: z.string().min(1),
  provider: z.string().min(1),
});

const AgentRunNodeBasePayloadSchema = AgentRunBasePayloadSchema.extend({
  node_id: z.string().min(1),
});

export const AgentRunStartedPayloadSchema = AgentRunBasePayloadSchema.extend({
  started_at: z.string().datetime(),
});

export const AgentRunCompletedPayloadSchema = AgentRunBasePayloadSchema.extend({
  message_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  metrics: AgentRunMetricsSchema,
  usage: z.record(z.string(), z.unknown()).optional(),
  completed_at: z.string().datetime(),
});

export const AgentRunFailedPayloadSchema = AgentRunBasePayloadSchema.extend({
  error: z.string().min(1).max(2000),
  partial_message_id: z.string().min(1).optional(),
  failed_at: z.string().datetime(),
});

export const AgentRunNodeStartedPayloadSchema =
  AgentRunNodeBasePayloadSchema.extend({
    parent_node_id: z.string().min(1).optional(),
    kind: AgentRunNodeKindSchema,
    status: AgentRunNodeActiveStatusSchema,
    title: z.string().min(1).max(500),
    role: z.enum(["user", "assistant", "system"]).optional(),
    content_format: z.enum(["text", "markdown", "html"]).optional(),
    text: z.string().optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
    source_refs: AgentRunSourceRefsSchema.optional(),
    started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  });

export const AgentRunNodeDeltaPayloadSchema =
  AgentRunNodeBasePayloadSchema.extend({
    delta_type: z.enum(["text", "stdout", "stderr"]),
    chunk: z.string(),
    updated_at: z.string().datetime(),
  });

export const AgentRunNodeUpdatedPayloadSchema =
  AgentRunNodeBasePayloadSchema.extend({
    status: AgentRunNodeStatusSchema.optional(),
    title: z.string().min(1).max(500).optional(),
    role: z.enum(["user", "assistant", "system"]).optional(),
    content_format: z.enum(["text", "markdown", "html"]).optional(),
    text: z.string().optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
    source_refs: AgentRunSourceRefsSchema.optional(),
    updated_at: z.string().datetime(),
  });

export const AgentRunNodeCompletedPayloadSchema =
  AgentRunNodeBasePayloadSchema.extend({
    summary: z.string().min(1).max(500).optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
    completed_at: z.string().datetime(),
  });

export const AgentRunNodeFailedPayloadSchema =
  AgentRunNodeBasePayloadSchema.extend({
    error: z.string().min(1).max(2000),
    detail: z.record(z.string(), z.unknown()).optional(),
    failed_at: z.string().datetime(),
  });

export const AgentRunApprovalRequestBodySchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  tool_node_id: z.string().min(1),
  tool_use_id: z.string().min(1),
  tool_name: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  decision_reason: z.string().min(1).max(2000).optional(),
  blocked_path: z.string().min(1).max(1000).optional(),
  input: z.unknown().optional(),
  requested_at: z.string().datetime(),
});

export const AgentRunApprovalResolveBodySchema = z
  .object({
    decision: z.enum(["allow", "deny"]),
    reason: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const AgentRunElicitationRequestBodySchema = z
  .object({
    agent_id: z.string().min(1),
    turn_id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    display_name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    message: z.string().min(1).max(4000),
    mode: z.enum(["form", "url"]).optional(),
    url: z.string().url().optional(),
    requested_schema: z.record(z.string(), z.unknown()).optional(),
    requested_at: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "url" && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL mode requires url",
        path: ["url"],
      });
    }
  });

export const AgentRunElicitationResolveBodySchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("accept"),
        content: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("decline"),
      })
      .strict(),
    z
      .object({
        action: z.literal("cancel"),
      })
      .strict(),
  ]
);

export const LocalAgentProviderSchema = z.enum([
  "claude-code",
  "codex-cli",
  "github-copilot",
  "kimi-cli",
]);

export const AgentSessionSummarySchema = ClaudeSessionSummarySchema.extend({
  provider: LocalAgentProviderSchema.optional(),
});

export const AgentSessionCatalogUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  provider: LocalAgentProviderSchema,
  working_dir: z.string().min(1).max(500),
  sessions: z.array(AgentSessionSummarySchema).max(100),
});

export const AgentSessionSelectedPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("fresh"),
    selected_by: z.string().min(1),
  }),
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    selected_by: z.string().min(1),
  }),
]);

export const AgentSessionReadyPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("fresh"),
    session_id: z.string().min(1).optional(),
    ready_at: z.string().datetime(),
  }),
  z.object({
    agent_id: z.string().min(1),
    provider: LocalAgentProviderSchema,
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    ready_at: z.string().datetime(),
  }),
]);

export const AgentSessionPreviewRequestedPayloadSchema =
  ClaudeSessionPreviewRequestedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionImportStartedPayloadSchema =
  ClaudeSessionImportStartedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionImportAuthorRoleSchema =
  ClaudeSessionImportAuthorRoleSchema;
export const AgentSessionImportSourceKindSchema =
  ClaudeSessionImportSourceKindSchema;

export const AgentSessionImportMessagePayloadSchema =
  ClaudeSessionImportMessagePayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionPreviewMessagePayloadSchema =
  AgentSessionImportMessagePayloadSchema.omit({ import_id: true }).extend({
    preview_id: z.string().min(1),
  });

export const AgentSessionPreviewCompletedPayloadSchema =
  ClaudeSessionPreviewCompletedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionPreviewFailedPayloadSchema =
  ClaudeSessionPreviewFailedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionImportCompletedPayloadSchema =
  ClaudeSessionImportCompletedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export const AgentSessionImportFailedPayloadSchema =
  ClaudeSessionImportFailedPayloadSchema.extend({
    provider: LocalAgentProviderSchema,
  });

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;
export type AttachmentDisposition = z.infer<typeof AttachmentDispositionSchema>;
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
export type StructuredMessageContent = z.infer<
  typeof StructuredMessageContentSchema
>;
export type AgentAttachmentInputMode = z.infer<
  typeof AgentAttachmentInputModeSchema
>;
export type AgentInputCapabilities = z.infer<
  typeof AgentInputCapabilitiesSchema
>;
export type AgentAdapterCompatibility = z.infer<
  typeof AgentAdapterCompatibilitySchema
>;
export type ConnectorCompatibility = z.infer<
  typeof ConnectorCompatibilitySchema
>;
export const RequiredAgentAdapterCompatibility = [
  {
    provider: "claude-code",
    sdk_package: "@anthropic-ai/claude-agent-sdk",
    sdk_version: "0.3.220",
    input_capabilities: {
      image: "native",
      pdf: "native",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
  {
    provider: "codex-cli",
    sdk_package: "@openai/codex-sdk",
    sdk_version: "0.146.0",
    input_capabilities: {
      image: "native",
      pdf: "file_path",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
  {
    provider: "github-copilot",
    sdk_package: "@github/copilot-sdk",
    sdk_version: "1.0.8",
    input_capabilities: {
      image: "native",
      pdf: "native",
      text: "native",
      office: "native",
      file: "native",
      max_attachments: 5,
    },
  },
  {
    provider: "kimi-cli",
    sdk_package: "@moonshot-ai/kimi-agent-sdk",
    sdk_version: "0.1.8",
    input_capabilities: {
      image: "native",
      pdf: "file_path",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
] as const satisfies readonly AgentAdapterCompatibility[];
export type MessageCreatedPayload = z.infer<typeof MessageCreatedPayloadSchema>;
export type AgentTurnRequestedPayload = z.infer<
  typeof AgentTurnRequestedPayloadSchema
>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type CacpEvent = z.infer<typeof CacpEventSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteRecord = z.infer<typeof VoteRecordSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type RequiredUnknown = z.infer<typeof RequiredUnknownSchema>;
export type RoomHistoryClearedPayload = z.infer<
  typeof RoomHistoryClearedPayloadSchema
>;
export type ClaudeSessionSummary = z.infer<typeof ClaudeSessionSummarySchema>;
export type ClaudeSessionCatalogUpdatedPayload = z.infer<
  typeof ClaudeSessionCatalogUpdatedPayloadSchema
>;
export type ClaudeSessionSelectedPayload = z.infer<
  typeof ClaudeSessionSelectedPayloadSchema
>;
export type ClaudeSessionReadyPayload = z.infer<
  typeof ClaudeSessionReadyPayloadSchema
>;
export type ClaudeSessionPreviewRequestedPayload = z.infer<
  typeof ClaudeSessionPreviewRequestedPayloadSchema
>;
export type ClaudeSessionPreviewMessagePayload = z.infer<
  typeof ClaudeSessionPreviewMessagePayloadSchema
>;
export type ClaudeSessionPreviewCompletedPayload = z.infer<
  typeof ClaudeSessionPreviewCompletedPayloadSchema
>;
export type ClaudeSessionPreviewFailedPayload = z.infer<
  typeof ClaudeSessionPreviewFailedPayloadSchema
>;
export type ClaudeSessionImportStartedPayload = z.infer<
  typeof ClaudeSessionImportStartedPayloadSchema
>;
export type ClaudeSessionImportMessagePayload = z.infer<
  typeof ClaudeSessionImportMessagePayloadSchema
>;
export type ClaudeSessionImportCompletedPayload = z.infer<
  typeof ClaudeSessionImportCompletedPayloadSchema
>;
export type ClaudeSessionImportFailedPayload = z.infer<
  typeof ClaudeSessionImportFailedPayloadSchema
>;
export type LocalAgentProvider = z.infer<typeof LocalAgentProviderSchema>;
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;
export type AgentSessionCatalogUpdatedPayload = z.infer<
  typeof AgentSessionCatalogUpdatedPayloadSchema
>;
export type AgentSessionSelectedPayload = z.infer<
  typeof AgentSessionSelectedPayloadSchema
>;
export type AgentSessionReadyPayload = z.infer<
  typeof AgentSessionReadyPayloadSchema
>;
export type AgentSessionPreviewRequestedPayload = z.infer<
  typeof AgentSessionPreviewRequestedPayloadSchema
>;
export type AgentSessionPreviewMessagePayload = z.infer<
  typeof AgentSessionPreviewMessagePayloadSchema
>;
export type AgentSessionPreviewCompletedPayload = z.infer<
  typeof AgentSessionPreviewCompletedPayloadSchema
>;
export type AgentSessionPreviewFailedPayload = z.infer<
  typeof AgentSessionPreviewFailedPayloadSchema
>;
export type AgentSessionImportStartedPayload = z.infer<
  typeof AgentSessionImportStartedPayloadSchema
>;
export type AgentSessionImportMessagePayload = z.infer<
  typeof AgentSessionImportMessagePayloadSchema
>;
export type AgentSessionImportCompletedPayload = z.infer<
  typeof AgentSessionImportCompletedPayloadSchema
>;
export type AgentSessionImportFailedPayload = z.infer<
  typeof AgentSessionImportFailedPayloadSchema
>;
export type AgentRunMetrics = z.infer<typeof AgentRunMetricsSchema>;
export type AgentRunNodeKind = z.infer<typeof AgentRunNodeKindSchema>;
export type AgentRunNodeStatus = z.infer<typeof AgentRunNodeStatusSchema>;
export type AgentRunSourceRefs = z.infer<typeof AgentRunSourceRefsSchema>;
export type AgentRunStartedPayload = z.infer<
  typeof AgentRunStartedPayloadSchema
>;
export type AgentRunCompletedPayload = z.infer<
  typeof AgentRunCompletedPayloadSchema
>;
export type AgentRunFailedPayload = z.infer<typeof AgentRunFailedPayloadSchema>;
export type AgentRunNodeStartedPayload = z.infer<
  typeof AgentRunNodeStartedPayloadSchema
>;
export type AgentRunNodeDeltaPayload = z.infer<
  typeof AgentRunNodeDeltaPayloadSchema
>;
export type AgentRunNodeUpdatedPayload = z.infer<
  typeof AgentRunNodeUpdatedPayloadSchema
>;
export type AgentRunNodeCompletedPayload = z.infer<
  typeof AgentRunNodeCompletedPayloadSchema
>;
export type AgentRunNodeFailedPayload = z.infer<
  typeof AgentRunNodeFailedPayloadSchema
>;
export type AgentRunApprovalRequestBody = z.infer<
  typeof AgentRunApprovalRequestBodySchema
>;
export type AgentRunApprovalResolveBody = z.infer<
  typeof AgentRunApprovalResolveBodySchema
>;
export type AgentRunElicitationRequestBody = z.infer<
  typeof AgentRunElicitationRequestBodySchema
>;
export type AgentRunElicitationResolveBody = z.infer<
  typeof AgentRunElicitationResolveBodySchema
>;
export type ParticipantPresence = z.infer<typeof ParticipantPresenceSchema>;
export type ParticipantActivityScope = z.infer<
  typeof ParticipantActivityScopeSchema
>;
export type ParticipantPresenceChangedPayload = z.infer<
  typeof ParticipantPresenceChangedPayloadSchema
>;
export type ParticipantTypingStartedPayload = z.infer<
  typeof ParticipantTypingStartedPayloadSchema
>;
export type ParticipantTypingStoppedPayload = z.infer<
  typeof ParticipantTypingStoppedPayloadSchema
>;

export const MainInputSourceSchema = z.enum(["composer", "orbit_promote"]);
export const MainInputStatusSchema = z.enum([
  "accepted",
  "queued",
  "triggered",
  "cancelled",
  "failed",
]);

// Kept as shared value types for rendering historical room events. The
// corresponding legacy runtime event types are intentionally not part of the
// v0.3 event schema; new connectors emit agent.run.* traces instead.
export const ClaudeRuntimePhaseSchema = z.enum([
  "connecting",
  "resuming_session",
  "importing_session",
  "requesting_api",
  "retrying_api",
  "compacting_context",
  "recalling_memory",
  "thinking",
  "reading_files",
  "searching",
  "running_command",
  "running_subagent",
  "executing_hook",
  "waiting_for_approval",
  "generating_answer",
  "completed",
  "failed",
]);

export const ClaudeRuntimeMetricsSchema = z.object({
  files_read: z.number().int().nonnegative().default(0),
  searches: z.number().int().nonnegative().default(0),
  commands: z.number().int().nonnegative().default(0),
});

export const MainInputAcceptedPayloadSchema = z.object({
  input_id: z.string().min(1),
  author_id: z.string().min(1),
  content: StructuredMessageContentSchema,
  source: MainInputSourceSchema,
  created_at: z.string().datetime(),
});

export const MainInputQueuedPayloadSchema = z.object({
  input_id: z.string().min(1),
  queued_after_turn_id: z.string().min(1),
});

export const MainInputTriggeredPayloadSchema = z.object({
  input_id: z.string().min(1),
  trigger_turn_id: z.string().min(1),
});

export const MainInputCancelledPayloadSchema = z.object({
  input_id: z.string().min(1),
  cancelled_by: z.string().min(1),
});

export const MainInputFailedPayloadSchema = z.object({
  input_id: z.string().min(1),
  failure_reason: z.string().min(1),
});

export const ConnectorLedgerEntrySchema = z.object({
  ledger_version: z.literal(1),
  room_id: z.string().min(1),
  connector_id: z.string().min(1),
  agent_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  entry_id: z.string().min(1),
  entry_type: z.enum([
    "human_input",
    "agent_final",
    "imported_session_message",
    "system_marker",
  ]),
  actor_id: z.string().min(1),
  actor_name: z.string().min(1).max(120),
  actor_role: ParticipantRoleSchema,
  text: z.string().min(1).max(8000),
  source: z.enum(["composer", "orbit_promote", "session_import", "system"]),
  created_at: z.string().datetime(),
  turn_id: z.string().min(1).optional(),
  input_id: z.string().min(1).optional(),
  source_session_id: z.string().min(1).optional(),
});

export const ConnectorSnapshotRequestedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  since_sequence: z.number().int().nonnegative(),
  requested_by: z.string().min(1),
});

export const ConnectorSnapshotStartedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  first_sequence: z.number().int().nonnegative(),
  last_sequence: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative().optional(),
});

export const ConnectorSnapshotEntryPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  entry: ConnectorLedgerEntrySchema,
});

export const ConnectorSnapshotCompletedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  last_sequence: z.number().int().nonnegative(),
});

export const ConnectorSnapshotFailedPayloadSchema = z.object({
  request_id: z.string().min(1),
  connector_id: z.string().min(1),
  error: z.string().min(1).max(2000),
});

export const OrbitNoteCreatedPayloadSchema = z
  .object({
    note_id: z.string().min(1),
    author_id: z.string().min(1),
    author_name: z.string().min(1),
    text: z.string().max(2000).default(""),
    attachments: z.array(AttachmentRefSchema).max(5).default([]),
    created_at: z.string().datetime(),
    reply_to: z.string().optional(),
  })
  .refine(
    (payload) =>
      payload.text.trim().length > 0 || payload.attachments.length > 0,
    { message: "orbit_note_content_required" }
  );

export const OrbitLikeChangedPayloadSchema = z.object({
  note_id: z.string().min(1),
  participant_id: z.string().min(1),
  liked: z.boolean(),
  likes: z.number().int().nonnegative(),
});

export const OrbitClearedPayloadSchema = z.object({
  cleared_by: z.string().min(1),
  cleared_at: z.string().datetime(),
});

export const OrbitNotesQuotedPayloadSchema = z.object({
  note_ids: z.array(z.string().min(1)).min(1),
});

export const ParticipantRoleUpdatedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  old_role: ParticipantRoleSchema,
  new_role: ParticipantRoleSchema,
  updated_by: z.string().min(1),
  updated_at: z.string().datetime(),
});

export const AgentUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  thinking_enabled: z.boolean(),
  updated_by: z.string().min(1),
  updated_at: z.string().datetime(),
});

export const WhiteboardProtocolName = "cacp-whiteboard" as const;
export const WhiteboardProtocolVersion = "1.0.0" as const;
export const WhiteboardMaxElements = 10_000;
export const WhiteboardMaxSelectedElements = 200;

const WhiteboardWireBaseSchema = z.object({
  protocol: z.literal(WhiteboardProtocolName),
  version: z.literal(WhiteboardProtocolVersion),
  room_id: z.string().min(1).max(200),
});

export const WhiteboardHumanRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "observer",
]);

export const WhiteboardElementSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    version: z.number().int().positive(),
    versionNonce: z.number().int(),
  })
  .passthrough();

export const WhiteboardSharedAppStateSchema = z
  .object({
    viewBackgroundColor: z.string().min(1).max(32).optional(),
  })
  .strict();

export const WhiteboardSceneSchema = z
  .object({
    elements: z.array(WhiteboardElementSchema).max(WhiteboardMaxElements),
    app_state: WhiteboardSharedAppStateSchema,
  })
  .strict();

export const WhiteboardConnectedMessageSchema = WhiteboardWireBaseSchema.extend(
  {
    type: z.literal("whiteboard.connected"),
    participant_id: z.string().min(1).max(200),
    role: WhiteboardHumanRoleSchema,
    can_edit: z.boolean(),
    presence_heartbeat_ms: z.number().int().positive().optional(),
  }
).strict();

export const WhiteboardSceneMessageSchema = WhiteboardWireBaseSchema.extend({
  type: z.literal("whiteboard.scene"),
  revision: z.number().int().nonnegative(),
  scene: WhiteboardSceneSchema,
}).strict();

export const WhiteboardClientUpdateMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.elements.update"),
    update_id: z.string().min(1).max(200),
    base_revision: z.number().int().nonnegative(),
    elements: z.array(WhiteboardElementSchema).max(WhiteboardMaxElements),
    app_state: WhiteboardSharedAppStateSchema,
  }).strict();

export const WhiteboardElementsUpdatedMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.elements.updated"),
    update_id: z.string().min(1).max(200),
    participant_id: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    elements: z.array(WhiteboardElementSchema).max(WhiteboardMaxElements),
    app_state: WhiteboardSharedAppStateSchema,
  }).strict();

export const WhiteboardAckMessageSchema = WhiteboardWireBaseSchema.extend({
  type: z.literal("whiteboard.ack"),
  update_id: z.string().min(1).max(200),
  revision: z.number().int().positive(),
}).strict();

export const WhiteboardCursorSchema = z
  .object({
    x: z.number().finite().min(-10_000_000).max(10_000_000),
    y: z.number().finite().min(-10_000_000).max(10_000_000),
    button: z.enum(["up", "down"]),
  })
  .strict();

export const WhiteboardViewportSchema = z
  .object({
    scroll_x: z.number().finite().min(-10_000_000).max(10_000_000),
    scroll_y: z.number().finite().min(-10_000_000).max(10_000_000),
    zoom: z.number().finite().min(0.05).max(30),
  })
  .strict();

export const WhiteboardClientPresenceMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.presence.update"),
    cursor: WhiteboardCursorSchema.nullable(),
    selected_element_ids: z
      .array(z.string().min(1).max(200))
      .max(WhiteboardMaxSelectedElements),
    viewport: WhiteboardViewportSchema,
  }).strict();

export const WhiteboardCollaboratorSchema = z
  .object({
    participant_id: z.string().min(1).max(200),
    display_name: z.string().min(1).max(200),
    color: z
      .object({
        background: z.string().regex(/^#[0-9a-f]{6}$/i),
        stroke: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .strict(),
    can_edit: z.boolean(),
    cursor: WhiteboardCursorSchema.nullable().optional(),
    selected_element_ids: z
      .array(z.string().min(1).max(200))
      .max(WhiteboardMaxSelectedElements)
      .optional(),
    viewport: WhiteboardViewportSchema.optional(),
  })
  .strict();

export const WhiteboardPresenceSnapshotMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.presence.snapshot"),
    collaborators: z.array(WhiteboardCollaboratorSchema).max(100),
  }).strict();

export const WhiteboardPresenceUpdatedMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.presence.updated"),
    collaborator: WhiteboardCollaboratorSchema,
  }).strict();

export const WhiteboardPresenceLeftMessageSchema =
  WhiteboardWireBaseSchema.extend({
    type: z.literal("whiteboard.presence.left"),
    participant_id: z.string().min(1).max(200),
  }).strict();

export const WhiteboardErrorCodeSchema = z.enum([
  "invalid_token",
  "origin_not_allowed",
  "room_ended",
  "room_full",
  "forbidden",
  "invalid_message",
  "not_synchronized",
  "stale_revision",
  "rate_limited",
  "internal_error",
]);

export const WhiteboardErrorMessageSchema = WhiteboardWireBaseSchema.extend({
  type: z.literal("whiteboard.error"),
  code: WhiteboardErrorCodeSchema,
  message: z.string().min(1).max(500),
  recoverable: z.boolean(),
  update_id: z.string().min(1).max(200).optional(),
  current_revision: z.number().int().nonnegative().optional(),
}).strict();

export const WhiteboardClientMessageSchema = z.discriminatedUnion("type", [
  WhiteboardClientUpdateMessageSchema,
  WhiteboardClientPresenceMessageSchema,
]);

export const WhiteboardServerMessageSchema = z.discriminatedUnion("type", [
  WhiteboardConnectedMessageSchema,
  WhiteboardSceneMessageSchema,
  WhiteboardElementsUpdatedMessageSchema,
  WhiteboardAckMessageSchema,
  WhiteboardPresenceSnapshotMessageSchema,
  WhiteboardPresenceUpdatedMessageSchema,
  WhiteboardPresenceLeftMessageSchema,
  WhiteboardErrorMessageSchema,
]);

export type MainInputSource = z.infer<typeof MainInputSourceSchema>;
export type MainInputStatus = z.infer<typeof MainInputStatusSchema>;
export type ClaudeRuntimePhase = z.infer<typeof ClaudeRuntimePhaseSchema>;
export type ClaudeRuntimeMetrics = z.infer<typeof ClaudeRuntimeMetricsSchema>;
export type MainInputAcceptedPayload = z.infer<
  typeof MainInputAcceptedPayloadSchema
>;
export type MainInputQueuedPayload = z.infer<
  typeof MainInputQueuedPayloadSchema
>;
export type MainInputTriggeredPayload = z.infer<
  typeof MainInputTriggeredPayloadSchema
>;
export type MainInputCancelledPayload = z.infer<
  typeof MainInputCancelledPayloadSchema
>;
export type MainInputFailedPayload = z.infer<
  typeof MainInputFailedPayloadSchema
>;
export type ConnectorLedgerEntry = z.infer<typeof ConnectorLedgerEntrySchema>;
export type ConnectorSnapshotRequestedPayload = z.infer<
  typeof ConnectorSnapshotRequestedPayloadSchema
>;
export type ConnectorSnapshotStartedPayload = z.infer<
  typeof ConnectorSnapshotStartedPayloadSchema
>;
export type ConnectorSnapshotEntryPayload = z.infer<
  typeof ConnectorSnapshotEntryPayloadSchema
>;
export type ConnectorSnapshotCompletedPayload = z.infer<
  typeof ConnectorSnapshotCompletedPayloadSchema
>;
export type ConnectorSnapshotFailedPayload = z.infer<
  typeof ConnectorSnapshotFailedPayloadSchema
>;
export type OrbitNoteCreatedPayload = z.infer<
  typeof OrbitNoteCreatedPayloadSchema
>;
export type OrbitLikeChangedPayload = z.infer<
  typeof OrbitLikeChangedPayloadSchema
>;
export type OrbitClearedPayload = z.infer<typeof OrbitClearedPayloadSchema>;
export type OrbitNotesQuotedPayload = z.infer<
  typeof OrbitNotesQuotedPayloadSchema
>;
export type ParticipantRoleUpdatedPayload = z.infer<
  typeof ParticipantRoleUpdatedPayloadSchema
>;
export type AgentUpdatedPayload = z.infer<typeof AgentUpdatedPayloadSchema>;
export type WhiteboardHumanRole = z.infer<typeof WhiteboardHumanRoleSchema>;
export type WhiteboardElement = z.infer<typeof WhiteboardElementSchema>;
export type WhiteboardSharedAppState = z.infer<
  typeof WhiteboardSharedAppStateSchema
>;
export type WhiteboardScene = z.infer<typeof WhiteboardSceneSchema>;
export type WhiteboardConnectedMessage = z.infer<
  typeof WhiteboardConnectedMessageSchema
>;
export type WhiteboardSceneMessage = z.infer<
  typeof WhiteboardSceneMessageSchema
>;
export type WhiteboardClientUpdateMessage = z.infer<
  typeof WhiteboardClientUpdateMessageSchema
>;
export type WhiteboardElementsUpdatedMessage = z.infer<
  typeof WhiteboardElementsUpdatedMessageSchema
>;
export type WhiteboardAckMessage = z.infer<typeof WhiteboardAckMessageSchema>;
export type WhiteboardCursor = z.infer<typeof WhiteboardCursorSchema>;
export type WhiteboardViewport = z.infer<typeof WhiteboardViewportSchema>;
export type WhiteboardClientPresenceMessage = z.infer<
  typeof WhiteboardClientPresenceMessageSchema
>;
export type WhiteboardCollaborator = z.infer<
  typeof WhiteboardCollaboratorSchema
>;
export type WhiteboardPresenceSnapshotMessage = z.infer<
  typeof WhiteboardPresenceSnapshotMessageSchema
>;
export type WhiteboardPresenceUpdatedMessage = z.infer<
  typeof WhiteboardPresenceUpdatedMessageSchema
>;
export type WhiteboardPresenceLeftMessage = z.infer<
  typeof WhiteboardPresenceLeftMessageSchema
>;
export type WhiteboardErrorCode = z.infer<typeof WhiteboardErrorCodeSchema>;
export type WhiteboardErrorMessage = z.infer<
  typeof WhiteboardErrorMessageSchema
>;
export type WhiteboardClientMessage = z.infer<
  typeof WhiteboardClientMessageSchema
>;
export type WhiteboardServerMessage = z.infer<
  typeof WhiteboardServerMessageSchema
>;
