import {
  CacpEventSchema,
  WhiteboardSnapshotListSchema,
  WhiteboardSnapshotMutationResultSchema,
  WhiteboardPromotionResultSchema,
  type AttachmentRef,
  type CacpEvent,
  type CollaborationDiagnosticBatch,
  type WhiteboardSnapshotList,
  type WhiteboardSnapshotMutationResult,
  type WhiteboardPromotionRequest,
  type WhiteboardPromotionResult,
} from "@cacp/protocol";
export {
  cancelAttachmentUpload,
  deleteAttachment,
  fetchAttachmentBlob,
  fetchAttachmentUsage,
  uploadAttachment,
  type AttachmentUploadOptions,
  type AttachmentUploadProgress,
  type AttachmentUsage,
} from "./attachment-api.js";

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
}

export interface RoomWithLocalAgentResult {
  session: RoomSession;
  launch?: LocalAgentLaunch;
  launch_error?: string;
}

async function postJson<T>(
  path: string,
  token: string | undefined,
  body: unknown
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function createRoom(
  name: string,
  displayName: string
): Promise<RoomSession> {
  const result = await postJson<{
    room_id: string;
    owner_id: string;
    owner_token: string;
  }>("/rooms", undefined, { name, display_name: displayName });
  return {
    room_id: result.room_id,
    token: result.owner_token,
    participant_id: result.owner_id,
    role: "owner",
  };
}

export async function createRoomWithLocalAgent(
  name: string,
  displayName: string,
  agent: AgentSetupInput
): Promise<RoomWithLocalAgentResult> {
  const session = await createRoom(name, displayName);
  try {
    const launch = await createLocalAgentLaunch(session, agent);
    return { session, launch };
  } catch (cause) {
    return {
      session,
      launch_error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export type MainThreadHistoryAccess = "allowed" | "denied";

export async function createInvite(
  session: RoomSession,
  role: "member" | "observer",
  expiresInSeconds: number,
  maxUses: number,
  mainThreadHistoryAccess?: MainThreadHistoryAccess
): Promise<{
  invite_token: string;
  role: string;
  main_thread_history_access: string;
  expires_at: string;
  max_uses: number;
}> {
  const body: Record<string, unknown> = {
    role,
    expires_in_seconds: expiresInSeconds,
    max_uses: maxUses,
  };
  if (mainThreadHistoryAccess)
    body.main_thread_history_access = mainThreadHistoryAccess;
  return await postJson(
    `/rooms/${session.room_id}/invites`,
    session.token,
    body
  );
}

export async function sendMessage(
  session: RoomSession,
  text: string
): Promise<void> {
  await postJson(`/rooms/${session.room_id}/messages`, session.token, { text });
}

export async function sendOrbitNote(
  session: RoomSession,
  text: string,
  attachmentIds: string[] = [],
  replyTo?: string
): Promise<{ note_id: string; attachments: AttachmentRef[] }> {
  return await postJson(
    `/rooms/${session.room_id}/orbit/notes`,
    session.token,
    { text, attachment_ids: attachmentIds, reply_to: replyTo }
  );
}

export async function likeOrbitNote(
  session: RoomSession,
  noteId: string
): Promise<{ liked: boolean; count: number }> {
  return await postJson(
    `/rooms/${session.room_id}/orbit/notes/${noteId}/like`,
    session.token,
    {}
  );
}

export async function unlikeOrbitNote(
  session: RoomSession,
  noteId: string
): Promise<{ liked: boolean; count: number }> {
  return await fetch(`/rooms/${session.room_id}/orbit/notes/${noteId}/like`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${session.token}` },
  }).then((r) => r.json());
}

export async function promoteOrbitNotes(
  session: RoomSession,
  noteIds: string[],
  attachmentIds: string[] = [],
  instruction = ""
): Promise<{
  input_id: string;
  status: string;
  note_count: number;
  attachment_count: number;
}> {
  return await postJson(
    `/rooms/${session.room_id}/orbit/promote`,
    session.token,
    {
      note_ids: noteIds,
      attachment_ids: attachmentIds,
      instruction,
    }
  );
}

export async function clearOrbit(session: RoomSession): Promise<{ ok: true }> {
  return await postJson(
    `/rooms/${session.room_id}/orbit/clear`,
    session.token,
    {}
  );
}

export class WhiteboardOperationError extends Error {
  constructor(
    readonly code: string,
    readonly currentRevision?: number
  ) {
    super(code);
    this.name = "WhiteboardOperationError";
  }
}

async function whiteboardJson<T>(
  response: Response,
  parse: (value: unknown) => T
) {
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const error = value as { error?: unknown; current_revision?: unknown };
    throw new WhiteboardOperationError(
      typeof error.error === "string"
        ? error.error
        : "whiteboard_operation_failed",
      typeof error.current_revision === "number"
        ? error.current_revision
        : undefined
    );
  }
  return parse(value);
}

export async function fetchWhiteboardSnapshots(
  session: RoomSession
): Promise<WhiteboardSnapshotList> {
  const response = await fetch(
    `/rooms/${session.room_id}/whiteboard/snapshots`,
    { headers: { authorization: `Bearer ${session.token}` } }
  );
  return whiteboardJson(response, (value) =>
    WhiteboardSnapshotListSchema.parse(value)
  );
}

async function mutateWhiteboard(
  session: RoomSession,
  path: string,
  expectedRevision: number
): Promise<WhiteboardSnapshotMutationResult> {
  const response = await fetch(`/rooms/${session.room_id}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
  return whiteboardJson(response, (value) =>
    WhiteboardSnapshotMutationResultSchema.parse(value)
  );
}

export function clearWhiteboard(
  session: RoomSession,
  expectedRevision: number
): Promise<WhiteboardSnapshotMutationResult> {
  return mutateWhiteboard(session, "/whiteboard/clear", expectedRevision);
}

export function restoreWhiteboardSnapshot(
  session: RoomSession,
  snapshotId: string,
  expectedRevision: number
): Promise<WhiteboardSnapshotMutationResult> {
  return mutateWhiteboard(
    session,
    `/whiteboard/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    expectedRevision
  );
}

export async function promoteWhiteboardSelection(
  session: RoomSession,
  request: WhiteboardPromotionRequest,
  options: { signal?: AbortSignal } = {}
): Promise<WhiteboardPromotionResult> {
  const response = await fetch(
    `/rooms/${session.room_id}/whiteboard/promotions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(request),
      signal: options.signal,
    }
  );
  return whiteboardJson(response, (value) =>
    WhiteboardPromotionResultSchema.parse(value)
  );
}

export async function sendMainInput(
  session: RoomSession,
  text: string,
  attachmentIds: string[] = []
): Promise<{ input_id: string; status: string }> {
  return await postJson(
    `/rooms/${session.room_id}/main-inputs`,
    session.token,
    { text, attachment_ids: attachmentIds }
  );
}

export async function cancelMainInput(
  session: RoomSession,
  inputId: string
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/main-inputs/${inputId}/cancel`,
    session.token,
    {}
  );
}

export async function requestConnectorSnapshot(
  session: RoomSession,
  sinceSequence = 0
): Promise<{ request_id: string }> {
  const response = await fetch(
    `/rooms/${session.room_id}/connector-snapshots`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ since_sequence: sinceSequence }),
    }
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as { request_id: string };
}

export async function fetchRoomEvents(
  session: RoomSession
): Promise<CacpEvent[]> {
  const response = await fetch(`/rooms/${session.room_id}/events`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new Error(await response.text());
  const body = (await response.json()) as { events: CacpEvent[] };
  return body.events;
}

export async function sendCollaborationDiagnostics(
  session: RoomSession,
  batch: CollaborationDiagnosticBatch
): Promise<void> {
  const response = await fetch(`/rooms/${session.room_id}/diagnostics`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify(batch),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`diagnostics_${response.status}`);
}

export async function leaveRoom(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/leave`, session.token, {});
}

export type ParticipantPresence = "online" | "idle" | "offline";

export interface VoiceJoinCredentials {
  server_url: string;
  participant_token: string;
  can_publish: boolean;
  expires_in: number;
}

export async function createVoiceJoinCredentials(
  session: RoomSession
): Promise<VoiceJoinCredentials> {
  return await postJson(
    `/rooms/${session.room_id}/voice/token`,
    session.token,
    {}
  );
}

export async function updatePresence(
  session: RoomSession,
  presence: ParticipantPresence
): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/presence`, session.token, {
    presence,
  });
}

export async function startTyping(session: RoomSession): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/activity/typing/start`,
    session.token,
    {}
  );
}

export async function stopTyping(session: RoomSession): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/activity/typing/stop`,
    session.token,
    {}
  );
}

export async function selectAgent(
  session: RoomSession,
  agentId: string
): Promise<void> {
  await postJson(`/rooms/${session.room_id}/agents/select`, session.token, {
    agent_id: agentId,
  });
}

export async function updateAgentThinking(
  session: RoomSession,
  agentId: string,
  thinkingEnabled: boolean
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/agents/${agentId}/thinking`,
    session.token,
    { thinking_enabled: thinkingEnabled }
  );
}

