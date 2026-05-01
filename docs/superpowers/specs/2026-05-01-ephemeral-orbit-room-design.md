# Ephemeral Orbit Room Conversation Design

Date: 2026-05-01
Scope: Redesign CACP conversation mechanics so the public server is an ephemeral relay, the Local Connector owns the durable main agent transcript, and human-to-human discussion becomes a local-first Orbit layer.

## 1. Product Principle

CACP rooms are ephemeral rendezvous points, not hosted conversation archives.

The public server coordinates temporary room presence, pairing, realtime delivery, current turn state, and queue state. It should not be the long-term source of truth for conversation bodies. Durable collaboration assets live in the project directory through the Local Connector and in each browser's local cache.

## 2. Confirmed Decisions

- Split human-to-agent conversation from human-to-human discussion.
- Main Agent Thread stays close to the underlying Claude Code or Codex CLI conversation format.
- Human Orbit Layer is a realtime, fun, high-end, star-orbit style side discussion surface.
- One composer input has two send actions:
  - Send to People: creates an Orbit discussion note.
  - Send to Agent: creates a main-thread message and triggers the active agent.
- Orbit discussion does not enter agent context by default.
- Owner/admin can send the current Orbit discussion round to the agent.
- Member users can participate in Orbit discussion and like notes, but cannot promote discussion to the agent.
- A main-thread message sent while the agent is busy queues for the next agent turn. Owner/admin may cancel queued messages before they trigger AI.
- If the agent is idle, Send to Agent triggers immediately and has no undo window.
- Server restart or loss of in-memory room state ends the room. The server does not restore rooms from persistent history.
- Main Agent Thread is saved locally by the Local Connector as the authoritative transcript and cached by browsers in IndexedDB.
- Orbit discussion history is viewable locally, but is not stored by the public server.
- Connector transcript sync is role-controlled: owner/admin can auto-sync; member history access is determined by invite permission.
- Backchannel realtime visibility has no extra invite permission. Online members can see and send Orbit notes according to normal message permissions.
- The project-side agent guidance for `CACP_ORBIT_DISCUSSION` should be documented in an example file such as `AGENTS_demo.md`; do not modify real `AGENTS.md` or `CLAUDE.md` as part of this design.

## 3. Architecture Direction

Target architecture is pure ephemeral relay with local durable owners.

```text
                 Public CACP Server
        in-memory room / relay / queue / TTL replay only
                         │
          ┌──────────────┴──────────────┐
          │                             │
      Browser Web UI              Local Connector
  IndexedDB cache/history     project .cacp transcript
  Orbit UI and local notes     CLI-native agent session bridge
```

Implementation may temporarily pass through a TTL relay phase, but the target state is: server restart ends rooms and server does not act as conversation archive.

## 4. Main Agent Thread

The Main Agent Thread is the formal conversation with the active local agent.

### Responsibilities

- Preserve the native Claude Code / Codex CLI conversation shape as much as possible.
- Avoid reconstructing CACP UI from provider-native session logs.
- Use a provider-neutral Local Connector transcript ledger as the CACP display/sync source.
- Let Claude Code and Codex CLI keep their own native session continuity for runtime context.

### Non-goals

- Do not create CACP-specific branching conversations in MVP.
- Do not support discussion anchored to historical agent answers in MVP.
- Do not rewrite CLI-native conversation output into a complex CACP timeline.

### Triggering

```text
Send to Agent
├─ agent idle: immediately trigger active agent
└─ agent busy: queue as next main-thread input
   ├─ owner/admin can cancel before trigger
   └─ after current turn ends, queued input triggers next turn
```

## 5. Human Orbit Layer

Human Orbit is the human-to-human side discussion layer.

### Scope

An Orbit round covers the current main-conversation scene:

- It starts after a main input is sent to the agent.
- It continues while the agent replies and while people discuss that current round.
- It ends when a new main input starts the next round.

The MVP does not let users attach Orbit discussion to old answers. This keeps the model compatible with CLI sessions and avoids branch complexity.

### UI Concept

Use a technology / star-orbit visual language:

```text
           ✦ Bob: 预算没说清  ✨5
      ✦ Alice: 风险需要展开 ✨2

          ┌──────────────────────┐
          │  Main Agent Thread    │
          │  current CLI answer   │
          └──────────────────────┘

              · Carol: 我同意
```

Rules:

- Orbit notes appear as star-like floating notes around the current conversation scene.
- New notes pulse into view.
- Notes can collapse into a star cluster when dense.
- A collapsible Orbit History panel shows local previous discussion rounds.
- Mobile can degrade to a bottom starfield panel.

## 6. Orbit Notes and Likes

Each Orbit note is local-first and server-relayed only in realtime.

```text
OrbitNote
├─ note_id
├─ room_id
├─ round_id
├─ author_id
├─ author_name
├─ text
├─ created_at
└─ local visibility metadata
```

Likes:

- Every non-author user can like a note at most once.
- Likes can be cancelled.
- Authors cannot like their own notes.
- Likes are realtime-relayed by the server, not persisted by the server.
- Browser IndexedDB stores notes and like state seen by that browser.
- Like counts affect visual emphasis, not chronological ordering.

## 7. Sending Orbit Discussion to Agent

Owner/admin can send the current Orbit round to the agent.

### Selection

- Default selection is all notes in the current Orbit round.
- Notes are sent in original chronological order.
- Owner/admin may deselect notes before sending.
- No editing or rewriting in MVP.

### Agent Message Format

Actual message sent to the agent is only the XML-like payload:

