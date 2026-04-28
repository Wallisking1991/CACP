# Roundtable Mode and Agent Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Roundtable Mode request/approval UX and remove CACP-level AI turn timeouts while preserving one-at-a-time queued agent turns.

**Architecture:** Keep the internal `ai.collection.*` events and `/ai-collection/*` endpoints for compatibility, but change all product-facing copy to Roundtable Mode / 圆桌模式. Add request lifecycle events, derive pending request state from the append-only event log, and make server turn scheduling rely on completion/failure events rather than age. The local CLI adapter only applies `timeout_ms` when explicitly configured.

**Tech Stack:** TypeScript, Node 20, pnpm workspace, Fastify, WebSocket, SQLite event store, React 19, Vite, Vitest, Testing Library, Zod.

---

## Execution Notes

Recommended isolation:

```powershell
git status --short --untracked-files=all
git worktree add .worktrees/roundtable-mode -b feat/roundtable-mode
cd .worktrees/roundtable-mode
corepack pnpm install
```

If working in the current checkout, check `git status --short --untracked-files=all` first and preserve unrelated changes.

## File Structure

- `packages/protocol/src/schemas.ts` / `packages/protocol/test/protocol.test.ts` — event type contract.
- `packages/cli-adapter/src/runner.ts` / `packages/cli-adapter/test/runner.test.ts` — default timeout removal.
- `packages/server/src/server.ts` / `packages/server/test/server-conversation.test.ts` — request lifecycle, active-turn guards, queue behavior.
- `packages/web/src/api.ts` / `packages/web/test/api.test.ts` — Roundtable request API functions.
- `packages/web/src/room-state.ts` / `packages/web/test/room-state.test.ts` — `pendingRoundtableRequest` derivation.
- `packages/web/src/components/Composer.tsx` / `packages/web/test/composer-matrix.test.tsx` — Roundtable and queue composer copy/behavior.
- `packages/web/src/components/RoundtableRequestModal.tsx` / `packages/web/test/workspace-roundtable-request-modal.test.tsx` — owner approval prompt.
- `packages/web/src/components/Workspace.tsx`, `packages/web/src/App.tsx`, `packages/web/src/i18n/messages.en.json`, `packages/web/src/i18n/messages.zh.json` — web wiring and bilingual copy.
- `packages/web/test/app-copy.test.ts`, `README.md`, `README.zh-CN.md`, `docs/protocol/cacp-v0.2.md`, `docs/cacp-concept.svg`, `docs/cacp-concept.en.svg`, `docs/cacp-architecture.svg` — product copy and protocol docs.

---

### Task 1: Add Protocol Event Types

**Files:**
- Modify: `packages/protocol/test/protocol.test.ts`
- Modify: `packages/protocol/src/schemas.ts`

- [ ] **Step 1: Write the failing protocol test**

Update the AI flow-control event list in `packages/protocol/test/protocol.test.ts`:

```ts
for (const type of [
  "ai.collection.started",
  "ai.collection.submitted",
  "ai.collection.cancelled",
  "ai.collection.requested",
  "ai.collection.request_approved",
  "ai.collection.request_rejected",
  "room.history_cleared"
] as const) {
  expect(CacpEventSchema.parse({
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${type}`,
    room_id: "room_1",
    type,
    actor_id: "user_1",
    created_at: "2026-04-26T00:00:00.000Z",
    payload: {}
  }).type).toBe(type);
}
```

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
```

Expected: FAIL because the three request lifecycle event names are not in `EventTypeSchema`.

- [ ] **Step 3: Implement the schema change**

In `packages/protocol/src/schemas.ts`, extend the `ai.collection.*` event row:

```ts
"ai.collection.started", "ai.collection.submitted", "ai.collection.cancelled", "ai.collection.requested", "ai.collection.request_approved", "ai.collection.request_rejected",
```

