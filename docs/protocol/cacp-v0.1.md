# CACP v0.1 Experimental Protocol

CACP v0.1 is an event-stream protocol for collaborative AI and agent rooms.

## Core concepts

- Room: a shared collaboration space.
- Participant: a human, agent, system actor, or observer.
- Event: an append-only record of room activity.
- Question: a prompt directed at the room or selected participants.
- Proposal: a formal item that can receive votes and policy evaluation.
- Task: a request for an agent to perform work.
- Artifact: a durable result produced from discussion or agent work.

## Event envelope

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

## MVP flow

1. Create a room with `POST /rooms`.
2. Invite or join participants.
3. Open `GET /rooms/:roomId/stream?token=...` as a WebSocket.
4. Create messages, questions, proposals, and tasks over HTTP.
5. Receive all room events over the WebSocket stream.
6. Connect a CLI adapter to register a local agent.
7. Create a task targeting that agent.
8. Observe `task.started`, `task.output`, and `task.completed` events.
