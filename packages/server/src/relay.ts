import type { CacpEvent } from "@cacp/protocol";
import type { ParticipantRole } from "@cacp/protocol";
import type { StoredParticipant } from "./event-store.js";

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
  return { kind: "role", roles: [...new Set(roles)] };
}

export function canDeliverEnvelope(envelope: RelayEnvelope, participant: StoredParticipant): boolean {
  if (envelope.delivery.kind === "room") return true;
  if (envelope.delivery.kind === "targeted") {
    return envelope.delivery.participant_ids.includes(participant.id);
  }
  return envelope.delivery.roles.includes(participant.role);
}