- [ ] **Step 4: Verify and commit**

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
git add packages/protocol/src/schemas.ts packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add roundtable request events"
```

Expected: test PASS, commit created.

---

### Task 2: Remove the CLI Adapter Default Timeout

**Files:**
- Modify: `packages/cli-adapter/test/runner.test.ts`
- Modify: `packages/cli-adapter/src/runner.ts`

- [ ] **Step 1: Write the failing no-default-timeout test**

Add this test before the explicit timeout test:

```ts
it("does not create a timeout when timeout_ms is omitted", async () => {
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  try {
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.stdout.write('done')"],
      working_dir: process.cwd(),
      prompt: "",
      onOutput: () => undefined
    });
    expect(result.exit_code).toBe(0);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  } finally {
    setTimeoutSpy.mockRestore();
  }
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- runner.test.ts
```

Expected: FAIL because `runCommandForTask` currently calls `setTimeout` when `timeout_ms` is omitted.

- [ ] **Step 3: Make timeout opt-in**

In `packages/cli-adapter/src/runner.ts`, replace:

```ts
const timeoutMs = options.timeout_ms ?? 60_000;
```

with:

```ts
const timeoutMs = options.timeout_ms;
```

Replace the unconditional timer with:

```ts
const timeout = typeof timeoutMs === "number"
  ? setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, process.platform);
    }, timeoutMs)
  : undefined;
```

Replace each `clearTimeout(timeout);` with:

```ts
if (timeout) clearTimeout(timeout);
```

Keep the existing timeout error:

```ts
if (timedOut) throw new Error(`command timed out after ${timeoutMs}ms`);
```

- [ ] **Step 4: Verify and commit**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- runner.test.ts
git add packages/cli-adapter/src/runner.ts packages/cli-adapter/test/runner.test.ts
git commit -m "fix(adapter): remove default command timeout"
```

Expected: existing explicit `timeout_ms: 200` test still PASS.

---

### Task 3: Fix Server Queue Semantics

**Files:**
- Modify: `packages/server/test/server-conversation.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Add stale-turn regression coverage**

Change the test import to:

```ts
import { describe, expect, it, vi } from "vitest";
```

Add this test:

```ts
it("queues followup for old open turns without stale recovery", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
    const { app, room, ownerAuth } = await createRoom();
    const agent = await registerAgent(app, room.room_id, ownerAuth);
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "First slow question" } });

    vi.setSystemTime(new Date("2026-04-28T00:03:10.000Z"));
    expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Second queued question" } })).statusCode).toBe(201);

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((event) => event.type === "agent.turn.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent.turn.followup_queued")).toHaveLength(1);
    expect(events.some((event) => event.type === "agent.turn.failed" && event.payload.error === "stale_turn_recovered")).toBe(false);
    await app.close();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Add queued-after-failure coverage**

Add this test:

```ts
it("starts a queued followup after an agent turn fails", async () => {
  const { app, room, ownerAuth } = await createRoom();
  const agent = await registerAgent(app, room.room_id, ownerAuth);
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "First question" } });
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "Second queued question" } });

  let events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
  const turnId = String(events.find((event) => event.type === "agent.turn.requested")!.payload.turn_id);
  const agentAuth = { authorization: `Bearer ${agent.agent_token}` };

  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/start`, headers: agentAuth, payload: {} })).statusCode).toBe(201);
  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-turns/${turnId}/fail`, headers: agentAuth, payload: { error: "CLI exited", exit_code: 1 } })).statusCode).toBe(201);

  events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events;
  const requestedTurns = events.filter((event) => event.type === "agent.turn.requested");
  expect(requestedTurns).toHaveLength(2);
  expect(requestedTurns[1].payload.reason).toBe("queued_followup");
  expect(String(requestedTurns[1].payload.context_prompt)).toContain("Second queued question");
  await app.close();
});
```

- [ ] **Step 3: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- server-conversation.test.ts
```

Expected: FAIL because age-based stale recovery and fail-route behavior are still wrong.

- [ ] **Step 4: Remove age-based stale recovery**

In `packages/server/src/server.ts`, delete `isOpenTurnStale(...)`. In `createAgentTurnRequestEvents(...)`, replace the open-turn block with:

```ts
if (openTurn) {
  if (hasQueuedFollowup(turnEvents, openTurn.turn_id)) return [];
  return [event(roomId, "agent.turn.followup_queued", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId })];
}
```

Keep the existing offline-agent branch before this block.

- [ ] **Step 5: Start queued followups after turn failure**

Replace the fail-route `appendAndPublish(...)` with:

```ts
const storedEvents = store.transaction(() => {
  const failed = store.appendEvent(event(request.params.roomId, "agent.turn.failed", participant.id, {
    turn_id: request.params.turnId,
    agent_id: participant.id,
    ...TurnFailedSchema.parse(request.body)
  }));
  const followupEvents = hasQueuedFollowup(store.listEvents(request.params.roomId), request.params.turnId)
    ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup").map((nextEvent) => store.appendEvent(nextEvent))
    : [];
  return [failed, ...followupEvents];
});
publishEvents(storedEvents);
return reply.code(201).send({ ok: true });
```

- [ ] **Step 6: Verify and commit**

```powershell
corepack pnpm --filter @cacp/server test -- server-conversation.test.ts
git add packages/server/src/server.ts packages/server/test/server-conversation.test.ts
git commit -m "fix(server): queue turns without stale recovery"
```

---

### Task 4: Add Server Roundtable Request Lifecycle

**Files:**
- Modify: `packages/server/test/server-conversation.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Add failing server request tests**

