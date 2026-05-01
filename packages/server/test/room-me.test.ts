import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function joinViaApproval(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string, inviteToken: string, displayName: string) {
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteToken, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${ownerToken}` }, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  return status.json() as { participant_id: string; participant_token: string; role: string };
}

describe("GET /rooms/:roomId/me", () => {
  it("returns room info for the owner", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Planning", display_name: "Alice" } })).json() as { room_id: string; owner_token: string; owner_id: string };

    const response = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      room_id: room.room_id,
      name: "Planning",
      role: "owner",
      participant_id: room.owner_id,
    });

    await app.close();
  });

  it("returns room info for an approved member", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Dev", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Bob");

    const response = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${joined.participant_token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      room_id: room.room_id,
      name: "Dev",
      role: "member",
      participant_id: joined.participant_id,
    });

    await app.close();
  });

  it("returns 401 for an invalid token", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Alice" } })).json() as { room_id: string; owner_token: string };

    const response = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: "Bearer bad_token" }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 when no authorization header is provided", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Alice" } })).json() as { room_id: string };

    const response = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for a removed participant", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Alice" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Bob");

    // Owner removes Bob
    const remove = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(remove.statusCode).toBe(201);

    // Bob tries to access /me
    const response = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${joined.participant_token}` }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
