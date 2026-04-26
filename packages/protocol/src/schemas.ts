import { z } from "zod";

export const ProtocolVersionSchema = z.enum(["0.1.0", "0.2.0"]);

export const ParticipantTypeSchema = z.enum(["human", "agent", "system", "observer"]);
export const ParticipantRoleSchema = z.enum(["owner", "admin", "member", "observer", "agent"]);
export const ParticipantSchema = z.object({
  id: z.string().min(1),
  type: ParticipantTypeSchema,
  display_name: z.string().min(1),
  role: ParticipantRoleSchema
});

export const EventTypeSchema = z.enum([
  "room.created", "room.configured", "room.agent_selected", "participant.joined", "participant.left", "participant.role_updated", "invite.created",
  "message.created",
  "question.created", "question.response_submitted", "question.closed",
  "decision.created", "decision.finalized", "decision.requested", "decision.response_recorded", "decision.resolved", "decision.cancelled",
  "proposal.created", "proposal.vote_cast", "proposal.approved", "proposal.rejected", "proposal.expired",
  "agent.registered", "agent.unregistered", "agent.disconnected", "agent.pairing_created", "agent.status_changed", "agent.action_approval_requested", "agent.action_approval_resolved",
  "agent.turn.requested", "agent.turn.followup_queued", "agent.turn.started", "agent.output.delta", "agent.turn.completed", "agent.turn.failed",
  "task.created", "task.started", "task.output", "task.completed", "task.failed", "task.cancelled",
  "artifact.created", "context.updated", "room.history_cleared"
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
export const DecisionOptionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const DecisionKindSchema = z.enum(["single_choice", "approval", "multiple_choice", "ranking", "free_text_confirmation"]);
export const DecisionRequestedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  kind: DecisionKindSchema,
  options: z.array(DecisionOptionSchema).default([]),
  policy: PolicySchema,
  blocking: z.boolean().default(true),
  decision_type: z.string().optional(),
  action_id: z.string().optional(),
  source_turn_id: z.string().optional(),
  source_message_id: z.string().optional()
});
export const DecisionResponseRecordedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  respondent_id: z.string().min(1),
  response: RequiredUnknownSchema,
  response_label: z.string().optional(),
  source_message_id: z.string().min(1),
  interpretation: z.object({ method: z.enum(["deterministic", "agent", "manual"]), confidence: z.number().min(0).max(1) })
});
export const DecisionResolvedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  result: RequiredUnknownSchema,
  result_label: z.string().optional(),
  decided_by: z.array(z.string().min(1)),
  policy_evaluation: z.object({ status: z.enum(["approved", "rejected", "resolved"]), reason: z.string().min(1) })
});
export const DecisionCancelledPayloadSchema = z.object({
  decision_id: z.string().min(1),
  reason: z.string().min(1),
  cancelled_by: z.string().min(1)
});
export const RoomHistoryClearedPayloadSchema = z.object({
  cleared_by: z.string().min(1),
  cleared_at: z.string().datetime(),
  scope: z.literal("messages_and_decisions")
});

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type CacpEvent = z.infer<typeof CacpEventSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteRecord = z.infer<typeof VoteRecordSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type RequiredUnknown = z.infer<typeof RequiredUnknownSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;
export type DecisionKind = z.infer<typeof DecisionKindSchema>;
export type DecisionRequestedPayload = z.infer<typeof DecisionRequestedPayloadSchema>;
export type DecisionResponseRecordedPayload = z.infer<typeof DecisionResponseRecordedPayloadSchema>;
export type DecisionResolvedPayload = z.infer<typeof DecisionResolvedPayloadSchema>;
export type DecisionCancelledPayload = z.infer<typeof DecisionCancelledPayloadSchema>;
export type RoomHistoryClearedPayload = z.infer<typeof RoomHistoryClearedPayloadSchema>;
