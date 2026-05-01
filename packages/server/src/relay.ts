import type { CacpEvent } from "@cacp/protocol";
import type { StoredParticipant } from "./event-store.js";

export type RelayDelivery = { kind: "room" } | { kind: "targeted"; participant_ids: string[] };

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

export function canDeliverEnvelope(envelope: RelayEnvelope, participant: StoredParticipant): boolean {
  if (envelope.delivery.kind === "room") return true;
  return envelope.delivery.participant_ids.includes(participant.id);
}
