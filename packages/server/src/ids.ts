import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CacpEvent, EventType } from "@cacp/protocol";

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function token(): string {
  return `cacp_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(value: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(value).digest("base64url");
  return `hmac-sha256:${digest}`;
}

export function safeTokenEquals(value: string, storedHash: string, secret: string): boolean {
  const next = hashToken(value, secret);
  const left = Buffer.from(next);
  const right = Buffer.from(storedHash);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function event(roomId: string, type: EventType, actorId: string, payload: Record<string, unknown>): CacpEvent {
  return { protocol: "cacp", version: "0.2.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
}
