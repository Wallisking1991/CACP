# Roundtable Mode and Agent Queue Design

Date: 2026-04-28
Status: Draft for review
Scope: Web room UX, protocol events, server turn scheduling, local CLI adapter timeout behavior

## Background

CACP currently exposes an owner-only AI answer collection flow. The behavior is useful, but the name "Collect Mode / 收集模式" feels technical and undersells the intended多人协同 experience. The product-facing concept should become **Roundtable Mode / 圆桌模式**: people discuss first, then the room sends one curated turn to AI.

Recent AI conversations can also fail because CACP adds its own timing behavior on top of the local CLI. The CLI adapter currently defaults to a 60-second command timeout, and the server can mark an old open turn as `stale_turn_recovered` after about two minutes. This conflicts with the desired model: the CLI owns its own timeout/error behavior, and CACP should preserve ordering by queueing later messages until the active AI turn returns.

## Goals

- Rename all user-facing collection copy to **Roundtable Mode / 圆桌模式**.
- Let invited participants request Roundtable Mode from the chat composer with one click and no reason field.
- Show the room owner a clear approval prompt; approval starts Roundtable Mode.
- Remove CACP-level default AI CLI turn timeout while preserving explicitly configured timeouts.
- Keep new messages sendable while AI is replying; they should queue the next AI turn instead of cancelling the current one.
- Preserve local-first architecture: the public room coordinates events, and agent execution remains in the user's local connector.

## Non-Goals

- Do not rename the existing `ai.collection.*` protocol namespace or `/ai-collection/*` endpoints in this slice.
- Do not add voting, reason entry, request comments, or multi-owner approval.
- Do not host agent execution in the web room server.
- Do not redesign the full room UI beyond the Roundtable and queue surfaces.

## Naming Model

The product name is **Roundtable Mode / 圆桌模式** everywhere users see the feature: composer buttons, hints, headers, modal text, thread badges, README copy, and screenshots.

For compatibility, the first implementation keeps the internal event/API namespace as `ai.collection.*` and `/ai-collection/*`. Code may use "collection" for existing data structures, but new UI copy must not expose "Collect / 收集" as the feature name. A later protocol version can introduce `roundtable.*` aliases or migration if needed.

## Roundtable Request Flow

### Roles

- Owner: can start Roundtable Mode directly when no Roundtable is active and no request is pending.
- Admin/member: can request Roundtable Mode.
- Observer/agent/system: cannot request or start Roundtable Mode.

### Member/Admin UX

The composer shows a `Request Roundtable` / `申请圆桌` button for admin/member users. Clicking it sends a request immediately with an empty body; no reason, title, or extra form is shown.

The request button is disabled when:

- Roundtable Mode is already active.
- A Roundtable request is already pending in the room.
- The participant does not have permission to send messages.

### Owner Prompt

When a request is pending, the owner sees a modal prompt similar to the existing join-request modal. It shows the requester display name and the number of pending requests if more are later supported. Actions:

- `Start Roundtable` / `开启圆桌`: approves the request and starts Roundtable Mode.
- `Reject` / `拒绝`: closes the request without starting Roundtable Mode.
- `Later` / `稍后`: dismisses the prompt locally only; the request remains pending and visible.

Only one pending Roundtable request is allowed per room in this version. If a pending request exists, direct owner start should be rejected server-side so the request cannot be left unresolved. If an AI turn is currently in flight, the modal keeps the request visible but disables `Start Roundtable` with a short "AI is replying" hint until the turn closes.

## Protocol and API Design

Keep existing events:

- `ai.collection.started`
- `ai.collection.submitted`
- `ai.collection.cancelled`

Add request lifecycle events:

- `ai.collection.requested`
  - Payload: `{ request_id, requested_by }`
- `ai.collection.request_approved`
  - Payload: `{ request_id, approved_by, collection_id }`
- `ai.collection.request_rejected`
  - Payload: `{ request_id, rejected_by }`

Approval is atomic: the server appends `ai.collection.request_approved`, then `ai.collection.started` with the same `collection_id` and `request_id`. Rejection appends only `ai.collection.request_rejected`.

