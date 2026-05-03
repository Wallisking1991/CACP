import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { clearEventSocket, clearOrbit, createJoinRequest, createLocalAgentLaunch, createRoom, createRoomWithLocalAgent, fetchRoomEvents, getRoomMe, inviteUrlFor, joinRequestStatus, leaveRoom, pairingServerUrlFor, parseCacpEventMessage, requestAgentSessionPreview, requestConnectorSnapshot, selectAgentSession, startTyping, stopTyping, updatePresence, type RoomSession } from "../src/api.js";

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

  function mockErrorResponse(message: string): void {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      text: async () => message
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

  it("creates a join request and polls its status", async () => {
    mockJsonResponse({ request_id: "req_1", request_token: "req_secret", status: "pending", expires_at: "2026-04-27T16:30:00.000Z" });

    await expect(createJoinRequest("room_1", "invite_secret", "Member")).resolves.toEqual({
      request_id: "req_1",
      request_token: "req_secret",
      status: "pending",
      expires_at: "2026-04-27T16:30:00.000Z"
    });
    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/join-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite_token: "invite_secret", display_name: "Member" })
    });

    mockJsonResponse({ status: "approved", participant_id: "user_2", participant_token: "member_secret", role: "member" });
    await expect(joinRequestStatus("room_1", "req_1", "req_secret")).resolves.toEqual({
      status: "approved",
      participant_id: "user_2",
      participant_token: "member_secret",
      role: "member"
    });
  });

  it("posts owner leave requests to the room leave endpoint", async () => {
    mockJsonResponse({ ok: true, status: "room_closed" });
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    await leaveRoom(session);

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/leave", {
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

  it("creates a room and starts the configured local agent in one setup flow", async () => {
    mockJsonResponse({ room_id: "room_1", owner_id: "user_owner", owner_token: "owner_secret" });
    mockJsonResponse({ launch_id: "launch_1", status: "starting", command: "corepack pnpm ..." });

    await expect(createRoomWithLocalAgent("Planning", "Owner", {
      agent_type: "claude-code",
      permission_level: "full_access",
      working_dir: "D:\\Development\\2"
    })).resolves.toEqual({
      session: { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" },
      launch: { launch_id: "launch_1", status: "starting", command: "corepack pnpm ..." }
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Planning", display_name: "Owner" })
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/rooms/room_1/agent-pairings/start-local", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ agent_type: "claude-code", permission_level: "full_access", working_dir: "D:\\Development\\2", server_url: "http://localhost:3737" })
    });
  });

  it("keeps the created room session when automatic local agent startup fails", async () => {
    mockJsonResponse({ room_id: "room_1", owner_id: "user_owner", owner_token: "owner_secret" });
    mockErrorResponse("local agent failed");

    await expect(createRoomWithLocalAgent("Planning", "Owner", {
      agent_type: "claude-code",
      permission_level: "read_only",
      working_dir: "D:\\Development\\2"
    })).resolves.toEqual({
      session: { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" },
      launch_error: "local agent failed"
    });
  });

  it("posts participant activity requests", async () => {
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };

    mockJsonResponse({ ok: true, event_type: "participant.presence_changed" });
    await updatePresence(session, "idle");
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/activity/presence", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ presence: "idle" })
    });

    mockJsonResponse({ ok: true, event_type: "participant.typing_started" });
    await startTyping(session);
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/activity/typing/start", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });

    mockJsonResponse({ ok: true, event_type: "participant.typing_stopped" });
    await stopTyping(session);
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/activity/typing/stop", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });
  });

  it("posts generic agent session selection to the provider-neutral endpoint", async () => {
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };
    mockJsonResponse({ ok: true });

    await expect(selectAgentSession({
      serverUrl: "http://server",
      roomId: "room_1",
      token: "owner_secret",
      agentId: "agent_1",
      provider: "codex-cli",
      mode: "resume",
      sessionId: "session_1"
    })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith(
      "http://server/rooms/room_1/agent-sessions/selection",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agent_id: "agent_1",
          provider: "codex-cli",
          mode: "resume",
          session_id: "session_1"
        })
      })
    );
  });

  it("posts generic agent session preview request to the provider-neutral endpoint", async () => {
    mockJsonResponse({ ok: true, preview_id: "preview_1" });

    await expect(requestAgentSessionPreview({
      serverUrl: "http://server",
      roomId: "room_1",
      token: "owner_secret",
      agentId: "agent_1",
      provider: "codex-cli",
      sessionId: "session_1"
    })).resolves.toEqual({ ok: true, preview_id: "preview_1" });

    expect(fetch).toHaveBeenCalledWith(
      "http://server/rooms/room_1/agent-sessions/previews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agent_id: "agent_1",
          provider: "codex-cli",
          session_id: "session_1"
        })
      })
    );
  });

  it("posts connector snapshot requests to the plural snapshot endpoint with a cursor", async () => {
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };
    mockJsonResponse({ request_id: "snap_1" });

    await expect(requestConnectorSnapshot(session, 7)).resolves.toEqual({ request_id: "snap_1" });

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/connector-snapshots", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ since_sequence: 7 })
    });
  });

  it("clearOrbit posts to the orbit clear endpoint", async () => {
    const session: RoomSession = { room_id: "room_1", token: "token_1", participant_id: "user_1", role: "owner" };
    mockJsonResponse({ ok: true });

    await clearOrbit(session);

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/orbit/clear", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token_1" },
      body: JSON.stringify({})
    });
  });

  it("fetches the room event log via GET /rooms/:roomId/events", async () => {
    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };
    mockJsonResponse({ events: [validEvent], participant: { id: "user_owner" } });

    await expect(fetchRoomEvents(session)).resolves.toEqual([validEvent]);

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/events", {
      headers: { authorization: "Bearer owner_secret" }
    });
  });
});

describe("invite URL", () => {
  it("generates /join path with room and token query params", () => {
    const url = inviteUrlFor("https://cacp.example.com", "room_abc", "invite_xyz");
    expect(url).toBe("https://cacp.example.com/join?room=room_abc&token=invite_xyz");
  });
});

describe("getRoomMe", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches room info with bearer token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ room_id: "room_1", name: "Planning", role: "owner", participant_id: "user_1" })
    } as Response);

    const session: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_1", role: "owner" };
    await expect(getRoomMe(session)).resolves.toEqual({
      room_id: "room_1",
      name: "Planning",
      role: "owner",
      participant_id: "user_1"
    });

    expect(fetch).toHaveBeenCalledWith("/rooms/room_1/me", {
      headers: { authorization: "Bearer owner_secret" }
    });
  });

  it("throws on invalid session", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      text: async () => "invalid_token"
    } as Response);

    const session: RoomSession = { room_id: "room_1", token: "bad_token", participant_id: "user_1", role: "member" };
    await expect(getRoomMe(session)).rejects.toThrow("invalid_token");
  });
});
