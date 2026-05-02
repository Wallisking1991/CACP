import { CacpEventSchema, type CacpEvent } from "@cacp/protocol";

export interface RoomSession {
  room_id: string;
  token: string;
  participant_id: string;
  role: "owner" | "admin" | "member" | "observer" | "agent";
}

export interface LocalAgentLaunch {
  launch_id: string;
  pairing_token?: string;
  expires_at?: string;
  command: string;
  status: "starting";
  pid?: number;
  out_log?: string;
  err_log?: string;
}

export interface AgentSetupInput {
  agent_type: string;
  permission_level: string;
  working_dir: string;
}

export interface RoomWithLocalAgentResult {
  session: RoomSession;
  launch?: LocalAgentLaunch;
  launch_error?: string;
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

export async function createRoom(name: string, displayName: string): Promise<RoomSession> {
  const result = await postJson<{ room_id: string; owner_id: string; owner_token: string }>("/rooms", undefined, { name, display_name: displayName });
  return { room_id: result.room_id, token: result.owner_token, participant_id: result.owner_id, role: "owner" };
}

export async function createRoomWithLocalAgent(name: string, displayName: string, agent: AgentSetupInput): Promise<RoomWithLocalAgentResult> {
  const session = await createRoom(name, displayName);
  try {
    const launch = await createLocalAgentLaunch(session, agent);
    return { session, launch };
  } catch (cause) {
    return { session, launch_error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export type MainThreadHistoryAccess = "allowed" | "denied";

export async function createInvite(session: RoomSession, role: "member" | "observer", expiresInSeconds: number, maxUses: number, mainThreadHistoryAccess?: MainThreadHistoryAccess): Promise<{ invite_token: string; role: string; main_thread_history_access: string; expires_at: string; max_uses: number }> {
  const body: Record<string, unknown> = { role, expires_in_seconds: expiresInSeconds, max_uses: maxUses };
  if (mainThreadHistoryAccess) body.main_thread_history_access = mainThreadHistoryAccess;
  return await postJson(`/rooms/${session.room_id}/invites`, session.token, body);
}

export async function sendMessage(session: RoomSession, text: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/messages`, session.token, { text });
}

export async function sendOrbitNote(session: RoomSession, text: string): Promise<{ note_id: string }> {
  return await postJson(`/rooms/${session.room_id}/orbit/notes`, session.token, { text });
}

export async function likeOrbitNote(session: RoomSession, noteId: string): Promise<{ liked: boolean; count: number }> {
  return await postJson(`/rooms/${session.room_id}/orbit/notes/${noteId}/like`, session.token, {});
}

export async function unlikeOrbitNote(session: RoomSession, noteId: string): Promise<{ liked: boolean; count: number }> {
  return await fetch(`/rooms/${session.room_id}/orbit/notes/${noteId}/like`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${session.token}` }
  }).then((r) => r.json());
}

export async function promoteOrbitRound(session: RoomSession, noteIds?: string[]): Promise<{ input_id: string; status: string; note_count: number }> {
  return await postJson(`/rooms/${session.room_id}/orbit/promote`, session.token, { note_ids: noteIds });
}

export async function sendMainInput(session: RoomSession, text: string): Promise<{ input_id: string; status: string }> {
  return await postJson(`/rooms/${session.room_id}/main-inputs`, session.token, { text });
}

export async function cancelMainInput(session: RoomSession, inputId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/main-inputs/${inputId}/cancel`, session.token, {});
}

export async function requestConnectorSnapshot(session: RoomSession, sinceSequence = 0): Promise<{ request_id: string }> {
  const response = await fetch(`/rooms/${session.room_id}/connector-snapshots`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ since_sequence: sinceSequence })
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as { request_id: string };
}

export async function fetchRoomEvents(session: RoomSession): Promise<CacpEvent[]> {
  const response = await fetch(`/rooms/${session.room_id}/events`, {
    headers: { authorization: `Bearer ${session.token}` }
  });
  if (!response.ok) throw new Error(await response.text());
  const body = (await response.json()) as { events: CacpEvent[] };
  return body.events;
}

export async function leaveRoom(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/leave`, session.token, {});
}

export type ParticipantPresence = "online" | "idle" | "offline";

export async function updatePresence(session: RoomSession, presence: ParticipantPresence): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/presence`, session.token, { presence });
}

export async function startTyping(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/typing/start`, session.token, {});
}

export async function stopTyping(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/typing/stop`, session.token, {});
}

export async function selectAgent(session: RoomSession, agentId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/agents/select`, session.token, { agent_id: agentId });
}

