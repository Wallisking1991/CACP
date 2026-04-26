# CACP Decision Protocol and Room UX Redesign

Date: 2026-04-26
Status: Approved for implementation planning

## Background

The current prototype can already create a room, connect a local CLI agent, invite participants, and stream agent replies. The next version should move beyond a demo UI and turn multi-user decisions into a first-class CACP protocol capability.

This design follows the user's direction to implement the fuller protocol-oriented approach rather than a shallow UI patch.

## Goals

1. Make explicit conversation decisions a standard protocol concept.
2. Keep the room usable as a natural chat experience: users answer in the main composer, not inside a side-panel form.
3. Enforce one active blocking decision at a time so discussions converge before moving to the next decision.
4. Redesign the Web UI around a chat-first workspace with compact controls.
5. Make all Web UI text English.
6. Add room history clearing for owners/admins.
7. Improve perceived agent response speed without risky long-running CLI session changes.
8. Replace the current invisible background test service startup with a visible console session suitable for manual testing.

## Non-goals for this iteration

- Full natural-language decision extraction from arbitrary discussion without an explicit agent request.
- Long-running Claude Code / Codex / opencode process reuse.
- Multi-active-decision workflows.
- A production authentication or permission model beyond the current room token and role model.

## Protocol Design

### Version

The protocol should move from the current v0.1 question-centric shape toward v0.2 decision-centric semantics.

Implementation may keep backward compatibility internally where useful, but the public standard should name the concept `decision`, not `question`.

### Core event types

Add first-class decision and room-history events:

```text
decision.requested
decision.response_recorded
decision.resolved
decision.cancelled
room.history_cleared
```

Existing `question.*` events should be considered legacy after this change. Tool/action approval should also be represented as a decision type rather than as a special question UI.

### `decision.requested`

Created by an agent or system actor when the conversation reaches an explicit choice, judgment, approval, or confirmation point.

Required payload fields:

```json
{
  "decision_id": "dec_...",
  "title": "Choose first CLI integration",
  "description": "We need to decide which CLI agent to support first.",
  "kind": "single_choice",
  "options": [
    { "id": "A", "label": "Claude Code CLI" },
    { "id": "B", "label": "Codex CLI" },
    { "id": "C", "label": "opencode CLI" }
  ],
  "policy": { "type": "majority" },
  "blocking": true,
  "source_turn_id": "turn_...",
  "source_message_id": "msg_..."
}
```

Supported first-iteration `kind` values:

- `single_choice`
- `approval`

Future-compatible values may include `multiple_choice`, `ranking`, and `free_text_confirmation`.

### `decision.response_recorded`

Recorded when a participant answers the current active decision from the main chat composer.

Required payload fields:

```json
{
  "decision_id": "dec_...",
  "respondent_id": "pt_...",
  "response": "A",
  "response_label": "Claude Code CLI",
  "source_message_id": "msg_...",
  "interpretation": {
    "method": "deterministic",
    "confidence": 1
  }
}
```

If a participant changes their answer, append another `decision.response_recorded` event. Derived state uses that participant's latest response. History can show that the answer changed.

### `decision.resolved`

Emitted automatically when the decision policy is satisfied.

Payload:

```json
{
  "decision_id": "dec_...",
  "result": "A",
  "result_label": "Claude Code CLI",
  "decided_by": ["pt_owner", "pt_member"],
  "policy_evaluation": {
    "status": "approved",
    "reason": "majority selected A"
  }
}
```

### `decision.cancelled`

Only owners/admins can cancel or skip a stuck active decision. This does not require another decision approval.

Payload:

```json
{
  "decision_id": "dec_...",
  "reason": "Skipped by owner",
  "cancelled_by": "pt_owner"
}
```

Cancelled decisions remain in Decision History.

### `room.history_cleared`

Owners/admins can clear the room history for everyone. This clears displayed messages and decision history after the event boundary.

The event itself remains visible as the new timeline boundary so participants can understand why prior context disappeared.

Payload:

```json
{
  "cleared_by": "pt_owner",
  "cleared_at": "2026-04-26T...Z",
  "scope": "messages_and_decisions"
}
```

## Single Active Decision Gate

A room can have only one active/open blocking decision at a time.

Rules:

1. If no active decision exists, agents can request a new decision.
2. If an active decision exists, the server rejects another `decision.requested` with `409 active_decision_exists`.
3. Discussion about the active decision may continue.
4. The agent may explain options, summarize current responses, or remind missing participants.
5. The agent should not move to the next decision until the active one is resolved or cancelled.
6. Owners/admins can cancel or skip a stuck decision directly.

## Decision Response Interpretation

Users answer in the main chat composer. They do not need to click side-panel buttons.

First-iteration interpretation should be deterministic and conservative:

### `single_choice`

Recognize:

- Exact option id: `A`, `B`, `C`
- Common choice phrases: `choose A`, `I choose A`, `选 A`
- Option label match: `Claude Code`, `Claude Code CLI`

If the answer is ambiguous, do not record a decision response. The system should guide the user with an English prompt such as:

```text
Please answer with one of: A, B, C.
```

### `approval`

Recognize approve phrases:

- `approve`
- `yes`
- `agree`
- `同意`
- `可以`

Recognize reject phrases:

- `reject`
- `no`
- `disagree`
- `不同意`
- `不可以`

