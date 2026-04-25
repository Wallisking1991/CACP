# CACP v0.1 Experimental Protocol

CACP v0.1 is an experimental event-stream protocol for collaborative AI and agent rooms. The MVP server exposes a small HTTP API for room actions and a WebSocket stream for append-only room events. This document is the minimum developer reference for building MVP web clients, third-party clients, and CLI adapters.

## Core concepts

- Room: a shared collaboration space.
- Participant: a human, agent, system actor, or observer.
- Event: an append-only record of room activity.
- Question: a prompt directed at the room or selected participants.
- Proposal: a formal item that can receive votes and policy evaluation.
- Task: a request for an agent to perform work.
- Artifact: a durable result produced from discussion or agent work.

## Event envelope

Every room activity record is sent as a CACP event with this envelope:

```json
{
  "protocol": "cacp",
  "version": "0.1.0",
  "event_id": "evt_123",
  "room_id": "room_123",
  "type": "message.created",
  "actor_id": "user_123",
  "created_at": "2026-04-25T00:00:00.000Z",
  "payload": {}
}
```

Envelope field notes:

- `protocol` is always `cacp` for this protocol family.
- `version` is always `0.1.0` for this MVP protocol draft.
- `event_id` is unique for the event.
- `room_id` is the room that owns the event.
- `type` is one of the supported event types listed below.
- `actor_id` is the participant or system actor that caused the event.
- `created_at` is an ISO 8601 timestamp.
- `payload` is event-type-specific JSON.

## Auth and token model

CACP v0.1 uses bearer-style room tokens. Tokens are scoped to one room participant and currently act as shared secrets.

- HTTP endpoints that require room membership use `Authorization: Bearer <token>`.
- The WebSocket stream uses a token query parameter: `GET /rooms/:roomId/stream?token=<token>`.
- `POST /rooms` is public and returns the owner token for the new room.
- Owner/admin users can create invite tokens. A participant joins with an invite token and receives their own participant token.
- Agents register with an owner/admin/member token and receive a separate `agent_token`. The adapter must use the `agent_token` for task lifecycle calls and stream connection.
- Tokens should not be committed. For local demos, copy the example config to `*.local.json` and edit that ignored file.

Participant roles:

| Role | Purpose | MVP capabilities |
| --- | --- | --- |
| `owner` | Room creator and primary controller. | Read events, stream events, create invites, create messages/questions/proposals/tasks, vote, register agents. |
| `admin` | Delegated room administrator. | Read events, stream events, create invites, create messages/questions/proposals/tasks, vote, register agents. |
| `member` | Normal collaborator. | Read events, stream events, create messages/questions/proposals/tasks, vote, register agents. |
| `observer` | Read-only room participant. | Read events and stream events only. |
| `agent` | Registered local or remote worker. | Read/stream room events and report lifecycle for tasks assigned to that agent. |

## HTTP and WebSocket endpoints

| Method | Path | Auth requirement | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Health check and protocol/version discovery. |
| `POST` | `/rooms` | None | Create a room. Returns `room_id`, `owner_id`, and `owner_token`. |
| `GET` | `/rooms/:roomId/events` | Bearer room participant token | List room events and return the caller participant summary. |
| `GET` | `/rooms/:roomId/stream?token=...` | Token query parameter | Open the room WebSocket stream. Existing events are replayed first, then live events are sent. |
| `POST` | `/rooms/:roomId/invites` | Bearer owner/admin token | Create an invite for `admin`, `member`, or `observer`. |
| `POST` | `/rooms/:roomId/join` | Invite token in JSON body | Join with an invite token. Returns participant id/token and role. |
| `POST` | `/rooms/:roomId/messages` | Bearer owner/admin/member token | Append `message.created`. Observers are forbidden. |
| `POST` | `/rooms/:roomId/questions` | Bearer owner/admin/member token | Append `question.created`. Observers are forbidden. |
| `POST` | `/rooms/:roomId/questions/:questionId/responses` | Bearer owner/admin/member token | Append `question.response_submitted`. Observers are forbidden. |
| `POST` | `/rooms/:roomId/proposals` | Bearer owner/admin/member token | Append `proposal.created`. Observers are forbidden. |
| `POST` | `/rooms/:roomId/proposals/:proposalId/votes` | Bearer owner/admin/member token | Append `proposal.vote_cast` and, when policy evaluation reaches a terminal status, append `proposal.approved`, `proposal.rejected`, or `proposal.expired`. |
| `POST` | `/rooms/:roomId/agents/register` | Bearer owner/admin/member token | Register an agent participant. Returns `agent_id` and `agent_token`; appends `agent.registered`. |
| `POST` | `/rooms/:roomId/tasks` | Bearer owner/admin/member token | Create a task for an existing agent. Appends `task.created`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/start` | Bearer token for assigned agent | Mark the assigned task as started. Appends `task.started`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/output` | Bearer token for assigned agent | Append stdout/stderr output for the assigned task. Appends `task.output`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/complete` | Bearer token for assigned agent | Mark the assigned task as completed. Appends `task.completed`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/fail` | Bearer token for assigned agent | Mark the assigned task as failed. Appends `task.failed`. |

