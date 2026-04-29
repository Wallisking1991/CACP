import { z } from "zod";
import {
  ClaudeRuntimeStatusChangedPayloadSchema,
  ClaudeRuntimeStatusCompletedPayloadSchema,
  ClaudeRuntimeStatusFailedPayloadSchema,
  ClaudeSessionCatalogUpdatedPayloadSchema,
  ClaudeSessionImportCompletedPayloadSchema,
  ClaudeSessionImportFailedPayloadSchema,
  ClaudeSessionImportMessagePayloadSchema,
  ClaudeSessionImportStartedPayloadSchema,
  ClaudeSessionSelectedPayloadSchema,
  type CacpEvent,
  type Participant
} from "@cacp/protocol";
import { event } from "./ids.js";

export const ClaudeSessionCatalogBodySchema = ClaudeSessionCatalogUpdatedPayloadSchema;
export const ClaudeSessionSelectionBodySchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh")
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1)
  })
]);

export const ClaudeSessionImportStartBodySchema = ClaudeSessionImportStartedPayloadSchema;
export const ClaudeSessionImportMessagesBodySchema = ClaudeSessionImportMessagePayloadSchema.array().min(1).max(50);
export const ClaudeSessionImportCompleteBodySchema = ClaudeSessionImportCompletedPayloadSchema;
export const ClaudeSessionImportFailBodySchema = ClaudeSessionImportFailedPayloadSchema;

export const ClaudeRuntimeStatusBodySchema = {
  changed: ClaudeRuntimeStatusChangedPayloadSchema,
  completed: ClaudeRuntimeStatusCompletedPayloadSchema,
  failed: ClaudeRuntimeStatusFailedPayloadSchema
} as const;

export function participantIsAgent(participant: Participant): boolean {
  return participant.role === "agent" && participant.type === "agent";
}

export function assertAgentOwnsPayload(participant: Participant, agentId: string): boolean {
  return participantIsAgent(participant) && participant.id === agentId;
}

export function claudeSelectionEvent(roomId: string, actorId: string, payload: unknown): CacpEvent {
  const parsed = ClaudeSessionSelectedPayloadSchema.parse(payload);
  return event(roomId, "claude.session_selected", actorId, parsed);
}
