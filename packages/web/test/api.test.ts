import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { approveAiCollectionRequest, cancelAiCollection, clearEventSocket, clearRoom, createJoinRequest, createLocalAgentLaunch, createRoom, createRoomWithLocalAgent, getRoomMe, inviteUrlFor, joinRequestStatus, leaveRoom, pairingServerUrlFor, parseCacpEventMessage, rejectAiCollectionRequest, requestAiCollection, startAiCollection, startTyping, stopTyping, submitAiCollection, updatePresence, type RoomSession } from "../src/api.js";

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

  it("posts Roundtable request lifecycle calls to the collection request endpoints", async () => {
    const session: RoomSession = { room_id: "room_1", token: "member_secret", participant_id: "user_member", role: "member" };
    mockJsonResponse({ request_id: "collection_request_1", requested_by: "user_member", status: "pending" });
    await expect(requestAiCollection(session)).resolves.toEqual({ request_id: "collection_request_1", requested_by: "user_member", status: "pending" });
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/request", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer member_secret" },
      body: JSON.stringify({})
    });

    const owner: RoomSession = { room_id: "room_1", token: "owner_secret", participant_id: "user_owner", role: "owner" };
    mockJsonResponse({ ok: true, collection_id: "collection_1", request_id: "collection_request_1" });
    await expect(approveAiCollectionRequest(owner, "collection_request_1")).resolves.toEqual({ ok: true, collection_id: "collection_1", request_id: "collection_request_1" });
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/requests/collection_request_1/approve", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
    });

    mockJsonResponse({ ok: true, request_id: "collection_request_1" });
    await rejectAiCollectionRequest(owner, "collection_request_1");
    expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/requests/collection_request_1/reject", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({})
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