## Supported event types

Room events:

- `room.created`
- `invite.created`

Participant events:

- `participant.joined`
- `participant.left`
- `participant.role_updated`

Message events:

- `message.created`

Question events:

- `question.created`
- `question.response_submitted`
- `question.closed`

Proposal events:

- `proposal.created`
- `proposal.vote_cast`
- `proposal.approved`
- `proposal.rejected`
- `proposal.expired`

Decision events:

- `decision.created`
- `decision.finalized`

Agent events:

- `agent.registered`
- `agent.unregistered`
- `agent.disconnected`

Task events:

- `task.created`
- `task.started`
- `task.output`
- `task.completed`
- `task.failed`
- `task.cancelled`

Artifact events:

- `artifact.created`

Context events:

- `context.updated`

Some event types are defined by the protocol schema before all of their HTTP producers exist in the MVP server. Clients should tolerate receiving any supported event type and should ignore unknown payload fields.

## Key payload examples

### `message.created`

Created by `POST /rooms/:roomId/messages`.

Request body and event payload:

```json
{
  "text": "Hello room"
}
```

### `question.created`

Created by `POST /rooms/:roomId/questions`.

Request body:

```json
{
  "question": "Which option should we pursue?",
  "expected_response": "single_choice",
  "options": ["Option A", "Option B"]
}
```

Event payload:

```json
{
  "question_id": "q_123",
  "question": "Which option should we pursue?",
  "expected_response": "single_choice",
  "options": ["Option A", "Option B"]
}
```

`expected_response` can be `free_text`, `single_choice`, or `multiple_choice`.

### `question.response_submitted`

Created by `POST /rooms/:roomId/questions/:questionId/responses`.

Request body:

```json
{
  "response": "Option A",
  "comment": "Best fit for the MVP timeline."
}
```

Event payload:

```json
{
  "question_id": "q_123",
  "respondent_id": "user_123",
  "response": "Option A",
  "comment": "Best fit for the MVP timeline."
}
```

### `proposal.created`

Created by `POST /rooms/:roomId/proposals`.

Request body:

```json
{
  "title": "Approve local agent demo",
  "proposal_type": "demo_approval",
  "policy": {
    "type": "owner_approval"
  }
}
```

Event payload:

```json
{
  "proposal_id": "prop_123",
  "title": "Approve local agent demo",
  "proposal_type": "demo_approval",
  "policy": {
    "type": "owner_approval"
  }
}
```

Supported policy types are `owner_approval`, `majority`, `role_quorum`, `unanimous`, and `no_approval`. Policies may include `expires_at`; `role_quorum` also requires `required_roles` and `min_approvals`.

### `proposal.vote_cast`

Created by `POST /rooms/:roomId/proposals/:proposalId/votes`.

Request body:

```json
{
  "vote": "approve",
  "comment": "Looks good."
}
```

Event payload:

```json
{
  "proposal_id": "prop_123",
  "voter_id": "user_123",
  "vote": "approve",
  "comment": "Looks good."
}
```

`vote` can be `approve`, `reject`, `abstain`, or `request_changes`.

### `agent.registered`

Created by `POST /rooms/:roomId/agents/register`.

Request body:

```json
{
  "name": "Echo CLI Agent",
  "capabilities": ["shell.oneshot"]
}
```

Response body:

```json
{
  "agent_id": "agent_123",
  "agent_token": "agent_secret_token"
}
```

Event payload:

```json
{
  "agent_id": "agent_123",
  "name": "Echo CLI Agent",
  "capabilities": ["shell.oneshot"]
}
```

### `task.created`

Created by `POST /rooms/:roomId/tasks`.

Request body:

```json
{
  "target_agent_id": "agent_123",
  "prompt": "hello from the room",
  "mode": "oneshot",
  "requires_approval": false
}
```

Event payload:

```json
{
  "task_id": "task_123",
  "created_by": "user_123",
  "target_agent_id": "agent_123",
  "prompt": "hello from the room",
  "mode": "oneshot",
  "requires_approval": false
}
```

### `task.output`

Created by `POST /rooms/:roomId/tasks/:taskId/output` using the assigned agent token.

Request body:

```json
{
  "stream": "stdout",
  "chunk": "agent:hello from the room"
}
```

Event payload:

```json
{
  "task_id": "task_123",
  "agent_id": "agent_123",
  "stream": "stdout",
  "chunk": "agent:hello from the room"
}
```

`stream` can be `stdout` or `stderr`.

## CLI adapter integration sequence

A CLI adapter bridges room tasks to a local command. The MVP sequence is:

1. Load a local adapter config containing `server_url`, `room_id`, a human participant `token`, and agent command details.
2. Register the agent:

   ```http
   POST /rooms/:roomId/agents/register
   Authorization: Bearer <owner-admin-or-member-token>
   Content-Type: application/json
   ```

   ```json
   {
     "name": "Echo CLI Agent",
     "capabilities": ["shell.oneshot"]
   }
   ```

3. Store the returned `agent_id` and `agent_token` in memory for the running adapter process. Do not write the returned `agent_token` to tracked files.
4. Open the WebSocket stream with the agent token: `ws://127.0.0.1:3737/rooms/:roomId/stream?token=<agent_token>`.
5. For every streamed event, parse the CACP envelope and ignore events that are not `task.created`.
6. For `task.created`, inspect `payload.target_agent_id`. Only run the task when it matches the adapter's `agent_id`.
7. For an accepted task:
   - `POST /rooms/:roomId/tasks/:taskId/start` with the agent token.
   - Run the configured local command and send the task prompt on stdin or as your adapter contract requires.
   - For each stdout/stderr chunk, `POST /rooms/:roomId/tasks/:taskId/output` with `{ "stream": "stdout" | "stderr", "chunk": "..." }`.
   - On success, `POST /rooms/:roomId/tasks/:taskId/complete` with `{ "exit_code": 0 }` or the command exit code.
   - On adapter or command failure, `POST /rooms/:roomId/tasks/:taskId/fail` with `{ "error": "...", "exit_code": 1 }` when an exit code exists.
8. Keep the stream open for future tasks. If disconnected, reconnect with the same `agent_token` while the server still has that participant state.

Adapters should de-duplicate task ids while work is running, because stream replay may resend existing events after reconnect.

## Local MVP demo workflow

Use an ignored local config file for real room ids and tokens. Do not edit or commit `docs/examples/generic-cli-agent.json` with secrets.

Terminal A:

```powershell
corepack pnpm --filter @cacp/server dev
```

Expected output:

```text
CACP server listening on http://127.0.0.1:3737
```

Terminal B:

```powershell
corepack pnpm --filter @cacp/web dev
```

Expected: Vite prints a local URL on port `5173`.

Browser:

```text
Open http://127.0.0.1:5173
Create room named "CACP MVP Room"
Copy the displayed room_id and token
```

Create a local adapter config and edit only the copied file:

```powershell
Copy-Item docs/examples/generic-cli-agent.json docs/examples/generic-cli-agent.local.json
```

In `docs/examples/generic-cli-agent.local.json`, replace:

- `replace_with_room_id` with the copied `room_id`.
- `replace_with_owner_or_member_token` with the copied owner/member token.

Run the adapter with the local config:

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/generic-cli-agent.local.json
```

Expected adapter output:

```text
Registered Echo CLI Agent as agent_...
Connected adapter stream for room room_...
```

Browser:

```text
Select the registered Echo CLI Agent.
Create an agent task with prompt "hello from the room".
Confirm the event stream shows task.created, task.started, task.output, and task.completed.
Confirm task.output contains "agent:hello from the room".
```

If running the adapter directly from the repository root instead of through the package script, use an absolute or root-relative config path:

```powershell
corepack pnpm --filter @cacp/cli-adapter exec tsx src/index.ts "$PWD\docs\examples\generic-cli-agent.local.json"
```

## MVP flow summary

1. Create a room with `POST /rooms`.
2. Invite or join participants.
3. Open `GET /rooms/:roomId/stream?token=...` as a WebSocket.
4. Create messages, questions, proposals, and tasks over HTTP.
5. Receive all room events over the WebSocket stream.
6. Connect a CLI adapter to register a local agent.
7. Create a task targeting that agent.
8. Observe `task.started`, `task.output`, and `task.completed` events.

