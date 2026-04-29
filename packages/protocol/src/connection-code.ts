import { z } from "zod";
import { AgentTypeSchema } from "./schemas.js";

const Prefix = "CACP-CONNECT:v1:";

export const ConnectionCodePayloadSchema = z.object({
  server_url: z.string().url(),
  pairing_token: z.string().min(1),
  expires_at: z.string().datetime(),
  room_id: z.string().min(1).optional(),
  agent_type: AgentTypeSchema.optional(),
  permission_level: z.string().min(1).optional()
});

export type ConnectionCodePayload = z.infer<typeof ConnectionCodePayloadSchema>;

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildConnectionCode(payload: ConnectionCodePayload): string {
  const parsed = ConnectionCodePayloadSchema.parse(payload);
  return `${Prefix}${encodeBase64Url(JSON.stringify(parsed))}`;
}

export function parseConnectionCode(code: string): ConnectionCodePayload {
  if (!code.startsWith(Prefix)) throw new Error("invalid_connection_code");
  try {
    return ConnectionCodePayloadSchema.parse(JSON.parse(decodeBase64Url(code.slice(Prefix.length))));
  } catch {
    throw new Error("invalid_connection_code");
  }
}
