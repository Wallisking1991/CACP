# CACP Decision Protocol and Room UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade CACP from question-based governance to a first-class decision protocol with a chat-first English Web UI, room clearing, and a visible Windows test launcher.

**Architecture:** Add CACP v0.2 decision event schemas, then implement server helpers that derive active/history decision state from the event stream. Web derives all chat, participant, agent, decision, and collapsed-control badge state from events; the server enforces one active blocking decision and records decision responses from normal chat messages.

**Tech Stack:** TypeScript, Zod, Fastify, better-sqlite3 event sourcing, React 19, Vite, Vitest, PowerShell/CMD.

---

## Scope notes

This is one coordinated implementation because protocol, server, Web UI, and CLI agent prompts must agree on the `decision.*` standard for the room flow to be testable. Keep legacy `question.*` routes only as compatibility surface; new prompts, Web UI, and action approvals should use `decision.*`.

## File map

- Protocol:
  - Modify `packages/protocol/src/schemas.ts`
  - Modify `packages/protocol/test/protocol.test.ts`
- Server:
  - Create `packages/server/src/decisions.ts`
  - Modify `packages/server/src/ids.ts`
  - Modify `packages/server/src/conversation.ts`
  - Modify `packages/server/src/pairing.ts`
  - Modify `packages/server/src/server.ts`
  - Add `packages/server/test/decisions.test.ts`
  - Add `packages/server/test/decision-protocol.test.ts`
  - Update `packages/server/test/server-conversation.test.ts`
  - Update `packages/server/test/server-governance.test.ts`
- Web:
  - Modify `packages/web/src/api.ts`
  - Modify `packages/web/src/session-storage.ts`
  - Modify `packages/web/src/room-state.ts`
  - Create `packages/web/src/control-badges.ts`
  - Modify `packages/web/src/App.tsx`
  - Modify `packages/web/src/App.css`
  - Add `packages/web/test/control-badges.test.ts`
  - Add `packages/web/test/app-copy.test.ts`
  - Update `packages/web/test/api.test.ts`
  - Update `packages/web/test/session-storage.test.ts`
  - Update `packages/web/test/room-state.test.ts`
- CLI adapter:
  - Modify `packages/cli-adapter/src/runner.ts`
  - Update `packages/cli-adapter/test/runner.test.ts`
- Launcher/docs:
  - Modify `start-test-services.ps1`
  - Modify `start-test-services.cmd`
  - Update `packages/web/test/start-test-services-script.test.ts`
  - Update `README.md`
  - Add `docs/protocol/cacp-v0.2.md`

---

## Task 1: Add protocol v0.2 decision schemas

**Files:**
- Modify: `packages/protocol/src/schemas.ts`
- Test: `packages/protocol/test/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/protocol/test/protocol.test.ts`:

```ts
import {
  CacpEventSchema,
  DecisionRequestedPayloadSchema,
  DecisionResponseRecordedPayloadSchema,
  DecisionResolvedPayloadSchema,
  DecisionCancelledPayloadSchema
} from "../src/index.js";

it("accepts v0.2 decision events and payloads", () => {
  expect(CacpEventSchema.parse({
    protocol: "cacp",
    version: "0.2.0",
    event_id: "evt_1",
    room_id: "room_1",
    type: "decision.requested",
    actor_id: "agent_1",
    created_at: "2026-04-26T00:00:00.000Z",
    payload: {
      decision_id: "dec_1",
      title: "Choose CLI",
      description: "Pick the first CLI integration.",
      kind: "single_choice",
      options: [{ id: "A", label: "Claude Code CLI" }],
      policy: { type: "majority" },
      blocking: true
    }
  }).type).toBe("decision.requested");

  expect(DecisionRequestedPayloadSchema.parse({
    decision_id: "dec_1",
    title: "Approve write",
    description: "Allow file writes?",
    kind: "approval",
    options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
    policy: { type: "owner_approval" },
    blocking: true
  }).kind).toBe("approval");

  expect(DecisionResponseRecordedPayloadSchema.parse({
    decision_id: "dec_1",
    respondent_id: "user_1",
    response: "approve",
    response_label: "Approve",
    source_message_id: "msg_1",
    interpretation: { method: "deterministic", confidence: 1 }
  }).response).toBe("approve");

  expect(DecisionResolvedPayloadSchema.parse({
    decision_id: "dec_1",
    result: "approve",
    result_label: "Approve",
    decided_by: ["user_1"],
    policy_evaluation: { status: "approved", reason: "owner selected approve" }
  }).result).toBe("approve");

  expect(DecisionCancelledPayloadSchema.parse({
    decision_id: "dec_1",
    reason: "Skipped by owner",
    cancelled_by: "user_1"
  }).reason).toBe("Skipped by owner");
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/protocol test
```

