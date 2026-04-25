# CACP Multi-User AI Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade CACP from a task-output demo into a shared multi-user AI conversation room with server-orchestrated agent turns, live streaming AI replies, invite/join, active agent selection, and a dark command-center Web UI.

**Architecture:** The server remains the coordination authority and owns room state, active agent selection, human-message-triggered agent turn requests, turn concurrency, context prompt generation, and final AI message persistence. The CLI adapter keeps task support and adds turn support. The Web app becomes a shared room workspace that displays the event-derived state and never directly starts AI calls.

**Tech Stack:** TypeScript, pnpm workspaces, Zod, Fastify, @fastify/websocket, better-sqlite3, ws, React, Vite, Vitest.

---

## Scope Check

This is a multi-component vertical slice. The feature touches protocol, server, CLI adapter, and Web UI, but those pieces are not useful in isolation for the target test scenario. Implement in phases, with tests at each layer and `corepack pnpm check` at the end.

## File Structure Map

### Protocol

- Modify `packages/protocol/src/schemas.ts`
  - Add new event types for room config, active agent, and agent turns.
- Modify `packages/protocol/test/protocol.test.ts`
  - Add schema acceptance tests for the new event names.

### Server

- Modify `packages/server/src/server.ts`
  - Change invite/create join payloads.
  - Normalize message payloads with `message_id` and `kind`.
  - Add active-agent selection endpoint.
  - Add agent-turn lifecycle endpoints.
  - Trigger agent turns after human messages.
- Create `packages/server/src/conversation.ts`
  - Pure helpers for deriving active agent, open turns, queued followups, recent messages, context prompts, and `cacp-question` blocks.
- Modify `packages/server/test/server.test.ts`
  - Update current invite/join flow.
  - Add full conversation-room test.
- Modify `packages/server/test/server-hardening.test.ts`
  - Update invite/join tests.
  - Add authorization and lifecycle tests for agent turns.

### CLI Adapter

- Modify `packages/cli-adapter/src/index.ts`
  - Listen for both `task.created` and `agent.turn.requested`.
  - Stream turn output to new agent-turn endpoints.
- Create `packages/cli-adapter/src/turn-result.ts`
  - Map command result and accumulated output to turn completion/failure payloads.
- Create or modify tests under `packages/cli-adapter/test/`
  - Unit test turn output accumulation and final payload behavior.

### Web

- Modify `packages/web/src/api.ts`
  - Add `createInvite`, `joinRoom`, `selectAgent`, and keep `sendMessage`.
  - Remove main UI dependency on manual `createTask` for conversation.
- Modify `packages/web/src/session-storage.ts`
  - Ensure stored sessions support joined users and refresh recovery.
- Create `packages/web/src/room-state.ts`
  - Derive participants, agents, active agent, messages, streaming turns, questions, and invite links from events.
- Modify `packages/web/src/App.tsx`
  - Replace debug forms with landing/join and room workspace.
- Modify `packages/web/src/App.css`
  - Implement dark command-center styling.
- Add tests under `packages/web/test/`
  - `room-state.test.ts` for derived UI state.
  - Update `api.test.ts` if needed.

### Docs / Examples

- Modify `README.md`
  - Add the new conversation-room flow.
- Optionally add `docs/examples/claude-code-agent.json`
  - Safe template without secrets; local `.local.json` remains ignored.

---

## Phase 0: Preserve Current Baseline

**Files:** no production code changes.

- [ ] **Step 1: Check working tree**

Run:

```powershell
git status --short
```

Expected: note existing README/Web fix files before feature work. Do not discard them.

- [ ] **Step 2: Verify current baseline**

Run:

```powershell
corepack pnpm check
```

Expected: PASS before feature work starts.

- [ ] **Step 3: Decide commit boundary**

Recommended before code work:

```powershell
git add README.md packages/web/src/App.tsx packages/web/src/session-storage.ts packages/web/vite.config.ts packages/web/test/session-storage.test.ts packages/web/test/vite-config.test.ts
git commit -m "docs: add Chinese readme and stabilize web room demo"
```

