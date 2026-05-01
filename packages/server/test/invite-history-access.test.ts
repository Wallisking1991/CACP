import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { cloudTestConfig } from "./test-config.js";

async function owner(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

describe("invite-derived history access", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("defaults member invite to allowed and observer to denied", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const room = await owner(app);

    const memberInvite = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", expires_in_seconds: 3600 }
    });
    expect(memberInvite.statusCode).toBe(201);
    expect(memberInvite.json()).toMatchObject({ main_thread_history_access: "allowed" });

    const observerInvite = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "observer", expires_in_seconds: 3600 }
    });
    expect(observerInvite.statusCode).toBe(201);
    expect(observerInvite.json()).toMatchObject({ main_thread_history_access: "denied" });
  });

  it("accepts explicit main_thread_history_access on invite creation", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const room = await owner(app);

    const deniedMember = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", main_thread_history_access: "denied", expires_in_seconds: 3600 }
    });
    expect(deniedMember.statusCode).toBe(201);
    expect(deniedMember.json()).toMatchObject({ main_thread_history_access: "denied" });

    const allowedObserver = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "observer", main_thread_history_access: "allowed", expires_in_seconds: 3600 }
    });
    expect(allowedObserver.statusCode).toBe(201);
    expect(allowedObserver.json()).toMatchObject({ main_thread_history_access: "allowed" });
  });

  it("copies main_thread_history_access to join request and approved status", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const room = await owner(app);

    const inviteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", main_thread_history_access: "denied", expires_in_seconds: 3600 }
    });
    const invite = inviteRes.json() as { invite_token: string };

    const pending = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: invite.invite_token, display_name: "Alice" }
    });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string; request_token: string; main_thread_history_access: string };
    expect(request.main_thread_history_access).toBe("denied");

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(approved.statusCode).toBe(201);

    const afterApproval = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    expect(afterApproval.json()).toMatchObject({ main_thread_history_access: "denied" });
  });

  it("returns main_thread_history_access from /rooms/:roomId/me", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudTestConfig() });
    const room = await owner(app);

    const inviteRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member", main_thread_history_access: "denied", expires_in_seconds: 3600 }
    });
    const invite = inviteRes.json() as { invite_token: string };

    const pending = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: invite.invite_token, display_name: "Alice" }
    });
    const request = pending.json() as { request_id: string; request_token: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });

    const status = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    const { participant_token } = status.json() as { participant_token: string };

    const me = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/me`,
      headers: { authorization: `Bearer ${participant_token}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ main_thread_history_access: "denied" });
  });
});
