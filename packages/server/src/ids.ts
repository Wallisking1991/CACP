import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

function secretKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function sealSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function openSecret(sealed: string, secret: string): string {
  const [scheme, ivValue, tagValue, encryptedValue] = sealed.split(":");
  if (scheme !== "aes-256-gcm" || !ivValue || !tagValue || !encryptedValue) throw new Error("invalid_secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("invalid_secret");
  }
}

export function event(roomId: string, type: EventType, actorId: string, payload: Record<string, unknown>): CacpEvent {
  return { protocol: "cacp", version: "0.2.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
}
