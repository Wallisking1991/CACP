import { randomBytes, randomUUID } from "node:crypto";
import type { CacpEvent, EventType } from "@cacp/protocol";

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function token(): string {
  return `cacp_${randomBytes(24).toString("base64url")}`;
}

export function event(roomId: string, type: EventType, actorId: string, payload: Record<string, unknown>): CacpEvent {
  return { protocol: "cacp", version: "0.1.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
}