## Agent Output Standard

The agent prompt should instruct connected CLI agents to emit a structured decision block only when an explicit decision is required.

New block:

````text
```cacp-decision
{
  "title": "Choose first CLI integration",
  "description": "We need to decide which CLI agent to support first.",
  "kind": "single_choice",
  "options": [
    { "id": "A", "label": "Claude Code CLI" },
    { "id": "B", "label": "Codex CLI" },
    { "id": "C", "label": "opencode CLI" }
  ],
  "policy": "room_default",
  "blocking": true
}
```
````

The legacy `cacp-question` block should be replaced by `cacp-decision` in prompts and parser logic.

## Web UI Design

### Layout

Use a chat-first workspace:

```text
Compact Header
Room name / active agent / participants / Clear room / Collapse controls / Leave

Main Chat Panel                 Right Controls
fixed-height scroll area         Agent
composer                         Invite
                                 Participants
                                 Decisions
```

The whole page should not grow indefinitely with messages. The chat content area should scroll internally.

### Header

The header should be compact and practical, not a large hero banner. It should show:

- Room name / Room ID
- Active agent status
- Participant count
- `Clear room`
- `Collapse controls`
- `Leave room`

### Right controls

Default state: expanded.

Recommended desktop widths:

- Expanded: about 280px
- Collapsed: about 52px

Collapsed state shows an icon rail for:

- Agent
- Invite
- Participants
- Decisions

If any hidden section changes while collapsed, show a badge on the corresponding icon. Opening the controls clears the relevant badge state.

### Decisions panel

The Decisions panel should have two layers:

1. `Current Decision`
   - Active decision title and description
   - Options or approval choices
   - Policy
   - Participant response status
   - Missing participants if the policy still waits for them
   - Owner/admin cancel or skip control

2. `Decision History`
   - Resolved and cancelled decisions
   - Final result
   - Who answered what
   - Timestamp
   - Expandable details

Empty state:

```text
No active decision.
When the AI requests a decision, it will appear here.
```

### Clear room

Behavior:

- Button label: `Clear room`
- Owner/admin only
- Confirmation text: `Clear all messages and decision history for everyone?`
- Clears messages and decisions for all clients
- Leaves a `room.history_cleared` boundary event

### Language

All visible Web UI text should be English, including:

- Permission options
- Invite options
- Policy labels
- Empty states
- Error messages
- Buttons
- Form labels
- Decision status

## Startup Script Design

The root `start-test-services.cmd` should be the primary Windows entry point.

Expected behavior:

1. Opens and keeps a visible console window.
2. Starts the server and web services.
3. Shows URLs and logs in the console.
4. Keeps running until the user presses Ctrl+C or closes the window.
5. Stops child service processes when the console exits.

The PowerShell script can remain as the implementation engine, but should support a foreground mode used by the `.cmd` wrapper.

The console should display:

```text
CACP test services

Server: http://127.0.0.1:3737
Web:    http://127.0.0.1:5173

Press Ctrl+C or close this window to stop services.
```

## Response-Speed and Perceived Performance Design

The user reported that streaming appears but full replies are slow. Therefore the first iteration should focus on perceived speed and adapter overhead, not risky persistent CLI sessions.

Required improvements:

1. Show the user's message immediately after send.
2. Make the streaming bubble explicit:
   - `Claude Code CLI is responding...`
   - `Waiting for local CLI output...`
3. If waiting exceeds a threshold such as 8 seconds, show:
   - `Still waiting for the local CLI agent...`
4. Keep the UI responsive while waiting.
5. Check adapter stdout streaming and remove unnecessary waiting.
6. Do not introduce long-running CLI process reuse in this iteration unless the CLI provides a stable documented session/resume mode.

## Testing Strategy

### Protocol and server tests

Add tests for:

- `decision.requested` event validation
- Rejecting a second active decision with `409 active_decision_exists`
- Recording responses from chat messages
- Majority resolution
- Unanimous resolution
- Owner approval resolution
- Owner/admin cancellation
- Room history clearing boundary

### Web tests

Add tests for derived room state:

- Current decision derivation
- Decision history derivation
- Latest response wins
- Cleared history hides prior messages and decisions
- Collapsed controls badge state

### Manual Playwright flow

Validate:

1. Start services with the visible console script.
2. Create a room.
3. Pair a Claude Code CLI agent.
4. Invite a second browser participant.
5. Agent emits a `cacp-decision` block.
6. Both users answer in chat.
7. Decision resolves according to policy.
8. Decisions panel shows current and history correctly.
9. Collapse controls and confirm badges appear on hidden updates.
10. Owner clears room and all clients sync.

## Acceptance Criteria

The implementation is complete when:

1. All Web UI text is English.
2. The room UI uses a fixed-height scrollable chat area.
3. The right control rail is expanded by default and collapsible.
4. Hidden control changes create visible badges while collapsed.
5. Decisions are represented by first-class protocol events.
6. Only one active decision can exist at a time.
7. Users answer decisions from the main chat composer.
8. Decision completion follows the room policy.
9. Owners/admins can cancel or skip active decisions directly.
10. Owners/admins can clear room messages and decision history for everyone.
11. The one-click test script keeps a visible console open and stops services when it exits.
12. Automated tests and a manual browser flow pass.
