# CACP v0.2 Experimental Protocol

> Historical specification. Protocol v0.2 is superseded by [CACP v0.3](cacp-v0.3.md) and is retained only to explain older event logs and connectors.

CACP is an experimental event-stream protocol for collaborative AI rooms. The reference implementation exposes HTTP endpoints for room actions, a WebSocket stream for append-only room events, and a Local Connector that keeps agent execution on the user's machine.

The public room server stores room state and serves the Web UI. It does not execute Claude Code, read local project files, or store LLM provider API keys.

The current reference agent model is intentionally narrow:

- Local execution: `claude-code` through the Local Connector and a persistent Claude Code session.
- Pure chat execution: `llm-api`, `llm-openai-compatible`, and `llm-anthropic-compatible` through the Local Connector.

Codex, opencode, Echo, and arbitrary generic command agents are not reference agent types in this version.

---

## Core flow

1. A host creates a governed room.
2. The host creates an agent pairing for Claude Code or an LLM API agent.
3. The Local Connector claims the pairing token and registers as the room agent.
4. For Claude Code, the connector scans local Claude sessions for the selected project directory and publishes a metadata-only catalog.
5. The room owner starts fresh or requests a preview of a detected session before selecting it.
6. If the owner resumes a session, the connector uploads the complete selected transcript into the shared room timeline.
7. The connector reports `claude.session_ready`; only then does the server request Claude Code turns.
8. Humans and agents share one room event stream. Claude Code status appears as a rolling runtime status card, while final answers are normal chat messages.

---

## Core concepts

- **Room**: a shared collaboration space containing participants, agents, messages, votes, runtime status, and imported Claude history.
- **Participant**: a human, agent, system actor, or observer.
- **Event**: an append-only activity record. Room state is derived from events.
- **Message**: a durable human, agent, or imported Claude transcript item in the shared timeline.
- **Active agent**: the room-level agent selected to answer new human messages.
- **Agent turn**: a server-orchestrated conversational turn for the active agent.
- **Pairing**: an expiring token that lets the Local Connector register without storing raw tokens in config files.
- **Claude session catalog**: metadata about local Claude Code sessions. Catalogs are manager-visible only.
- **Claude transcript import**: complete selected Claude session content uploaded after explicit owner selection. Imported history is visible to all room members.
- **Runtime status**: observable Claude Code work state for one turn, updated in place by `turn_id` / `status_id`.
- **Roundtable collection**: room-mode flow where human inputs are collected first and submitted to the active agent once.
- **Task events**: legacy compatibility events, not a reference generic command-agent product path.

---

## Event envelope

Every room activity record is sent as a CACP event:

```json
{
  "protocol": "cacp",
  "version": "0.2.0",
  "event_id": "evt_123",
  "room_id": "room_123",
  "type": "message.created",
  "actor_id": "user_123",
  "created_at": "2026-04-29T00:00:00.000Z",
  "payload": {}
}
```

Fields:

- `protocol`: always `cacp`.
- `version`: current reference version is `0.2.0`.
- `event_id`: unique event id.
- `room_id`: owning room id.
- `type`: supported event name.
- `actor_id`: participant or system actor that caused the event.
- `created_at`: ISO 8601 timestamp.
- `payload`: event-type-specific JSON object.

---

## Auth and token model

CACP uses bearer-style room tokens. Tokens are scoped to one room participant and act as shared secrets.

- HTTP endpoints that require membership use `Authorization: Bearer <token>`.
- The WebSocket stream uses `GET /rooms/:roomId/stream?token=<token>`.
- `POST /rooms` is public and returns the owner token.
- Owner/admin users create expiring invite tokens and agent pairings.
- A participant joins with an invite or approved join request and receives an individual participant token.
- Pairing tokens are claimed by the Local Connector and exchanged for an agent token.
- LLM provider API keys are entered into the Local Connector and are not sent to the room server.
- Tokens, connection codes, API keys, participant tokens, and pairing tokens must not appear in logs, screenshots, or session catalog metadata.

Participant roles:

| Role       | Purpose                              | Reference capabilities                                                                                                           |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `owner`    | Room creator and primary controller. | Read/stream events, manage invites/join requests/participants, create pairings, select Claude sessions, start/submit Roundtable. |
| `admin`    | Delegated room administrator.        | Manage room workflows where enabled.                                                                                             |
| `member`   | Normal collaborator.                 | Read/stream events and create conversation messages.                                                                             |
| `observer` | Read-only room participant.          | Read and stream visible room events only.                                                                                        |
| `agent`    | Registered Local Connector agent.    | Stream room events and report assigned turn, Claude session, import, and runtime status events.                                  |

---

## HTTP and WebSocket endpoints

| Method | Path                                                         | Auth requirement                             | Purpose                                                                              |
| ------ | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET`  | `/health`                                                    | None                                         | Health check and protocol/version discovery.                                         |
| `POST` | `/rooms`                                                     | None                                         | Create a room.                                                                       |
| `GET`  | `/rooms/:roomId/events`                                      | Bearer participant token                     | List visible room events and caller participant summary.                             |
| `GET`  | `/rooms/:roomId/stream?token=...`                            | Token query parameter                        | Open WebSocket stream. Existing visible events are replayed first, then live events. |
| `POST` | `/rooms/:roomId/invites`                                     | Bearer owner/admin token                     | Create expiring invite.                                                              |
| `POST` | `/rooms/:roomId/join-requests`                               | Invite token in JSON body                    | Request room access.                                                                 |
| `GET`  | `/rooms/:roomId/join-requests/:requestId`                    | Join request token                           | Poll join request status.                                                            |
| `GET`  | `/rooms/:roomId/join-requests`                               | Bearer owner token                           | List join requests.                                                                  |
| `POST` | `/rooms/:roomId/join-requests/:requestId/approve`            | Bearer owner token                           | Approve a join request.                                                              |
| `POST` | `/rooms/:roomId/join-requests/:requestId/reject`             | Bearer owner token                           | Reject a join request.                                                               |
| `POST` | `/rooms/:roomId/messages`                                    | Bearer owner/admin/member token              | Append human `message.created`; server may request or queue an agent turn.           |
| `POST` | `/rooms/:roomId/agent-pairings`                              | Bearer owner/admin token                     | Create a Claude Code or LLM API pairing and copyable connection code.                |
| `POST` | `/agent-pairings/:pairingToken/claim`                        | Pairing token                                | Local Connector claims pairing and receives agent token/profile.                     |
| `POST` | `/rooms/:roomId/agents/select`                               | Bearer owner/admin token                     | Select the active room agent.                                                        |
| `POST` | `/rooms/:roomId/claude/session-catalog`                      | Bearer token for the registered Claude agent | Publish metadata-only Claude session catalog.                                        |
| `POST` | `/rooms/:roomId/claude/session-previews`                     | Bearer owner/admin token                     | Request complete preview of one detected Claude session.                             |
| `POST` | `/rooms/:roomId/claude/session-previews/:previewId/messages` | Bearer token for the registered Claude agent | Upload preview transcript messages.                                                  |
| `POST` | `/rooms/:roomId/claude/session-previews/:previewId/complete` | Bearer token for the registered Claude agent | Mark preview complete after all preview messages are uploaded.                       |
| `POST` | `/rooms/:roomId/claude/session-previews/:previewId/fail`     | Bearer token for the registered Claude agent | Mark preview failed.                                                                 |
| `POST` | `/rooms/:roomId/claude/session-selection`                    | Bearer owner/admin token                     | Select fresh or resume mode for the Claude agent.                                    |
| `POST` | `/rooms/:roomId/claude/session-ready`                        | Bearer token for the registered Claude agent | Report that the selected Claude SDK session is ready for turns.                      |
| `POST` | `/rooms/:roomId/claude/session-imports/start`                | Bearer token for the registered Claude agent | Start transcript import for a selected resume session.                               |
| `POST` | `/rooms/:roomId/claude/session-imports/:importId/messages`   | Bearer token for the registered Claude agent | Upload ordered import transcript messages.                                           |
| `POST` | `/rooms/:roomId/claude/session-imports/:importId/complete`   | Bearer token for the registered Claude agent | Mark import complete after all expected messages are uploaded.                       |
| `POST` | `/rooms/:roomId/claude/session-imports/:importId/fail`       | Bearer token for the registered Claude agent | Mark import failed.                                                                  |
| `POST` | `/rooms/:roomId/claude/runtime-status`                       | Bearer token for the registered Claude agent | Publish changed/completed/failed status for a Claude turn.                           |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/start`                   | Bearer token for assigned agent              | Mark assigned turn as started.                                                       |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/delta`                   | Bearer token for assigned agent              | Append streaming turn output.                                                        |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/complete`                | Bearer token for assigned agent              | Complete a turn and persist final message.                                           |
| `POST` | `/rooms/:roomId/agent-turns/:turnId/fail`                    | Bearer token for assigned agent              | Fail a turn.                                                                         |
| `POST` | `/rooms/:roomId/ai-collections/*`                            | Bearer room token, role-checked              | Roundtable collection start/submit/cancel/request/approval APIs.                     |
| `POST` | `/rooms/:roomId/proposals/*`                                 | Bearer room token, role-checked              | Proposal creation and voting APIs.                                                   |
| `POST` | `/rooms/:roomId/tasks*`                                      | Bearer token, legacy-gated                   | Legacy compatibility only; not used by the reference Local Connector.                |

