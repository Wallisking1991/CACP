import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { cancelAiCollection, clearEventSocket, clearRoom, createLocalAgentLaunch, createRoom, joinRoom, pairingServerUrlFor, parseCacpEventMessage, startAiCollection, submitAiCollection, type RoomSession } from "../src/api.js";

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

  it("defers closing connecting event sockets until they open", () => {
    const close = vi.fn();
    let openHandler: (() => void) | undefined;
    const socket = {
      readyState: 0,
      close,
      addEventListener: vi.fn((event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === "open") openHandler = handler as () => void;
      })
    };

    clearEventSocket(socket as unknown as WebSocket);

    expect(close).not.toHaveBeenCalled();
    expect(socket.addEventListener).toHaveBeenCalledWith("open", expect.any(Function), { once: true });
    openHandler?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes open event sockets immediately", () => {
    const socket = {
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn()
    };

    clearEventSocket(socket as unknown as WebSocket);

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.addEventListener).not.toHaveBeenCalled();
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
    expect(fetch).toHaveBeenCalledWith("/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Planning", display_name: "Owner" })
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

  it("starts local agent launches through the local pairing endpoint", async () => {
    mockJsonResponse({ launch_id: "launch_1", status: "starting", command: "corepack pnpm ..." });
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    await expect(createLocalAgentLaunch(session, { agent_type: "claude-code", permission_level: "read_only", working_dir: "D:\\Development\\2" })).resolves.toMatchObject({
      launch_id: "launch_1",
      status: "starting"
    });

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/agent-pairings/start-local", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ agent_type: "claude-code", permission_level: "read_only", working_dir: "D:\\Development\\2", server_url: "http://localhost:3737" })
    });
  });

  it("posts AI collection control requests to the room collection endpoints", async () => {
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    mockJsonResponse({ collection_id: "collection_1" });
    await expect(startAiCollection(session)).resolves.toEqual({ collection_id: "collection_1" });
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/start", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });

    mockJsonResponse({ ok: true });
    await submitAiCollection(session);
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/submit", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });

    mockJsonResponse({ ok: true });
    await cancelAiCollection(session);
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });
  });
});