Expected: missing decision schema exports or unknown event type.

- [ ] **Step 3: Implement schemas**

In `packages/protocol/src/schemas.ts`:

```ts
export const ProtocolVersionSchema = z.enum(["0.1.0", "0.2.0"]);

export const DecisionOptionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const DecisionKindSchema = z.enum(["single_choice", "approval", "multiple_choice", "ranking", "free_text_confirmation"]);
export const DecisionRequestedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  kind: DecisionKindSchema,
  options: z.array(DecisionOptionSchema).default([]),
  policy: PolicySchema,
  blocking: z.boolean().default(true),
  decision_type: z.string().optional(),
  action_id: z.string().optional(),
  source_turn_id: z.string().optional(),
  source_message_id: z.string().optional()
});
export const DecisionResponseRecordedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  respondent_id: z.string().min(1),
  response: z.unknown(),
  response_label: z.string().optional(),
  source_message_id: z.string().min(1),
  interpretation: z.object({ method: z.enum(["deterministic", "agent", "manual"]), confidence: z.number().min(0).max(1) })
});
export const DecisionResolvedPayloadSchema = z.object({
  decision_id: z.string().min(1),
  result: z.unknown(),
  result_label: z.string().optional(),
  decided_by: z.array(z.string().min(1)),
  policy_evaluation: z.object({ status: z.enum(["approved", "rejected", "resolved"]), reason: z.string().min(1) })
});
export const DecisionCancelledPayloadSchema = z.object({
  decision_id: z.string().min(1),
  reason: z.string().min(1),
  cancelled_by: z.string().min(1)
});
export const RoomHistoryClearedPayloadSchema = z.object({
  cleared_by: z.string().min(1),
  cleared_at: z.string().datetime(),
  scope: z.literal("messages_and_decisions")
});
```

Add event names:

```ts
"decision.requested", "decision.response_recorded", "decision.resolved", "decision.cancelled", "room.history_cleared",
```

Change event version validation:

```ts
version: ProtocolVersionSchema,
```

Export inferred types for every new schema.

- [ ] **Step 4: Run and commit**

```powershell
corepack pnpm --filter @cacp/protocol test
git add packages/protocol/src/schemas.ts packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add decision event schemas"
```

---

## Task 2: Add server decision parser, interpreter, and policy helpers

**Files:**
- Create: `packages/server/src/decisions.ts`
- Create: `packages/server/test/decisions.test.ts`
- Modify: `packages/server/src/conversation.ts`
- Modify: `packages/server/src/pairing.ts`

- [ ] **Step 1: Write failing helper tests**

Create `packages/server/test/decisions.test.ts` with tests for:

```ts
expect(extractCacpDecisions(textWithCacpDecisionBlock, { type: "majority" })[0]).toMatchObject({
  title: "Choose CLI",
  policy: { type: "majority" }
});
expect(interpretDecisionResponse({ decision: singleChoiceDecision, text: "I choose A" })).toMatchObject({
  response: "A",
  response_label: "Claude Code CLI"
});
expect(interpretDecisionResponse({ decision: approvalDecision, text: "同意" })).toMatchObject({
  response: "approve",
  response_label: "Approve"
});
expect(evaluateDecisionPolicy({ decision: stateWithTwoLatestAResponses, participants }).status).toBe("resolved");
```

