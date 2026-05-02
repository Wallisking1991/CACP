import type { CacpEvent, ParticipantRole } from "@cacp/protocol";
import type { StoredParticipant } from "./event-store.js";

/**
 * Canonical list of non-agent (human) participant roles. Use this at every
 * orbit emit site (and any future role-filtered emit) to avoid duplicating
 * the literal `["owner", "admin", "member", "observer"]` — a typo at one
 * call site would silently exclude that role from delivery and TypeScript
 * would not catch it.
 */
export const HUMAN_ROLES: ParticipantRole[] = ["owner", "admin", "member", "observer"];

export type RelayDelivery =
  | { kind: "room" }
  | { kind: "targeted"; participant_ids: string[] }
  | { kind: "role"; roles: ParticipantRole[] };

export interface RelayEnvelope {
  event: CacpEvent;
  delivery: RelayDelivery;
}

export function roomDelivery(): RelayDelivery {
  return { kind: "room" };
}

export function targetedDelivery(ids: string[]): RelayDelivery {
  return { kind: "targeted", participant_ids: [...new Set(ids)] };
}

export function roleDelivery(roles: ParticipantRole[]): RelayDelivery {
  if (roles.length === 0) {
    throw new Error("roleDelivery requires at least one role (mirrors required_roles .min(1) in schemas)");
  }
  return { kind: "role", roles: [...new Set(roles)] };
}

export function canDeliverEnvelope(envelope: RelayEnvelope, participant: StoredParticipant): boolean {
  if (envelope.delivery.kind === "room") return true;
  if (envelope.delivery.kind === "targeted") {
    return envelope.delivery.participant_ids.includes(participant.id);
  }
  return envelope.delivery.roles.includes(participant.role);
}
