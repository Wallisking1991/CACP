# Claude Code-first Persistent Session Room Design

Date: 2026-04-29  
Status: Approved design, ready for implementation planning  
Scope: CACP room, server protocol, local connector, and web UI behavior for Claude Code-first rooms

## 1. Context

CACP currently treats local command agents as a generic adapter family. The room can pair command agents such as Claude Code, Codex, opencode, and Echo, and the adapter invokes the configured command once per agent turn. For Claude Code today that means each turn starts a new `claude -p` process with `--no-session-persistence`, so Claude Code does not naturally retain the previous CACP conversation unless the server rebuilds recent context into the prompt.

That model is not the right long-term product direction. Claude Code already has mature session, project, tool-use, and context-management behavior. CACP should stop trying to be a generic CLI-agent wrapper and instead become an excellent multi-user room around a persistent Claude Code working session, while still keeping LLM API agents for pure chat use cases.

## 2. Confirmed product decisions

- The primary local command agent is **Claude Code CLI Agent**.
- LLM API agents remain supported for pure conversation use cases.
- Codex, opencode, Echo, and generic local command agent adapters are removed from the product surface and reference docs.
- Existing room conversation modes are not redesigned in this work. Normal chat and Roundtable behavior stay as they are until a later room-mode design.
- Claude Code should run as a persistent process/session instead of spawning a fresh process per turn.
- Connector startup scans the current project directory for existing Claude Code sessions.
- The Web UI lets the room owner choose whether to start fresh or resume a detected Claude session.
- When a Claude session is resumed, the complete session contents are uploaded to the Web room and become visible to all room members.
- Imported session history is merged into the main chat timeline; members continue the conversation below it like a normal chat window.
- Claude Code work status is shown as a single rolling status card, not as one permanent message per status update.
- `chat.md` is no longer a core context mechanism for Claude Code. If retained, it is only an optional export/debug artifact.

## 3. Goals

1. Make Claude Code feel like a persistent expert present in the room, not a stateless bot called once per message.
2. Let all members see the restored Claude Code context before continuing the discussion.
3. Reduce prompt reconstruction in CACP for Claude Code by relying on Claude Code's own session and context management.
4. Keep the Web room readable while still showing real-time Claude Code activity.
5. Simplify the local agent model by removing generic command-agent paths that are not part of the focused Claude Code experience.
6. Preserve LLM API agent support without forcing it into the Claude Code session model.

## 4. Non-goals

- No redesign of room modes, meeting roles, member AI-trigger permissions, or Roundtable semantics in this work.
- No support for Codex, opencode, Echo, or arbitrary generic command agents after this migration.
- No attempt to display hidden model chain-of-thought. The UI only shows observable status, tool activity, messages, and outputs.
- No use of `chat.md` as a required context input to Claude Code.
- No server-side execution of local agents. Claude Code continues to run on the user's local machine through the connector.

## 5. User experience

### 5.1 Room creation and connector launch

The room owner creates a room and selects Claude Code as the local agent. The room provides a local connector launch flow as it does today, but the copy changes from generic local connector language to Claude Code-specific language.

The connector runs in the selected project directory. The project directory is important because Claude Code sessions are project-scoped and because the persistent expert should work in the same repository that the owner intends to discuss.

### 5.2 Claude session discovery

After the connector claims the pairing token, it scans the current project directory for Claude Code sessions using the official Claude Code session APIs when available. If the implementation must inspect local session files, that inspection stays local to the connector and is treated as a compatibility fallback.

The connector reports a catalog to the room with enough information for the owner to choose a session:

- session id;
- title or generated summary;
- project directory;
- last updated time;
- approximate message count;
- approximate size;
- whether the full content is available for import.

The catalog is visible in the Web room only to users who can manage the room until the owner chooses a session. The full selected session becomes visible to all room members after import.

### 5.3 Owner session choice

The owner sees a Claude setup panel with these choices:

1. **Start fresh**: start a new persistent Claude Code session for this room.
2. **Resume latest**: resume the newest detected session for the current project directory.
3. **Choose session**: browse detected sessions and inspect their complete content before selecting one.

Starting fresh does not import prior Claude history. Resuming a session uploads its complete content into the room and starts Claude Code from that same session context.

### 5.4 Full session import into the main timeline

When the owner resumes a session, the connector uploads the full Claude session transcript to the server. The server persists it as imported room history tied to the active Claude agent and session id.

The Web UI renders the imported transcript in the main chat timeline, before any new room messages that occur after the import. It should feel like opening an existing chat and continuing below it.

Imported history should retain the original sequence and author types:

- user messages;
- assistant/Claude messages;
- visible tool-use summaries;
- visible command/output summaries when available;
- system-level metadata that is safe and useful to show.

The UI should add a compact import banner at the top of the imported range, for example:

```text
Imported Claude Code session: <title> · <message count> messages · shared with all room members
```

The imported messages are not hidden in a separate panel. They are part of the chat timeline and become the shared context for the room.

