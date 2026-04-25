import { describe, expect, it } from "vitest";
import type { RoomSession } from "../src/api.js";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "../src/session-storage.js";

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

describe("room session storage", () => {
  it("round-trips a valid room session", () => {
    const storage = new MemoryStorage();
    const session: RoomSession = { room_id: "room_123", token: "cacp_secret" };

    saveStoredSession(storage, session);

    expect(loadStoredSession(storage)).toEqual(session);
  });

  it("clears invalid stored session data", () => {
    const storage = new MemoryStorage();
    storage.setItem("cacp.roomSession", JSON.stringify({ room_id: "", token: "cacp_secret" }));

    expect(loadStoredSession(storage)).toBeUndefined();
    expect(storage.getItem("cacp.roomSession")).toBeNull();
  });

  it("can clear a previously stored session", () => {
    const storage = new MemoryStorage();
    saveStoredSession(storage, { room_id: "room_123", token: "cacp_secret" });

    clearStoredSession(storage);

    expect(loadStoredSession(storage)).toBeUndefined();
  });
});
