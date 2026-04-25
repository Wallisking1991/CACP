# CACP v0.1 Experimental Protocol

CACP v0.1 is an experimental event-stream protocol for collaborative AI and agent rooms. The MVP server exposes HTTP endpoints for room actions and agent lifecycle updates, plus a WebSocket stream for append-only room events.

This version focuses on a shared multi-user AI conversation room:

- multiple humans can join the same room;
- one room-level active agent can be selected;
- human messages automatically request an agent turn on the server;
- agent output streams as deltas and is persisted as a final `message.created` event;
- legacy `task.created` flows remain available for compatibility.

---

## Core concepts

- **Room**: a shared collaboration space with participants, agents, messages, questions, proposals, tasks, and artifacts.
- **Participant**: a human, agent, system actor, or observer.
- **Event**: an append-only record of room activity.
- **Message**: a durable human or agent utterance in the shared conversation timeline.
- **Active agent**: the room-level agent selected to answer new human messages.
- **Agent turn**: a server-orchestrated conversational invocation of the active agent.
- **Question**: a structured decision prompt directed at room participants.
- **Proposal**: a formal decision item that can receive votes and policy evaluation.
- **Task**: a legacy explicit request for an agent to perform work.
- **Artifact**: a durable result produced from discussion or agent work.

---

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

Envelope fields:

- `protocol`: always `cacp`.
- `version`: always `0.1.0` for this draft.
- `event_id`: unique event id.
- `room_id`: owning room id.
- `type`: one of the supported event names.
- `actor_id`: participant or system actor that caused the event.
- `created_at`: ISO 8601 timestamp.
- `payload`: event-type-specific JSON object.

---

## Auth and token model

CACP v0.1 uses bearer-style room tokens. Tokens are scoped to one room participant and currently act as shared secrets.

- HTTP endpoints that require room membership use `Authorization: Bearer <token>`.
- The WebSocket stream uses a token query parameter: `GET /rooms/:roomId/stream?token=<token>`.
- `POST /rooms` is public and returns the owner token for the new room.
- Owner/admin users create invite tokens. The invite defines the target role only.
- A participant joins with `{ invite_token, display_name }` and receives an individual participant token.
- Agents register with an owner/admin/member token and receive an `agent_token`.
- The adapter must use the `agent_token` for WebSocket stream and agent lifecycle endpoints.
- Tokens should never be committed. Local demos should copy examples to ignored `*.local.json` files.

Participant roles:

| Role | Purpose | MVP capabilities |
| --- | --- | --- |
| `owner` | Room creator and primary controller. | Read/stream events, create invites, create messages/questions/proposals/tasks, vote, register/select agents. |
| `admin` | Delegated room administrator. | Read/stream events, create invites, create messages/questions/proposals/tasks, vote, register/select agents. |
| `member` | Normal collaborator. | Read/stream events, create messages/questions/proposals/tasks, vote, register/select agents. |
| `observer` | Read-only room participant. | Read and stream events only. |
| `agent` | Registered local or remote worker. | Read/stream room events and report task/turn lifecycle for work assigned to that agent. |

---

## HTTP and WebSocket endpoints

