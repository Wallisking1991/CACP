# Room UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Content-first AI Roundtable Studio room experience with real presence/typing, sound cues, a slim avatar header, distinct message treatments, a draggable logo control, and a centered Room Control Center.

**Architecture:** Add protocol/server activity events first, then derive activity and avatar status in web state, then replace the room shell with focused UI components. Keep operations out of the header, keep secrets masked, and keep component boundaries small enough to test independently.

**Tech Stack:** TypeScript, ESM, Zod, Fastify/WebSocket, React 19, Vite, Vitest, Testing Library, Web Audio API, CSS variables/animations.

---

## Scope Check

This plan intentionally implements the full approved redesign in one pass. The work spans protocol, server, web state, web UI, sound, and styling, but those pieces are dependent: the avatar rail needs activity events, the composer needs typing emission, and sound/UI behavior depend on room-state derivation. The plan is split into testable checkpoints with focused commits.

Run implementation from a clean dedicated worktree. The main checkout currently has an untracked `.claude/settings.json`; do not commit it.

## File Structure

### Protocol

- Modify `packages/protocol/src/schemas.ts`: add participant presence and typing event types, payload schemas, and exported TypeScript types.
- Modify `packages/protocol/test/protocol.test.ts`: add schema coverage for presence and typing payloads.

### Server

- Modify `packages/server/src/server.ts`: add activity body schemas, active-participant guard, presence endpoint, typing start endpoint, and typing stop endpoint.
- Create `packages/server/test/participant-activity.test.ts`: verify authenticated activity events, no spoofing, and removed participant denial.

### Web API and state

- Modify `packages/web/src/api.ts`: add `updatePresence`, `startTyping`, and `stopTyping` API helpers.
- Modify `packages/web/test/api.test.ts`: verify activity helper requests.
- Modify `packages/web/src/room-state.ts`: derive participant activity, avatar roles, latest sender, and AI working state.
- Modify `packages/web/test/room-state.test.ts`: verify activity expiry, avatar status priority, AI working derivation, and Roundtable state propagation.

### Web behavior utilities

- Create `packages/web/src/activity-client.ts`: typing debounce and presence helpers for Workspace/Composer integration.
- Create `packages/web/test/activity-client.test.ts`: fake-timer tests for typing start/stop behavior.
- Create `packages/web/src/room-sound.ts`: Web Audio sound cue controller with localStorage-backed preference.
- Create `packages/web/test/room-sound.test.ts`: sound default, mute, cooldown, own-message suppression helper behavior.

### Web components

- Create `packages/web/src/components/RoomIcons.tsx`: shared icon-only SVG system for high-quality room controls.
- Create `packages/web/src/components/RoomIdentity.tsx`: room title, current user role, short room ID chip, copy affordance.
- Create `packages/web/src/components/RoleAvatarRail.tsx`: grouped/priority avatar rail with activity states.
- Create `packages/web/src/components/FloatingLogoControl.tsx`: draggable half-hidden logo control.
- Create `packages/web/src/components/RoomControlCenter.tsx`: centered modal for Agent, People, Invite, Room, Sound, Advanced.
- Modify `packages/web/src/components/Header.tsx`: convert to slim header using RoomIdentity and RoleAvatarRail; language toggle remains the only header control.
- Modify `packages/web/src/components/Thread.tsx`: render own, other-human, AI work-card, system, import, and Roundtable variants.
- Modify `packages/web/src/components/Composer.tsx`: icon-first mode switch, typing hooks, clear icon at composer top-right, confirmation flow.
- Modify `packages/web/src/components/Workspace.tsx`: wire activity client, sound cues, floating logo control, Room Control Center, and new header props.
- Retire `packages/web/src/components/MobileDrawer.tsx` from Workspace usage. Leave the file in place until a later cleanup commit removes it after tests confirm no imports.

### Web tests and styles

- Create `packages/web/test/room-identity.test.tsx`.
- Create `packages/web/test/role-avatar-rail.test.tsx`.
- Create `packages/web/test/floating-logo-control.test.tsx`.
- Create `packages/web/test/room-control-center.test.tsx`.
- Create `packages/web/test/thread-message-variants.test.tsx`.
- Modify `packages/web/test/composer-matrix.test.tsx`.
- Modify `packages/web/test/workspace-join-request-modal.test.tsx` and `packages/web/test/workspace-roundtable-request-modal.test.tsx` only where the renamed control surface changes queries.
- Modify `packages/web/src/tokens.css`: add room studio color, shadow, and motion tokens.
- Modify `packages/web/src/App.css`: add the room studio layout, avatar rail, message variants, composer dock, floating control, modal, sound controls, and responsive rules.
- Modify `packages/web/src/i18n/messages.en.json` and `packages/web/src/i18n/messages.zh.json`: add labels/tooltips for icon-first controls, activity states, sound controls, and confirmation text.

## Task 1: Protocol activity events

**Files:**
- Modify: `packages/protocol/src/schemas.ts`
- Modify: `packages/protocol/test/protocol.test.ts`

- [ ] **Step 1: Add failing protocol tests for presence and typing schemas**

Add these imports to `packages/protocol/test/protocol.test.ts`:

```ts
  ParticipantPresenceChangedPayloadSchema,
  ParticipantTypingStartedPayloadSchema,
  ParticipantTypingStoppedPayloadSchema,
```

Add this test inside `describe("CACP event schema", () => { ... })`:

```ts
  it("accepts participant presence and typing activity events", () => {
    const presencePayload = ParticipantPresenceChangedPayloadSchema.parse({
      participant_id: "user_1",
      presence: "idle",
      updated_at: "2026-04-30T00:00:00.000Z"
    });
    expect(presencePayload.presence).toBe("idle");

    const typingStartedPayload = ParticipantTypingStartedPayloadSchema.parse({
      participant_id: "user_1",
      scope: "room",
      started_at: "2026-04-30T00:00:01.000Z"
    });
    expect(typingStartedPayload.scope).toBe("room");

    const typingStoppedPayload = ParticipantTypingStoppedPayloadSchema.parse({
      participant_id: "user_1",
      scope: "room",
      stopped_at: "2026-04-30T00:00:02.000Z"
    });
    expect(typingStoppedPayload.participant_id).toBe("user_1");

    for (const type of [
      "participant.presence_changed",
      "participant.typing_started",
      "participant.typing_stopped"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-04-30T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
  });
```

- [ ] **Step 2: Run protocol tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
```

Expected: TypeScript or Vitest fails because the new payload schemas are not exported and the event types are not accepted.

- [ ] **Step 3: Implement protocol schemas and exports**

In `packages/protocol/src/schemas.ts`, add the three event types to `EventTypeSchema` immediately after `participant.role_updated`:

```ts
  "participant.presence_changed", "participant.typing_started", "participant.typing_stopped",
```

Add these payload schemas after `ParticipantSchema`:

```ts
export const ParticipantPresenceSchema = z.enum(["online", "idle", "offline"]);
export const ParticipantActivityScopeSchema = z.enum(["room"]);

export const ParticipantPresenceChangedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  presence: ParticipantPresenceSchema,
  updated_at: z.string().datetime()
});

export const ParticipantTypingStartedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  started_at: z.string().datetime()
});

export const ParticipantTypingStoppedPayloadSchema = z.object({
  participant_id: z.string().min(1),
  scope: ParticipantActivityScopeSchema,
  stopped_at: z.string().datetime()
});
```

Add these exported types near the other inferred types:

```ts
export type ParticipantPresence = z.infer<typeof ParticipantPresenceSchema>;
export type ParticipantActivityScope = z.infer<typeof ParticipantActivityScopeSchema>;
export type ParticipantPresenceChangedPayload = z.infer<typeof ParticipantPresenceChangedPayloadSchema>;
export type ParticipantTypingStartedPayload = z.infer<typeof ParticipantTypingStartedPayloadSchema>;
export type ParticipantTypingStoppedPayload = z.infer<typeof ParticipantTypingStoppedPayloadSchema>;
```

- [ ] **Step 4: Run protocol tests and build**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
corepack pnpm --filter @cacp/protocol build
```

Expected: both commands pass.

- [ ] **Step 5: Commit protocol activity events**

Run:

```powershell
git add packages/protocol/src/schemas.ts packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add participant activity events"
```

## Task 2: Server activity routes

**Files:**
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/test/participant-activity.test.ts`

- [ ] **Step 1: Add failing server route tests**

Create `packages/server/test/participant-activity.test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run server activity tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- participant-activity.test.ts
```

Expected: requests return 404 because the activity endpoints do not exist.

- [ ] **Step 3: Implement activity routes**

Update the protocol import list at the top of `packages/server/src/server.ts` to include:

```ts
  ParticipantPresenceSchema,
