# CACP v0.1 Experimental Protocol

CACP v0.1 is an experimental event-stream protocol for collaborative AI/agent rooms. The reference implementation exposes HTTP endpoints for room actions and agent lifecycle updates, plus a WebSocket stream for append-only room events.

This draft currently focuses on a local MVP flow:

1. a host creates a governed room;
2. the host creates a local CLI agent pairing command;
3. an adapter claims the pairing token and registers as an online agent;
4. the host selects the active agent;
5. invitees join by link and display name;
6. humans and agents share one room event stream;
7. structured AI questions and tool approvals are resolved by room policy.

---

## Core concepts

- **Room**: a shared collaboration space containing participants, agents, messages, questions, approvals, tasks, and artifacts.
- **Participant**: a human, agent, system actor, or observer.
- **Event**: an append-only activity record. Room state is derived from events.
- **Message**: a durable human or agent utterance in the shared conversation timeline.
- **Active agent**: the room-level agent selected to answer new human messages.
- **Agent turn**: a server-orchestrated conversational invocation of the active agent.
- **Invite**: an expiring token that allows a new `member` or `observer` to join a room.
- **Pairing**: an expiring token that allows a local CLI adapter to register a configured agent without manually editing config files.
- **Question**: a structured decision prompt directed at room participants.
- **Policy**: a room governance rule used to close questions or approvals.
- **Action approval**: a tool/action gate requested by an agent and resolved through a blocking question.
- **Task**: a legacy explicit request for an agent to perform work. Kept for compatibility.

---

## Event envelope

Every room activity record is sent as a CACP event:

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

Fields:

- `protocol`: always `cacp`.
- `version`: currently `0.1.0`.
- `event_id`: unique event id.
- `room_id`: owning room id.
- `type`: supported event name.
- `actor_id`: participant or system actor that caused the event.
- `created_at`: ISO 8601 timestamp.
- `payload`: event-type-specific JSON object.

---

## Auth and token model

CACP v0.1 uses bearer-style room tokens. Tokens are scoped to one room participant and currently act as shared secrets.

- HTTP endpoints that require membership use `Authorization: Bearer <token>`.
- The WebSocket stream uses `GET /rooms/:roomId/stream?token=<token>`.
- `POST /rooms` is public and returns the owner token.
- Owner/admin users create expiring invite tokens.
- A participant joins with `{ invite_token, display_name }` and receives an individual participant token.
- Pairing tokens are created by room members and claimed by local adapters.
- Agents use `agent_token` for stream and lifecycle endpoints.
- Tokens should never be committed. The local pairing flow avoids storing tokens in config files.

Participant roles:

| Role | Purpose | MVP capabilities |
| --- | --- | --- |
| `owner` | Room creator and primary controller. | Read/stream events, create invites, create messages/questions/proposals/tasks, vote, register/select agents, create pairings. |
| `admin` | Delegated room administrator. | Same as owner except ownership semantics are not yet separated. |
| `member` | Normal collaborator. | Read/stream events, create messages/questions/proposals/tasks, vote, register/select agents, create pairings. |
| `observer` | Read-only room participant. | Read and stream events only. Cannot vote. |
| `agent` | Registered local or remote worker. | Read/stream room events and report assigned task/turn lifecycle. Can request action approvals. |

---

## Policies

Room creation accepts a `default_policy`:

```json
{ "default_policy": "majority" }
```

Supported default policies in the MVP:

- `owner_approval`: the room owner response closes the question.
- `majority`: any option with more than half of eligible human voters closes the question.
- `unanimous`: all eligible human voters must choose the same option.

Eligible voters are human participants with role `owner`, `admin`, or `member`. Observers and agents are excluded. If a voter responds multiple times before closure, the latest response wins.

---

## HTTP and WebSocket endpoints