| Method | Path | Auth requirement | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Health check and protocol/version discovery. |
| `POST` | `/rooms` | None | Create a room. Returns `room_id`, `owner_id`, and `owner_token`. |
| `GET` | `/rooms/:roomId/events` | Bearer room participant token | List room events and return caller participant summary. |
| `GET` | `/rooms/:roomId/stream?token=...` | Token query parameter | Open WebSocket stream. Existing events are replayed first, then live events are sent. |
| `POST` | `/rooms/:roomId/invites` | Bearer owner/admin token | Create an invite for `admin`, `member`, or `observer`. Body: `{ "role": "member" }`. |
| `POST` | `/rooms/:roomId/join` | Invite token in JSON body | Join with `{ "invite_token": "...", "display_name": "Bob" }`. |
| `POST` | `/rooms/:roomId/messages` | Bearer owner/admin/member token | Append human `message.created`; server may also append `agent.turn.requested` or `agent.turn.followup_queued`. |
| `POST` | `/rooms/:roomId/questions` | Bearer owner/admin/member token | Append `question.created`. |
| `POST` | `/rooms/:roomId/questions/:questionId/responses` | Bearer owner/admin/member token | Append `question.response_submitted`. |
| `POST` | `/rooms/:roomId/proposals` | Bearer owner/admin/member token | Append `proposal.created`. |
| `POST` | `/rooms/:roomId/proposals/:proposalId/votes` | Bearer owner/admin/member token | Append `proposal.vote_cast` and a terminal proposal event when policy evaluation completes. |
| `POST` | `/rooms/:roomId/agents/register` | Bearer owner/admin/member token | Register an agent participant. Returns `agent_id` and `agent_token`; appends `agent.registered`. |
| `POST` | `/rooms/:roomId/agents/select` | Bearer owner/admin/member token | Select room-level active agent. Body: `{ "agent_id": "agent_123" }`; appends `room.agent_selected`. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/start` | Bearer token for assigned agent | Mark an assigned turn as started; appends `agent.turn.started`. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/delta` | Bearer token for assigned agent | Append streaming turn output; appends `agent.output.delta`. Body: `{ "chunk": "..." }`. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/complete` | Bearer token for assigned agent | Complete a turn; appends `agent.turn.completed`, final agent `message.created`, parsed `question.created`, and possibly follow-up turn request. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/fail` | Bearer token for assigned agent | Fail a turn; appends `agent.turn.failed`. |
| `POST` | `/rooms/:roomId/tasks` | Bearer owner/admin/member token | Legacy explicit task creation for an existing agent; appends `task.created`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/start` | Bearer token for assigned agent | Legacy task start; appends `task.started`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/output` | Bearer token for assigned agent | Legacy task output; appends `task.output`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/complete` | Bearer token for assigned agent | Legacy task complete; appends `task.completed`. |
| `POST` | `/rooms/:roomId/tasks/:taskId/fail` | Bearer token for assigned agent | Legacy task failure; appends `task.failed`. |

---

## Supported event types

Room events:

- `room.created`
- `room.configured`
- `room.agent_selected`
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

Decision events:

- `decision.created`
- `decision.finalized`

Proposal events:

- `proposal.created`
- `proposal.vote_cast`
- `proposal.approved`
- `proposal.rejected`
- `proposal.expired`

Agent events:

- `agent.registered`
- `agent.unregistered`
- `agent.disconnected`
- `agent.turn.requested`
- `agent.turn.followup_queued`
- `agent.turn.started`
- `agent.output.delta`
- `agent.turn.completed`
- `agent.turn.failed`

Legacy task events:

- `task.created`
- `task.started`
- `task.output`
- `task.completed`
- `task.failed`
- `task.cancelled`

Other extension events:

- `artifact.created`
- `context.updated`

---

## Key payload examples

### `room.created`

```json
{
  "type": "room.created",
  "actor_id": "user_owner",
  "payload": {
    "name": "CACP AI Room",
    "created_by": "user_owner"
  }
}
```

### `room.configured`

```json
{
  "type": "room.configured",
  "payload": {
    "default_policy": { "type": "owner_approval" }
  }
}
```

### `participant.joined`

```json
{
  "type": "participant.joined",
  "payload": {
    "participant": {
      "id": "user_123",
      "type": "human",
      "display_name": "Alice",
      "role": "owner"
    }
  }
}
```

### `invite.created`

```json
{
  "type": "invite.created",
  "payload": {
    "role": "member"
  }
}
```

The actual invite token is returned by HTTP response and is not stored in the event payload.

### `agent.registered`

```json
{
  "type": "agent.registered",
  "payload": {
    "agent_id": "agent_123",
    "name": "Claude Code Agent",
    "capabilities": ["claude-code.print", "repo.read", "analysis"]
  }
}
```

### `room.agent_selected`

```json
{
  "type": "room.agent_selected",
  "payload": {
    "agent_id": "agent_123"
  }
}
```

### Human `message.created`

```json
{
  "type": "message.created",
  "actor_id": "user_123",
  "payload": {
    "message_id": "msg_123",
    "text": "Please help us compare option A and option B.",
    "kind": "human"
  }
}
```

### `agent.turn.requested`

```json
{
  "type": "agent.turn.requested",
  "actor_id": "user_123",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "reason": "human_message",
    "context_prompt": "You are Claude Code Agent..."
  }
}
```

`reason` is currently `human_message` or `queued_followup`.

### `agent.turn.followup_queued`

```json
{
  "type": "agent.turn.followup_queued",
  "payload": {
    "turn_id": "turn_current",
    "agent_id": "agent_123"
  }
}
```

This means a new human message arrived while the same active agent already had an open turn. The server will request one follow-up turn after the current one completes.

### `agent.turn.started`

```json
{
  "type": "agent.turn.started",
  "actor_id": "agent_123",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123"
  }
}
```

### `agent.output.delta`

```json
{
  "type": "agent.output.delta",
  "actor_id": "agent_123",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "chunk": "partial streamed text"
  }
}
```

Deltas are for live display. The durable conversation context uses final `message.created` events.

### `agent.turn.completed`

```json
{
  "type": "agent.turn.completed",
  "actor_id": "agent_123",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "message_id": "msg_456",
    "exit_code": 0
  }
}
```

### Agent final `message.created`

```json
{
  "type": "message.created",
  "actor_id": "agent_123",
  "payload": {
    "message_id": "msg_456",
    "text": "Here is the final answer.",
    "kind": "agent",
    "turn_id": "turn_123"
  }
}
```

### `agent.turn.failed`

```json
{
  "type": "agent.turn.failed",
  "actor_id": "agent_123",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "error": "command exited with code 1",
    "exit_code": 1
  }
}
```

### `question.created`

```json
{
  "type": "question.created",
  "payload": {
    "question_id": "q_123",
    "question": "Should we continue with option A?",
    "expected_response": "single_choice",
    "options": ["Yes", "No"]
  }
}
```

An agent can request a structured question by emitting:

````text
```cacp-question
{"question":"Should we continue?","options":["Yes","No"]}
```
````

The server parses valid blocks during turn completion and appends `question.created` events. Malformed blocks are ignored while the final agent message is still preserved.

### Legacy `task.created`

```json
{
  "type": "task.created",
  "payload": {
    "task_id": "task_123",
    "created_by": "user_123",
    "target_agent_id": "agent_123",
    "prompt": "Run a one-shot analysis.",
    "mode": "oneshot",
    "requires_approval": false
  }
}
```

---

## Conversation orchestration sequence

```text
Human client                   Server                         Adapter / Agent
     | POST /messages             |                                  |
     |--------------------------->| append human message.created     |
     |                            | find active agent                |
     |                            | build context from latest 20 msgs|
     |                            | append agent.turn.requested      |
     |                            |--------------------------------->| receives stream event
     |                            |<---------------------------------| POST /agent-turns/:id/start
     |                            | append agent.turn.started        |
     |                            |<---------------------------------| POST /delta chunks
     |                            | append agent.output.delta        |
     |                            |<---------------------------------| POST /complete final_text
     |                            | append agent.turn.completed      |
     |                            | append final agent message       |
     | WebSocket events to all humans and agents                         |