```

Add these local body schemas near the other route schemas:

```ts
const PresenceBodySchema = z.object({ presence: ParticipantPresenceSchema });
const EmptyObjectBodySchema = z.object({});
```

Add these routes after `/rooms/:roomId/events` and before the websocket stream route:

```ts
  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/presence", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (store.isParticipantRevoked(request.params.roomId, participant.id)) return deny(reply, "participant_removed", 403);
    const body = PresenceBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.presence_changed", participant.id, {
      participant_id: participant.id,
      presence: body.presence,
      updated_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.presence_changed" });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/typing/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (store.isParticipantRevoked(request.params.roomId, participant.id)) return deny(reply, "participant_removed", 403);
    EmptyObjectBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.typing_started", participant.id, {
      participant_id: participant.id,
      scope: "room",
      started_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.typing_started" });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/typing/stop", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (store.isParticipantRevoked(request.params.roomId, participant.id)) return deny(reply, "participant_removed", 403);
    EmptyObjectBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.typing_stopped", participant.id, {
      participant_id: participant.id,
      scope: "room",
      stopped_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.typing_stopped" });
  });
```

Do not persist secrets in these payloads. Do not accept `participant_id` from the client body.

- [ ] **Step 4: Run server activity tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- participant-activity.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Run focused server regression tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- server.test.ts participant-removal.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit server activity routes**

Run:

```powershell
git add packages/server/src/server.ts packages/server/test/participant-activity.test.ts
git commit -m "feat(server): add participant activity routes"
```

## Task 3: Web activity API and typing controller

**Files:**
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/test/api.test.ts`
- Create: `packages/web/src/activity-client.ts`
- Create: `packages/web/test/activity-client.test.ts`

- [ ] **Step 1: Add failing API tests for activity requests**

Update the import in `packages/web/test/api.test.ts` to include:

```ts
  startTyping,
  stopTyping,
  updatePresence,
```

Add this test inside `describe("room API", () => { ... })`:

```ts
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
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts
```

Expected: test build fails because the new API helpers do not exist.

- [ ] **Step 3: Implement web activity API helpers**

In `packages/web/src/api.ts`, add this type near `RoomSession`:

```ts
export type ParticipantPresence = "online" | "idle" | "offline";
```

Add these functions after `leaveRoom`:

```ts
export async function updatePresence(session: RoomSession, presence: ParticipantPresence): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/presence`, session.token, { presence });
}

export async function startTyping(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/typing/start`, session.token, {});
}

export async function stopTyping(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/activity/typing/stop`, session.token, {});
}
```

- [ ] **Step 4: Add failing typing controller tests**

Create `packages/web/test/activity-client.test.ts` with this content:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTypingActivityController } from "../src/activity-client.js";

describe("typing activity controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts typing once and stops after inactivity", () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createTypingActivityController({ startTyping: start, stopTyping: stop, stopDelayMs: 2000 });

    controller.inputChanged("h");
    controller.inputChanged("he");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops immediately after send or clear", () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createTypingActivityController({ startTyping: start, stopTyping: stop, stopDelayMs: 2000 });

    controller.inputChanged("hello");
    controller.stopNow();
    expect(stop).toHaveBeenCalledTimes(1);

    controller.inputChanged("again");
    controller.inputChanged("");
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Run activity client test and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- activity-client.test.ts
```

Expected: test fails because `activity-client.ts` does not exist.

- [ ] **Step 6: Implement typing activity controller**

Create `packages/web/src/activity-client.ts` with this content:

```ts
export interface TypingActivityController {
  inputChanged: (value: string) => void;
  stopNow: () => void;
  dispose: () => void;
}

export interface TypingActivityControllerOptions {
  startTyping: () => void;
  stopTyping: () => void;
  stopDelayMs?: number;
}

export function createTypingActivityController({
  startTyping,
  stopTyping,
  stopDelayMs = 2500
}: TypingActivityControllerOptions): TypingActivityController {
  let typing = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clearStopTimer(): void {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = undefined;
  }

  function emitStop(): void {
    clearStopTimer();
    if (!typing) return;
    typing = false;
    stopTyping();
  }

  function scheduleStop(): void {
    clearStopTimer();
    timeout = setTimeout(emitStop, stopDelayMs);
  }

  return {
    inputChanged(value: string): void {
      if (!value.trim()) {
        emitStop();
        return;
      }
      if (!typing) {
        typing = true;
        startTyping();
      }
      scheduleStop();
    },
    stopNow: emitStop,
    dispose(): void {
      emitStop();
    }
  };
}
```

- [ ] **Step 7: Run web API and activity tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts activity-client.test.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit web activity client**

Run:

```powershell
git add packages/web/src/api.ts packages/web/test/api.test.ts packages/web/src/activity-client.ts packages/web/test/activity-client.test.ts
git commit -m "feat(web): add participant activity client"
```

## Task 4: Room-state activity and avatar status derivation

**Files:**
- Modify: `packages/web/src/room-state.ts`
- Modify: `packages/web/test/room-state.test.ts`

- [ ] **Step 1: Add failing room-state tests for activity and avatar status**

Add this test to `packages/web/test/room-state.test.ts`:

```ts
  it("derives participant activity and avatar statuses with priority", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1, "user_1"),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2, "user_2"),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["claude-code", "repo.read"] }, 3, "agent_1"),
      event("room.agent_selected", { agent_id: "agent_1" }, 4, "user_1"),
      event("participant.presence_changed", { participant_id: "user_2", presence: "idle", updated_at: "2026-04-25T00:00:05.000Z" }, 5, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:06.000Z" }, 6, "user_2"),
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 7, "agent_1")
    ]);

    expect(state.participantActivity.get("user_2")).toMatchObject({ presence: "idle", typing: true });
    expect(state.avatarStatuses.find((item) => item.id === "user_2")).toMatchObject({ kind: "human", status: "typing", group: "humans" });
    expect(state.avatarStatuses.find((item) => item.id === "agent_1")).toMatchObject({ kind: "agent", status: "working", group: "agents" });
  });

  it("expires stale typing indicators and clears typing on stop", () => {
    const stale = deriveRoomState([
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 1, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:01.000Z" }, 2, "user_2")
    ], { now: "2026-04-25T00:00:10.000Z" });
    expect(stale.participantActivity.get("user_2")?.typing).toBe(false);

    const stopped = deriveRoomState([
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 1, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:01.000Z" }, 2, "user_2"),
      event("participant.typing_stopped", { participant_id: "user_2", scope: "room", stopped_at: "2026-04-25T00:00:02.000Z" }, 3, "user_2")
    ], { now: "2026-04-25T00:00:03.000Z" });
    expect(stopped.participantActivity.get("user_2")?.typing).toBe(false);
  });
```

- [ ] **Step 2: Run room-state tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts
```

Expected: TypeScript fails because `deriveRoomState` does not accept options and the activity fields do not exist.

- [ ] **Step 3: Implement room-state activity types**

In `packages/web/src/room-state.ts`, add these interfaces after `AgentView`:

```ts
export type ParticipantPresenceView = "online" | "idle" | "offline";
export type AvatarStatusKind = "working" | "typing" | "roundtable" | "online" | "idle" | "offline";
export type AvatarStatusGroup = "humans" | "agents";

export interface ParticipantActivityView {
  participant_id: string;
  presence: ParticipantPresenceView;
  typing: boolean;
  typing_updated_at?: string;
  updated_at?: string;
}

export interface AvatarStatusView {
  id: string;
  display_name: string;
  role: string;
  kind: "human" | "agent";
  group: AvatarStatusGroup;
  status: AvatarStatusKind;
  capabilities?: string[];
  active: boolean;
}

export interface DeriveRoomStateOptions {
  now?: string;
  typingTtlMs?: number;
}
```

Add fields to `RoomViewState`:

```ts
  participantActivity: Map<string, ParticipantActivityView>;
  avatarStatuses: AvatarStatusView[];
  latestSenderId?: string;
```

- [ ] **Step 4: Implement derivation helpers**

Add these helpers before `deriveRoomState`:

```ts
function activityFor(activity: Map<string, ParticipantActivityView>, participantId: string): ParticipantActivityView {
  const existing = activity.get(participantId);
  if (existing) return existing;
  const next: ParticipantActivityView = { participant_id: participantId, presence: "online", typing: false };
  activity.set(participantId, next);
  return next;
}