Expected: previous README and WebSocket/session fixes are safely committed before this larger feature. If the user does not want a commit, skip this step and keep changes staged/unstaged intentionally.

---

## Phase 1: Protocol Event Types

**Files:**
- Modify `packages/protocol/src/schemas.ts`
- Modify `packages/protocol/test/protocol.test.ts`

- [ ] **Step 1: Add failing protocol test**

Add a test that expects these event types to parse:

```ts
for (const type of [
  "room.configured",
  "room.agent_selected",
  "agent.turn.requested",
  "agent.turn.followup_queued",
  "agent.turn.started",
  "agent.output.delta",
  "agent.turn.completed",
  "agent.turn.failed"
] as const) {
  expect(CacpEventSchema.parse({
    protocol: "cacp",
    version: "0.1.0",
    event_id: `evt_${type}`,
    room_id: "room_1",
    type,
    actor_id: "user_1",
    created_at: "2026-04-25T00:00:00.000Z",
    payload: {}
  }).type).toBe(type);
}
```

Run:

```powershell
corepack pnpm --filter @cacp/protocol test
```

Expected: FAIL because the new event types are not in `EventTypeSchema`.

- [ ] **Step 2: Add event names**

Update `EventTypeSchema` in `packages/protocol/src/schemas.ts` with the new event names.

- [ ] **Step 3: Verify protocol**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/protocol build
```

Expected: PASS.

---

## Phase 2: Server Conversation Helpers

**Files:**
- Create `packages/server/src/conversation.ts`
- Create `packages/server/test/conversation.test.ts`

- [ ] **Step 1: Write failing tests for pure helpers**

Cover these behaviors:

1. `findActiveAgentId(events)` returns the latest `room.agent_selected.payload.agent_id`.
2. `findOpenTurn(events, agentId)` returns a requested/started turn without completed/failed.
3. `hasQueuedFollowup(events, turnId)` detects `agent.turn.followup_queued` for that turn.
4. `buildAgentContextPrompt({ participants, messages, agentName })` includes only the latest 20 durable `message.created` events.
5. `extractCacpQuestions(text)` parses fenced `cacp-question` JSON blocks.

Run:

```powershell
corepack pnpm --filter @cacp/server test -- test/conversation.test.ts
```

Expected: FAIL because `conversation.ts` does not exist.

- [ ] **Step 2: Implement pure helpers**

Create helpers with explicit exports:

```ts
export function findActiveAgentId(events: CacpEvent[]): string | undefined
export function findOpenTurn(events: CacpEvent[], agentId: string): { turn_id: string; agent_id: string } | undefined
export function hasQueuedFollowup(events: CacpEvent[], turnId: string): boolean
export function recentConversationMessages(events: CacpEvent[], limit = 20): Array<{ actor_id: string; text: string; kind: string }>
export function buildAgentContextPrompt(input: { participants: Participant[]; messages: Array<{ actorName: string; kind: string; text: string }>; agentName: string }): string
export function extractCacpQuestions(text: string): Array<{ question: string; options: string[] }>
```

- [ ] **Step 3: Verify helper tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- test/conversation.test.ts
```

Expected: PASS.

---

## Phase 3: Server Invite/Join and Room Configuration

**Files:**
- Modify `packages/server/src/server.ts`
- Modify `packages/server/test/server.test.ts`
- Modify `packages/server/test/server-hardening.test.ts`

- [ ] **Step 1: Update tests for invite/join**

Change invite creation tests from:

```ts
payload: { role: "member", display_name: "Bob" }
```

to:

```ts
payload: { role: "member" }
```

Change join tests from:

```ts
payload: { invite_token: inviteToken }
```

to:

```ts
payload: { invite_token: inviteToken, display_name: "Bob" }
```

Run server tests. Expected: FAIL because schemas still require invite display name and join does not accept it.

- [ ] **Step 2: Update schemas and invite storage**

In `server.ts`:

```ts
const CreateInviteSchema = z.object({ role: z.enum(["admin", "member", "observer"]).default("member") });
const JoinSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1) });
```

Update `Invite` type to remove `display_name`.