```

If a turn is open for the active agent when a new human message is created:

1. the server appends `agent.turn.followup_queued` once for that open turn;
2. the current turn continues normally;
3. when the current turn completes, the server creates one new `agent.turn.requested` with `reason: "queued_followup"` and a fresh context prompt.

---

## CLI adapter requirements

A compliant CLI adapter for this MVP should:

1. register itself through `POST /rooms/:roomId/agents/register`;
2. open `/rooms/:roomId/stream?token=<agent_token>`;
3. ignore events not assigned to its `agent_id`;
4. for `agent.turn.requested`:
   - call `/agent-turns/:turnId/start`;
   - run the configured local command;
   - pass `context_prompt` through stdin;
   - post stdout/stderr chunks to `/agent-turns/:turnId/delta` as `{ "chunk": "..." }`;
   - accumulate stdout as the final agent response;
   - call `/agent-turns/:turnId/complete` with `{ "final_text": "...", "exit_code": 0 }`, or `/fail` on errors;
5. optionally keep supporting legacy `task.created` events.

The reference `@cacp/cli-adapter` implements both the legacy task path and the new conversational turn path.

---

## Local MVP demo workflow

1. Start server:

```powershell
corepack pnpm dev:server
```

2. Start web:

```powershell
corepack pnpm dev:web
```

3. Create a room at `http://127.0.0.1:5173/`.

4. Copy an adapter config template to an ignored local config and fill `room_id` and token:

```powershell
Copy-Item docs\examples\generic-cli-agent.json docs\examples\generic-cli-agent.local.json
```

5. Start adapter:

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/generic-cli-agent.local.json
```

6. Select the registered agent in Web and send a message.

7. Open another browser session, create an invite, join as another display name, and verify both clients see the same timeline.

For Claude Code CLI testing, use `docs/examples/claude-code-agent.json` as the source template and copy it to `docs/examples/claude-code-agent.local.json`.

---

## Compatibility notes

- The old explicit task API remains available and is still supported by the reference CLI adapter.
- The Web reference UI no longer uses manual task creation as its main path.
- Agent turn deltas are live-display events; final context is derived from durable messages.
- The current Web UI shows decision cards but does not yet implement a complete multi-person approval gate before continuing.
- This draft intentionally avoids production account management, global identity, deployment security, and long-term memory compression.