```text
<CACP_ORBIT_DISCUSSION>
1. Bob (+3): 预算没说清
2. Alice (+1): 风险需要展开
3. Carol (+0): 先让它出一个版本
</CACP_ORBIT_DISCUSSION>
```

Semantics are documented in an example project guidance file, not repeated in every message.

### Agent Guidance Example

Create an example file such as `AGENTS_demo.md` with guidance like:

```markdown
## CACP Orbit Discussion

When you receive a message wrapped in `<CACP_ORBIT_DISCUSSION>...</CACP_ORBIT_DISCUSSION>`, treat it as curated side-channel discussion from room members.

It is not a direct command by itself. Extract useful signals, preserve chronological order, use like counts as importance hints, and continue the main conversation naturally.
```

The design must not modify the repository's real `AGENTS.md` or `CLAUDE.md` unless explicitly approved later.

## 8. Local Project Asset Storage

The Local Connector stores durable CACP room assets inside the project working directory.

Default path:

```text
<working_dir>/.cacp/rooms/YYYY-MM-DD-<slugified-room-title>-<room_id>/
```

Example:

```text
.cacp/
└─ rooms/
   └─ 2026-05-01-architecture-review-room_ab12cd/
      ├─ room.json
      ├─ main-thread.jsonl
      ├─ orbit-rounds.jsonl
      ├─ orbit-notes.jsonl
      ├─ orbit-likes.jsonl
      └─ exports/
         └─ chat.md
```

Directory naming rules:

- Use room creation date in local connector time or room metadata time.
- Slugify room title: lowercase, spaces to `-`, remove Windows-invalid characters `< > : " / \\ | ? *`, collapse repeated dashes, max 60 chars.
- If room title is empty, use `untitled-room`.
- Include room id at the end.
- If the directory already exists, continue writing to it as the same room asset.

`.cacp/` is considered a project asset and may be committed. The runtime design should avoid writing API keys, participant tokens, pairing tokens, agent tokens, connection codes, or provider credentials into these files.

## 9. Browser IndexedDB Cache

Browser storage provides fast refresh recovery and local Orbit history.

Suggested IndexedDB database:

```text
cacp-room-cache-v1
```

Suggested stores:

- `roomSessions`
- `mainThreadCache`
- `orbitRounds`
- `orbitNotes`
- `orbitLikes`
- `syncState`

Refresh strategy:

```text
Web refresh
├─ immediately show IndexedDB cache
└─ if Local Connector is online and user has permission
   └─ reconcile with connector transcript
```

Orbit history is only the history this browser saw. Joining members do not receive old Orbit history from server or connector.

## 10. Server Behavior

The server should move away from being a durable event-store source of truth for conversation bodies.

Target server responsibilities:

- Create temporary rooms.
- Maintain in-memory participant presence.
- Relay main-thread and Orbit messages to online clients and connector.
- Maintain current active agent, open turn, and queued main-thread inputs in memory.
- Relay Orbit likes/unlikes.
- Support short in-memory replay only as needed for active connections.
- End rooms when server restarts or room state is lost.

Server should not persist:

- Main Agent Thread body.
- Orbit notes.
- Orbit likes.
- Agent final answer text as long-term archive.
- Imported or synced transcript bodies.

Existing SQLite usage for auth/pairing/invite may be reduced or replaced during implementation. Any remaining persistence must be justified as temporary room coordination, not hosted conversation history.

## 11. Invite and Transcript Sync

Member access to connector transcript history is controlled by invite permission.

```text
Invite
├─ role: member / observer
├─ ttl / max uses
└─ main_thread_history_access: allowed | denied
```

Behavior:

- Owner/admin can auto-sync connector transcript.
- Members with history access can receive connector main-thread transcript snapshots.
- Members without history access only see realtime main-thread messages after joining.
- Orbit history is never synced from connector.

## 12. Testing Strategy

Protocol and state tests:

- Main-thread send while idle triggers agent immediately.
- Main-thread send while agent is busy queues and can be cancelled by owner/admin before trigger.
- Member cannot cancel queued main-thread messages.
- Orbit note realtime event does not enter agent context.
- Orbit promote sends XML payload with chronological order and like counts.
- Likes toggle and cannot be added by the note author.
- Browser state derives current Orbit round and local history.

Connector tests:

- Builds `.cacp/rooms/YYYY-MM-DD-title-room_id/` path correctly.
- Reuses existing room directory.
- Appends main-thread transcript JSONL.
- Appends Orbit round/note/like JSONL when the connector is configured to record project assets.
- Does not derive CACP display timeline from Claude/Codex native session logs.

Server tests:

- Realtime Orbit events are broadcast but not appended to durable event store.
- Server restart / new server instance does not restore old room conversation bodies.
- Invite history permission is included in join approval and used by sync authorization.

Web tests:

- Composer uses one input with Send to People and Send to Agent actions.
- Orbit notes render in the Orbit layer and local history panel.
- Like/unlike UI obeys self-like restriction.
- Owner/admin can open promote tray and send current round in chronological order.
- Member cannot promote Orbit discussion.

## 13. Migration Notes

Current CACP stores all room events in SQLite. Implementation should avoid a single large rewrite by introducing the new model behind focused boundaries:

1. Add local transcript path and ledger utilities in the connector.
2. Add browser Orbit cache and UI without changing main-thread persistence yet.
3. Add server realtime Orbit relay events that bypass durable event storage.
4. Add Orbit promote to main-thread send path.
5. Move main-thread body storage from server event store to connector transcript and browser cache.
6. Convert server room state to ephemeral in-memory coordination.

Each step must be test-driven and independently shippable.