function typingIsFresh(typingAt: string | undefined, nowMs: number, ttlMs: number): boolean {
  if (!typingAt) return false;
  const started = Date.parse(typingAt);
  if (Number.isNaN(started)) return false;
  return nowMs - started <= ttlMs;
}

function avatarPriority(status: AvatarStatusKind): number {
  switch (status) {
    case "working": return 0;
    case "typing": return 1;
    case "roundtable": return 2;
    case "online": return 3;
    case "idle": return 4;
    case "offline": return 5;
  }
}
```

- [ ] **Step 5: Update `deriveRoomState` signature and event loop**

Change the signature to:

```ts
export function deriveRoomState(events: CacpEvent[], options: DeriveRoomStateOptions = {}): RoomViewState {
```

At the top of the function, add:

```ts
  const participantActivity = new Map<string, ParticipantActivityView>();
  let latestSenderId: string | undefined;
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const typingTtlMs = options.typingTtlMs ?? 5000;
```

In the event loop, add these cases:

```ts
    if (event.type === "participant.presence_changed") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      const presence = event.payload.presence === "online" || event.payload.presence === "idle" || event.payload.presence === "offline" ? event.payload.presence : undefined;
      if (participantId && presence) {
        const activity = activityFor(participantActivity, participantId);
        activity.presence = presence;
        activity.updated_at = typeof event.payload.updated_at === "string" ? event.payload.updated_at : event.created_at;
      }
    }

    if (event.type === "participant.typing_started") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      if (participantId) {
        const activity = activityFor(participantActivity, participantId);
        activity.typing = true;
        activity.typing_updated_at = typeof event.payload.started_at === "string" ? event.payload.started_at : event.created_at;
      }
    }

    if (event.type === "participant.typing_stopped") {
      const participantId = typeof event.payload.participant_id === "string" ? event.payload.participant_id : undefined;
      if (participantId) {
        const activity = activityFor(participantActivity, participantId);
        activity.typing = false;
        activity.typing_updated_at = typeof event.payload.stopped_at === "string" ? event.payload.stopped_at : event.created_at;
      }
    }

    if (event.type === "message.created") {
      latestSenderId = event.actor_id;
    }
```

After the event loop and before `return`, expire stale typing:

```ts
  for (const activity of participantActivity.values()) {
    if (activity.typing && !typingIsFresh(activity.typing_updated_at, nowMs, typingTtlMs)) {
      activity.typing = false;
    }
  }
```

- [ ] **Step 6: Build avatar statuses before returning**

Add this block before `return`:

```ts
  const workingAgentIds = new Set<string>([...streamingTurns.values()].map((turn) => turn.agent_id));
  for (const status of claudeRuntimeStatuses) {
    if (status.phase !== "completed" && status.phase !== "failed") workingAgentIds.add(status.agent_id);
  }

  const roundtableParticipantIds = new Set<string>();
  if (activeCollection) {
    for (const participant of participants.values()) {
      if (participant.type !== "agent") roundtableParticipantIds.add(participant.id);
    }
  }
  if (pendingRoundtableRequest) roundtableParticipantIds.add(pendingRoundtableRequest.requested_by);

  const avatarStatuses: AvatarStatusView[] = [
    ...[...participants.values()].map((participant): AvatarStatusView => {
      const activity = participantActivity.get(participant.id);
      const status: AvatarStatusKind = activity?.typing
        ? "typing"
        : roundtableParticipantIds.has(participant.id)
          ? "roundtable"
          : activity?.presence === "idle"
            ? "idle"
            : activity?.presence === "offline"
              ? "offline"
              : "online";
      return {
        id: participant.id,
        display_name: participant.display_name,
        role: participant.role,
        kind: "human",
        group: "humans",
        status,
        active: status === "typing" || status === "roundtable" || participant.id === latestSenderId
      };
    }),
    ...[...agents.values()].map((agent): AvatarStatusView => {
      const status: AvatarStatusKind = workingAgentIds.has(agent.agent_id)
        ? "working"
        : agent.status === "offline"
          ? "offline"
          : agent.status === "online"
            ? "online"
            : "idle";
      return {
        id: agent.agent_id,
        display_name: agent.name,
        role: "agent",
        kind: "agent",
        group: "agents",
        status,
        capabilities: agent.capabilities,
        active: status === "working" || agent.agent_id === activeAgentId
      };
    })
  ].sort((a, b) => avatarPriority(a.status) - avatarPriority(b.status) || a.display_name.localeCompare(b.display_name));
```

Add these fields to the returned object:

```ts
    participantActivity,
    avatarStatuses,
    latestSenderId,
```

- [ ] **Step 7: Run room-state tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts room-state-helpers.test.ts
```

Expected: tests pass.

- [ ] **Step 8: Commit room-state activity derivation**

Run:

```powershell
git add packages/web/src/room-state.ts packages/web/test/room-state.test.ts
git commit -m "feat(web): derive room activity status"
```

## Task 5: Sound cue manager

**Files:**
- Create: `packages/web/src/room-sound.ts`
- Create: `packages/web/test/room-sound.test.ts`

- [ ] **Step 1: Add failing sound manager tests**

Create `packages/web/test/room-sound.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomSoundController, shouldPlayCueForMessage } from "../src/room-sound.js";

describe("room sound cues", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults sound cues on and persists mute preference", () => {
    const controller = createRoomSoundController({ playTone: vi.fn(), now: () => 1000 });
    expect(controller.enabled()).toBe(true);
    controller.setEnabled(false);
    expect(controller.enabled()).toBe(false);
    expect(localStorage.getItem("cacp.room.sound.enabled")).toBe("false");
  });

  it("suppresses own-message cues and plays other-message cues", () => {
    expect(shouldPlayCueForMessage({ actorId: "user_1", currentParticipantId: "user_1" })).toBe(false);
    expect(shouldPlayCueForMessage({ actorId: "user_2", currentParticipantId: "user_1" })).toBe(true);
  });

  it("uses cooldown to avoid noisy cue bursts", () => {
    let now = 1000;
    const playTone = vi.fn();
    const controller = createRoomSoundController({ playTone, now: () => now, cooldownMs: 500 });

    controller.play("message");
    controller.play("message");
    now = 1501;
    controller.play("message");

    expect(playTone).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run sound tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-sound.test.ts
```

Expected: test fails because `room-sound.ts` does not exist.

- [ ] **Step 3: Implement sound manager**

Create `packages/web/src/room-sound.ts` with this content:

```ts
export type RoomSoundCue = "message" | "ai-start" | "roundtable" | "agent-online" | "join-request";

export interface RoomSoundController {
  enabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  play: (cue: RoomSoundCue) => void;
}

export interface RoomSoundControllerOptions {
  playTone?: (cue: RoomSoundCue) => void;
  now?: () => number;
  cooldownMs?: number;
}

const storageKey = "cacp.room.sound.enabled";

export function shouldPlayCueForMessage(input: { actorId: string; currentParticipantId: string }): boolean {
  return input.actorId !== input.currentParticipantId;
}

function storedEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(storageKey) !== "false";
}

function synthTone(cue: RoomSoundCue): void {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency = cue === "ai-start" ? 180 : cue === "roundtable" ? 330 : 260;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

export function createRoomSoundController({
  playTone = synthTone,
  now = () => Date.now(),
  cooldownMs = 450
}: RoomSoundControllerOptions = {}): RoomSoundController {
  let enabled = storedEnabled();
  const lastPlayedAt = new Map<RoomSoundCue, number>();

  return {
    enabled: () => enabled,
    setEnabled(next: boolean): void {
      enabled = next;
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, String(next));
    },
    play(cue: RoomSoundCue): void {
      if (!enabled) return;
      const current = now();
      const last = lastPlayedAt.get(cue) ?? -Infinity;
      if (current - last < cooldownMs) return;
      lastPlayedAt.set(cue, current);
      try {
        playTone(cue);
      } catch {
        return;
      }
    }
  };
}
```

- [ ] **Step 4: Run sound tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-sound.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit sound manager**

Run:

```powershell
git add packages/web/src/room-sound.ts packages/web/test/room-sound.test.ts
git commit -m "feat(web): add room sound cues"
```

## Task 6: Header identity and avatar rail components

**Files:**
- Create: `packages/web/src/components/RoomIcons.tsx`
- Create: `packages/web/src/components/RoomIdentity.tsx`
- Create: `packages/web/src/components/RoleAvatarRail.tsx`
- Modify: `packages/web/src/components/Header.tsx`
- Create: `packages/web/test/room-identity.test.tsx`
- Create: `packages/web/test/role-avatar-rail.test.tsx`