export async function selectClaudeSession(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  mode: "fresh" | "resume";
  sessionId?: string;
}): Promise<{ ok: true }> {
  const response = await fetch(
    `${input.serverUrl}/rooms/${input.roomId}/claude/session-selection`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        agent_id: input.agentId,
        mode: input.mode,
        ...(input.mode === "resume" ? { session_id: input.sessionId } : {}),
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as { ok: true };
}

export async function requestClaudeSessionPreview(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  sessionId: string;
}): Promise<{ ok: true; preview_id: string }> {
  const response = await fetch(
    `${input.serverUrl}/rooms/${input.roomId}/claude/session-previews`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        agent_id: input.agentId,
        session_id: input.sessionId,
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as { ok: true; preview_id: string };
}

export async function selectAgentSession(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  provider: "claude-code" | "codex-cli" | "github-copilot" | "kimi-cli";
  mode: "fresh" | "resume";
  sessionId?: string;
}): Promise<{ ok: true }> {
  const response = await fetch(
    `${input.serverUrl}/rooms/${input.roomId}/agent-sessions/selection`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        agent_id: input.agentId,
        provider: input.provider,
        mode: input.mode,
        ...(input.mode === "resume" ? { session_id: input.sessionId } : {}),
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as { ok: true };
}

export async function requestAgentSessionPreview(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  provider: "claude-code" | "codex-cli" | "github-copilot" | "kimi-cli";
  sessionId: string;
}): Promise<{ ok: true; preview_id: string }> {
  const response = await fetch(
    `${input.serverUrl}/rooms/${input.roomId}/agent-sessions/previews`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        agent_id: input.agentId,
        provider: input.provider,
        session_id: input.sessionId,
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as { ok: true; preview_id: string };
}

export async function resolveAgentRunApproval(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  runId: string;
  nodeId: string;
  decision: "allow" | "deny";
  reason?: string;
}): Promise<{ ok: true; decision: "allow" | "deny" }> {
  const response = await fetch(
    `${input.serverUrl.replace(/\/$/, "")}/rooms/${input.roomId}/agent-runs/${input.runId}/approvals/${input.nodeId}/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as { ok: true; decision: "allow" | "deny" };
}

export async function resolveAgentRunElicitation(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  runId: string;
  nodeId: string;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}): Promise<{ ok: true; action: "accept" | "decline" | "cancel" }> {
  const response = await fetch(
    `${input.serverUrl.replace(/\/$/, "")}/rooms/${input.roomId}/agent-runs/${input.runId}/elicitations/${input.nodeId}/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        action: input.action,
        ...(input.action === "accept" && input.content
          ? { content: input.content }
          : {}),
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`
    );
  return (await response.json()) as {
    ok: true;
    action: "accept" | "decline" | "cancel";
  };
}

export function pairingServerUrlFor(origin: string): string {
  const url = new URL(origin);
  if (
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    (url.port === "5173" || url.port === "3000")
  ) {
    url.port = "3737";
  }
  return url.toString().replace(/\/$/, "");
}

function currentBrowserOrigin(): string {
  return typeof window === "undefined"
    ? "http://localhost:3737"
    : window.location.origin;
}

export interface AgentPairingResult {
  connection_code: string;
  expires_at: string;
  download_url: string;
}

export async function createAgentPairing(
  session: RoomSession,
  input: AgentSetupInput
): Promise<AgentPairingResult> {
  return await postJson(
    `/rooms/${session.room_id}/agent-pairings`,
    session.token,
    {
      agent_type: input.agent_type,
      permission_level: input.permission_level,
      server_url: pairingServerUrlFor(currentBrowserOrigin()),
    }
  );
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

export async function verifyInvite(
  inviteToken: string
): Promise<{ valid: true } | { valid: false; reason: string }> {
  const response = await fetch(
    `/invites/verify?token=${encodeURIComponent(inviteToken)}`
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as
    { valid: true } | { valid: false; reason: string };
}

export async function createJoinRequest(
  roomId: string,
  inviteToken: string,
  displayName: string
): Promise<JoinRequestResult> {
  return await postJson(`/rooms/${roomId}/join-requests`, undefined, {
    invite_token: inviteToken,
    display_name: displayName,
  });
}

export async function joinRequestStatus(
  roomId: string,
  requestId: string,
  requestToken: string
): Promise<JoinRequestStatus> {
  const response = await fetch(
    `/rooms/${roomId}/join-requests/${requestId}?request_token=${encodeURIComponent(requestToken)}`
  );
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as JoinRequestStatus;
}

export async function approveJoinRequest(
  session: RoomSession,
  requestId: string
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/join-requests/${requestId}/approve`,
    session.token,
    {}
  );
}