### 5.5 Continuing after import

After import, participants continue typing below the restored history. The connector sends new room turns into the persistent Claude Code session as incremental messages, not as a rebuilt transcript.

For Claude Code turns, the prompt payload should be small and explicit:

```text
CACP room message
Room: <room name>
Speaker: <display name> (<role>)
Mode: current CACP mode
Message: <new message text>
Instruction: Continue from the current Claude Code session context and answer for the room.
```

This keeps CACP responsible for room metadata and Claude Code responsible for project/session context.

### 5.6 Rolling Claude work status

Web shows one active Claude work status card per running turn. It is updated in place instead of appending a permanent chat message for each state.

The card shows:

- high-level phase, such as connecting, thinking, reading files, searching, running command, waiting for approval, generating answer, completed, or failed;
- current activity line;
- a rolling list of the most recent status entries;
- elapsed time;
- optional counts such as files read, searches run, commands executed;
- owner action buttons when Claude is waiting for approval.

The rolling list is bounded, for example the latest 5-10 entries. Older detailed status can remain expandable in the card if stored, but it does not fill the main chat.

When the turn completes, the status card collapses to a summary, for example:

```text
Claude Code completed · 18s · read 3 files · searched 2 times
```

Claude's final answer is posted as a normal chat message below the status card.

### 5.7 Visibility and privacy

The selected Claude session is uploaded as shared room context. All room members can view it after import, including members who join later. This is intentional product behavior.

Because Claude sessions may contain local paths, code snippets, command output, logs, and business context, the owner must see an explicit confirmation before upload:

```text
This will upload the complete selected Claude Code session to the CACP room. All room members can view it. Continue?
```

The MVP does not silently redact session content because redaction can remove important context and can create false confidence. Owners should start fresh or choose another session if the selected history should not be shared.

## 6. Architecture

### 6.1 Agent support model

After this change, supported agent categories are:

```text
Local command agent:
  - claude-code

LLM API agents:
  - llm-api
  - llm-openai-compatible
  - llm-anthropic-compatible
```

`codex`, `opencode`, `echo`, and arbitrary generic command configurations are removed from server schemas, Web selections, docs, tests, and examples. The connector package can remain named `cli-adapter` for compatibility, but its product behavior becomes Claude Code connector plus LLM API connector.

### 6.2 Connector runtime

The connector has two runtime paths:

1. **Claude Code persistent runtime** for `claude-code`.
2. **LLM API runtime** for LLM API agents.

The Claude Code persistent runtime is responsible for:

- discovering local Claude sessions for the working directory;
- uploading selected session content after owner selection;
- starting a fresh or resumed persistent Claude Code session;
- sending new room messages into that session;
- streaming visible text output back to the server;
- streaming observable tool/status events back to the server;
- closing the Claude session when the connector shuts down.

Implementation should prefer official Claude Code Agent SDK streaming/session APIs for the persistent runtime. If the CLI streaming mode is used instead, it must still behave as a long-lived session process and not fall back to spawning `claude -p` once per turn.

### 6.3 Server responsibilities

The server remains the authority for room state. It does not execute Claude locally and does not read local Claude sessions by itself.

The server adds durable events for:

- Claude session catalog availability;
- owner selection of a session;
- imported Claude transcript messages;
- Claude runtime status updates;
- Claude runtime status completion/failure.

The server broadcasts these events over the existing room event stream. It also enforces role checks:

- only room managers can select/import a Claude session;
- all room members can view imported session contents after import;
- only the selected connector/agent can publish runtime status for its own active turn.

### 6.4 Web responsibilities

The Web app adds:

- a Claude session selection UI for room managers;
- imported transcript rendering in the main chat timeline;
- a rolling status card for active Claude work;
- clear banners when a shared Claude session has been imported;
- copy that explains full-session sharing to the owner.

The Web app removes or hides generic local command agent choices. Claude Code and LLM API remain selectable at room creation.

### 6.5 Data flow

```text
Owner creates room
  -> Owner launches connector in project directory
  -> Connector claims pairing
  -> Connector scans Claude sessions locally
  -> Connector publishes session catalog metadata
  -> Web shows session choices to owner
  -> Owner selects fresh or existing session
  -> Server records selection
  -> Connector imports complete selected session when needed
  -> Server stores imported transcript events
  -> Web renders imported transcript in main timeline
  -> Connector starts persistent Claude runtime
  -> Room messages create Claude turns
  -> Connector sends incremental message to persistent Claude runtime
  -> Connector streams rolling status and final answer
  -> Web updates one status card and appends final answer
```

## 7. Protocol and event design

Use the following event names and semantic records for the first implementation.

### 7.1 Session catalog

A connector publishes a catalog for the active room and agent:

```json
{
  "type": "claude.session_catalog.updated",
  "payload": {
    "agent_id": "agent_...",
    "working_dir": "D:\\Development\\2",
    "sessions": [
      {
        "session_id": "...",
        "title": "CACP UX discussion",
        "updated_at": "2026-04-29T10:00:00.000Z",
        "message_count": 42,
        "byte_size": 120000,
        "importable": true
      }
    ]
  }
}
```