- [ ] **Step 1: Add component tests for room identity and avatar rail**

Create `packages/web/test/room-identity.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { RoomIdentity } from "../src/components/RoomIdentity.js";

describe("RoomIdentity", () => {
  it("shows compact room identity and copies the full room id", () => {
    const onCopyRoomId = vi.fn();
    render(<RoomIdentity roomName="CACP AI Room" roomId="room_jPNCRNROwP3_isiArOvncw" userDisplayName="Wei" userRole="owner" onCopyRoomId={onCopyRoomId} />);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByText("Wei · Owner")).toBeInTheDocument();
    expect(screen.getByText("room_jPNC…Ovncw")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy room ID/i }));
    expect(onCopyRoomId).toHaveBeenCalledWith("room_jPNCRNROwP3_isiArOvncw");
  });
});
```

Create `packages/web/test/role-avatar-rail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { RoleAvatarRail } from "../src/components/RoleAvatarRail.js";
import type { AvatarStatusView } from "../src/room-state.js";

const avatars: AvatarStatusView[] = [
  { id: "user_1", display_name: "Alice", role: "owner", kind: "human", group: "humans", status: "online", active: false },
  { id: "user_2", display_name: "Bob", role: "member", kind: "human", group: "humans", status: "typing", active: true },
  { id: "agent_1", display_name: "Claude Code Agent", role: "agent", kind: "agent", group: "agents", status: "working", capabilities: ["repo.read"], active: true }
];

describe("RoleAvatarRail", () => {
  it("renders grouped avatars with accessible status labels", () => {
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} />);

    expect(screen.getByLabelText("Bob, member, typing")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude Code Agent, AI agent, working")).toBeInTheDocument();
    expect(screen.getByText("Humans")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("folds inactive overflow into a count", () => {
    render(<RoleAvatarRail avatars={[...avatars, ...avatars.map((item, index) => ({ ...item, id: `${item.id}_${index}`, active: false, status: "idle" as const }))]} maxVisible={3} />);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-identity.test.tsx role-avatar-rail.test.tsx
```

Expected: tests fail because components do not exist.

- [ ] **Step 3: Create shared room icons**

Create `packages/web/src/components/RoomIcons.tsx` with this content:

```tsx
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function IconFrame({ title, children, ...props }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...props}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></IconFrame>;
}

export function GlobeIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.2 2.5 3.3 5.5 3.3 9s-1.1 6.5-3.3 9c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z" /></IconFrame>;
}

export function SendIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 12 20 5l-5 15-3-6-8-2Z" /><path d="m12 14 8-9" /></IconFrame>;
}

export function SweepIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 18c4 2 10 2 16 0" /><path d="M8 16 16 4" /><path d="m13 7 4 2" /><path d="M6 14h6" /></IconFrame>;
}

export function LiveIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="3" /><path d="M5 12a7 7 0 0 1 14 0" /><path d="M7 17a9 9 0 0 0 10 0" /></IconFrame>;
}

export function RoundtableIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="4" r="1.5" /><circle cx="19" cy="16" r="1.5" /><circle cx="5" cy="16" r="1.5" /></IconFrame>;
}

export function SoundIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16 9c1 1 1 5 0 6" /><path d="M19 7c2 3 2 7 0 10" /></IconFrame>;
}
```

- [ ] **Step 4: Implement RoomIdentity**

Create `packages/web/src/components/RoomIdentity.tsx` with this content:

```tsx
import { CopyIcon } from "./RoomIcons.js";

export interface RoomIdentityProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  onCopyRoomId: (roomId: string) => void;
}

function shortRoomId(roomId: string): string {
  if (roomId.length <= 16) return roomId;
  return `${roomId.slice(0, 9)}…${roomId.slice(-5)}`;
}

function roleLabel(role?: string): string {
  if (!role) return "";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

export function RoomIdentity({ roomName, roomId, userDisplayName, userRole, onCopyRoomId }: RoomIdentityProps) {
  const userLine = [userDisplayName, roleLabel(userRole)].filter(Boolean).join(" · ");
  return (
    <div className="room-identity">
      <div>
        <h2>{roomName}</h2>
        {userLine ? <p>{userLine}</p> : null}
      </div>
      <button type="button" className="room-id-chip" onClick={() => onCopyRoomId(roomId)} aria-label="Copy room ID" title={roomId}>
        <span>{shortRoomId(roomId)}</span>
        <CopyIcon />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Implement RoleAvatarRail**

Create `packages/web/src/components/RoleAvatarRail.tsx` with this content:

```tsx
import type { AvatarStatusView } from "../room-state.js";

export interface RoleAvatarRailProps {
  avatars: AvatarStatusView[];
  maxVisible?: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function statusLabel(status: AvatarStatusView["status"]): string {
  switch (status) {
    case "working": return "working";
    case "typing": return "typing";
    case "roundtable": return "in Roundtable";
    case "online": return "online";
    case "idle": return "idle";
    case "offline": return "offline";
  }
}

function avatarLabel(avatar: AvatarStatusView): string {
  const role = avatar.kind === "agent" ? "AI agent" : avatar.role;
  return `${avatar.display_name}, ${role}, ${statusLabel(avatar.status)}`;
}

function splitVisible(avatars: AvatarStatusView[], maxVisible: number): { visible: AvatarStatusView[]; hiddenCount: number } {
  const active = avatars.filter((avatar) => avatar.active);
  const inactive = avatars.filter((avatar) => !avatar.active);
  const visible = [...active, ...inactive].slice(0, maxVisible);
  return { visible, hiddenCount: Math.max(0, avatars.length - visible.length) };
}

export function RoleAvatarRail({ avatars, maxVisible = 10 }: RoleAvatarRailProps) {
  const humans = avatars.filter((avatar) => avatar.group === "humans");
  const agents = avatars.filter((avatar) => avatar.group === "agents");
  const { visible, hiddenCount } = splitVisible([...humans, ...agents], maxVisible);

  return (
    <div className="role-avatar-rail" aria-label="Room roles">
      {humans.length > 0 ? <span className="avatar-group-label">Humans</span> : null}
      {visible.filter((avatar) => avatar.group === "humans").map((avatar) => (
        <span key={avatar.id} className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`} aria-label={avatarLabel(avatar)} title={avatarLabel(avatar)}>
          <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
          <span className="role-avatar__status" aria-hidden="true" />
        </span>
      ))}
      {agents.length > 0 ? <span className="avatar-group-label">Agents</span> : null}
      {visible.filter((avatar) => avatar.group === "agents").map((avatar) => (
        <span key={avatar.id} className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`} aria-label={avatarLabel(avatar)} title={avatarLabel(avatar)}>
          <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
          <span className="role-avatar__status" aria-hidden="true" />
        </span>
      ))}
      {hiddenCount > 0 ? <span className="role-avatar-overflow">+{hiddenCount}</span> : null}
    </div>
  );
}
```

- [ ] **Step 6: Convert Header to slim header**

Modify `packages/web/src/components/Header.tsx` so `HeaderProps` contains these fields:

```ts
  userRole?: string;
  avatarStatuses: AvatarStatusView[];
  onCopyRoomId: (roomId: string) => void;
```

Remove these fields from `HeaderProps`:

```ts
  participantCount: number;
  agentName?: string;
  agentOnline?: boolean;
  mode: "live" | "collect" | "replying";
  isOwner: boolean;
  onClearRoom: () => void;
  onLeaveRoom: () => void;
  onOpenDrawer?: () => void;
```

Replace the header JSX body with:

```tsx
    <header className="workspace-header workspace-header--studio">
      <RoomIdentity
        roomName={roomName}
        roomId={roomId}
        userDisplayName={userDisplayName}
        userRole={userRole}
        onCopyRoomId={onCopyRoomId}
      />

      <RoleAvatarRail avatars={avatarStatuses} />

      <button
        type="button"
        className="lang-toggle room-icon-button"
        onClick={handleToggleLang}
        aria-label={t("lang.toggle")}
        title={t("lang.toggle")}
      >
        <GlobeIcon />
      </button>
    </header>
```

Add imports:

```ts
import type { AvatarStatusView } from "../room-state.js";
import { GlobeIcon } from "./RoomIcons.js";
import { RoomIdentity } from "./RoomIdentity.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";
```

Remove the status pill helper functions and unused SVG button markup.

- [ ] **Step 7: Run header component tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-identity.test.tsx role-avatar-rail.test.tsx
```

Expected: tests pass.

- [ ] **Step 8: Commit header components**

Run:

```powershell
git add packages/web/src/components/RoomIcons.tsx packages/web/src/components/RoomIdentity.tsx packages/web/src/components/RoleAvatarRail.tsx packages/web/src/components/Header.tsx packages/web/test/room-identity.test.tsx packages/web/test/role-avatar-rail.test.tsx
git commit -m "feat(web): add studio room header"
```

## Task 7: Composer clear action and typing integration

**Files:**
- Modify: `packages/web/src/components/Composer.tsx`
- Modify: `packages/web/test/composer-matrix.test.tsx`

- [ ] **Step 1: Add failing composer tests for clear icon and typing callbacks**

In `packages/web/test/composer-matrix.test.tsx`, add these fields to `baseProps`:

```ts
    onTypingInput: noop,
    onStopTyping: noop,
    onClearConversation: noop,
```

Add these tests in the Live mode describe block:

```tsx
    it("shows owner-only clear conversation icon and confirms before clearing", () => {
      const onClearConversation = vi.fn();
      renderComposer({ ...baseProps, role: "owner", onClearConversation });

      fireEvent.click(screen.getByRole("button", { name: /Clear conversation/i }));
      expect(screen.getByText(/Clear the visible conversation history/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Confirm clear conversation/i }));
      expect(onClearConversation).toHaveBeenCalledTimes(1);
    });

    it("hides clear conversation action for members", () => {
      renderComposer({ ...baseProps, role: "member" });
      expect(screen.queryByRole("button", { name: /Clear conversation/i })).not.toBeInTheDocument();
    });

    it("notifies typing callbacks on input and send", () => {
      const onTypingInput = vi.fn();
      const onStopTyping = vi.fn();
      const onSend = vi.fn();
      renderComposer({ ...baseProps, onTypingInput, onStopTyping, onSend });

      const textarea = screen.getByPlaceholderText(/Type a message/i);
      fireEvent.change(textarea, { target: { value: "hello" } });
      expect(onTypingInput).toHaveBeenCalledWith("hello");
      fireEvent.click(screen.getByRole("button", { name: /Send/i }));
      expect(onSend).toHaveBeenCalledWith("hello");
      expect(onStopTyping).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run composer tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- composer-matrix.test.tsx
```

Expected: TypeScript fails because the new props are not defined.

- [ ] **Step 3: Update Composer props and handlers**

In `packages/web/src/components/Composer.tsx`, add props:

```ts
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  onClearConversation: () => void;
```

Add local confirmation state:

```ts
  const [confirmingClear, setConfirmingClear] = useState(false);
```

Update text change handling:

```tsx
          onChange={(e) => {
            setText(e.target.value);
            onTypingInput(e.target.value);
          }}
```

Update `handleSend`:

```ts
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    onStopTyping();
  }, [text, onSend, onStopTyping]);
```

Add clear icon before `.composer-top`:

```tsx
      {isOwner && (
        <div className="composer-utility-row">
          <button
            type="button"
            className="room-icon-button composer-clear-button"
            onClick={() => setConfirmingClear(true)}
            aria-label={t("composer.clearConversation")}
            title={t("composer.clearConversation")}
          >
            <SweepIcon />
          </button>
        </div>
      )}
```

Add confirmation UI after `.composer-bottom`:

```tsx
      {confirmingClear && (
        <div className="composer-confirm-clear" role="dialog" aria-label={t("composer.clearConversation")}>
          <p>{t("composer.clearConversationConfirm")}</p>
          <button type="button" className="btn btn-warm-ghost" onClick={() => setConfirmingClear(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-warm"
            onClick={() => {
              setConfirmingClear(false);
              onClearConversation();
            }}
          >
            {t("composer.clearConversationConfirmAction")}
          </button>
        </div>
      )}
```

Add import:

```ts
import { LiveIcon, RoundtableIcon, SendIcon, SweepIcon } from "./RoomIcons.js";
```

Use `LiveIcon`, `RoundtableIcon`, and `SendIcon` inside the existing mode/send buttons while preserving their accessible text.

- [ ] **Step 4: Add i18n keys for composer actions**

Add to `packages/web/src/i18n/messages.en.json`:

```json
"common.cancel": "Cancel",
"composer.clearConversation": "Clear conversation",
"composer.clearConversationConfirm": "Clear the visible conversation history for everyone in this room? This keeps room membership and controls intact.",
"composer.clearConversationConfirmAction": "Confirm clear conversation"
```

Add to `packages/web/src/i18n/messages.zh.json`:

```json
"common.cancel": "取消",
"composer.clearConversation": "清空对话",
"composer.clearConversationConfirm": "要为房间内所有人清空当前可见对话历史吗？房间成员和控制设置会保留。",
"composer.clearConversationConfirmAction": "确认清空对话"
```

Keep valid JSON commas based on the surrounding entries.

- [ ] **Step 5: Run composer and i18n tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- composer-matrix.test.tsx i18n.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit composer interaction changes**

Run:

```powershell
git add packages/web/src/components/Composer.tsx packages/web/test/composer-matrix.test.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json
git commit -m "feat(web): refine studio composer controls"
```

## Task 8: Floating logo control and Room Control Center

**Files:**
- Create: `packages/web/src/components/FloatingLogoControl.tsx`
- Create: `packages/web/src/components/RoomControlCenter.tsx`
- Create: `packages/web/test/floating-logo-control.test.tsx`
- Create: `packages/web/test/room-control-center.test.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`

- [ ] **Step 1: Add failing tests for floating logo and control center**

Create `packages/web/test/floating-logo-control.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FloatingLogoControl } from "../src/components/FloatingLogoControl.js";

describe("FloatingLogoControl", () => {
  it("opens controls and persists vertical position after keyboard nudging", () => {
    const onOpen = vi.fn();
    render(<FloatingLogoControl active={false} pendingCount={1} onOpen={onOpen} storageKey="test.logo.y" />);

    const button = screen.getByRole("button", { name: /Room controls/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(localStorage.getItem("test.logo.y")).toBe("52");
  });
});
```

Create `packages/web/test/room-control-center.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { RoomControlCenter } from "../src/components/RoomControlCenter.js";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  soundEnabled: true,
  onSoundEnabledChange: vi.fn(),
  onTestSound: vi.fn(),
  agents: [{ agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"], status: "online" as const }],
  activeAgentId: "agent_1",
  participants: [{ id: "user_1", display_name: "Wei", role: "owner", type: "human" }],
  inviteCount: 0,
  isOwner: true,
  roomId: "room_1",
  onLeaveRoom: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onSelectAgent: vi.fn(),
  onRemoveParticipant: vi.fn(),
  onClearRoom: vi.fn()
};

describe("RoomControlCenter", () => {
  it("shows control sections and toggles sound", () => {
    render(<LangProvider><RoomControlCenter {...baseProps} /></LangProvider>);

    expect(screen.getByRole("dialog", { name: /Room Control Center/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /People/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invite/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sound/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sound/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Sound cues/i }));
    expect(baseProps.onSoundEnabledChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run control tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- floating-logo-control.test.tsx room-control-center.test.tsx
```

Expected: tests fail because components do not exist.

- [ ] **Step 3: Implement FloatingLogoControl**

Create `packages/web/src/components/FloatingLogoControl.tsx` with this content:

```tsx
import { useMemo, useState } from "react";
import CacpHeroLogo from "./CacpHeroLogo.js";

export interface FloatingLogoControlProps {
  active: boolean;
  pendingCount: number;
  onOpen: () => void;
  storageKey?: string;
}

function readY(storageKey: string): number {
  if (typeof localStorage === "undefined") return 50;
  const raw = localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : 50;
  return Number.isFinite(parsed) ? Math.min(85, Math.max(15, parsed)) : 50;
}

export function FloatingLogoControl({ active, pendingCount, onOpen, storageKey = "cacp.room.logoControl.y" }: FloatingLogoControlProps) {
  const initialY = useMemo(() => readY(storageKey), [storageKey]);
  const [y, setY] = useState(initialY);

  function persist(next: number): void {
    const clamped = Math.min(85, Math.max(15, next));
    setY(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }

  return (
    <button
      type="button"
      className={`floating-logo-control ${active ? "is-active" : ""}`}
      style={{ top: `${y}%` }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") persist(y + 2);
        if (event.key === "ArrowUp") persist(y - 2);
      }}
      aria-label="Room controls"
      title="Room controls"
    >
      <span className="floating-logo-control__mark" aria-hidden="true"><CacpHeroLogo ariaLabel="" /></span>
      {pendingCount > 0 ? <span className="floating-logo-control__badge">{pendingCount}</span> : null}
    </button>
  );
}
```

- [ ] **Step 4: Implement RoomControlCenter**

