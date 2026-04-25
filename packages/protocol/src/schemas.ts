import { z } from "zod";

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
  "decision.created", "decision.finalized",
  "proposal.created", "proposal.vote_cast", "proposal.approved", "proposal.rejected", "proposal.expired",
  "agent.registered", "agent.unregistered", "agent.disconnected",
  "agent.turn.requested", "agent.turn.followup_queued", "agent.turn.started", "agent.output.delta", "agent.turn.completed", "agent.turn.failed",
  "task.created", "task.started", "task.output", "task.completed", "task.failed", "task.cancelled",
  "artifact.created", "context.updated"
]);

export const CacpEventSchema = z.object({
  protocol: z.literal("cacp"),
  version: z.literal("0.1.0"),
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

export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type CacpEvent = z.infer<typeof CacpEventSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteRecord = z.infer<typeof VoteRecordSchema>;
export type Policy = z.infer<typeof PolicySchema>;
