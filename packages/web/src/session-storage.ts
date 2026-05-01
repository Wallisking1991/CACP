import type { RoomSession } from "./api.js";

const SESSIONS_STORAGE_KEY = "cacp.sessions";

type SessionStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type InviteTarget = { room_id: string; invite_token: string } | undefined;

const ROOM_ROLES = ["owner", "admin", "member", "observer", "agent"] satisfies RoomSession["role"][];

function isRoomSession(value: unknown): value is RoomSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoomSession>;
  return typeof candidate.room_id === "string" && candidate.room_id.length > 0
    && typeof candidate.token === "string" && candidate.token.length > 0
    && typeof candidate.participant_id === "string" && candidate.participant_id.length > 0
    && typeof candidate.role === "string" && ROOM_ROLES.includes(candidate.role as RoomSession["role"]);
}

export function loadAllSessions(storage: SessionStorageLike): Record<string, RoomSession> {
  try {
    const raw = storage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      clearAllSessions(storage);
      return {};
    }
    const valid: Record<string, RoomSession> = {};
    for (const [roomId, session] of Object.entries(parsed)) {
      if (isRoomSession(session)) {
        valid[roomId] = session;
      }
    }
    return valid;
  } catch {
    clearAllSessions(storage);
    return {};
  }
}

export function saveAllSessions(storage: SessionStorageLike, sessions: Record<string, RoomSession>): void {
  storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

function clearAllSessions(storage: SessionStorageLike): void {
  storage.removeItem(SESSIONS_STORAGE_KEY);
}

export function loadStoredSession(storage: SessionStorageLike, roomId: string): RoomSession | undefined {
  const sessions = loadAllSessions(storage);
  return sessions[roomId];
}

export function saveStoredSession(storage: SessionStorageLike, session: RoomSession): void {
  const sessions = loadAllSessions(storage);
  sessions[session.room_id] = session;
  saveAllSessions(storage, sessions);
}

export function clearStoredSession(storage: SessionStorageLike, roomId?: string): void {
  if (roomId) {
    const sessions = loadAllSessions(storage);
    delete sessions[roomId];
    saveAllSessions(storage, sessions);
  } else {
    clearAllSessions(storage);
  }
}

export function loadInitialSession(storage: SessionStorageLike, inviteTarget: InviteTarget): RoomSession | undefined {
  if (inviteTarget) return undefined;
  const sessions = loadAllSessions(storage);
  const roomIds = Object.keys(sessions);
  if (roomIds.length === 0) return undefined;
  return sessions[roomIds[0]];
}