Use `body.display_name` from join request when adding participant.

- [ ] **Step 3: Add room config event on room creation**

When creating a room, append `room.configured` after `room.created` with:

```ts
{ default_policy: { type: "owner_approval" } }
```

- [ ] **Step 4: Verify server tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test
```

Expected: PASS after updating affected expectations.

---

## Phase 4: Server Active Agent Selection

**Files:**
- Modify `packages/server/src/server.ts`
- Modify `packages/server/test/server.test.ts`
- Modify `packages/server/test/server-hardening.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests for:

1. Owner/member can select an existing same-room agent.
2. Observer cannot select an agent.
3. Agent token cannot select an agent.
4. Cross-room or missing agent is rejected.
5. Event log contains `room.agent_selected`.

Use endpoint:

```http
POST /rooms/:roomId/agents/select
```

Payload:

```json
{ "agent_id": "agent_xxx" }
```

Expected before implementation: 404.

- [ ] **Step 2: Implement endpoint**

Add schema:

```ts
const SelectAgentSchema = z.object({ agent_id: z.string().min(1) });
```

Endpoint behavior:

- Auth requires owner/admin/member.
- Target must be participant in same room with `type === "agent"` and `role === "agent"`.
- Append `room.agent_selected` with `{ agent_id }`.
- Return `{ ok: true, agent_id }`.

- [ ] **Step 3: Verify**

Run:

```powershell
corepack pnpm --filter @cacp/server test
```

Expected: PASS.

---

## Phase 5: Server Agent Turn Lifecycle and Auto Trigger

**Files:**
- Modify `packages/server/src/server.ts`
- Modify `packages/server/src/conversation.ts`
- Modify `packages/server/test/server.test.ts`
- Modify `packages/server/test/server-hardening.test.ts`

- [ ] **Step 1: Add failing integrated test**

Create a test flow:

1. Create room.
2. Register agent.
3. Select active agent.
4. Send human message.
5. Assert event log has `message.created` and `agent.turn.requested`.
6. Agent starts turn.
7. Agent posts two deltas.
8. Agent completes with final text.
9. Assert final agent `message.created` exists.

Expected before implementation: no turn request and lifecycle endpoints missing.

- [ ] **Step 2: Add agent-turn schemas**

Recommended schemas:

```ts
const TurnStartSchema = z.object({});
const TurnDeltaSchema = z.object({ chunk: z.string() });
const TurnCompleteSchema = z.object({ final_text: z.string(), exit_code: z.number().int().default(0) });
const TurnFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });
```

- [ ] **Step 3: Add helper functions in server**

Add local functions:

```ts
function requestAgentTurnIfPossible(roomId: string, reason: "human_message" | "queued_followup"): CacpEvent | undefined
function requireAssignedAgentTurn(roomId: string, turnId: string, participant: Participant, reply: FastifyReply): { agent_id: string } | undefined
```

Behavior:

- If no active agent: return undefined.
- If an open turn exists: append `agent.turn.followup_queued` for that open turn and return undefined.
- Else build `context_prompt` from recent messages and append `agent.turn.requested`.

- [ ] **Step 4: Trigger after human message**

In `/rooms/:roomId/messages`:

- Append normalized human `message.created`.
- If actor is owner/admin/member, call `requestAgentTurnIfPossible`.
- Publish all resulting events in one transaction.

- [ ] **Step 5: Implement turn lifecycle endpoints**

Add:

```http
POST /rooms/:roomId/agent-turns/:turnId/start
POST /rooms/:roomId/agent-turns/:turnId/delta
POST /rooms/:roomId/agent-turns/:turnId/complete
POST /rooms/:roomId/agent-turns/:turnId/fail
```

Rules:

- Only assigned agent token can call.
- Cannot start twice.
- Cannot delta/complete/fail before start.
- Cannot delta/complete/fail after terminal event.
- Complete appends `agent.turn.completed` and final agent `message.created`.
- Complete parses `cacp-question` blocks and appends `question.created` events.
- After completion, if the completed turn had queued followup events, request one new turn with latest context.

