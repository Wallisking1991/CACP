import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { VoiceService } from "../src/voice-service.js";
import { localTestConfig } from "./test-config.js";

function fakeVoiceService(): VoiceService {
  return {
    createJoinCredentials: vi.fn(async (_roomId, participant) => ({
      server_url: "wss://rtc.example.com",
      participant_token: "short-lived-token",
      can_publish: participant.role !== "observer",
      expires_in: 300,
    })),
    removeParticipant: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
  };
}

async function createRoom(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Voice room", display_name: "Owner" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    room_id: string;
    owner_id: string;
    owner_token: string;
  };
}

async function joinParticipant(
  app: FastifyInstance,
  room: Awaited<ReturnType<typeof createRoom>>,
  role: "member" | "observer"
) {
  const invite = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/invites`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { role },
  });
  const pending = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/join-requests`,
    payload: {
      invite_token: invite.json().invite_token,
      display_name: "Alice",
    },
  });
  const request = pending.json() as {
    request_id: string;
    request_token: string;
  };
  await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: {},
  });
  const status = await app.inject({
    method: "GET",
    url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`,
  });
  return status.json() as {
    participant_id: string;
    participant_token: string;
  };
}

describe("voice token route", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("authenticates a human and returns uncached credentials", async () => {
    const voiceService = fakeVoiceService();
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      voiceService,
    });
    const room = await createRoom(app);
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/voice/token`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      server_url: "wss://rtc.example.com",
      can_publish: true,
      expires_in: 300,
    });
    expect(voiceService.createJoinCredentials).toHaveBeenCalledWith(
      room.room_id,
      expect.objectContaining({ id: room.owner_id, role: "owner" })
    );
  });

  it("returns a safe unavailable response when voice is not configured", async () => {
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
    });
    const room = await createRoom(app);
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/voice/token`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "voice_unavailable" });
  });

  it("refreshes voice permissions when a participant role changes", async () => {
    const voiceService = fakeVoiceService();
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      voiceService,
    });
    const room = await createRoom(app);
    const joined = await joinParticipant(app, room, "member");
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "observer" },
    });

    expect(response.statusCode).toBe(201);
    expect(voiceService.removeParticipant).toHaveBeenCalledWith(
      room.room_id,
      joined.participant_id
    );
  });

  it("disconnects removed participants and deletes voice with the room", async () => {
    const voiceService = fakeVoiceService();
    app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      voiceService,
    });
    const room = await createRoom(app);
    const joined = await joinParticipant(app, room, "member");
    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(removed.statusCode).toBe(201);
    expect(voiceService.removeParticipant).toHaveBeenCalledWith(
      room.room_id,
      joined.participant_id
    );

    const left = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(left.statusCode).toBe(201);
    expect(voiceService.deleteRoom).toHaveBeenCalledWith(room.room_id);
  });
});