export async function rejectJoinRequest(
  session: RoomSession,
  requestId: string
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/join-requests/${requestId}/reject`,
    session.token,
    {}
  );
}

export async function removeParticipant(
  session: RoomSession,
  participantId: string
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/participants/${participantId}/remove`,
    session.token,
    {}
  );
}

export async function updateParticipantRole(
  session: RoomSession,
  participantId: string,
  role: string
): Promise<void> {
  await postJson(
    `/rooms/${session.room_id}/participants/${participantId}/role`,
    session.token,
    { role }
  );
}

export async function createLocalAgentLaunch(
  session: RoomSession,
  input: AgentSetupInput
): Promise<LocalAgentLaunch> {
  return await postJson(
    `/rooms/${session.room_id}/agent-pairings/start-local`,
    session.token,
    {
      agent_type: input.agent_type,
      permission_level: input.permission_level,
      server_url: pairingServerUrlFor(currentBrowserOrigin()),
    }
  );
}

export function inviteUrlFor(
  origin: string,
  roomId: string,
  inviteToken: string
): string {
  const url = new URL("/join", origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("token", inviteToken);
  return url.toString();
}

export async function getRoomMe(session: RoomSession): Promise<{
  room_id: string;
  name: string;
  role: RoomSession["role"];
  participant_id: string;
}> {
  const response = await fetch(`/rooms/${session.room_id}/me`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as {
    room_id: string;
    name: string;
    role: RoomSession["role"];
    participant_id: string;
  };
}

export function parseInviteUrl(
  search: string
): { room_id: string; invite_token: string } | undefined {
  const params = new URLSearchParams(search);
  const roomId = params.get("room");
  const inviteToken = params.get("token");
  return roomId && inviteToken
    ? { room_id: roomId, invite_token: inviteToken }
    : undefined;
}

export function parseCacpEventMessage(data: string): CacpEvent | undefined {
  try {
    const parsed = CacpEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export interface EventStreamConnection {
  close(): void;
}

export function clearEventSocket(
  socket: WebSocket | EventStreamConnection
): void {
  if (!("readyState" in socket)) {
    socket.close();
    return;
  }
  if (socket.readyState === 0) {
    socket.addEventListener("open", () => socket.close(), { once: true });
    return;
  }
  if (socket.readyState === 1) socket.close();
}

export function connectEvents(
  session: RoomSession,
  onEvent: (event: CacpEvent) => void,
  onClose?: (code: number, reason: string) => void,
  diagnostics?: import("./collaboration-diagnostics.js").CollaborationDiagnostics
): EventStreamConnection {
  const url = new URL(
    `/rooms/${session.room_id}/stream`,
    window.location.origin
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);

  const reconnectDelaysMs = [500, 1_000, 2_000, 5_000, 10_000];
  const terminalReasons = new Set([
    "invalid_token",
    "owner_left_room",
    "participant_removed",
    "room_ended",
  ]);
  let activeSocket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let connectionGeneration = 0;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    if (activeSocket) clearEventSocket(activeSocket);
    activeSocket = undefined;
  };

  const open = (): void => {
    if (stopped) return;
    connectionGeneration += 1;
    diagnostics?.record({
      area: "room_stream",
      action: "stream_connecting",
      connection_generation: connectionGeneration,
      reconnect_attempt: reconnectAttempt,
    });
    const socket = new WebSocket(url);
    activeSocket = socket;
    socket.addEventListener("open", () => {
      if (activeSocket === socket) {
        diagnostics?.record({
          area: "room_stream",
          action: "stream_opened",
          connection_generation: connectionGeneration,
          reconnect_attempt: reconnectAttempt,
        });
        reconnectAttempt = 0;
      }
    });
    socket.addEventListener("message", (message) => {
      if (typeof message.data !== "string") return;
      const parsed = parseCacpEventMessage(message.data);
      if (parsed) {
        if (!parsed.type.endsWith(".delta")) {
          const createdAt = Date.parse(parsed.created_at);
          diagnostics?.record({
            area: parsed.type.startsWith("orbit.") ? "orbit" : "room_stream",
            action: "event_received",
            connection_generation: connectionGeneration,
            event_type: parsed.type,
            event_id: parsed.event_id,
            ...(Number.isFinite(createdAt)
              ? { source_age_ms: Math.max(0, Date.now() - createdAt) }
              : {}),
          });
        }
        onEvent(parsed);
        return;
      }
      try {
        const envelope = JSON.parse(message.data) as { error?: unknown };
        if (
          typeof envelope.error === "string" &&
          terminalReasons.has(envelope.error)
        ) {
          stopped = true;
          onClose?.(4001, envelope.error);
          clearEventSocket(socket);
        }
      } catch {
        // Ignore non-protocol frames and keep the stream alive.
      }
    });
    socket.addEventListener("close", (event) => {
      if (activeSocket === socket) activeSocket = undefined;
      if (stopped) return;
      diagnostics?.record({
        area: "room_stream",
        action: "stream_closed",
        connection_generation: connectionGeneration,
        close_code: event.code,
        ...(/^[A-Za-z0-9._:-]{1,80}$/u.test(event.reason)
          ? { reason: event.reason }
          : {}),
      });
      onClose?.(event.code, event.reason);
      if (event.code === 4001 || terminalReasons.has(event.reason)) {
        stopped = true;
        return;
      }
      const delay =
        reconnectDelaysMs[
          Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)
        ]!;
      reconnectAttempt += 1;
      diagnostics?.record({
        area: "room_stream",
        action: "stream_reconnect_scheduled",
        connection_generation: connectionGeneration,
        reconnect_attempt: reconnectAttempt,
        retry_delay_ms: delay,
      });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        open();
      }, delay);
    });
  };

  open();
  return { close: stop };
}
