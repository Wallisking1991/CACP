import type { FastifyRequest } from "fastify";
import type { ParticipantRole } from "@cacp/protocol";
import type { EventStore, StoredParticipant } from "./event-store.js";

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

export function requireParticipant(store: EventStore, roomId: string, request: FastifyRequest): StoredParticipant | undefined {
  const value = bearerToken(request);
  return value ? store.getParticipantByToken(roomId, value) : undefined;
}

export function hasAnyRole(participant: StoredParticipant, roles: ParticipantRole[]): boolean {
  return roles.includes(participant.role);
}

export function hasHumanRole(participant: StoredParticipant, roles: ParticipantRole[]): boolean {
  return participant.type === "human" && roles.includes(participant.role);
}