export async function selectClaudeSession(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  mode: "fresh" | "resume";
  sessionId?: string;
}): Promise<{ ok: true }> {
  const response = await fetch(`${input.serverUrl}/rooms/${input.roomId}/claude/session-selection`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      mode: input.mode,
      ...(input.mode === "resume" ? { session_id: input.sessionId } : {})
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return await response.json() as { ok: true };
}

export async function requestClaudeSessionPreview(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  sessionId: string;
}): Promise<{ ok: true; preview_id: string }> {
  const response = await fetch(`${input.serverUrl}/rooms/${input.roomId}/claude/session-previews`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      session_id: input.sessionId
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return await response.json() as { ok: true; preview_id: string };
}

export async function selectAgentSession(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  provider: "claude-code" | "codex-cli";
  mode: "fresh" | "resume";
  sessionId?: string;
}): Promise<{ ok: true }> {
  const response = await fetch(`${input.serverUrl}/rooms/${input.roomId}/agent-sessions/selection`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      provider: input.provider,
      mode: input.mode,
      ...(input.mode === "resume" ? { session_id: input.sessionId } : {})
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return await response.json() as { ok: true };
}

export async function requestAgentSessionPreview(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  provider: "claude-code" | "codex-cli";
  sessionId: string;
}): Promise<{ ok: true; preview_id: string }> {
  const response = await fetch(`${input.serverUrl}/rooms/${input.roomId}/agent-sessions/previews`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      provider: input.provider,
      session_id: input.sessionId
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return await response.json() as { ok: true; preview_id: string };
}

export function pairingServerUrlFor(origin: string): string {
  const url = new URL(origin);
  if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && (url.port === "5173" || url.port === "3000")) {
    url.port = "3737";
  }
  return url.toString().replace(/\/$/, "");
}

function currentBrowserOrigin(): string {
  return typeof window === "undefined" ? "http://localhost:3737" : window.location.origin;
}

export interface AgentPairingResult {
  connection_code: string;
  expires_at: string;
  download_url: string;
}

export async function createAgentPairing(session: RoomSession, input: AgentSetupInput): Promise<AgentPairingResult> {
  return await postJson(`/rooms/${session.room_id}/agent-pairings`, session.token, { ...input, server_url: pairingServerUrlFor(currentBrowserOrigin()) });
}

export interface JoinRequestResult {
  request_id: string;
  request_token: string;
  status: "pending";
  expires_at: string;
}

export interface JoinRequestStatus {
  status: "pending" | "approved" | "rejected" | "expired";
  participant_id?: string;
  participant_token?: string;
  role?: RoomSession["role"];
}

export async function verifyInvite(inviteToken: string): Promise<{ valid: true } | { valid: false; reason: string }> {
  const response = await fetch(`/invites/verify?token=${encodeURIComponent(inviteToken)}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as { valid: true } | { valid: false; reason: string };
}

export async function createJoinRequest(roomId: string, inviteToken: string, displayName: string): Promise<JoinRequestResult> {
  return await postJson(`/rooms/${roomId}/join-requests`, undefined, { invite_token: inviteToken, display_name: displayName });
}

export async function joinRequestStatus(roomId: string, requestId: string, requestToken: string): Promise<JoinRequestStatus> {
  const response = await fetch(`/rooms/${roomId}/join-requests/${requestId}?request_token=${encodeURIComponent(requestToken)}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as JoinRequestStatus;
}

export async function approveJoinRequest(session: RoomSession, requestId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/join-requests/${requestId}/approve`, session.token, {});
}

export async function rejectJoinRequest(session: RoomSession, requestId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/join-requests/${requestId}/reject`, session.token, {});
}

export async function removeParticipant(session: RoomSession, participantId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/participants/${participantId}/remove`, session.token, {});
}

export async function createLocalAgentLaunch(session: RoomSession, input: AgentSetupInput): Promise<LocalAgentLaunch> {
  return await postJson(`/rooms/${session.room_id}/agent-pairings/start-local`, session.token, { ...input, server_url: pairingServerUrlFor(currentBrowserOrigin()) });
}

export function inviteUrlFor(origin: string, roomId: string, inviteToken: string): string {
  const url = new URL("/join", origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("token", inviteToken);
  return url.toString();
}

export async function getRoomMe(session: RoomSession): Promise<{ room_id: string; name: string; role: RoomSession["role"]; participant_id: string }> {
  const response = await fetch(`/rooms/${session.room_id}/me`, {
    headers: { authorization: `Bearer ${session.token}` }
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as { room_id: string; name: string; role: RoomSession["role"]; participant_id: string };
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

export function clearEventSocket(socket: WebSocket): void {
  if (socket.readyState === 0) {
    socket.addEventListener("open", () => socket.close(), { once: true });
    return;
  }
  if (socket.readyState === 1) socket.close();
}

export function connectEvents(
  session: RoomSession,
  onEvent: (event: CacpEvent) => void,
  onClose?: (code: number, reason: string) => void
): WebSocket {
  const url = new URL(`/rooms/${session.room_id}/stream`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);
  const socket = new WebSocket(url);
  socket.addEventListener("message", (message) => {
    const parsed = parseCacpEventMessage(message.data);
    if (parsed) onEvent(parsed);
  });
  if (onClose) {
    socket.addEventListener("close", (ev) => onClose(ev.code, ev.reason));
  }
  return socket;
}