- [ ] **Step 6: Add hardening tests**

Cover:

- Wrong agent cannot start/delta/complete/fail a turn.
- Human token cannot call turn lifecycle endpoints.
- Terminal turn rejects more deltas/completion.
- Queued followup causes exactly one new `agent.turn.requested` after completion.

- [ ] **Step 7: Verify server**

Run:

```powershell
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/server build
```

Expected: PASS.

---

## Phase 6: CLI Adapter Agent Turn Support

**Files:**
- Modify `packages/cli-adapter/src/index.ts`
- Create `packages/cli-adapter/src/turn-result.ts`
- Add/modify tests in `packages/cli-adapter/test/`

- [ ] **Step 1: Add failing test for turn result helper**

Test that final stdout becomes `final_text` and non-zero exit code becomes failure metadata.

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test
```

Expected: FAIL until helper exists.

- [ ] **Step 2: Implement turn helper**

Create a helper that accumulates stdout chunks for final text:

```ts
export function appendTurnOutput(current: string, output: { stream: "stdout" | "stderr"; chunk: string }): string
export function turnCompleteBody(finalText: string, exitCode: number): { final_text: string; exit_code: number }
```

- [ ] **Step 3: Update adapter event handler**

In `index.ts`:

- Keep current `task.created` handling unchanged.
- Add handler for `agent.turn.requested`.
- Ignore turns not assigned to current `registered.agent_id`.
- De-duplicate running `turn_id`s.
- Post start.
- Run configured command with `context_prompt`.
- For each output chunk, post `delta` with `chunk`.
- Accumulate stdout chunks as final answer.
- On exit code 0, post `complete` with `{ final_text, exit_code }`.
- On non-zero or error, post `fail`.

- [ ] **Step 4: Verify adapter**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/cli-adapter build
```

Expected: PASS.

---

## Phase 7: Web API and Event-Derived Room State

**Files:**
- Modify `packages/web/src/api.ts`
- Create `packages/web/src/room-state.ts`
- Add `packages/web/test/room-state.test.ts`
- Modify `packages/web/test/api.test.ts`

- [ ] **Step 1: Add failing room-state tests**

Test state derivation for:

- Participants from `participant.joined`.
- Agents from `agent.registered`.
- Active agent from latest `room.agent_selected`.
- Durable chat messages from `message.created`.
- Streaming bubble from `agent.turn.started` + `agent.output.delta` until completion.
- Questions from `question.created`.

Expected: FAIL until `room-state.ts` exists.

- [ ] **Step 2: Implement room-state selectors**

Recommended exports:

```ts
export function deriveRoomState(events: CacpEvent[]): RoomViewState
export interface RoomViewState {
  participants: Array<{ id: string; display_name: string; role: string; type: string }>;
  agents: Array<{ agent_id: string; name: string; capabilities: string[] }>;
  activeAgentId?: string;
  messages: Array<{ message_id?: string; actor_id: string; text: string; kind: string; created_at: string }>;
  streamingTurns: Array<{ turn_id: string; agent_id: string; text: string }>;
  questions: Array<{ question_id: string; question: string; options: string[] }>;
}
```

- [ ] **Step 3: Update API functions**

Add:

```ts
export async function createInvite(session: RoomSession, role: "admin" | "member" | "observer"): Promise<{ invite_token: string; role: string }>
export async function joinRoom(roomId: string, inviteToken: string, displayName: string): Promise<RoomSession>
export async function selectAgent(session: RoomSession, agentId: string): Promise<void>
```

Keep `sendMessage`. Keep `createTask` only if you want a hidden/debug fallback, not as the main UI path.

- [ ] **Step 4: Verify Web unit tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: PASS.

---

## Phase 8: Web UI Redesign

**Files:**
- Modify `packages/web/src/App.tsx`
- Modify `packages/web/src/App.css`
- Reuse `packages/web/src/session-storage.ts`

- [ ] **Step 1: Replace landing UI**

Implement a dark landing page with two cards:

- Create room: room name, display name, create button.
- Join room: room id, invite token, display name, join button.

- [ ] **Step 2: Replace room UI**