Create `packages/web/src/components/RoomControlCenter.tsx` with this content:

```tsx
import { useState } from "react";
import type { AgentView, ParticipantView } from "../room-state.js";
import { useT } from "../i18n/useT.js";
import { SoundIcon } from "./RoomIcons.js";

export interface RoomControlCenterProps {
  open: boolean;
  onClose: () => void;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  onTestSound: () => void;
  agents: AgentView[];
  activeAgentId?: string;
  participants: ParticipantView[];
  inviteCount: number;
  isOwner: boolean;
  roomId: string;
  onLeaveRoom: () => void;
  onCreateInvite: (role: string, ttl: number) => Promise<string | undefined>;
  onSelectAgent: (agentId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onClearRoom: () => void;
}

type ControlSection = "agent" | "people" | "invite" | "room" | "sound" | "advanced";

export function RoomControlCenter(props: RoomControlCenterProps) {
  const t = useT();
  const [section, setSection] = useState<ControlSection>("agent");
  const activeAgent = props.agents.find((agent) => agent.agent_id === props.activeAgentId);
  if (!props.open) return null;

  const sections: Array<{ id: ControlSection; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "people", label: "People" },
    { id: "invite", label: "Invite" },
    { id: "room", label: "Room" },
    { id: "sound", label: "Sound" },
    { id: "advanced", label: "Advanced" }
  ];

  return (
    <div className="room-control-overlay" onClick={props.onClose}>
      <section className="room-control-center" role="dialog" aria-modal="true" aria-label="Room Control Center" onClick={(event) => event.stopPropagation()}>
        <header className="room-control-center__header">
          <div>
            <p className="section-label">CACP</p>
            <h2>Room Control Center</h2>
          </div>
          <button type="button" className="room-icon-button" onClick={props.onClose} aria-label={t("sidebar.close")}>×</button>
        </header>
        <nav className="room-control-center__tabs" aria-label="Room controls">
          {sections.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)} aria-label={item.label}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="room-control-center__body">
          {section === "agent" && (
            <section className="agent-cockpit">
              <h3>{activeAgent?.name ?? "No active agent"}</h3>
              <p>{activeAgent ? `${activeAgent.status} · ${activeAgent.capabilities.join(" · ") || "no capabilities"}` : "Connect an agent from the room setup flow."}</p>
              {props.agents.length > 1 ? (
                <select className="input" value={props.activeAgentId ?? ""} onChange={(event) => props.onSelectAgent(event.target.value)}>
                  {props.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
                </select>
              ) : null}
            </section>
          )}
          {section === "people" && (
            <section>
              <h3>People</h3>
              {props.participants.map((participant) => (
                <div key={participant.id} className="people-row">
                  <span>{participant.display_name} · {participant.role}</span>
                  {props.isOwner && participant.role !== "owner" ? (
                    <button type="button" className="btn btn-ghost" onClick={() => props.onRemoveParticipant(participant.id)}>Remove</button>
                  ) : null}
                </div>
              ))}
            </section>
          )}
          {section === "invite" && (
            <section>
              <h3>Invite</h3>
              <p>{props.inviteCount} invites</p>
              <button type="button" className="btn btn-warm" onClick={() => void props.onCreateInvite("member", 3600)}>Copy member invite</button>
            </section>
          )}
          {section === "room" && (
            <section>
              <h3>Room</h3>
              <p>{props.roomId}</p>
              <button type="button" className="btn btn-ghost" onClick={props.onLeaveRoom}>Leave room</button>
              {props.isOwner ? <button type="button" className="btn btn-warm-ghost" onClick={props.onClearRoom}>Clear conversation</button> : null}
            </section>
          )}
          {section === "sound" && (
            <section>
              <h3><SoundIcon /> Sound</h3>
              <button type="button" role="switch" aria-checked={props.soundEnabled} onClick={() => props.onSoundEnabledChange(!props.soundEnabled)}>
                Sound cues
              </button>
              <button type="button" className="btn btn-ghost" onClick={props.onTestSound}>Test sound</button>
            </section>
          )}
          {section === "advanced" && (
            <section>
              <h3>Advanced</h3>
              <p>Agent logs and protocol diagnostics appear here as they become available.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add i18n labels for control surface**

Add English keys:

```json
"room.controls": "Room controls",
"room.controlCenter": "Room Control Center",
"room.sound": "Sound",
"room.soundCues": "Sound cues",
"room.testSound": "Test sound"
```

Add Chinese keys:

```json
"room.controls": "房间控制",
"room.controlCenter": "房间控制中心",
"room.sound": "声音",
"room.soundCues": "提示音",
"room.testSound": "测试提示音"
```

- [ ] **Step 6: Run control component tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- floating-logo-control.test.tsx room-control-center.test.tsx i18n.test.ts
```

Expected: tests pass.

- [ ] **Step 7: Commit control surface**

Run:

```powershell
git add packages/web/src/components/FloatingLogoControl.tsx packages/web/src/components/RoomControlCenter.tsx packages/web/test/floating-logo-control.test.tsx packages/web/test/room-control-center.test.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json
git commit -m "feat(web): add room control center"
```

## Task 9: Message variants and thread redesign

**Files:**
- Modify: `packages/web/src/components/Thread.tsx`
- Create: `packages/web/test/thread-message-variants.test.tsx`

- [ ] **Step 1: Add failing tests for message variants**

Create `packages/web/test/thread-message-variants.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderThread(currentParticipantId = "user_1") {
  return render(
    <LangProvider>
      <Thread
        currentParticipantId={currentParticipantId}
        messages={[
          { message_id: "msg_1", actor_id: "user_1", text: "My note", kind: "human", created_at: "2026-04-30T00:00:00.000Z" },
          { message_id: "msg_2", actor_id: "user_2", text: "Other note", kind: "human", created_at: "2026-04-30T00:00:01.000Z" },
          { message_id: "msg_3", actor_id: "agent_1", text: "AI answer", kind: "agent", created_at: "2026-04-30T00:00:02.000Z" },
          { message_id: "msg_4", actor_id: "system", text: "History cleared", kind: "system", created_at: "2026-04-30T00:00:03.000Z" }
        ]}
        streamingTurns={[]}
        actorNames={new Map([["user_1", "Wei"], ["user_2", "Bob"], ["agent_1", "Claude Code Agent"]])}
        showSlowStreamingNotice={false}
        activeCollectionId={undefined}
        claudeImports={[]}
      />
    </LangProvider>
  );
}

describe("Thread message variants", () => {
  it("distinguishes own, other human, AI, and system messages", () => {
    renderThread();
    expect(screen.getByText("My note").closest("article")).toHaveClass("message-own");
    expect(screen.getByText("Other note").closest("article")).toHaveClass("message-human-other");
    expect(screen.getByText("AI answer").closest("article")).toHaveClass("message-ai-card");
    expect(screen.getByText("History cleared").closest("article")).toHaveClass("message-system-marker");
  });
});
```

- [ ] **Step 2: Run thread variant tests and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- thread-message-variants.test.tsx
```

Expected: TypeScript fails because `Thread` lacks `currentParticipantId`, or classes do not match.

- [ ] **Step 3: Update Thread props and message class logic**

In `packages/web/src/components/Thread.tsx`, add prop:

```ts
  currentParticipantId: string;
```

Update `messageClass` to accept actor id:

```ts
function messageClass(kind: string, actorId: string, currentParticipantId: string, collectionId: string | undefined, activeCollectionId: string | undefined): string {
  const isQueued = Boolean(collectionId) && collectionId === activeCollectionId;
  if (isQueued) return "message message-roundtable-queued";
  if (kind === "agent") return "message message-ai-card";
  if (kind === "system") return "message message-system-marker";
  if (actorId === currentParticipantId) return "message message-own";
  return "message message-human-other";
}
```

Change normal message article class call to:

```tsx
            className={messageClass(msg.kind, msg.actor_id, currentParticipantId, msg.collection_id, activeCollectionId)}
```

Change streaming turn article class to:

```tsx
          <article key={turn.turn_id} className="message message-ai-card streaming-bubble">