| Method | Path | Auth requirement | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Health check and protocol/version discovery. |
| `POST` | `/rooms` | None | Create a room. Body includes `name`, `display_name`, optional `default_policy`. Returns `room_id`, `owner_id`, `owner_token`. |
| `GET` | `/rooms/:roomId/events` | Bearer participant token | List room events and caller participant summary. |
| `GET` | `/rooms/:roomId/stream?token=...` | Token query parameter | Open WebSocket stream. Existing events are replayed first, then live events. Agent streams emit online/offline status. |
| `POST` | `/rooms/:roomId/invites` | Bearer owner/admin token | Create expiring invite. Body: `{ "role": "member", "expires_in_seconds": 86400 }`. |
| `POST` | `/rooms/:roomId/join` | Invite token in JSON body | Join with `{ "invite_token": "...", "display_name": "Bob" }`. |
| `POST` | `/rooms/:roomId/messages` | Bearer owner/admin/member token | Append human `message.created`; server may append `agent.turn.requested` or `agent.turn.followup_queued`. |
| `POST` | `/rooms/:roomId/questions` | Bearer owner/admin/member token | Append `question.created`. |
| `POST` | `/rooms/:roomId/questions/:questionId/responses` | Bearer owner/admin/member token | Append `question.response_submitted`; may append `question.closed` and approval resolution. |
| `POST` | `/rooms/:roomId/agent-pairings` | Bearer owner/admin/member token | Create pairing token and a copyable local adapter command. |
| `POST` | `/agent-pairings/:pairingToken/claim` | Pairing token | Adapter claims pairing, registers an agent, returns agent token/profile. |
| `POST` | `/rooms/:roomId/agents/register` | Bearer owner/admin/member token | Legacy/manual agent registration. |
| `POST` | `/rooms/:roomId/agents/select` | Bearer owner/admin/member token | Select room-level active agent. |
| `POST` | `/rooms/:roomId/agent-action-approvals?token=...&wait_ms=...` | Agent token | Create an action approval question. With `wait_ms`, hold the request until policy resolves or timeout. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/start` | Bearer token for assigned agent | Mark an assigned turn as started. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/delta` | Bearer token for assigned agent | Append streaming turn output. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/complete` | Bearer token for assigned agent | Complete a turn, persist final message, parse `cacp-question` blocks, and possibly create follow-up turn. |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/fail` | Bearer token for assigned agent | Fail a turn. |
| `POST` | `/rooms/:roomId/tasks` | Bearer owner/admin/member token | Legacy explicit task creation. |
| `POST` | `/rooms/:roomId/tasks/:taskId/start` | Bearer token for assigned agent | Legacy task start. |
| `POST` | `/rooms/:roomId/tasks/:taskId/output` | Bearer token for assigned agent | Legacy task output. |
| `POST` | `/rooms/:roomId/tasks/:taskId/complete` | Bearer token for assigned agent | Legacy task complete. |
| `POST` | `/rooms/:roomId/tasks/:taskId/fail` | Bearer token for assigned agent | Legacy task failure. |

---

## Supported event types

Room/invite:

- `room.created`
- `room.configured`
- `room.agent_selected`
- `invite.created`

Participant:

- `participant.joined`
- `participant.left`
- `participant.role_updated`

Message:

- `message.created`

Question/governance:

- `question.created`
- `question.response_submitted`
- `question.closed`
- `decision.created`
- `decision.finalized`
- `proposal.created`
- `proposal.vote_cast`
- `proposal.approved`
- `proposal.rejected`
- `proposal.expired`

Agent:

- `agent.registered`
- `agent.unregistered`
- `agent.disconnected`
- `agent.pairing_created`
- `agent.status_changed`
- `agent.action_approval_requested`
- `agent.action_approval_resolved`
- `agent.turn.requested`
- `agent.turn.followup_queued`
- `agent.turn.started`
- `agent.output.delta`
- `agent.turn.completed`
- `agent.turn.failed`

Legacy task:

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

### `room.configured`

```json
{
  "type": "room.configured",
  "payload": {
    "default_policy": { "type": "majority" }
  }
}
```

### `invite.created`

```json
{
  "type": "invite.created",
  "payload": {
    "role": "member",
    "expires_at": "2026-04-26T08:00:00.000Z"
  }
}
```

The actual invite token is returned by HTTP response and is not stored in the event payload.

### `agent.pairing_created`

