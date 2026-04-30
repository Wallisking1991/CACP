import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Activity Room", display_name: "Alice" }
  });
  expect(response.statusCode).toBe(201);
  return { app, created: response.json() as { room_id: string; owner_id: string; owner_token: string } };
}

describe("participant activity routes", () => {
  it("records authenticated presence and typing events for the current participant", async () => {
    const { app, created } = await createRoom();
    const auth = { authorization: `Bearer ${created.owner_token}` };

    const presence = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/activity/presence`,
      headers: auth,
      payload: { presence: "idle", participant_id: "spoofed_user" }
    });
    expect(presence.statusCode).toBe(201);
    expect(presence.json()).toMatchObject({ ok: true, event_type: "participant.presence_changed" });

    const started = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/activity/typing/start`,
      headers: auth,
      payload: {}
    });
    expect(started.statusCode).toBe(201);

    const stopped = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/activity/typing/stop`,
      headers: auth,
      payload: {}
    });
    expect(stopped.statusCode).toBe(201);

    const eventsResponse = await app.inject({ method: "GET", url: `/rooms/${created.room_id}/events`, headers: auth });
    const events = eventsResponse.json().events as Array<{ type: string; actor_id: string; payload: Record<string, unknown> }>;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "participant.presence_changed",
        actor_id: created.owner_id,
        payload: expect.objectContaining({ participant_id: created.owner_id, presence: "idle" })
      }),
      expect.objectContaining({
        type: "participant.typing_started",
        actor_id: created.owner_id,
        payload: expect.objectContaining({ participant_id: created.owner_id, scope: "room" })
      }),
      expect.objectContaining({
        type: "participant.typing_stopped",
        actor_id: created.owner_id,
        payload: expect.objectContaining({ participant_id: created.owner_id, scope: "room" })
      })
    ]));

    await app.close();
  });

  it("rejects invalid tokens and revoked participants", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const invalid = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/activity/typing/start`,
      headers: { authorization: "Bearer invalid" },
      payload: {}
    });
    expect(invalid.statusCode).toBe(401);

    const invite = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member" }
    });
    expect(invite.statusCode).toBe(201);

    const pending = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join-requests`,
      payload: { invite_token: invite.json().invite_token, display_name: "Bob" }
    });
    expect(pending.statusCode).toBe(201);

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join-requests/${pending.json().request_id}/approve`,
      headers: ownerAuth,
      payload: {}
    });
    expect(approved.statusCode).toBe(201);

    const status = await app.inject({
      method: "GET",
      url: `/rooms/${created.room_id}/join-requests/${pending.json().request_id}?request_token=${encodeURIComponent(pending.json().request_token)}`
    });
    expect(status.statusCode).toBe(200);
    const member = status.json() as { participant_id: string; participant_token: string };

    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/participants/${member.participant_id}/remove`,
      headers: ownerAuth,
      payload: {}
    });
    expect(removed.statusCode).toBe(201);

    const revoked = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/activity/typing/start`,
      headers: { authorization: `Bearer ${member.participant_token}` },
      payload: {}
    });
    expect(revoked.statusCode).toBe(403);

    await app.close();
  });
});
