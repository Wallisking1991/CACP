import type { RoomSession } from "./api.js";

const SESSION_STORAGE_KEY = "cacp.roomSession";

type SessionStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type InviteTarget = { room_id: string; invite_token: string } | undefined;

function isRoomSession(value: unknown): value is RoomSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoomSession>;
  return typeof candidate.room_id === "string" && candidate.room_id.length > 0
    && typeof candidate.token === "string" && candidate.token.length > 0;
}

export function loadStoredSession(storage: SessionStorageLike): RoomSession | undefined {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (isRoomSession(parsed)) return parsed;
  } catch {
    // Fall through and clear corrupt or inaccessible stored state.
  }
  clearStoredSession(storage);
  return undefined;
}

export function loadInitialSession(storage: SessionStorageLike, inviteTarget: InviteTarget): RoomSession | undefined {
  if (inviteTarget) return undefined;
  return loadStoredSession(storage);
}

export function saveStoredSession(storage: SessionStorageLike, session: RoomSession): void {
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(storage: SessionStorageLike): void {
  storage.removeItem(SESSION_STORAGE_KEY);
}
