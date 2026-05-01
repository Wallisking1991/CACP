import { describe, expect, it, beforeEach } from "vitest";
import type { RoomSession } from "../src/api.js";
import {
  loadAllSessions,
  saveAllSessions,
  loadStoredSession,
  saveStoredSession,
  clearStoredSession,
  loadInitialSession,
} from "../src/session-storage.js";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeSession(roomId: string, overrides: Partial<RoomSession> = {}): RoomSession {
  return {
    room_id: roomId,
    token: `token-${roomId}`,
    participant_id: `pid-${roomId}`,
    role: "member",
    ...overrides,
  };
}

describe("session-storage (multi-session)", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe("loadAllSessions", () => {
    it("returns empty object when storage is empty", () => {
      const result = loadAllSessions(storage);
      expect(result).toEqual({});
    });

    it("returns valid sessions object", () => {
      const sessions: Record<string, RoomSession> = {
        roomA: makeSession("roomA"),
        roomB: makeSession("roomB", { role: "owner" }),
      };
      storage.setItem("cacp.sessions", JSON.stringify(sessions));
      const result = loadAllSessions(storage);
      expect(result).toEqual(sessions);
    });

    it("clears corrupt data and returns empty object", () => {
      storage.setItem("cacp.sessions", "not-json");
      const result = loadAllSessions(storage);
      expect(result).toEqual({});
      expect(storage.getItem("cacp.sessions")).toBeNull();
    });

    it("clears non-object data and returns empty object", () => {
      storage.setItem("cacp.sessions", JSON.stringify("string"));
      const result = loadAllSessions(storage);
      expect(result).toEqual({});
      expect(storage.getItem("cacp.sessions")).toBeNull();
    });

    it("filters out invalid session entries", () => {
      const sessions = {
        roomA: makeSession("roomA"),
        roomB: { room_id: "roomB" },
        roomC: makeSession("roomC"),
      };
      storage.setItem("cacp.sessions", JSON.stringify(sessions));
      const result = loadAllSessions(storage);
      expect(Object.keys(result)).toEqual(["roomA", "roomC"]);
    });
  });

  describe("saveAllSessions", () => {
    it("writes sessions to storage", () => {
      const sessions = { roomA: makeSession("roomA") };
      saveAllSessions(storage, sessions);
      expect(storage.getItem("cacp.sessions")).toEqual(JSON.stringify(sessions));
    });
  });

  describe("loadStoredSession (by roomId)", () => {
    it("returns session for specific roomId", () => {
      const session = makeSession("roomX");
      storage.setItem("cacp.sessions", JSON.stringify({ roomX: session }));
      const result = loadStoredSession(storage, "roomX");
      expect(result).toEqual(session);
    });

    it("returns undefined for unknown roomId", () => {
      storage.setItem("cacp.sessions", JSON.stringify({ roomA: makeSession("roomA") }));
      const result = loadStoredSession(storage, "roomZ");
      expect(result).toBeUndefined();
    });

    it("returns undefined when storage is empty", () => {
      const result = loadStoredSession(storage, "roomA");
      expect(result).toBeUndefined();
    });
  });

  describe("saveStoredSession", () => {
    it("adds session without overwriting others", () => {
      saveStoredSession(storage, makeSession("roomA"));
      saveStoredSession(storage, makeSession("roomB"));
      const all = loadAllSessions(storage);
      expect(Object.keys(all)).toEqual(["roomA", "roomB"]);
    });

    it("overwrites existing session for same room", () => {
      saveStoredSession(storage, makeSession("roomA"));
      saveStoredSession(storage, makeSession("roomA", { token: "updated-token" }));
      const result = loadStoredSession(storage, "roomA");
      expect(result?.token).toBe("updated-token");
    });
  });

  describe("clearStoredSession", () => {
    it("removes specific room session while keeping others", () => {
      saveStoredSession(storage, makeSession("roomA"));
      saveStoredSession(storage, makeSession("roomB"));
      clearStoredSession(storage, "roomA");
      const all = loadAllSessions(storage);
      expect(Object.keys(all)).toEqual(["roomB"]);
    });

    it("is a no-op for unknown roomId", () => {
      saveStoredSession(storage, makeSession("roomA"));
      clearStoredSession(storage, "roomZ");
      const all = loadAllSessions(storage);
      expect(Object.keys(all)).toEqual(["roomA"]);
    });
  });

  describe("loadInitialSession", () => {
    it("ignores stored sessions when invite target is present", () => {
      saveStoredSession(storage, makeSession("room_host", { role: "owner" }));

      const result = loadInitialSession(storage, { room_id: "room_invited", invite_token: "invite_token" });
      expect(result).toBeUndefined();
    });

    it("returns stored session when no invite target and URL matches", () => {
      const hostSession = makeSession("room_host", { role: "owner" });
      saveStoredSession(storage, hostSession);

      const result = loadInitialSession(storage, undefined);
      expect(result).toEqual(hostSession);
    });

    it("returns undefined when no invite target and no stored sessions", () => {
      const result = loadInitialSession(storage, undefined);
      expect(result).toBeUndefined();
    });
  });
});