```

Keep Claude import branches and add their existing special classes unchanged.

- [ ] **Step 4: Run thread tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- thread-message-variants.test.tsx room-state.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit thread message variants**

Run:

```powershell
git add packages/web/src/components/Thread.tsx packages/web/test/thread-message-variants.test.tsx
git commit -m "feat(web): distinguish studio message variants"
```

## Task 10: Workspace integration

**Files:**
- Modify: `packages/web/src/components/Workspace.tsx`
- Modify: `packages/web/test/workspace-join-request-modal.test.tsx`
- Modify: `packages/web/test/workspace-roundtable-request-modal.test.tsx`
- Create: `packages/web/test/workspace-studio-shell.test.tsx`

- [ ] **Step 1: Add failing Workspace shell test**

Create `packages/web/test/workspace-studio-shell.test.tsx` with this content:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { CacpEvent } from "@cacp/protocol";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-30T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

const baseProps = {
  session: { room_id: "room_1", token: "owner_secret", participant_id: "user_1", role: "owner" as const },
  events: [
    event("room.created", { name: "CACP AI Room" }, 1),
    event("participant.joined", { participant: { id: "user_1", display_name: "Wei", role: "owner", type: "human" } }, 2),
    event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 3, "agent_1"),
    event("room.agent_selected", { agent_id: "agent_1" }, 4)
  ],
  onLeaveRoom: vi.fn(),
  onClearRoom: vi.fn(),
  onSendMessage: vi.fn(),
  onStartCollection: vi.fn(),
  onSubmitCollection: vi.fn(),
  onCancelCollection: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn(),
  onRequestRoundtable: vi.fn(),
  onApproveRoundtableRequest: vi.fn(),
  onRejectRoundtableRequest: vi.fn()
};

describe("Workspace studio shell", () => {
  it("uses slim header, floating controls, and centered control modal", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Toggle language/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Leave Room/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Room controls/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Room controls/i }));
    expect(screen.getByRole("dialog", { name: /Room Control Center/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run Workspace shell test and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- workspace-studio-shell.test.tsx
```

Expected: test fails because Workspace still uses the old header/drawer wiring.

- [ ] **Step 3: Wire Workspace to the new studio shell**

In `packages/web/src/components/Workspace.tsx`:

1. Remove `MobileDrawer` import and drawer state.
2. Import new helpers/components:

```ts
import { useRef, useState, useEffect, useMemo } from "react";
import { startTyping, stopTyping, updatePresence } from "../api.js";
import { createTypingActivityController, type TypingActivityController } from "../activity-client.js";
import { createRoomSoundController, shouldPlayCueForMessage } from "../room-sound.js";
import { FloatingLogoControl } from "./FloatingLogoControl.js";
import { RoomControlCenter } from "./RoomControlCenter.js";
```

3. Add state after the existing dismissed request state:

```ts
  const [controlCenterOpen, setControlCenterOpen] = useState(false);
  const soundControllerRef = useRef(createRoomSoundController());
  const [soundEnabled, setSoundEnabled] = useState(soundControllerRef.current.enabled());
  const typingControllerRef = useRef<TypingActivityController | undefined>();
  const previousMessageCountRef = useRef(room.messages.length);
  const previousStreamingCountRef = useRef(room.streamingTurns.length);
```

4. Add typing controller effect:

```ts
  useEffect(() => {
    typingControllerRef.current?.dispose();
    typingControllerRef.current = createTypingActivityController({
      startTyping: () => { void startTyping(session).catch(() => {}); },
      stopTyping: () => { void stopTyping(session).catch(() => {}); }
    });
    void updatePresence(session, "online").catch(() => {});
    return () => {
      typingControllerRef.current?.dispose();
      void updatePresence(session, "offline").catch(() => {});
    };
  }, [session.room_id, session.token, session.participant_id]);
```

5. Add sound effect:

```ts
  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    const nextMessages = room.messages.slice(previousMessageCount);
    for (const message of nextMessages) {
      if (shouldPlayCueForMessage({ actorId: message.actor_id, currentParticipantId: session.participant_id })) {
        soundControllerRef.current.play(message.kind === "agent" ? "ai-start" : "message");
      }
    }
    previousMessageCountRef.current = room.messages.length;

    if (room.streamingTurns.length > previousStreamingCountRef.current) {
      soundControllerRef.current.play("ai-start");
    }
    previousStreamingCountRef.current = room.streamingTurns.length;
  }, [room.messages, room.streamingTurns, session.participant_id]);
```

6. Update `Header` call:

```tsx
          <Header
            roomName={room.roomName ?? session.room_id}
            roomId={session.room_id}
            userDisplayName={myDisplayName}
            userRole={session.role}
            avatarStatuses={room.avatarStatuses}
            onCopyRoomId={(roomId) => void navigator.clipboard.writeText(roomId).catch(() => {})}
          />
```

7. Update `Thread` call:

```tsx
            currentParticipantId={session.participant_id}
```

8. Update `Composer` call:

```tsx
            onTypingInput={(value) => typingControllerRef.current?.inputChanged(value)}
            onStopTyping={() => typingControllerRef.current?.stopNow()}
            onClearConversation={onClearRoom}
```

9. Add floating logo and control center before closing `workspace-shell`:

```tsx
      <FloatingLogoControl
        active={turnInFlight}
        pendingCount={(visibleJoinRequest ? 1 : 0) + (visibleRoundtableRequest ? 1 : 0)}
        onOpen={() => setControlCenterOpen(true)}
      />

      <RoomControlCenter
        {...sidebarProps}
        open={controlCenterOpen}
        onClose={() => setControlCenterOpen(false)}
        soundEnabled={soundEnabled}
        onSoundEnabledChange={(enabled) => {
          soundControllerRef.current.setEnabled(enabled);
          setSoundEnabled(enabled);
        }}
        onTestSound={() => soundControllerRef.current.play("message")}
        roomId={session.room_id}
        onLeaveRoom={onLeaveRoom}
        onClearRoom={onClearRoom}
      />
```

- [ ] **Step 4: Update impacted Workspace tests**

Update tests that query the old drawer/menu by replacing old `Open menu` flows with clicking `Room controls` and querying the centered dialog. Preserve the assertions about join request and roundtable modals because those still render independently.

Use this pattern:

```ts
fireEvent.click(screen.getByRole("button", { name: /Room controls/i }));
expect(screen.getByRole("dialog", { name: /Room Control Center/i })).toBeInTheDocument();
```

- [ ] **Step 5: Run Workspace tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- workspace-studio-shell.test.tsx workspace-join-request-modal.test.tsx workspace-roundtable-request-modal.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: Commit Workspace integration**

Run:

```powershell
git add packages/web/src/components/Workspace.tsx packages/web/test/workspace-studio-shell.test.tsx packages/web/test/workspace-join-request-modal.test.tsx packages/web/test/workspace-roundtable-request-modal.test.tsx
git commit -m "feat(web): integrate studio workspace shell"
```

## Task 11: Studio visual system and responsive CSS

**Files:**
- Modify: `packages/web/src/tokens.css`
- Modify: `packages/web/src/App.css`
- Create: `packages/web/test/studio-layout-source.test.ts`

- [ ] **Step 1: Add source-level CSS regression tests**

Create `packages/web/test/studio-layout-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

describe("studio room CSS source", () => {
  it("contains the studio shell, avatar rail, floating logo, control center, and message variant selectors", () => {
    for (const selector of [
      ".workspace-header--studio",
      ".room-identity",
      ".role-avatar-rail",
      ".message-own",
      ".message-human-other",
      ".message-ai-card",
      ".message-system-marker",
      ".composer-clear-button",
      ".floating-logo-control",
      ".room-control-center"
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("defines reduced-motion rules for studio animation", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".role-avatar--working");
  });
});
```

- [ ] **Step 2: Run CSS source test and verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- studio-layout-source.test.ts
```

Expected: fails because selectors are missing.

- [ ] **Step 3: Add studio tokens**

Append to `packages/web/src/tokens.css` inside `:root`:

```css
  --studio-bg: #fbf4e8;
  --studio-panel: rgba(253, 250, 242, 0.88);
  --studio-panel-strong: rgba(255, 252, 245, 0.96);
  --studio-ink-soft: #736252;
  --studio-agent: #15110d;
  --studio-agent-2: #2a211a;
  --studio-glow: rgba(194, 65, 12, 0.18);
  --studio-shadow: 0 24px 70px rgba(70, 48, 27, 0.14);
  --studio-shadow-soft: 0 12px 36px rgba(70, 48, 27, 0.08);
  --motion-fast: 140ms;
  --motion-med: 260ms;
  --motion-slow: 440ms;
```

- [ ] **Step 4: Add studio CSS selectors**

Append this block to `packages/web/src/App.css` before the existing mobile breakpoint:

```css
.workspace-header--studio {
  min-height: 62px;
  align-items: center;
  backdrop-filter: blur(18px);
  background: var(--studio-panel);
  box-shadow: var(--studio-shadow-soft);
}

.room-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: min(340px, 32vw);
}

.room-identity h2 {
  font-size: clamp(16px, 1.5vw, 22px);
}