Implement workspace layout:

```text
Header: room id, active agent, leave room
Main: chat timeline, streaming AI bubble, composer
Sidebar: participants, agent selector, invite creator, decisions/questions
```

- [ ] **Step 3: Connect composer**

Composer calls only:

```ts
await sendMessage(session, message.trim())
```

It does not create tasks and does not call agent endpoints.

- [ ] **Step 4: Connect agent selector**

Agent selector calls:

```ts
await selectAgent(session, agentId)
```

- [ ] **Step 5: Connect invite creator**

Invite creator calls:

```ts
const invite = await createInvite(session, role)
```

Show copyable values:

```text
Room ID
Invite token
```

- [ ] **Step 6: Style dark command center**

Use:

- dark gradient background;
- glass-like panels;
- clear human/AI message bubbles;
- active agent badge;
- participant chips;
- streaming indicator;
- responsive layout for narrow screens.

- [ ] **Step 7: Verify Web**

Run:

```powershell
corepack pnpm --filter @cacp/web test
corepack pnpm --filter @cacp/web build
```

Expected: PASS.

---

## Phase 9: Docs and End-to-End Verification

**Files:**
- Modify `README.md`
- Optionally add `docs/examples/claude-code-agent.json`

- [ ] **Step 1: Update README**

Document new flow:

1. Start server.
2. Start web.
3. Create room.
4. Configure local Claude Code Agent `.local.json`.
5. Start adapter.
6. Select active agent in Web.
7. Send human message.
8. Observe streaming AI response and final AI message.
9. Create invite and join from another browser.

- [ ] **Step 2: Run full verification**

Run:

```powershell
corepack pnpm check
```

Expected: PASS.

- [ ] **Step 3: Manual Claude Code test**

Start:

```powershell
corepack pnpm dev:server
corepack pnpm dev:web
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/claude-code-agent.local.json
```

In Web:

1. Create or restore room.
2. Select `Claude Code Agent`.
3. Send:

```text
请基于当前 CACP 项目，简要说明 protocol、server、web、cli-adapter 四个模块的职责。不要修改任何文件。
```

Expected:

- `message.created` for human message.
- `agent.turn.requested`.
- `agent.turn.started`.
- multiple `agent.output.delta` events.
- `agent.turn.completed`.
- final agent `message.created` displayed in timeline.

- [ ] **Step 4: Manual multi-user test**

1. Alice creates invite with role `member`.
2. Bob opens a second browser/private window.
3. Bob joins with room id, invite token, and display name `Bob`.
4. Bob sees history.
5. Bob sends a message.
6. Alice and Bob both see Claude stream and final response.

Expected: only one AI turn is requested per message burst; no duplicate AI replies from multiple Web clients.

---

## Self-Review

### Spec Coverage

- Shared main conversation room: Phases 7 and 8.
- Server-triggered AI replies: Phase 5.
- Streaming AI output and final message persistence: Phases 5, 6, and 8.
- Recent 20-message context: Phase 2 and Phase 5.
- Merge while running: Phase 5 via `agent.turn.followup_queued`.
- Invite link with self-entered display name: Phase 3 and Phase 8.
- Room-level active agent: Phase 4 and Phase 8.
- AI structured question block: Phase 2 and Phase 5.
- Dark UI: Phase 8.
- Claude Code CLI test path: Phase 9.

### Placeholder Scan

This plan avoids placeholder tasks. Each phase names exact files, commands, expected failures, and expected passes.

### Type Consistency

- New event names are introduced in Phase 1 before use.
- `room.agent_selected.payload.agent_id` is used consistently.
- `agent.turn.requested.payload.context_prompt` is the adapter input.
- `agent.output.delta.payload.chunk` is the streaming text.
- Final agent reply is persisted as `message.created.payload.text`.

### Risk Notes

- The server must avoid triggering AI on agent-created messages; only human message route should request turns.
- Adapter must not start duplicate turns on replayed WebSocket events.
- Prompt size must be controlled by the 20-message limit.
- Existing task endpoints should remain working to preserve backward compatibility.
