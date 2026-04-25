# CACP Multi-User AI Room Design

Date: 2026-04-26
Status: Approved design for next implementation phase
Scope: Turn current task-oriented MVP into a shared multi-user AI conversation room.

## Goal

Move CACP from a developer debugging panel where users create `task.created` events manually into a real shared AI conversation room:

- One room can contain one or more humans and one active AI agent.
- If only the creator is present, the creator chats with the AI normally.
- If another participant joins from another browser/session, both users see the same timeline and can both participate.
- Human messages automatically trigger the active AI agent.
- AI output streams live in the room, then becomes a durable `message.created` record.
- When the AI asks for a structured decision, the room can use a configurable policy to decide how humans respond before continuing.

## Confirmed Product Decisions

1. **Main Web UI**
   - Replace the current separate Message / Question / Agent task debug forms with one main conversation workspace.
   - Users first create or join a room, then select an active agent, then chat in a shared timeline.

2. **AI Triggering**
   - Every human `message.created` triggers the room's active agent automatically.
   - If an agent turn is already running, new human messages are merged into one follow-up turn after the current turn completes.

3. **AI Output**
   - AI output should stream live.
   - Final AI output should also be saved as a durable `message.created` event.
   - Streaming chunks are display-only and are not used as long-term conversation context.

4. **Context Strategy**
   - First version uses the most recent 20 durable `message.created` events.
   - Future version can add room summaries.
   - CACP owns context assembly instead of relying on Claude Code / Codex session memory.

5. **Invite / Join**
   - Invite links define only the target role.
   - The invited participant enters their own display name when joining.

6. **Agent Selection**
   - Active agent is room-level shared state, not browser-local state.
   - Event: `room.agent_selected`.

7. **Decision Questions**
   - AI can request a structured room decision by emitting a fenced `cacp-question` JSON block.
   - Humans can also create decision questions manually later.
   - First version supports policy types already present in protocol: `owner_approval`, `majority`, `unanimous`, `no_approval`, and existing `role_quorum` internally.

8. **AI Turn Orchestration**
   - Server, not Web clients, triggers agent turns.
   - This prevents duplicate AI calls when multiple browsers are open.

9. **UI Direction**
   - Default style: dark AI command center / professional engineering collaboration workspace.

## Target Flow

```text
Alice opens Web -> creates room -> starts Claude Code Agent adapter -> selects Claude Code Agent
Alice sends a message -> server creates agent turn request -> adapter calls Claude -> deltas stream -> final AI message lands
Alice creates invite -> Bob opens another browser -> Bob joins with own name -> Bob sees history
Bob sends a message -> same active agent replies using latest shared context
AI emits cacp-question block -> server creates question card -> participants answer according to room policy
```

## Event Model Additions

Add these event types to `EventTypeSchema`:

```text
room.configured
room.agent_selected
agent.turn.requested
agent.turn.followup_queued
agent.turn.started
agent.output.delta
agent.turn.completed
agent.turn.failed
```

Recommended payloads:

```json
{
  "type": "room.configured",
  "payload": { "default_policy": { "type": "owner_approval" } }
}
```

```json
{
  "type": "room.agent_selected",
  "payload": { "agent_id": "agent_123" }
}
```

```json
{
  "type": "agent.turn.requested",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "reason": "human_message",
    "context_prompt": "...assembled prompt..."
  }
}
```

```json
{
  "type": "agent.output.delta",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "chunk": "streamed text"
  }
}
```

```json
{
  "type": "agent.turn.completed",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "message_id": "msg_123"
  }
}
```

Final AI response should be appended as:

```json
{
  "type": "message.created",
  "actor_id": "agent_123",
  "payload": {
    "message_id": "msg_123",
    "text": "final AI response",
    "kind": "agent",
    "turn_id": "turn_123"
  }
}
```

Human messages should be normalized to:

```json
{
  "type": "message.created",
  "actor_id": "user_123",
  "payload": {
    "message_id": "msg_456",
    "text": "human text",
    "kind": "human"
  }
}
```

## Server Responsibilities

- Maintain room-level active agent from `room.agent_selected` events.
- On human message creation, request an agent turn if an active agent exists.
- If a turn is already open, append `agent.turn.followup_queued` instead of starting another process.
- Build a context prompt from recent durable messages and participants.
- Expose agent-turn lifecycle endpoints for adapters.
- Accept final agent output, append `agent.turn.completed`, append final agent `message.created`, parse `cacp-question` blocks, and request a follow-up if queued.
- Keep existing task endpoints for backward compatibility.

## Adapter Responsibilities

- Keep current task support.
- Also listen for `agent.turn.requested` assigned to the registered agent.
- Call the configured CLI command with `context_prompt` through stdin.
- Stream stdout/stderr back as `agent.output.delta`.
- Accumulate stdout as final response text.
- Complete or fail the turn through server endpoints.

## Web Responsibilities

- Landing screen: Create room / Join room.
- Room workspace: dark command-center style.
- Main timeline: human messages, AI messages, streaming AI bubble, decision cards.
- Sidebar: participants, active agent selector, invite creator, room policy/decision area.
- Persist joined session locally so refresh restores the room.
- Web never triggers AI directly; it only sends human messages and displays events.

## Non-Goals For This Phase

- Full account system.
- Production deployment.
- Long-term summarization memory.
- Multiple active agents simultaneously.
- Full file-edit approval workflow.
- Rich artifact editor.

## Success Criteria

- Alice can create a room and select Claude Code Agent.
- Alice's message automatically triggers Claude Code Agent.
- Claude response streams live and then appears as a normal AI message.
- Bob can join from another browser with his own display name and see history.
- Bob's message triggers the same active agent with shared context.
- AI can create a `cacp-question` decision card through a fenced JSON block.
- `corepack pnpm check` passes.