Add API endpoints:

- `POST /rooms/:roomId/ai-collection/request`
- `POST /rooms/:roomId/ai-collection/requests/:requestId/approve`
- `POST /rooms/:roomId/ai-collection/requests/:requestId/reject`

Expected errors:

- `403 forbidden` for observers, agents, and unauthorised roles.
- `409 active_collection_exists` if Roundtable Mode is already active.
- `409 pending_collection_request_exists` if another request is pending.
- `409 active_turn_in_flight` if owner start, approval, or submit would interrupt an active AI turn.
- `409 no_pending_collection_request` for approve/reject on a resolved or unknown request.

## Room State and Web UX

`room-state.ts` should derive a single `pendingRoundtableRequest` from request events. A request is pending after `ai.collection.requested` until an approval or rejection event for the same `request_id`.

The composer has three practical surfaces:

- Live: normal send. If no AI turn is active, button text is `Send` / `发送`.
- AI replying: input stays enabled. Button text becomes `Queue message` / `排队发送`; hint: `AI is replying. Your message will wait for the next turn.` / `AI 正在回复，你的消息会排队到下一轮。`
- Roundtable active: messages are added to the active Roundtable and tagged with `collection_id`; button text is `Add to Roundtable` / `加入圆桌`.

Owner submit remains disabled when no messages are collected. If an AI turn is in flight, Roundtable start, approval, and submit actions are disabled in the UI and rejected by the server rather than interrupting or replacing the active turn.

## Agent Turn Queue and Timeout Behavior

CACP must not create a default timeout for local CLI turns. `runCommandForTask` should only start a timer when `timeout_ms` is explicitly provided. If no timeout is provided, the child process runs until the CLI exits or the connector is stopped.

The adapter continues to report CLI outcomes:

- Exit code `0`: post `agent.turn.completed` with final text.
- Non-zero exit code or thrown command error: post `agent.turn.failed` with the CLI error/exit details.

Server turn scheduling rules:

1. An active turn remains open until the adapter reports `agent.turn.completed` or `agent.turn.failed`, or until a real lifecycle event makes it impossible to continue, such as agent disconnect/removal or room history reset.
2. Age alone must never fail a turn. The server should not emit `stale_turn_recovered`.
3. New user messages during an open turn still append `message.created`.
4. The first such message appends one `agent.turn.followup_queued` for the open turn. Later messages do not create duplicate queued markers.
5. When the open turn completes or fails, the server creates the next `agent.turn.requested` if a queued follow-up exists and the active agent is still available.

This keeps room chat responsive while preserving strict one-turn-at-a-time AI execution.

## Testing Plan

- CLI adapter tests:
  - No default timeout when `timeout_ms` is omitted.
  - Explicit `timeout_ms` still terminates and reports a timeout error.
- Server tests:
  - Slow open turn older than two minutes receives a new human message and queues follow-up without `stale_turn_recovered`.
  - Queued follow-up starts after both `agent.turn.completed` and `agent.turn.failed`.
  - Admin/member can request Roundtable; observer cannot.
  - Owner approval emits request approval and starts Roundtable atomically.
  - Owner rejection resolves the pending request without starting Roundtable.
- Web tests:
  - User-facing copy says Roundtable/圆桌 rather than Collect/收集.
  - Member/admin request button posts the request and disables while pending.
  - Owner modal supports Start Roundtable, Reject, and Later.
  - AI replying state keeps composer input enabled and uses queue wording.
  - Room state derives pending request, active Roundtable, and completed history correctly.

## Acceptance Criteria

- No user-visible "Collect Mode / 收集模式" remains for this feature.
- Member/admin users can request Roundtable Mode with one click and no reason.
- Owners receive an approval prompt and can approve, reject, or dismiss locally.
- Approval starts Roundtable Mode; rejection closes the request.
- CACP does not impose a default CLI turn timeout.
- Long-running AI turns are not failed because of age.
- Messages sent while AI is replying are preserved, visible, and processed as the next queued AI turn.
- `corepack pnpm check` passes after implementation.
