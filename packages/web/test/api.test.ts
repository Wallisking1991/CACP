import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { cancelDecision, clearRoom, createRoom, joinRoom, pairingServerUrlFor, parseCacpEventMessage, type RoomSession } from "../src/api.js";

const validEvent = {
  protocol: "cacp",
  version: "0.1.0",
  event_id: "evt_1",
  room_id: "room_1",
  type: "message.created",
  actor_id: "user_1",
  created_at: "2026-04-25T00:00:00.000Z",
  payload: { text: "hello" }
} satisfies CacpEvent;

describe("API event parsing", () => {
  it("returns a valid event from websocket message data", () => {
    expect(parseCacpEventMessage(JSON.stringify(validEvent))).toEqual(validEvent);
  });

  it("returns undefined for malformed JSON without throwing", () => {
    expect(() => parseCacpEventMessage("not json")).not.toThrow();
    expect(parseCacpEventMessage("not json")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a CACP event", () => {
    expect(parseCacpEventMessage(JSON.stringify({ hello: "world" }))).toBeUndefined();
  });

  it("points generated local adapter commands at the API server when running through Vite dev server", () => {
    expect(pairingServerUrlFor("http://127.0.0.1:5173")).toBe("http://127.0.0.1:3737");
    expect(pairingServerUrlFor("http://localhost:5173")).toBe("http://localhost:3737");
    expect(pairingServerUrlFor("https://cacp.example.com")).toBe("https://cacp.example.com");
  });
});

describe("room API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(body: unknown): void {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => body
    } as Response);
  }

  it("maps created rooms to an owner room session", async () => {
    mockJsonResponse({ room_id: "room_1", owner_id: "user_owner", owner_token: "owner_secret" });

    await expect(createRoom("Planning", "Owner")).resolves.toEqual({
      room_id: "room_1",
      token: "owner_secret",
      participant_id: "user_owner",
      role: "owner"
    });
  });

  it("maps joined rooms to the participant room session returned by the server", async () => {
    mockJsonResponse({ participant_id: "user_2", participant_token: "member_secret", role: "member" });

    await expect(joinRoom("room_1", "invite_secret", "Member")).resolves.toEqual({
      room_id: "room_1",
      token: "member_secret",
      participant_id: "user_2",
      role: "member"
    });
  });

  it("posts clear room requests to the room history endpoint", async () => {
    mockJsonResponse({});
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    await clearRoom(session);

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/history/clear", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });
  });

  it("posts cancel decision requests with a reason", async () => {
    mockJsonResponse({});
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    await cancelDecision(session, "dec_1", "Skipped by owner");

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/decisions/dec_1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ reason: "Skipped by owner" })
    });
  });
});