Add a `joinObserver(...)` helper by copying `joinMember(...)` and changing the invite role and returned role to `"observer"`.

Add this approval test:

```ts
it("lets members request Roundtable Mode and owner approval starts it atomically", async () => {
  const { app, room, ownerAuth } = await createRoom();
  const member = await joinMember(app, room.room_id, ownerAuth, "Bob");
  const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
  expect(request.statusCode).toBe(201);
  const requestId = (request.json() as { request_id: string }).request_id;

  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} })).statusCode).toBe(409);
  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(409);

  const approve = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/approve`, headers: ownerAuth, payload: {} });
  expect(approve.statusCode).toBe(201);
  const collectionId = (approve.json() as { collection_id: string }).collection_id;

  const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
  const approvedIndex = events.findIndex((event) => event.type === "ai.collection.request_approved");
  const startedIndex = events.findIndex((event) => event.type === "ai.collection.started");
  expect(startedIndex).toBe(approvedIndex + 1);
  expect(events[approvedIndex].payload).toMatchObject({ request_id: requestId, collection_id: collectionId });
  expect(events[startedIndex].payload).toMatchObject({ request_id: requestId, collection_id: collectionId });
  await app.close();
});
```

Add rejection and permission coverage:

```ts
it("rejects Roundtable requests without starting a collection", async () => {
  const { app, room, ownerAuth } = await createRoom();
  const member = await joinMember(app, room.room_id, ownerAuth, "Bob");
  const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
  const requestId = (request.json() as { request_id: string }).request_id;
  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/reject`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
  const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
  expect(events.some((event) => event.type === "ai.collection.request_rejected" && event.payload.request_id === requestId)).toBe(true);
  expect(events.some((event) => event.type === "ai.collection.started")).toBe(false);
  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/start`, headers: ownerAuth, payload: {} })).statusCode).toBe(201);
  await app.close();
});

it("rejects observers and active-turn Roundtable approval", async () => {
  const { app, room, ownerAuth } = await createRoom();
  const agent = await registerAgent(app, room.room_id, ownerAuth);
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.agent_id } });
  const observer = await joinObserver(app, room.room_id, ownerAuth, "Olivia");
  const member = await joinMember(app, room.room_id, ownerAuth, "Bob");

  expect((await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: observer.auth, payload: {} })).statusCode).toBe(403);
  await app.inject({ method: "POST", url: `/rooms/${room.room_id}/messages`, headers: ownerAuth, payload: { text: "AI should answer this first." } });
  const request = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/request`, headers: member.auth, payload: {} });
  const requestId = (request.json() as { request_id: string }).request_id;
  const approve = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/ai-collection/requests/${requestId}/approve`, headers: ownerAuth, payload: {} });
  expect(approve.statusCode).toBe(409);
  expect(approve.json()).toMatchObject({ error: "active_turn_in_flight" });
  await app.close();
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- server-conversation.test.ts
```

Expected: FAIL because routes and helper derivations do not exist.

- [ ] **Step 3: Add server helpers**

Import the open-turn type:

```ts
import { buildAgentContextPrompt, buildCollectedAnswersPrompt, eventsAfterLastHistoryClear, findActiveAgentId, findOpenTurn, hasQueuedFollowup, recentConversationMessages, type OpenTurn } from "./conversation.js";
```

Add near `ActiveCollection`:

```ts
type PendingCollectionRequest = { request_id: string; requested_by: string; requested_at: string };
```

Add after `activeCollectionFor(...)`:

```ts
function pendingCollectionRequestFor(roomId: string): PendingCollectionRequest | undefined {
  let pending: PendingCollectionRequest | undefined;
  for (const storedEvent of eventsAfterLastHistoryClear(store.listEvents(roomId))) {
    if (storedEvent.type === "ai.collection.requested" && typeof storedEvent.payload.request_id === "string" && typeof storedEvent.payload.requested_by === "string") {
      pending = { request_id: storedEvent.payload.request_id, requested_by: storedEvent.payload.requested_by, requested_at: storedEvent.created_at };
    }
    if ((storedEvent.type === "ai.collection.request_approved" || storedEvent.type === "ai.collection.request_rejected") && typeof storedEvent.payload.request_id === "string" && pending?.request_id === storedEvent.payload.request_id) {
      pending = undefined;
    }
  }
  return pending;
}