Use concrete event objects with `version: "0.2.0"` and participants Alice owner/Bob member.

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- decisions.test.ts
```

Expected: `../src/decisions.js` does not exist.

- [ ] **Step 3: Implement `decisions.ts`**

Create these exports:

```ts
export interface DecisionState {
  request: DecisionRequestedPayload;
  responses: Array<{ respondent_id: string; response: unknown; response_label?: string; source_message_id: string; created_at: string }>;
  terminal_status?: "resolved" | "cancelled";
  result?: unknown;
  result_label?: string;
  decided_by?: string[];
  cancelled_by?: string;
  cancelled_reason?: string;
}
export function extractCacpDecisions(text: string, roomDefaultPolicy: Policy): DecisionRequestedPayload[];
export function deriveDecisionStates(events: CacpEvent[]): DecisionState[];
export function findActiveDecision(states: DecisionState[]): DecisionState | undefined;
export function interpretDecisionResponse(input: { decision: DecisionRequestedPayload; text: string }): InterpretedDecisionResponse | undefined;
export function evaluateDecisionPolicy(input: { decision: DecisionState; participants: Participant[] }): DecisionPolicyResult;
```

Implementation rules:

1. `extractCacpDecisions` uses `/```cacp-decision[ \t]*\r?\n([\s\S]*?)```/g`.
2. `policy: "room_default"` becomes the supplied room policy.
3. `deriveDecisionStates` keeps the latest response per participant for policy evaluation but preserves response timestamps for UI.
4. `single_choice` matching order: exact option id, `choose <id>`/`I choose <id>`/`选 <id>`, then option label substring.
5. `approval` approve phrases: `approve`, `yes`, `agree`, `同意`, `可以`.
6. `approval` reject phrases: `reject`, `no`, `disagree`, `不同意`, `不可以`.

- [ ] **Step 4: Update prompts**

In `conversation.ts` and `pairing.ts`, replace `cacp-question` guidance with:

```ts
"When an explicit room decision is required, output a separate fenced code block tagged `cacp-decision`.",
"The block must contain JSON with title, description, kind, options, policy, and blocking.",
"Only create a decision when the humans must choose, judge, approve, or confirm something."
```

- [ ] **Step 5: Run and commit**

```powershell
corepack pnpm --filter @cacp/server test -- decisions.test.ts
corepack pnpm --filter @cacp/server test
git add packages/server/src/decisions.ts packages/server/test/decisions.test.ts packages/server/src/conversation.ts packages/server/src/pairing.ts
git commit -m "feat(server): add decision state helpers"
```

---

## Task 3: Implement server decision routes and chat response recording

**Files:**
- Modify: `packages/server/src/ids.ts`
- Modify: `packages/server/src/server.ts`
- Add: `packages/server/test/decision-protocol.test.ts`
- Modify: `packages/server/test/server-conversation.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/server/test/decision-protocol.test.ts` with these cases:

1. Agent creates a `decision.requested` from `/rooms/:roomId/decisions`.
2. A second `/decisions` request while one is open returns `409 { error: "active_decision_exists" }`.
3. Alice and Bob answer in `/messages`; server emits two `decision.response_recorded` events and one `decision.resolved`.
4. Owner can cancel with `/rooms/:roomId/decisions/:decisionId/cancel`; member receives `403`.

Use helper functions matching existing tests:

```ts
async function createRoom(default_policy = "majority") {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Decision Room", display_name: "Alice", default_policy } });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_id: string; owner_token: string };
  return { app, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

async function inviteMember(app, roomId, ownerAuth, displayName) {
  const invite = await app.inject({ method: "POST", url: `/rooms/${roomId}/invites`, headers: ownerAuth, payload: { role: "member", expires_in_seconds: 3600 } });
  expect(invite.statusCode).toBe(201);
  const join = await app.inject({ method: "POST", url: `/rooms/${roomId}/join`, payload: { invite_token: invite.json().invite_token, display_name: displayName } });
  expect(join.statusCode).toBe(201);
  return { participant_id: join.json().participant_id as string, auth: { authorization: `Bearer ${join.json().participant_token}` } };
}

async function registerAndSelectAgent(app, roomId, ownerAuth) {
  const agent = await app.inject({ method: "POST", url: `/rooms/${roomId}/agents/register`, headers: ownerAuth, payload: { name: "Claude Code Agent", capabilities: [] } });
  expect(agent.statusCode).toBe(201);
  await app.inject({ method: "POST", url: `/rooms/${roomId}/agents/select`, headers: ownerAuth, payload: { agent_id: agent.json().agent_id } });
  return { agent_id: agent.json().agent_id as string, agentAuth: { authorization: `Bearer ${agent.json().agent_token}` } };
}
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- decision-protocol.test.ts
```

Expected: decision routes do not exist.

- [ ] **Step 3: Emit v0.2 events**

In `packages/server/src/ids.ts`:

```ts
return { protocol: "cacp", version: "0.2.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
```

- [ ] **Step 4: Add decision route schemas and helpers**

In `server.ts`, add `DecisionCreateSchema` and `DecisionCancelSchema`. Import `deriveDecisionStates`, `evaluateDecisionPolicy`, `extractCacpDecisions`, `findActiveDecision`, and `interpretDecisionResponse`.

Inside `buildServer`, add:

```ts
function decisionStates(roomId: string) { return deriveDecisionStates(store.listEvents(roomId)); }
function activeDecision(roomId: string) { return findActiveDecision(decisionStates(roomId)); }
function resolveDecisionPolicyEvents(roomId: string, actorId: string, decisionId: string): CacpEvent[] {
  const state = decisionStates(roomId).find((item) => item.request.decision_id === decisionId);
  if (!state || state.terminal_status) return [];
  const evaluation = evaluateDecisionPolicy({ decision: state, participants: store.getParticipants(roomId).map(publicParticipant) });
  if (evaluation.status !== "resolved") return [];
  const resolved = event(roomId, "decision.resolved", actorId, {
    decision_id: decisionId,
    result: evaluation.result,
    result_label: evaluation.result_label,
    decided_by: evaluation.decided_by,
    policy_evaluation: { status: "approved", reason: evaluation.reason }
  });
  return typeof state.request.action_id === "string"
    ? [resolved, event(roomId, "agent.action_approval_resolved", actorId, { action_id: state.request.action_id, decision_id: decisionId, decision: evaluation.result })]
    : [resolved];
}
```

- [ ] **Step 5: Add decision creation and cancellation routes**

Add `POST /rooms/:roomId/decisions`:

- Require owner/admin/agent.
- Reject active decision with `409 active_decision_exists`.
- Convert `policy: "room_default"` to `roomPolicy(roomId)`.
- Append `decision.requested`.
- Return `{ decision_id }`.

Add `POST /rooms/:roomId/decisions/:decisionId/cancel`:

- Require owner/admin.
- Reject unknown with `404 unknown_decision`.
- Reject terminal with `409 decision_closed`.
- Append `decision.cancelled`.

- [ ] **Step 6: Update `/messages`**

Change the transaction:

1. Append human `message.created`.
2. If an active decision exists, interpret the message.
3. If interpreted, append `decision.response_recorded`, then append `decision.resolved` events if policy completes.
4. If not interpreted, append system `message.created`:

```ts
`Current decision is still open. Please answer with one of: ${active.request.options.map((option) => option.id).join(", ")}.`
```

5. Only call `createAgentTurnRequestEvents` if there is no still-open active decision after the new events.

- [ ] **Step 7: Parse `cacp-decision` in agent turn completion**

Replace `extractCacpQuestions` in `/agent-turns/:turnId/complete`:

- Parse `extractCacpDecisions(body.final_text, roomPolicy(roomId))`.
- Append the first `decision.requested` if no active decision exists.
- If active decision exists or more than one block appears, append a system message: `A decision is already active. Resolve or cancel it before creating another decision.`

- [ ] **Step 8: Update conversation test**

In `server-conversation.test.ts`, use a `cacp-decision` block and assert `decision.requested` instead of `question.created`.

- [ ] **Step 9: Run and commit**

```powershell
corepack pnpm --filter @cacp/server test -- decision-protocol.test.ts
corepack pnpm --filter @cacp/server test
git add packages/server/src/ids.ts packages/server/src/server.ts packages/server/test/decision-protocol.test.ts packages/server/test/server-conversation.test.ts
git commit -m "feat(server): implement decision protocol routes"
```

---

## Task 4: Convert action approval to decision protocol

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/test/server-governance.test.ts`

- [ ] **Step 1: Update failing governance tests**

Change action approval tests to:

- Expect `agent.action_approval_requested`, `decision.requested`, `decision.response_recorded`, `decision.resolved`, `agent.action_approval_resolved`.
- Answer with `POST /rooms/:roomId/messages` payload `{ text: "approve" }`.
- Expect wait response contains `decision_id` and `decision: "approve"`.

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- server-governance.test.ts
```

- [ ] **Step 3: Implement action approval decisions**

In `/agent-action-approvals`, create `decision_id = prefixedId("dec")` and append:

```ts
event(roomId, "decision.requested", participant.id, {
  decision_id: decisionId,
  action_id: actionId,
  decision_type: "agent_action_approval",
  title: `Approve ${body.tool_name}`,
  description: body.description ?? `Allow agent to run ${body.tool_name}?`,
  kind: "approval",
  options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
  blocking: true,
  policy: roomPolicy(roomId)
})
```

Update `findActionApprovalStatus` to track `decision_id` from `decision.requested` and resolved state from `agent.action_approval_resolved`.

- [ ] **Step 4: Run and commit**

```powershell
corepack pnpm --filter @cacp/server test -- server-governance.test.ts
corepack pnpm --filter @cacp/server test
git add packages/server/src/server.ts packages/server/test/server-governance.test.ts
git commit -m "feat(server): model action approvals as decisions"
```

---

## Task 5: Add room history clearing

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/conversation.ts`
- Modify: `packages/server/test/decision-protocol.test.ts`

- [ ] **Step 1: Add failing clear-room test**

Add a test asserting:

- Member receives `403` on `POST /rooms/:roomId/history/clear`.
- Owner receives `201`.
- Event stream contains `room.history_cleared` with `scope: "messages_and_decisions"`.

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/server test -- decision-protocol.test.ts
```

- [ ] **Step 3: Add route**

In `server.ts`:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/history/clear", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
  appendAndPublish(event(request.params.roomId, "room.history_cleared", participant.id, {
    cleared_by: participant.id,
    cleared_at: new Date().toISOString(),
    scope: "messages_and_decisions"
  }));
  return reply.code(201).send({ ok: true });
});
```

In `conversation.ts`, add `eventsAfterLastHistoryClear(events)` and use it inside `recentConversationMessages`.

- [ ] **Step 4: Run and commit**

```powershell
corepack pnpm --filter @cacp/server test
git add packages/server/src/server.ts packages/server/src/conversation.ts packages/server/test/decision-protocol.test.ts
git commit -m "feat(server): add room history clear boundary"
```

---

## Task 6: Derive Web decision state and collapsed badge counts

**Files:**
- Modify: `packages/web/src/room-state.ts`
- Add: `packages/web/src/control-badges.ts`
- Modify: `packages/web/test/room-state.test.ts`
- Add: `packages/web/test/control-badges.test.ts`

- [ ] **Step 1: Write failing room-state test**

Add a test with events:

1. `room.history_cleared`
2. `decision.requested`
3. two `decision.response_recorded` events from the same user where the second response wins
4. `decision.resolved`

Assert:

```ts
expect(state.currentDecision).toBeUndefined();
expect(state.decisionHistory[0]).toMatchObject({ decision_id: "dec_1", terminal_status: "resolved", result_label: "Claude Code CLI" });
expect(state.decisionHistory[0].responses.find((r) => r.respondent_id === "user_1")?.response).toBe("A");
```

- [ ] **Step 2: Write failing badge test**

Create `control-badges.test.ts`:

```ts
expect(badgeChangesForCollapsedControls({
  collapsed: true,
  previous: { agents: 1, invites: 0, participants: 1, decisions: 0 },
  current: { agents: 2, invites: 1, participants: 2, decisions: 1 },
  existing: { agent: 0, invite: 0, participants: 0, decisions: 0 }
})).toEqual({ agent: 1, invite: 1, participants: 1, decisions: 1 });
```

- [ ] **Step 3: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts control-badges.test.ts
```

- [ ] **Step 4: Implement room-state types**

Add `DecisionView`, `DecisionOptionView`, and `DecisionResponseView`. Add to `RoomViewState`:

```ts
currentDecision?: DecisionView;
decisionHistory: DecisionView[];
lastHistoryClearedAt?: string;
inviteCount: number;
```

Use all events for participants/agents/invites. Use events after last `room.history_cleared` for messages, streaming turns, and decisions.

- [ ] **Step 5: Implement `control-badges.ts`**

```ts
export interface ControlCounts { agents: number; invites: number; participants: number; decisions: number }
export interface ControlBadges { agent: number; invite: number; participants: number; decisions: number }
export function badgeChangesForCollapsedControls(input: { collapsed: boolean; previous: ControlCounts; current: ControlCounts; existing: ControlBadges }): ControlBadges {
  if (!input.collapsed) return { agent: 0, invite: 0, participants: 0, decisions: 0 };
  return {
    agent: input.existing.agent + Math.max(0, input.current.agents - input.previous.agents),
    invite: input.existing.invite + Math.max(0, input.current.invites - input.previous.invites),
    participants: input.existing.participants + Math.max(0, input.current.participants - input.previous.participants),
    decisions: input.existing.decisions + Math.max(0, input.current.decisions - input.previous.decisions)
  };
}
```

- [ ] **Step 6: Run and commit**

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts control-badges.test.ts
git add packages/web/src/room-state.ts packages/web/src/control-badges.ts packages/web/test/room-state.test.ts packages/web/test/control-badges.test.ts
git commit -m "feat(web): derive decision room state"
```

---

## Task 7: Add Web API methods and session role metadata

**Files:**
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/session-storage.ts`
- Modify: `packages/web/test/api.test.ts`
- Modify: `packages/web/test/session-storage.test.ts`

- [ ] **Step 1: Write failing tests**

Test that:

- `createRoom` returns `{ room_id, token, participant_id, role: "owner" }`.
- `joinRoom` returns `{ room_id, token, participant_id, role }`.
- `clearRoom(session)` posts to `/rooms/:roomId/history/clear`.
- `cancelDecision(session, "dec_1", "Skipped by owner")` posts to `/rooms/:roomId/decisions/dec_1/cancel`.
- session storage rejects sessions missing `participant_id` or `role`.

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts session-storage.test.ts
```

- [ ] **Step 3: Implement API shape**

In `api.ts`:

```ts
export interface RoomSession {
  room_id: string;
  token: string;
  participant_id: string;
  role: "owner" | "admin" | "member" | "observer" | "agent";
}
export async function clearRoom(session: RoomSession): Promise<void> {
  await postJson(`/rooms/${session.room_id}/history/clear`, session.token, {});
}
export async function cancelDecision(session: RoomSession, decisionId: string, reason: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/decisions/${decisionId}/cancel`, session.token, { reason });
}
```

Update `createRoom` and `joinRoom` mappings to include participant metadata.

- [ ] **Step 4: Run and commit**

```powershell
corepack pnpm --filter @cacp/web test -- api.test.ts session-storage.test.ts
git add packages/web/src/api.ts packages/web/src/session-storage.ts packages/web/test/api.test.ts packages/web/test/session-storage.test.ts
git commit -m "feat(web): add room management APIs"
```

---

## Task 8: Redesign Web room UI

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/App.css`
- Add: `packages/web/test/app-copy.test.ts`

- [ ] **Step 1: Write failing source smoke test**

Create `app-copy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

describe("room UI copy and layout source", () => {
  it("uses English decision workspace labels", () => {
    expect(app).toContain("Clear room");
    expect(app).toContain("Collapse controls");
    expect(app).toContain("Current Decision");
    expect(app).toContain("Decision History");
    expect(app).toContain("No active decision.");
    expect(app).not.toContain("只读");
    expect(app).not.toContain("参与者");
  });

  it("keeps chat scrolling inside the panel", () => {
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("height: calc(100vh");
    expect(css).toContain(".workspace-grid.collapsed-controls");
  });
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- app-copy.test.ts
```

- [ ] **Step 3: Update `App.tsx`**

Implement these UI behaviors:

- English permission labels: `Read only`, `Limited write`, `Full access`.
- English policy labels: `Owner approval`, `Majority`, `Unanimous`.
- Compact header with room id, active agent, participants, `Clear room`, `Collapse controls`, `Leave room`.
- `controlsCollapsed` state; default `false`.
- `controlBadges` state; clear badges when opening controls.
- `timelineRef` with auto-scroll when messages or streaming turns change.
- Remove `submitQuestionResponse` usage from UI.
- Render `room.currentDecision` and `room.decisionHistory`.
- Owner/admin-only `Clear room` with `window.confirm("Clear all messages and decision history for everyone?")`.
- Owner/admin-only `Cancel decision`.
- Streaming text: `${agentName} is responding...` and after 8 seconds `Still waiting for the local CLI agent...`.

- [ ] **Step 4: Update CSS**

Ensure these rules exist:

```css
.workspace-shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.workspace-header h1 { font-size: clamp(20px, 2.4vw, 30px); }
.workspace-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 14px; }
.workspace-grid.collapsed-controls { grid-template-columns: minmax(0, 1fr) 52px; }
.chat-panel { min-height: 0; height: calc(100vh - 112px); display: flex; flex-direction: column; overflow: hidden; }
.timeline { flex: 1; min-height: 0; overflow-y: auto; }
.rail-button { position: relative; width: 36px; height: 36px; border-radius: 12px; }
.badge { position: absolute; right: -4px; top: -4px; min-width: 16px; height: 16px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; }
button.danger { color: #fecdd3; border-color: rgba(248, 113, 113, 0.35); }
```

- [ ] **Step 5: Run and commit**

```powershell
corepack pnpm --filter @cacp/web test
corepack pnpm --filter @cacp/web build
git add packages/web/src/App.tsx packages/web/src/App.css packages/web/test/app-copy.test.ts
git commit -m "feat(web): redesign room decision workspace"
```

---

## Task 9: Guard adapter streaming latency

**Files:**
- Modify: `packages/cli-adapter/src/runner.ts`
- Modify: `packages/cli-adapter/test/runner.test.ts`

- [ ] **Step 1: Add streaming timing test**

Add to `runner.test.ts`:

```ts
it("delivers output chunks before the command exits", async () => {
  const received: Array<{ chunk: string; at: number }> = [];
  const startedAt = Date.now();
  const result = await runCommandForTask({
    command: process.execPath,
    args: ["-e", "process.stdout.write('first'); setTimeout(() => { process.stdout.write('second'); process.exit(0); }, 250);"],
    working_dir: process.cwd(),
    prompt: "",
    onOutput: (output) => received.push({ chunk: output.chunk, at: Date.now() - startedAt })
  });
  expect(result.exit_code).toBe(0);
  expect(received.map((item) => item.chunk).join("")).toContain("first");
  expect(received[0].at).toBeLessThan(200);
});
```

- [ ] **Step 2: Run and fix if needed**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- runner.test.ts
```

If failing, simplify `captureOutput` so it calls `options.onOutput(output)` immediately and only waits for pending callbacks at process close.

- [ ] **Step 3: Commit**

```powershell
corepack pnpm --filter @cacp/cli-adapter test
git add packages/cli-adapter/src/runner.ts packages/cli-adapter/test/runner.test.ts
git commit -m "test(adapter): guard streaming output latency"
```

---

## Task 10: Make test-services launcher foreground by default

**Files:**
- Modify: `start-test-services.ps1`
- Modify: `start-test-services.cmd`
- Modify: `packages/web/test/start-test-services-script.test.ts`

- [ ] **Step 1: Update failing launcher test**

Extend `start-test-services-script.test.ts`:

```ts
const cmd = readFileSync(cmdWrapperPath, "utf8");
expect(script).toContain("[switch]$Foreground");
expect(script).toContain("Press Ctrl+C or close this window to stop services");
expect(script).toContain("finally");
expect(cmd).toContain("-Foreground");
```

- [ ] **Step 2: Run and verify failure**

```powershell
corepack pnpm --filter @cacp/web test -- start-test-services-script.test.ts
```

- [ ] **Step 3: Implement foreground mode**

Add `[switch]$Foreground` to `start-test-services.ps1`. After readiness checks:

```powershell
if ($Foreground) {
  Write-Host ""
  Write-Host "CACP test services" -ForegroundColor Green
  Write-Host "Server: $ServerUrl"
  Write-Host "Web:    $WebUrl"
  Write-Host ""
  Write-Host "Press Ctrl+C or close this window to stop services." -ForegroundColor Yellow
  try {
    Get-Content -LiteralPath (Join-Path $StateDir "server.out.log"), (Join-Path $StateDir "server.err.log"), (Join-Path $StateDir "web.out.log"), (Join-Path $StateDir "web.err.log") -Wait
  } finally {
    Stop-TestServices
  }
  exit 0
}
```

Change `start-test-services.cmd`:

```cmd
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-test-services.ps1" -Foreground %*
```

- [ ] **Step 4: Test and commit**

```powershell
corepack pnpm --filter @cacp/web test -- start-test-services-script.test.ts
git add start-test-services.ps1 start-test-services.cmd packages/web/test/start-test-services-script.test.ts
git commit -m "chore: make test services launcher foreground"
```

---

## Task 11: Document CACP v0.2 and updated test flow

**Files:**
- Modify: `README.md`
- Add: `docs/protocol/cacp-v0.2.md`

- [ ] **Step 1: Add protocol document**

Create `docs/protocol/cacp-v0.2.md` with:

- Purpose of `decision.*`.
- Event list.
- Single active decision gate.
- `cacp-decision` fenced block example.
- Main-chat response rule.
- Clear-room boundary behavior.

- [ ] **Step 2: Update README**

Document:

```powershell
.\start-test-services.cmd
```

Explain that the console stays open and Ctrl+C or closing the window stops services. Add manual flow:

1. Open `http://127.0.0.1:5173/`.
2. Create a room.
3. Generate and run an agent pairing command.
4. Invite a second participant.
5. Ask the AI to create a decision.
6. Answer in chat.
7. Verify Current Decision moves to Decision History.
8. Use Clear room as owner.

- [ ] **Step 3: Run and commit**

```powershell
corepack pnpm check
git add README.md docs/protocol/cacp-v0.2.md
git commit -m "docs: document cacp decision protocol"
```

---

## Task 12: Manual browser validation

**Files:**
- No planned production changes.
- If a bug appears, add a failing test in the relevant package before fixing.

- [ ] **Step 1: Start services**

```powershell
.\start-test-services.ps1 -Restart -NoWait
```

- [ ] **Step 2: Open browser**

```powershell
playwright-cli -s=cacp-decision open http://127.0.0.1:5173/ --browser=msedge
```

- [ ] **Step 3: Validate UI**

Confirm:

- English landing and room text.
- Compact header.
- Chat area scrolls internally.
- Controls default expanded.
- Controls collapse to icon rail.
- Hidden updates show badges.
- Permission and invite options are English.

- [ ] **Step 4: Validate decision flow**

Create a room, connect or simulate an agent, create a `cacp-decision`, answer in chat from two participants, and confirm policy resolution and Decision History.

- [ ] **Step 5: Validate Clear room**

Click `Clear room`, accept confirmation, and confirm messages and decisions disappear in all sessions.

- [ ] **Step 6: Stop and final check**

```powershell
.\start-test-services.ps1 -Stop
corepack pnpm check
git status --short --branch
```

Expected: services stopped, all tests/builds pass, and only intentional changes remain.

---

## Final acceptance checklist

- [ ] `decision.*` events are first-class protocol events.
- [ ] New emitted events use `version: "0.2.0"`.
- [ ] `cacp-decision` replaces `cacp-question` for new agent prompts.
- [ ] Only one active blocking decision is allowed.
- [ ] Users answer decisions in the main chat composer.
- [ ] Room policy resolves decisions.
- [ ] Owner/admin can cancel active decisions.
- [ ] Owner/admin can clear messages and decision history for everyone.
- [ ] Web UI visible text is English.
- [ ] Chat timeline scrolls internally.
- [ ] Right controls default expanded and can collapse.
- [ ] Collapsed hidden changes show badges.
- [ ] Test launcher keeps a visible console open.
- [ ] Adapter streaming remains prompt.
- [ ] `corepack pnpm check` passes.
- [ ] Manual browser validation passes.