.room-identity p {
  margin-top: 3px;
  color: var(--ink-4);
  font-size: 12px;
}

.room-id-chip,
.room-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-warm);
  color: var(--ink-3);
  min-height: 32px;
  padding: 6px 10px;
  cursor: pointer;
}

.role-avatar-rail {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
}

.avatar-group-label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: var(--ink-5);
  text-transform: uppercase;
  margin-left: 6px;
}

.role-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-2);
  box-shadow: 0 4px 16px rgba(70, 48, 27, 0.08);
}

.role-avatar--agent {
  background: radial-gradient(circle at 30% 20%, #5a3325, var(--studio-agent));
  color: #fff7ec;
  border-color: rgba(255, 210, 160, 0.26);
}

.role-avatar__initials {
  font-size: 11px;
  font-weight: 800;
}

.role-avatar__status {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 2px solid var(--surface);
  background: var(--success);
}

.role-avatar--typing .role-avatar__status,
.role-avatar--roundtable .role-avatar__status {
  background: var(--accent);
}

.role-avatar--working {
  box-shadow: 0 0 0 3px rgba(194, 65, 12, 0.14), 0 0 24px rgba(194, 65, 12, 0.24);
  animation: studio-breathe 1.8s ease-in-out infinite;
}

.role-avatar--offline {
  filter: grayscale(1);
  opacity: 0.56;
}

.role-avatar-overflow {
  color: var(--ink-4);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 4px 8px;
}

.message-own {
  margin-left: auto;
  background: var(--surface);
  border-color: var(--border-soft);
}

.message-human-other {
  margin-right: auto;
  background: var(--surface-warm);
}

.message-ai-card {
  width: min(940px, 94%);
  margin-right: auto;
  background: linear-gradient(135deg, var(--studio-agent), var(--studio-agent-2));
  color: #fff7ec;
  border-color: rgba(255, 210, 160, 0.22);
  box-shadow: var(--studio-shadow-soft);
}

.message-ai-card .message-meta,
.message-ai-card .message-body {
  color: #fff7ec;
}

.message-system-marker {
  width: fit-content;
  max-width: min(680px, 90%);
  margin: 10px auto;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  background: rgba(255, 247, 235, 0.8);
  color: var(--ink-4);
}

.message-roundtable-queued {
  background: var(--surface-queued);
  border-style: dashed;
  border-color: var(--accent-border);
}

.composer-utility-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.composer-clear-button {
  min-width: 32px;
  min-height: 32px;
  color: var(--accent);
}

.composer-confirm-clear {
  margin-top: 10px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  border-radius: var(--radius-card);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.composer-confirm-clear p {
  margin-right: auto;
  font-size: 12px;
  color: var(--ink-3);
}

.floating-logo-control {
  position: fixed;
  right: -26px;
  z-index: 35;
  width: 58px;
  height: 58px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--surface);
  box-shadow: var(--studio-shadow);
  cursor: pointer;
  transform: translateY(-50%);
  transition: right var(--motion-med) ease, transform var(--motion-med) ease;
}

.floating-logo-control:hover,
.floating-logo-control:focus-visible {
  right: 12px;
}

.floating-logo-control__mark {
  display: block;
  transform: scale(0.34);
  transform-origin: center;
}

.floating-logo-control__badge {
  position: absolute;
  top: -4px;
  left: -4px;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.room-control-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(28, 24, 19, 0.24);
  backdrop-filter: blur(10px);
}

.room-control-center {
  width: min(920px, 96vw);
  max-height: min(760px, 92dvh);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 24px;
  background: var(--studio-panel-strong);
  box-shadow: var(--studio-shadow);
}

.room-control-center__header,
.room-control-center__tabs,
.room-control-center__body {
  padding: 18px 22px;
}

.room-control-center__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-soft);
}

.room-control-center__tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.room-control-center__tabs button {
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  padding: 7px 12px;
  cursor: pointer;
}

.room-control-center__tabs .is-active {
  background: var(--ink);
  color: var(--invert);
}

.agent-cockpit {
  border-radius: 18px;
  padding: 18px;
  background: linear-gradient(135deg, var(--studio-agent), var(--studio-agent-2));
  color: #fff7ec;
}

@keyframes studio-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

@media (prefers-reduced-motion: reduce) {
  .role-avatar--working,
  .floating-logo-control {
    animation: none;
    transition: none;
  }
}
```

Inside the existing `@media (max-width: 767px)` block, add:

```css
  .workspace-header--studio {
    align-items: flex-start;
    flex-direction: column;
  }

  .room-identity {
    width: 100%;
    min-width: 0;
    justify-content: space-between;
  }

  .role-avatar-rail {
    width: 100%;
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .room-control-center {
    width: 100vw;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
  }

  .room-control-overlay {
    padding: 0;
  }

  .room-control-center__tabs {
    overflow-x: auto;
  }

  .message-ai-card,
  .message-own,
  .message-human-other {
    width: min(100%, 96vw);
  }

  .composer-confirm-clear {
    align-items: stretch;
    flex-direction: column;
  }
```

- [ ] **Step 5: Run CSS source and component tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- studio-layout-source.test.ts room-identity.test.tsx role-avatar-rail.test.tsx floating-logo-control.test.tsx room-control-center.test.tsx thread-message-variants.test.tsx composer-matrix.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: Commit studio visual system**

Run:

```powershell
git add packages/web/src/tokens.css packages/web/src/App.css packages/web/test/studio-layout-source.test.ts
git commit -m "feat(web): style content-first room studio"
```

## Task 12: Full validation and cleanup

**Files:**
- Review: all modified files
- Keep untracked local-only files uncommitted

- [ ] **Step 1: Run focused package tests**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full workspace check**

Run:

```powershell
corepack pnpm check
```

Expected: tests and builds pass across all packages.

- [ ] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Manual Playwright validation**

Start local dev services:

```powershell
corepack pnpm dev:server
corepack pnpm dev:web
```

In a second shell, inspect the room at desktop and mobile sizes:

```powershell
playwright-cli -s=cacp-room open --browser=msedge http://127.0.0.1:5173/
playwright-cli -s=cacp-room resize 1440 1000
playwright-cli -s=cacp-room snapshot
playwright-cli -s=cacp-room screenshot --filename=.playwright-cli\studio-room-desktop.png
playwright-cli -s=cacp-room resize 390 844
playwright-cli -s=cacp-room snapshot
playwright-cli -s=cacp-room screenshot --filename=.playwright-cli\studio-room-mobile.png
playwright-cli -s=cacp-room close
```

Expected observations:
- Header contains room identity, avatar rail, and language toggle only.
- Clear conversation is at composer top-right and requires confirmation.
- Floating logo is half-hidden at the right edge and opens a centered modal.
- Room Control Center contains Agent, People, Invite, Room, Sound, and Advanced.
- Message area has more visible conversation space than the old room page.
- Mobile keeps avatar rail, composer, and floating logo usable.

- [ ] **Step 5: Review git status for local-only files**

Run:

```powershell
git status --short --untracked-files=all
git check-ignore -v .claude/settings.json .playwright-cli/studio-room-desktop.png .playwright-cli/studio-room-mobile.png
```

Expected:
- `.claude/settings.json` remains untracked and uncommitted.
- Playwright screenshots are ignored by `.gitignore`.
- Only intended source/test/spec/plan files are staged or committed.

- [ ] **Step 6: Final commit for validation adjustments**

If validation required small fixes, commit them with a focused message:

```powershell
git add packages/protocol packages/server packages/web
git commit -m "fix(web): polish studio room validation issues"
```

When there are no validation fixes, do not create an empty commit.

## Self-Review Notes

Spec coverage:
- Content-first layout: Tasks 6, 9, 10, 11.
- Slim header with room title, room id, avatars, and language-only controls: Tasks 4, 6, 10, 11.
- Real typing/presence protocol: Tasks 1, 2, 3, 4, 10.
- Distinct message types: Tasks 9 and 11.
- Floating logo control and centered modal: Tasks 8, 10, 11.
- Default-on sound with modal mute: Tasks 5, 8, 10.
- Clear conversation in composer: Task 7.
- Icon-first visual language: Tasks 6, 7, 8, 11.
- Mobile and reduced motion: Task 11 and Task 12.
- Local-first security boundary: Tasks 2, 8, 12.

Implementation order:
- Protocol and server land before web activity calls.
- Web state lands before avatar rail integration.
- Component tests land before Workspace integration.
- Styling lands after classes and component structure exist.

Validation baseline:
- Finish with `corepack pnpm check` and `git diff --check`.
