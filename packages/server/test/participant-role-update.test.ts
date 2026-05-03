import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function joinViaApproval(app: FastifyInstance, roomId: string, ownerToken: string, inviteToken: string, displayName: string) {
  const pending = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests`, payload: { invite_token: inviteToken, display_name: displayName } });
  expect(pending.statusCode).toBe(201);
  const request = pending.json() as { request_id: string; request_token: string };
  const approved = await app.inject({ method: "POST", url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`, headers: { authorization: `Bearer ${ownerToken}` }, payload: {} });
  expect(approved.statusCode).toBe(201);
  const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
  expect(status.statusCode).toBe(200);
  return status.json() as { participant_id: string; participant_token: string; role: string };
}

function updateParticipantRole(dbPath: string, roomId: string, participantId: string, role: "admin" | "member" | "observer") {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE participants SET role = ? WHERE room_id = ? AND participant_id = ?").run(role, roomId, participantId);
  } finally {
    db.close();
  }
}

describe("participant role update", () => {
  let app: FastifyInstance | undefined;
  let dbPath: string | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (dbPath) {
      try { rmSync(dbPath, { force: true }); } catch {}
      dbPath = undefined;
    }
  });

  it("lets owner update a member role to admin", async () => {
    dbPath = join(tmpdir(), `role-update-test-${Date.now()}.db`);
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");

    const updated = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "admin" }
    });
    expect(updated.statusCode).toBe(201);
    expect(updated.json().participant.role).toBe("admin");

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: { authorization: `Bearer ${room.owner_token}` } })).json().events;
    const roleEvent = events.find((e: { type: string }) => e.type === "participant.role_updated");
    expect(roleEvent).toBeDefined();
    expect(roleEvent.payload.participant_id).toBe(joined.participant_id);
    expect(roleEvent.payload.old_role).toBe("member");
    expect(roleEvent.payload.new_role).toBe("admin");
  });

  it("prevents changing owner role", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };

    const updated = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${room.owner_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "admin" }
    });
    expect(updated.statusCode).toBe(409);
    expect(updated.json().error).toBe("cannot_change_own_role");
  });

  it("prevents changing another owner role via direct DB", async () => {
    dbPath = join(tmpdir(), `role-update-test-${Date.now()}.db`);
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");

    // Directly set Alice to owner via DB (not possible via API)
    updateParticipantRole(dbPath, room.room_id, joined.participant_id, "owner");

    const updated = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "admin" }
    });
    expect(updated.statusCode).toBe(409);
    expect(updated.json().error).toBe("cannot_change_owner_role");
  });

  it("rejects admin updating roles", async () => {
    dbPath = join(tmpdir(), `role-update-test-${Date.now()}.db`);
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");
    updateParticipantRole(dbPath, room.room_id, joined.participant_id, "admin");

    const updated = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${joined.participant_id}/role`,
      headers: { authorization: `Bearer ${joined.participant_token}` },
      payload: { role: "observer" }
    });
    expect(updated.statusCode).toBe(403);
  });

  it("rejects member updating roles", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");

    const updated = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${room.owner_id}/role`,
      headers: { authorization: `Bearer ${joined.participant_token}` },
      payload: { role: "admin" }
    });
    expect(updated.statusCode).toBe(403);
  });

  it("lets admin approve join requests after role change", async () => {
    dbPath = join(tmpdir(), `role-update-test-${Date.now()}.db`);
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const memberInvite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member", max_uses: 3 } })).json() as { invite_token: string };
    const alice = await joinViaApproval(app, room.room_id, room.owner_token, memberInvite.invite_token, "Alice");

    // Promote Alice to admin via API
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${alice.participant_id}/role`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "admin" }
    });

    // Alice (now admin) creates an invite and approves a join request
    const newInvite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${alice.participant_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const pending = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: newInvite.invite_token, display_name: "Bob" } });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string };

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${alice.participant_token}` },
      payload: {}
    });
    expect(approved.statusCode).toBe(201);
  });

  it("lets admin remove a member but not owner", async () => {
    dbPath = join(tmpdir(), `role-update-test-${Date.now()}.db`);
    app = await buildServer({ dbPath, config: localTestConfig() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
    const memberInvite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member", max_uses: 3 } })).json() as { invite_token: string };
    const alice = await joinViaApproval(app, room.room_id, room.owner_token, memberInvite.invite_token, "Alice");
    const bob = await joinViaApproval(app, room.room_id, room.owner_token, memberInvite.invite_token, "Bob");

    // Promote Alice to admin
    updateParticipantRole(dbPath, room.room_id, alice.participant_id, "admin");

    // Alice (admin) can remove Bob (member)
    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${bob.participant_id}/remove`,
      headers: { authorization: `Bearer ${alice.participant_token}` },
      payload: {}
    });
    expect(removed.statusCode).toBe(201);

    // Alice (admin) cannot remove owner
    const removeOwner = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${room.owner_id}/remove`,
      headers: { authorization: `Bearer ${alice.participant_token}` },
      payload: {}
    });
    expect(removeOwner.statusCode).toBe(409);
    expect(removeOwner.json().error).toBe("cannot_remove_owner");
  });
});