---

## Supported event types

Room, participants, and access:

- `room.created`
- `room.configured`
- `room.agent_selected`
- `room.history_cleared`
- `participant.joined`
- `participant.left`
- `participant.role_updated`
- `participant.removed`
- `invite.created`
- `join_request.created`
- `join_request.approved`
- `join_request.rejected`
- `join_request.expired`

Conversation and Roundtable:

- `message.created`
- `ai.collection.started`
- `ai.collection.submitted`
- `ai.collection.cancelled`
- `ai.collection.requested`
- `ai.collection.request_approved`
- `ai.collection.request_rejected`

Proposal governance:

- `proposal.created`
- `proposal.vote_cast`
- `proposal.approved`
- `proposal.rejected`
- `proposal.expired`

Agent lifecycle and turns:

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

Claude Code session and status:

- `claude.session_catalog.updated`
- `claude.session_preview.requested`
- `claude.session_preview.message`
- `claude.session_preview.completed`
- `claude.session_preview.failed`
- `claude.session_selected`
- `claude.session_ready`
- `claude.session_import.started`
- `claude.session_import.message`
- `claude.session_import.completed`
- `claude.session_import.failed`
- `claude.runtime.status_changed`
- `claude.runtime.status_completed`
- `claude.runtime.status_failed`

Legacy and extension events:

- `task.created`
- `task.started`
- `task.output`
- `task.completed`
- `task.failed`
- `task.cancelled`
- `artifact.created`
- `context.updated`

---

## Agent types

Allowed pairing `agent_type` values:

```text
claude-code
llm-api
llm-openai-compatible
llm-anthropic-compatible
```

The connection code schema rejects removed generic local command agent types. The reference Local Connector remains packaged as `@cacp/cli-adapter` for workspace compatibility, but its supported runtime paths are Claude Code sessions and LLM API chat.

---

## Key payload examples

### `agent.pairing_created`

```json
{
  "type": "agent.pairing_created",
  "payload": {
    "pairing_id": "pair_123",
    "agent_type": "claude-code",
    "permission_level": "read_only",
    "expires_at": "2026-04-29T08:00:00.000Z"
  }
}
```

The HTTP response returns a CACP connection code. The raw pairing token is not persisted in event payloads.

### `claude.session_catalog.updated`

```json
{
  "type": "claude.session_catalog.updated",
  "actor_id": "agent_123",
  "payload": {
    "agent_id": "agent_123",
    "working_dir": "D:\\Development\\2",
    "sessions": [
      {
        "session_id": "session_abc",
        "title": "CACP UX discussion",
        "project_dir": "D:\\Development\\2",
        "updated_at": "2026-04-29T10:00:00.000Z",
        "message_count": 42,
        "byte_size": 120000,
        "importable": true
      }
    ]
  }
}
```

Catalog events are visible only to room managers and the owning agent until a session is imported.

### `claude.session_preview.requested`

```json
{
  "type": "claude.session_preview.requested",
  "payload": {
    "preview_id": "preview_123",
    "agent_id": "agent_123",
    "session_id": "session_abc",
    "requested_by": "user_123",
    "requested_at": "2026-04-29T10:01:00.000Z"
  }
}
```

