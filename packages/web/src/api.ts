import { CacpEventSchema, type CacpEvent } from "@cacp/protocol";

export interface RoomSession {
  room_id: string;
  token: string;
}

async function postJson<T>(path: string, token: string | undefined, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function createRoom(name: string, displayName: string, defaultPolicy = "owner_approval"): Promise<RoomSession> {
  const result = await postJson<{ room_id: string; owner_token: string }>("/rooms", undefined, { name, display_name: displayName, default_policy: defaultPolicy });
  return { room_id: result.room_id, token: result.owner_token };
}

export async function createInvite(session: RoomSession, role: "member" | "observer", expiresInSeconds: number): Promise<{ invite_token: string; role: string; expires_at: string }> {
  return await postJson(`/rooms/${session.room_id}/invites`, session.token, { role, expires_in_seconds: expiresInSeconds });
}

export async function joinRoom(roomId: string, inviteToken: string, displayName: string): Promise<RoomSession> {
  const result = await postJson<{ participant_token: string }>(`/rooms/${roomId}/join`, undefined, { invite_token: inviteToken, display_name: displayName });
  return { room_id: roomId, token: result.participant_token };
}

export async function sendMessage(session: RoomSession, text: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/messages`, session.token, { text });
}


export async function selectAgent(session: RoomSession, agentId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/agents/select`, session.token, { agent_id: agentId });
}

export function pairingServerUrlFor(origin: string): string {
  const url = new URL(origin);
  if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "5173") {
    url.port = "3737";
  }
  return url.toString().replace(/\/$/, "");
}

export async function createAgentPairing(session: RoomSession, input: { agent_type: string; permission_level: string; working_dir: string }): Promise<{ pairing_token: string; expires_at: string; command: string }> {
  return await postJson(`/rooms/${session.room_id}/agent-pairings`, session.token, { ...input, server_url: pairingServerUrlFor(window.location.origin) });
}

export async function submitQuestionResponse(session: RoomSession, questionId: string, response: unknown, comment?: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/questions/${questionId}/responses`, session.token, { response, comment });
}

export function inviteUrlFor(origin: string, roomId: string, inviteToken: string): string {
  const url = new URL("/invite", origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("token", inviteToken);
  return url.toString();
}

export function parseInviteUrl(search: string): { room_id: string; invite_token: string } | undefined {
  const params = new URLSearchParams(search);
  const roomId = params.get("room");
  const inviteToken = params.get("token");
  return roomId && inviteToken ? { room_id: roomId, invite_token: inviteToken } : undefined;
}

export function parseCacpEventMessage(data: string): CacpEvent | undefined {
  try {
    const parsed = CacpEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function connectEvents(session: RoomSession, onEvent: (event: CacpEvent) => void): WebSocket {
  const url = new URL(`/rooms/${session.room_id}/stream`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);
  const socket = new WebSocket(url);
  socket.addEventListener("message", (message) => {
    const parsed = parseCacpEventMessage(message.data);
    if (parsed) onEvent(parsed);
  });
  return socket;
}