```json
{
  "type": "agent.pairing_created",
  "payload": {
    "agent_type": "claude-code",
    "permission_level": "read_only",
    "expires_at": "2026-04-26T08:00:00.000Z"
  }
}
```

The HTTP response contains a command similar to:

```powershell
corepack pnpm --filter @cacp/cli-adapter dev -- --server http://127.0.0.1:3737 --pair <pairing_token>
```

### `agent.registered`

```json
{
  "type": "agent.registered",
  "payload": {
    "agent_id": "agent_123",
    "name": "Claude Code Agent",
    "capabilities": ["claude-code", "read_only", "repo.read"],
    "agent_type": "claude-code",
    "permission_level": "read_only"
  }
}
```

### `agent.status_changed`

```json
{
  "type": "agent.status_changed",
  "actor_id": "agent_123",
  "payload": {
    "agent_id": "agent_123",
    "status": "online"
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

Deltas are for live display. Durable conversation context uses final `message.created` events.

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

### `question.created`

```json
{
  "type": "question.created",
  "payload": {
    "question_id": "q_123",
    "question": "Should we continue with option A?",
    "expected_response": "single_choice",
    "options": ["Yes", "No"],
    "blocking": true,
    "policy": { "type": "majority" }
  }
}
```

An agent can request a structured question by emitting:

````text
```cacp-question
{"question":"Should we continue?","options":["Yes","No"]}
```
````

The server parses valid blocks during turn completion and appends `question.created` events.

### `question.response_submitted`

```json
{
  "type": "question.response_submitted",
  "payload": {
    "question_id": "q_123",
    "respondent_id": "user_123",
    "response": "Yes",
    "comment": "Ship it"
  }
}
```

### `question.closed`

```json
{
  "type": "question.closed",
  "payload": {
    "question_id": "q_123",
    "evaluation": {
      "status": "closed",
      "selected_response": "Yes",
      "decided_by": ["user_123", "user_456"]
    }
  }
}
```

### Action approval events

Request:

```json
{
  "type": "agent.action_approval_requested",
  "payload": {
    "action_id": "action_123",
    "agent_id": "agent_123",
    "tool_name": "Write",
    "tool_input": { "file_path": "README.md" },
    "description": "Allow the agent to update README.md?"
  }
}
```

Resolution:

```json
{
  "type": "agent.action_approval_resolved",
  "payload": {
    "action_id": "action_123",
    "question_id": "q_123",
    "decision": "approve"
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
     |                            | build context from latest msgs   |
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

If a turn is already open for the active agent when a new human message is created:

1. the server appends `agent.turn.followup_queued` once;
2. the current turn continues;
3. when the current turn completes, the server creates one follow-up turn.

If the open turn is stale or the active agent is offline, the server appends `agent.turn.failed` to recover the room.

---

## CLI adapter requirements

A compliant CLI adapter for this MVP should:

1. claim a pairing token through `POST /agent-pairings/:pairingToken/claim`, or register manually through `POST /rooms/:roomId/agents/register`;
2. open `/rooms/:roomId/stream?token=<agent_token>`;
3. ignore events not assigned to its `agent_id`;
4. for `agent.turn.requested`:
   - call `/agent-turns/:turnId/start`;
   - run the configured local command;
   - pass `context_prompt` through stdin;
   - post output chunks to `/agent-turns/:turnId/delta`;
   - call `/agent-turns/:turnId/complete` with final text, or `/fail` on errors;
5. optionally call `/agent-action-approvals?wait_ms=...` before risky actions;
6. optionally keep supporting legacy `task.created` events.

The reference `@cacp/cli-adapter` implements pairing mode, the legacy task path, and the conversational turn path.

---

## Compatibility notes

- The old explicit task API remains available and is still supported by the reference CLI adapter.
- The Web reference UI no longer exposes manual task creation as the main path.
- Agent turn deltas are live-display events; final context is derived from durable messages.
- Invite and pairing state are in-memory in the MVP and are lost when the server restarts.
- Claude Code hooks/settings automatic installation is not yet part of the reference implementation.
- Codex/opencode pairing profiles exist but require further real-CLI validation.