function openTurnForActiveAgent(roomId: string): OpenTurn | undefined {
  const events = store.listEvents(roomId);
  const activeAgentId = findActiveAgentId(events);
  return activeAgentId ? findOpenTurn(eventsAfterLastHistoryClear(events), activeAgentId) : undefined;
}
```

- [ ] **Step 4: Add endpoint behavior**

In direct start, after active collection check:

```ts
if (pendingCollectionRequestFor(request.params.roomId)) return deny(reply, "pending_collection_request_exists", 409);
if (openTurnForActiveAgent(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
```

In submit, after active collection check:

```ts
if (openTurnForActiveAgent(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
```

Insert routes before submit:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/request", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["admin", "member"])) return deny(reply, "forbidden", 403);
  if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
  if (pendingCollectionRequestFor(request.params.roomId)) return deny(reply, "pending_collection_request_exists", 409);
  const requestId = prefixedId("collection_request");
  appendAndPublish(event(request.params.roomId, "ai.collection.requested", participant.id, { request_id: requestId, requested_by: participant.id }));
  return reply.code(201).send({ request_id: requestId, requested_by: participant.id, status: "pending" });
});

app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/ai-collection/requests/:requestId/approve", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
  const pending = pendingCollectionRequestFor(request.params.roomId);
  if (!pending || pending.request_id !== request.params.requestId) return deny(reply, "no_pending_collection_request", 409);
  if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
  if (openTurnForActiveAgent(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
  const collectionId = prefixedId("collection");
  const storedEvents = store.transaction(() => [
    store.appendEvent(event(request.params.roomId, "ai.collection.request_approved", participant.id, { request_id: request.params.requestId, approved_by: participant.id, collection_id: collectionId })),
    store.appendEvent(event(request.params.roomId, "ai.collection.started", participant.id, { collection_id: collectionId, started_by: participant.id, request_id: request.params.requestId }))
  ]);
  publishEvents(storedEvents);
  return reply.code(201).send({ ok: true, collection_id: collectionId, request_id: request.params.requestId });
});

app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/ai-collection/requests/:requestId/reject", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
  const pending = pendingCollectionRequestFor(request.params.roomId);
  if (!pending || pending.request_id !== request.params.requestId) return deny(reply, "no_pending_collection_request", 409);
  appendAndPublish(event(request.params.roomId, "ai.collection.request_rejected", participant.id, { request_id: request.params.requestId, rejected_by: participant.id }));
  return reply.code(201).send({ ok: true, request_id: request.params.requestId });
});
```

- [ ] **Step 5: Verify and commit**

```powershell
corepack pnpm --filter @cacp/server test -- server-conversation.test.ts
git add packages/server/src/server.ts packages/server/test/server-conversation.test.ts
git commit -m "feat(server): add roundtable request lifecycle"
```

---

### Task 5: Add Web API and Room State

**Files:**
- Modify: `packages/web/test/api.test.ts`
- Modify: `packages/web/test/room-state.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/room-state.ts`

- [ ] **Step 1: Write failing web API tests**

Import `requestAiCollection`, `approveAiCollectionRequest`, and `rejectAiCollectionRequest`. Add:

```ts
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
  await expect(approveAiCollectionRequest(owner, "collection_request_1")).resolves.toEqual({ collection_id: "collection_1", request_id: "collection_request_1" });

  mockJsonResponse({ ok: true, request_id: "collection_request_1" });
  await rejectAiCollectionRequest(owner, "collection_request_1");
  expect(fetch).toHaveBeenLastCalledWith("/rooms/room_1/ai-collection/requests/collection_request_1/reject", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
    body: JSON.stringify({})
  });
});
```

- [ ] **Step 2: Write failing room-state tests**

Add:

```ts
it("derives the pending Roundtable request from collection request events", () => {
  const state = deriveRoomState([
    event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
    event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2, "user_2"),
    event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_2" }, 3, "user_2")
  ]);
  expect(state.pendingRoundtableRequest).toEqual({
    request_id: "collection_request_1",
    requested_by: "user_2",
    requester_name: "Bob",
    created_at: "2026-04-25T00:00:03.000Z"
  });

  const resolved = deriveRoomState([
    event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_2" }, 1, "user_2"),
    event("ai.collection.request_rejected", { request_id: "collection_request_1", rejected_by: "user_1" }, 2, "user_1")
  ]);
  expect(resolved.pendingRoundtableRequest).toBeUndefined();
});
```

- [ ] **Step 3: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts room-state.test.ts
```

- [ ] **Step 4: Implement API functions**

In `packages/web/src/api.ts`, add:

```ts
export interface AiCollectionRequestResult { request_id: string; requested_by: string; status: "pending" }
export interface AiCollectionRequestApprovalResult { collection_id: string; request_id: string }

export async function requestAiCollection(session: RoomSession): Promise<AiCollectionRequestResult> {
  return await postJson(`/rooms/${session.room_id}/ai-collection/request`, session.token, {});
}

export async function approveAiCollectionRequest(session: RoomSession, requestId: string): Promise<AiCollectionRequestApprovalResult> {
  return await postJson(`/rooms/${session.room_id}/ai-collection/requests/${requestId}/approve`, session.token, {});
}

export async function rejectAiCollectionRequest(session: RoomSession, requestId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/ai-collection/requests/${requestId}/reject`, session.token, {});
}
```

- [ ] **Step 5: Implement room-state derivation**

In `packages/web/src/room-state.ts`, add:

```ts
export interface RoundtableRequestView { request_id: string; requested_by: string; requester_name: string; created_at: string }
```

Add `pendingRoundtableRequest?: RoundtableRequestView;` to `RoomViewState`. In `deriveRoomState`, add:

```ts
const roundtableRequests = new Map<string, RoundtableRequestView>();
```

Inside the scoped event loop:

```ts
if (event.type === "ai.collection.requested" && typeof event.payload.request_id === "string" && typeof event.payload.requested_by === "string") {
  const requester = participants.get(event.payload.requested_by);
  roundtableRequests.set(event.payload.request_id, {
    request_id: event.payload.request_id,
    requested_by: event.payload.requested_by,
    requester_name: requester?.display_name ?? event.payload.requested_by,
    created_at: event.created_at
  });
}
if ((event.type === "ai.collection.request_approved" || event.type === "ai.collection.request_rejected") && typeof event.payload.request_id === "string") {
  roundtableRequests.delete(event.payload.request_id);
}
```

Before return:

```ts
const pendingRoundtableRequest = [...roundtableRequests.values()][0];
```

Include `pendingRoundtableRequest` in the returned state.

- [ ] **Step 6: Verify and commit**

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts room-state.test.ts
git add packages/web/src/api.ts packages/web/src/room-state.ts packages/web/test/api.test.ts packages/web/test/room-state.test.ts
git commit -m "feat(web): derive roundtable requests"
```

---

### Task 6: Add Web Roundtable UI

**Files:**
- Create: `packages/web/src/components/RoundtableRequestModal.tsx`
- Create: `packages/web/test/workspace-roundtable-request-modal.test.tsx`
- Modify: `packages/web/src/components/Composer.tsx`
- Modify: `packages/web/src/components/Workspace.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Modify: `packages/web/test/composer-matrix.test.tsx`

- [ ] **Step 1: Write failing Composer tests**

Extend `baseProps` in `composer-matrix.test.tsx`:

```ts
pendingRoundtableRequest: false,
onRequestRoundtable: noop,
```

Update tests to query `Roundtable` instead of `Collect`. Add:

```ts
it("lets members request Roundtable Mode from live mode", () => {
  const onRequestRoundtable = vi.fn();
  renderComposer({ ...baseProps, role: "member", onRequestRoundtable });
  fireEvent.click(screen.getByRole("button", { name: /Request Roundtable/i }));
  expect(onRequestRoundtable).toHaveBeenCalled();
});

it("shows Queue message wording while the AI is replying", () => {
  renderComposer({ ...baseProps, turnInFlight: true });
  expect(screen.getByText(/AI is replying\. Your message will wait for the next turn\./i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Queue message/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Type a message/i)).not.toBeDisabled();
});
```

- [ ] **Step 2: Write failing Workspace modal tests**

Create `packages/web/test/workspace-roundtable-request-modal.test.tsx` with a `renderWorkspace(...)` helper matching `workspace-join-request-modal.test.tsx`, but use events:

```ts
event("participant.joined", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }, 2),
event("participant.joined", { participant: { id: "user_member", display_name: "Bob", role: "member", type: "human" } }, 3, "user_member"),
event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_member" }, 4, "user_member")
```

Assert:

```ts
expect(screen.getByRole("dialog", { name: "Roundtable request" })).toBeInTheDocument();
expect(screen.getByText("Bob wants to start Roundtable Mode.")).toBeInTheDocument();
fireEvent.click(within(screen.getByRole("dialog", { name: "Roundtable request" })).getByRole("button", { name: "Start Roundtable" }));
expect(onApproveRoundtableRequest).toHaveBeenCalledWith("collection_request_1");
```

Also add tests for non-owner hidden, reject callback, local `Later`, and disabled `Start Roundtable` when `agent.turn.started` is present.

- [ ] **Step 3: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- composer-matrix.test.tsx workspace-roundtable-request-modal.test.tsx
```

- [ ] **Step 4: Create modal component**

Create `RoundtableRequestModal.tsx`:

```tsx
import type { RoundtableRequestView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

export interface RoundtableRequestModalProps {
  request?: RoundtableRequestView;
  turnInFlight: boolean;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onLater: (requestId: string) => void;
}

export default function RoundtableRequestModal({ request, turnInFlight, onApprove, onReject, onLater }: RoundtableRequestModalProps) {
  const t = useT();
  if (!request) return null;
  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("roundtableRequestModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("roundtableRequestModal.title")}</p>
        <h3>{t("roundtableRequestModal.body", { name: request.requester_name })}</h3>
        {turnInFlight && <p className="join-request-modal-subcopy">{t("roundtableRequestModal.waitForTurn")}</p>}
        <div className="join-request-modal-actions">
          <button type="button" className="btn btn-primary" disabled={turnInFlight} onClick={() => onApprove(request.request_id)}>{t("roundtableRequestModal.start")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => onReject(request.request_id)}>{t("sidebar.reject")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => onLater(request.request_id)}>{t("joinRequestModal.later")}</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Update Composer behavior**

Add props:

```ts
pendingRoundtableRequest: boolean;
onRequestRoundtable: () => void;
```

Use:

```ts
const canRequestRoundtable = (role === "admin" || role === "member") && effectiveCanSend && isLive && !pendingRoundtableRequest;
```

Make the second mode button owner-start or member-request:

```tsx
<button
  type="button"
  className={`mode-toggle-btn ${!isLive ? "active" : ""}`}
  disabled={isOwner ? (!canToggleMode || pendingRoundtableRequest) : !canRequestRoundtable}
  onClick={isOwner ? (!isLive ? undefined : onToggleMode) : onRequestRoundtable}
  aria-pressed={!isLive}
>
  {isOwner || !isLive ? t("composer.roundtable") : pendingRoundtableRequest ? t("composer.roundtablePending") : t("composer.requestRoundtable")}
</button>
```

Use Roundtable copy keys:

```tsx
t("composer.roundtableActiveHint")
t("composer.memberRoundtableHint")
t("composer.queue")
t("composer.add")
t("composer.cancelRoundtable")
t("composer.submitRoundtable", { count: collectCount })
```

- [ ] **Step 6: Wire Workspace and App**

In `WorkspaceProps`, add:

```ts
onRequestRoundtable: () => void;
onApproveRoundtableRequest: (requestId: string) => void;
onRejectRoundtableRequest: (requestId: string) => void;
```

Import and render `RoundtableRequestModal`, derive `visibleRoundtableRequest` from `room.pendingRoundtableRequest`, maintain `dismissedRoundtableRequestIds`, pass `pendingRoundtableRequest={Boolean(room.pendingRoundtableRequest)}` and `onRequestRoundtable={onRequestRoundtable}` to `Composer`.

In `App.tsx`, import and wire:

```ts
requestAiCollection,
approveAiCollectionRequest,
rejectAiCollectionRequest,
```

Handlers:

```ts
const handleRequestRoundtable = useCallback(() => {
  if (!session) return;
  void run(async () => { await requestAiCollection(session); });
}, [session]);

const handleApproveRoundtableRequest = useCallback((requestId: string) => {
  if (!session) return;
  void run(async () => { await approveAiCollectionRequest(session, requestId); });
}, [session]);

const handleRejectRoundtableRequest = useCallback((requestId: string) => {
  if (!session) return;
  void run(async () => { await rejectAiCollectionRequest(session, requestId); });
}, [session]);
```

- [ ] **Step 7: Update bilingual i18n**

English values:

```json
"composer.roundtable": "Roundtable",
"composer.requestRoundtable": "Request Roundtable",
"composer.roundtablePending": "Roundtable request pending",
"composer.queuedHint": "AI is replying. Your message will wait for the next turn.",
"composer.queue": "Queue message",
"composer.add": "Add to Roundtable",
"composer.roundtableActiveHint": "Roundtable Mode is active",
"composer.memberRoundtableHint": "Owner is hosting a Roundtable",
"composer.cancelRoundtable": "Cancel Roundtable",
"composer.submitRoundtable": "Submit {count} messages",
"roundtableRequestModal.title": "Roundtable request",
"roundtableRequestModal.body": "{name} wants to start Roundtable Mode.",
"roundtableRequestModal.start": "Start Roundtable",
"roundtableRequestModal.waitForTurn": "AI is replying. Start Roundtable after this turn finishes."
```

Chinese values:

```json
"composer.roundtable": "圆桌",
"composer.requestRoundtable": "申请圆桌",
"composer.roundtablePending": "圆桌申请待处理",
"composer.queuedHint": "AI 正在回复，你的消息会排队到下一轮。",
"composer.queue": "排队发送",
"composer.add": "加入圆桌",
"composer.roundtableActiveHint": "圆桌模式已开启",
"composer.memberRoundtableHint": "房主正在主持圆桌",
"composer.cancelRoundtable": "取消圆桌",
"composer.submitRoundtable": "提交 {count} 条消息",
"roundtableRequestModal.title": "圆桌申请",
"roundtableRequestModal.body": "{name} 想开启圆桌模式。",
"roundtableRequestModal.start": "开启圆桌",
"roundtableRequestModal.waitForTurn": "AI 正在回复，请在本轮结束后开启圆桌。"
```

Also update existing `flow.*`, `composer.collect`, `composer.cancelCollection`, `thread.collectionCancelled`, and `header.statusCollect` values so they display Roundtable/圆桌 wording.

- [ ] **Step 8: Verify and commit**

```powershell
corepack pnpm --filter @cacp/web test -- composer-matrix.test.tsx workspace-roundtable-request-modal.test.tsx
git add packages/web/src/components/Composer.tsx packages/web/src/components/Workspace.tsx packages/web/src/components/RoundtableRequestModal.tsx packages/web/src/App.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/composer-matrix.test.tsx packages/web/test/workspace-roundtable-request-modal.test.tsx
git commit -m "feat(web): add roundtable request flow"
```

---

### Task 7: Update Product Copy and Docs

**Files:**
- Modify: `packages/web/test/app-copy.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/protocol/cacp-v0.2.md`
- Modify: `docs/cacp-concept.svg`
- Modify: `docs/cacp-concept.en.svg`
- Modify: `docs/cacp-architecture.svg`

- [ ] **Step 1: Update copy test**

Replace the old AI collection test in `app-copy.test.ts`:

```ts
it("offers host-controlled Roundtable Mode controls", () => {
  const source = allSource();
  expect(source).toContain("Start Roundtable");
  expect(source).toContain("Submit to Agent");
  expect(source).toContain("Cancel Roundtable");
  expect(source).toContain("Roundtable Mode");
  expect(source).not.toContain("Start AI Collection");
  expect(source).not.toContain("Cancel Collection");
  expect(source).not.toContain("Collecting answers");
});
```

- [ ] **Step 2: Update README wording**

In `README.md`, use:

```md
- **Roundtable Mode**, where the room owner can gather multiple participant messages and submit one consolidated agent turn.

### 5. Collaborate with Roundtable Mode

Use normal live chat for quick turns. When several people need to contribute before the AI responds, use **Roundtable Mode**: members can request it from the composer, the owner approves, participants add their views, and the owner submits one merged prompt to the active agent.
```

In `README.zh-CN.md`, use:

```md
- **圆桌模式**：房主可以先汇集多位成员的输入，再合并成一次 Agent 轮次提交。

### 5. 使用圆桌模式协作

快速讨论可以直接使用普通实时聊天。如果需要多人先发表意见，再让 AI 统一处理，可以使用 **圆桌模式**：成员可在输入区一键申请，房主同意后大家加入观点，最后由房主一次性提交给当前激活的 Agent。
```

- [ ] **Step 3: Update protocol docs and diagrams**

In `docs/protocol/cacp-v0.2.md`, add the three request events and describe:

```md
### 申请圆桌模式
POST /rooms/:roomId/ai-collection/request

### 同意圆桌申请
POST /rooms/:roomId/ai-collection/requests/:requestId/approve

### 拒绝圆桌申请
POST /rooms/:roomId/ai-collection/requests/:requestId/reject
```

Keep `ai.collection.*`, `/ai-collection/*`, and `collection_id` in protocol examples.

Update visible SVG text:

```text
docs/cacp-concept.en.svg: Collect → Review → Submit → One AI turn
  -> Roundtable → Review → Submit → One AI turn

docs/cacp-concept.svg: 消息收集
  -> 圆桌模式

docs/cacp-concept.svg: 收集 → 审阅 → 提交 → 一次 AI 轮次
  -> 圆桌 → 审阅 → 提交 → 一次 AI 轮次

docs/cacp-architecture.svg: AI Flow Control (owner-only batched collection)
  -> Roundtable Mode (owner-approved batch turn)
```

- [ ] **Step 4: Verify and commit**

```powershell
corepack pnpm --filter @cacp/web test -- app-copy.test.ts
rg -n "Start AI Collection|Cancel Collection|Collecting answers|收集模式|开始 AI 收集|取消收集|收集中" packages/web/src README.md README.zh-CN.md docs/cacp-concept.svg docs/cacp-concept.en.svg docs/cacp-architecture.svg
git add packages/web/test/app-copy.test.ts README.md README.zh-CN.md docs/protocol/cacp-v0.2.md docs/cacp-concept.svg docs/cacp-concept.en.svg docs/cacp-architecture.svg
git commit -m "docs: rename collection flow to roundtable mode"
```

Expected: Vitest PASS. The `rg` command returns no user-facing matches.

---

### Task 8: Full Validation

**Files:**
- Modify only files reported by validation failures.

- [ ] **Step 1: Run package tests**

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
```

Expected: all PASS.

- [ ] **Step 2: Run full check**

```powershell
corepack pnpm check
```

Expected: tests and builds PASS across the workspace.

- [ ] **Step 3: Search for forbidden timeout/stale code**

```powershell
rg -n "timeout_ms \?\?|stale_turn_recovered|isOpenTurnStale" packages
```

Expected: no matches.

- [ ] **Step 4: Search for old product copy**

```powershell
rg -n "Start AI Collection|Cancel Collection|Collecting answers|Collect mode|collection mode|收集模式|开始 AI 收集|取消收集|收集中" packages README.md README.zh-CN.md docs/cacp-concept.svg docs/cacp-concept.en.svg docs/cacp-architecture.svg
```

Expected: no user-facing matches. Internal names such as `ai.collection.*`, `/ai-collection/*`, `collection_id`, and `activeCollection` remain acceptable.

- [ ] **Step 5: Verify final status**

```powershell
git status --short --untracked-files=all
```

Expected: clean working tree after commits, or only intentional uncommitted files awaiting review.

## Self-Review Checklist

- Spec coverage:
  - Roundtable Mode naming: Tasks 6 and 7.
  - Member/admin one-click request without reason: Tasks 4, 5, and 6.
  - Owner approve/reject/later prompt: Task 6.
  - No default CACP CLI timeout: Task 2.
  - Queue messages while AI replies and no stale age recovery: Task 3.
  - Active-turn protection for start/approval/submit: Task 4.
  - Local-first boundary preserved: no hosted agent execution changes.
- Placeholder scan: no placeholder markers or incomplete task bodies.
- Type consistency:
  - Events: `ai.collection.requested`, `ai.collection.request_approved`, `ai.collection.request_rejected`.
  - Web state: `pendingRoundtableRequest`.
  - Web callbacks: `onRequestRoundtable`, `onApproveRoundtableRequest`, `onRejectRoundtableRequest`.