The catalog contains metadata only. Full content is uploaded after owner selection.

### 7.2 Session selection

The owner selects fresh or resume:

```json
{
  "type": "claude.session_selected",
  "payload": {
    "agent_id": "agent_...",
    "mode": "resume",
    "session_id": "...",
    "selected_by": "participant_..."
  }
}
```

For fresh starts, `mode` is `fresh` and `session_id` is absent until Claude creates one.

### 7.3 Imported transcript

Imported messages should be represented as chat-visible records with import metadata. The implementation can either store them as `message.created` with source metadata or as a dedicated transcript-import event that room-state derivation expands into message views. The UI requirement is the same: they appear in the main chat timeline as messages.

Required message fields:

- import id;
- source Claude session id;
- source message id or sequence number;
- original timestamp when available;
- visible author role;
- text or displayable tool/status summary;
- source kind such as user, assistant, tool, command, or system.

### 7.4 Rolling status

Claude runtime status updates should address a stable status id or turn id so Web can update one card in place:

```json
{
  "type": "claude.runtime.status_changed",
  "payload": {
    "agent_id": "agent_...",
    "turn_id": "turn_...",
    "phase": "searching",
    "current": "Searching packages/server/src for session handling",
    "recent": [
      "Read packages/server/src/pairing.ts",
      "Searching session_id"
    ],
    "metrics": {
      "files_read": 1,
      "searches": 1,
      "commands": 0
    }
  }
}
```

Completion or failure updates the same card:

```json
{
  "type": "claude.runtime.status_completed",
  "payload": {
    "agent_id": "agent_...",
    "turn_id": "turn_...",
    "summary": "Completed in 18s · read 3 files · searched 2 times"
  }
}
```

## 8. Prompt and context policy

For Claude Code, CACP stops sending reconstructed recent chat history as the primary context. The persistent Claude session is the source of continuity.

Each new turn sent to Claude Code includes only:

- room metadata;
- speaker identity and role;
- the new message or Roundtable submission;
- the current room mode label;
- safety/permission framing;
- any explicit owner instruction needed for the current turn.

For LLM API agents, the existing context-building approach remains in place until a separate LLM memory design is approved. LLM API agents do not get Claude session import or persistent Claude runtime behavior.

## 9. Removal and migration

### 9.1 Remove generic command-agent product surface

Remove from Web selection, docs, examples, and tests:

- Codex CLI Agent;
- opencode CLI Agent;
- Echo Test Agent;
- generic CLI command examples as a user-facing feature.

### 9.2 Keep package boundaries stable where useful

The `packages/cli-adapter` package can remain as the connector package to avoid unnecessary workspace churn. Internally, it should split into focused runtime modules:

- Claude Code persistent runtime;
- Claude session discovery/import;
- LLM API runtime;
- shared room WebSocket/event plumbing.

### 9.3 Transcript writer downgrade

`ChatTranscriptWriter` should be removed from the normal Claude Code flow or disabled by default. If a transcript export remains useful, it must be framed as an export/debug feature and not as Claude context storage.

## 10. Security and operational constraints

- The public room server still only hosts room state. Claude Code execution stays local through the connector.
- Full Claude session upload is an explicit owner action.
- After upload, all room members can view the imported session history.
- Room logs and screenshots may now contain imported Claude history, so docs must warn users not to import sensitive sessions into shared rooms.
- Pairing tokens, participant tokens, connector tokens, API keys, and secrets must not be logged or included in session catalog metadata.
- Imported session payloads need size limits and chunking so large sessions do not break the event stream.
- If import fails partway through, the UI must show a failed import state and avoid presenting a partial transcript as complete.

## 11. Testing and validation

Implementation should include tests for:

- server schemas allowing only Claude Code plus LLM API agent types;
- removed command-agent choices no longer appearing in Web UI;
- session catalog events deriving room state correctly;
- owner-only session selection;
- complete transcript import ordering in the main timeline;
- all members viewing imported history after import;
- status updates replacing/updating one rolling status card instead of creating multiple chat messages;
- Claude connector runtime using a persistent mocked session rather than spawning per turn;
- LLM API runtime still working through the existing provider path;
- `chat.md` no longer being required for Claude Code context.

Validation should include focused package tests first and `corepack pnpm check` before completion.

## 12. Documentation updates

Update public docs to reflect the new product stance:

- CACP is Claude Code-first for local execution.
- LLM API agents remain supported for pure conversation.
- Other local command agents are no longer reference targets.
- Claude sessions can be imported into a shared room and become visible to all members.
- Imported session history should be treated as shared room content.

References for implementation planning:

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code Agent SDK sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- Claude Code Agent SDK streaming vs single mode: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Claude Code Agent SDK streaming output: https://code.claude.com/docs/en/agent-sdk/streaming-output