The connector answers with ordered `claude.session_preview.message` events, then `completed` or `failed`.

### `claude.session_selected`

```json
{
  "type": "claude.session_selected",
  "payload": {
    "agent_id": "agent_123",
    "mode": "resume",
    "session_id": "session_abc",
    "selected_by": "user_123"
  }
}
```

For fresh starts, `mode` is `fresh` and no prior transcript is imported.

### `claude.session_import.message`

```json
{
  "type": "claude.session_import.message",
  "payload": {
    "import_id": "import_123",
    "agent_id": "agent_123",
    "session_id": "session_abc",
    "sequence": 0,
    "source_message_id": "msg_abc",
    "author_role": "assistant",
    "source_kind": "assistant",
    "text": "Visible Claude response text"
  }
}
```

Imported messages are rendered in the main chat timeline. Completion is accepted only when the uploaded sequence is continuous and the count matches the import start event.

### Claude `agent.turn.requested`

```json
{
  "type": "agent.turn.requested",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "reason": "human_message",
    "room_name": "Architecture review",
    "speaker_name": "Alice",
    "speaker_role": "owner",
    "mode": "normal",
    "message_text": "Please review the latest change."
  }
}
```

For Claude Code, the server sends incremental room metadata plus the new message or Roundtable submission. It does not rebuild recent chat history as the main context.

### LLM API `agent.turn.requested`

```json
{
  "type": "agent.turn.requested",
  "payload": {
    "turn_id": "turn_456",
    "agent_id": "agent_456",
    "reason": "human_message",
    "context_prompt": "Room context for a pure conversation LLM API agent..."
  }
}
```

LLM API agents remain pure chat agents and do not receive Claude session import/runtime events.

### `claude.runtime.status_changed`

```json
{
  "type": "claude.runtime.status_changed",
  "payload": {
    "agent_id": "agent_123",
    "turn_id": "turn_123",
    "status_id": "claude-runtime-turn_123",
    "phase": "reading_files",
    "current": "Claude Code reading files: README.md",
    "recent": [
      "Sending room message to Claude Code",
      "Claude Code reading files: README.md"
    ],
    "metrics": { "files_read": 1, "searches": 0, "commands": 0 },
    "started_at": "2026-04-29T10:02:00.000Z",
    "updated_at": "2026-04-29T10:02:05.000Z"
  }
}
```

The Web UI derives one rolling card per `status_id` / `turn_id`; status updates are not permanent chat messages.

---

## Local Connector requirements

A compliant reference Local Connector should:

1. Claim a pairing token through `POST /agent-pairings/:pairingToken/claim`.
2. Open `/rooms/:roomId/stream?token=<agent_token>`.
3. Ignore events not assigned to its `agent_id`.
4. For Claude Code:
   - discover sessions in the selected project directory;
   - publish a metadata-only catalog;
   - handle preview requests locally;
   - start or resume the selected persistent Claude SDK session;
   - upload the selected transcript only after owner selection;
   - report `claude.session_ready` after the SDK session is actually selected;
   - send each new room turn as an incremental room message to the persistent session;
   - stream visible output through `agent.output.delta` and final text through `agent-turns/:turnId/complete`;
   - stream observable work state through `claude.runtime.status_*` events.
5. For LLM API agents:
   - collect provider settings locally;
   - validate provider/model connectivity before pairing;
   - keep API keys local and out of room events;
   - answer as a pure conversation agent without claiming local file/tool access.
6. Treat `chat.md` as optional export/debug material only. It is not required Claude Code context storage.
7. Ignore legacy `task.created` events in the reference connector.

---

## Compatibility notes

- Historical `task.*` events remain in the protocol for compatibility, but generic command-agent execution is not part of the current reference product.
- The Web reference UI exposes Claude Code plus LLM API choices only.
- Claude session catalogs are manager-visible; imported selected transcript history is visible to all room members, including later joiners.
- Import failure must be represented explicitly and must not be shown as a complete imported transcript.
- Agent turn deltas are for live display; durable conversation context uses final `message.created` events and imported Claude transcript messages.
- `chat.md` must not be required for Claude Code continuity. Claude Code session continuity comes from the persistent SDK session.
