# Owner Leave Room Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an explicit owner click on **Leave Room** dissolve the CACP room, revoke every participant and agent token, close room sockets, and stop the local connector.

**Architecture:** Add a server-side owner leave endpoint that performs the authoritative shutdown in one transaction, then closes remembered WebSockets for the whole room. Update the web client so only owners call this endpoint before clearing local state; non-owners keep local-only leave. Keep connector logic unchanged because it already exits when the server closes its stream.

**Tech Stack:** TypeScript, Fastify, @fastify/websocket, better-sqlite3 EventStore, React/Vite, Vitest, pnpm workspace.

---

## File Structure

- Modify `packages/server/test/participant-removal.test.ts`: add the failing regression test that proves owner leave revokes owner, member, and agent tokens and records shutdown events.
- Modify `packages/server/src/server.ts`: add room socket close helper and `POST /rooms/:roomId/leave` route.
- Modify `packages/web/test/api.test.ts`: add API helper test for `leaveRoom`.
- Modify `packages/web/src/api.ts`: add `leaveRoom(session)` helper.
- Modify `packages/web/src/App.tsx`: make owner Leave call `leaveRoom`, and handle `owner_left_room` socket close reason for invited users.

## Task 1: Server regression test

**Files:**
- Modify: `packages/server/test/participant-removal.test.ts`
- Test: `packages/server/test/participant-removal.test.ts`

- [ ] **Step 1: Write the failing server test**

Add these imports at the top of `packages/server/test/participant-removal.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/event-store.js";
```

Add this test inside the existing `describe("participant removal", () => { ... })` block:

```ts
  it("owner leave revokes everyone and records room shutdown events", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-owner-leave-"));
    const dbPath = join(tempDir, "room.db");
    try {
      app = await buildServer({ dbPath, config: config() });
      const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
      const ownerAuth = { authorization: `Bearer ${room.owner_token}` };
      const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member" } })).json() as { invite_token: string };
      const joined = await joinViaApproval(app, room.room_id, room.owner_token, invite.invite_token, "Alice");
      const agentResponse = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Claude", capabilities: ["claude-code"] } });
      expect(agentResponse.statusCode).toBe(201);
      const agent = agentResponse.json() as { agent_id: string; agent_token: string };

      const left = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/leave`, headers: ownerAuth, payload: {} });
      expect(left.statusCode).toBe(201);
      expect(left.json()).toEqual({ ok: true, status: "room_closed" });

      const ownerMessage = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "owner after leave" } });
      expect(ownerMessage.statusCode).toBe(401);
      expect(ownerMessage.json()).toEqual({ error: "invalid_token" });

      const memberMessage = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/messages`,
        headers: { authorization: `Bearer ${joined.participant_token}` },
        payload: { text: "member after owner leave" }
      });
      expect(memberMessage.statusCode).toBe(401);
      expect(memberMessage.json()).toEqual({ error: "invalid_token" });

      const agentTurnStart = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/agent-turns/turn_missing/start`,
        headers: { authorization: `Bearer ${agent.agent_token}` },
        payload: {}
      });
      expect(agentTurnStart.statusCode).toBe(401);
      expect(agentTurnStart.json()).toEqual({ error: "invalid_token" });

      await app.close();
      app = undefined;
      const store = new EventStore(dbPath);
      try {
        const events = store.listEvents(room.room_id);
        const removals = events.filter((event) => event.type === "participant.removed");
        expect(removals).toEqual(expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: room.owner_id, removed_by: room.owner_id, reason: "owner_left_room" }) }),
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: joined.participant_id, removed_by: room.owner_id, reason: "owner_left_room" }) }),
          expect.objectContaining({ payload: expect.objectContaining({ participant_id: agent.agent_id, removed_by: room.owner_id, reason: "owner_left_room" }) })
        ]));
        expect(events).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "agent.status_changed", payload: expect.objectContaining({ agent_id: agent.agent_id, status: "offline" }) })
        ]));
      } finally {
        store.close();
      }
    } finally {
      await app?.close();
      app = undefined;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails for the missing endpoint**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- participant-removal.test.ts
```

Expected result: the new test fails because `POST /rooms/:roomId/leave` returns 404 instead of 201.

- [ ] **Step 3: Commit the failing test only after verifying RED**

Do not commit this step if the test does not fail for the missing endpoint. After verifying the expected failure, keep the test in the working tree for Task 2.

## Task 2: Server owner leave endpoint

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/participant-removal.test.ts`

- [ ] **Step 1: Add a helper that closes all sockets in a room**

In `packages/server/src/server.ts`, directly after `closeParticipantSockets`, add:

```ts
  function closeRoomSockets(roomId: string, code: number, reason: string): void {
    for (const [key, sockets] of [...participantSockets.entries()]) {
      if (!key.startsWith(`${roomId}:`)) continue;
      for (const socket of [...sockets]) socket.close(code, reason);
    }
  }
```

- [ ] **Step 2: Add the owner leave route before the participant remove route**

In `packages/server/src/server.ts`, immediately before the existing `/rooms/:roomId/participants/:participantId/remove` route, add:

```ts
  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/leave", async (request, reply) => {
    const actor = requireParticipant(store, request.params.roomId, request);
    if (!actor) return deny(reply, "invalid_token");
    if (!hasHumanRole(actor, ["owner"])) return deny(reply, "forbidden", 403);
    z.object({}).parse(request.body ?? {});

    const removedAt = new Date().toISOString();
    const participants = store.getParticipants(request.params.roomId);
    const storedEvents = store.transaction(() => {
      const events: CacpEvent[] = [];
      for (const target of participants) {
        store.revokeParticipant(request.params.roomId, target.id, actor.id, removedAt, "owner_left_room");
        events.push(store.appendEvent(event(request.params.roomId, "participant.removed", actor.id, {
          participant_id: target.id,
          removed_by: actor.id,
          removed_at: removedAt,
          reason: "owner_left_room"
        })));
        if (target.role === "agent") {
          events.push(store.appendEvent(event(request.params.roomId, "agent.status_changed", target.id, { agent_id: target.id, status: "offline" })));
        }
      }
      return events;
    });
    publishEvents(storedEvents);
    closeRoomSockets(request.params.roomId, 4001, "owner_left_room");
    return reply.code(201).send({ ok: true, status: "room_closed" });
  });
```

- [ ] **Step 3: Run the server regression test to verify GREEN**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- participant-removal.test.ts
```

Expected result: all tests in `participant-removal.test.ts` pass.

- [ ] **Step 4: Commit the server fix**

Run:

```powershell
git add packages/server/src/server.ts packages/server/test/participant-removal.test.ts
git commit -m "fix(server): close room when owner leaves"
```

## Task 3: Web API and owner Leave button behavior

**Files:**
- Modify: `packages/web/test/api.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Write the failing web API test**

In `packages/web/test/api.test.ts`, add `leaveRoom` to the import from `../src/api.js`:

```ts
import { approveAiCollectionRequest, cancelAiCollection, clearEventSocket, clearRoom, createJoinRequest, createLocalAgentLaunch, createRoom, createRoomWithLocalAgent, joinRequestStatus, leaveRoom, pairingServerUrlFor, parseCacpEventMessage, rejectAiCollectionRequest, requestAiCollection, startAiCollection, submitAiCollection, type RoomSession } from "../src/api.js";
```

Add this test inside `describe("room API", () => { ... })`:

```ts
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
```

- [ ] **Step 2: Run the web API test to verify RED**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts
```

Expected result: the new test fails because `leaveRoom` is not exported from `packages/web/src/api.ts`.

- [ ] **Step 3: Add the `leaveRoom` API helper**

In `packages/web/src/api.ts`, after `clearRoom`, add:

```ts
export async function leaveRoom(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/leave`, session.token, {});
}
```

- [ ] **Step 4: Update web socket-close handling and owner Leave flow**

In `packages/web/src/App.tsx`, add `leaveRoom` to the API import list.

Replace the existing close handler body in the `connectEvents` effect with:

```ts
        if (code === 4001 || reason === "participant_removed" || reason === "owner_left_room") {
          clearStoredSession(window.localStorage);
          setSession(undefined);
          setEvents([]);
          setCreatedInvite(undefined);
          setLocalLaunch(undefined);
          setCreatedPairing(undefined);
          setConnectorModalPairing(undefined);
          setWaitingRoom(undefined);
          setError(reason === "owner_left_room" ? "The room owner closed the room." : "You have been removed from the room.");
        }
```

Extract the repeated local clear logic before `handleLeaveRoom`:

```ts
  const clearActiveRoomSession = useCallback((): void => {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setCreatedPairing(undefined);
    setConnectorModalPairing(undefined);
    setWaitingRoom(undefined);
    setError(undefined);
  }, []);
```

Replace `handleLeaveRoom` with:

```ts
  const handleLeaveRoom = useCallback((): void => {
    if (!session || session.role !== "owner") {
      clearActiveRoomSession();
      return;
    }
    void run(async () => {
      await leaveRoom(session);
      clearActiveRoomSession();
    });
  }, [clearActiveRoomSession, session]);
```

- [ ] **Step 5: Run the web API test to verify GREEN**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts
```

Expected result: `api.test.ts` passes.

- [ ] **Step 6: Commit the web fix**

Run:

```powershell
git add packages/web/src/api.ts packages/web/src/App.tsx packages/web/test/api.test.ts
git commit -m "fix(web): notify server when owner leaves room"
```

## Task 4: Full validation

**Files:**
- Validate changed workspace packages.

- [ ] **Step 1: Run focused server and web tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- participant-removal.test.ts
corepack pnpm --filter @cacp/web test -- api.test.ts
```

Expected result: both commands pass with no failing tests.

- [ ] **Step 2: Run package builds through the repo check command**

Run:

```powershell
corepack pnpm check
```

Expected result: tests and builds pass for all packages.

- [ ] **Step 3: Inspect final git state**

Run:

```powershell
git status --short
git log --oneline -4
```

Expected result: only intentional files are committed, and the recent commits include the design doc commit plus the server and web fixes.
