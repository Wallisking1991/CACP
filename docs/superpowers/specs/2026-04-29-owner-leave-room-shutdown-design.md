# Owner Leave Room Shutdown Design

**Date:** 2026-04-29
**Status:** Approved for implementation

## Problem

When the room owner clicks the web UI's **Leave Room** button, the browser only clears local session state. The server is not notified that the owner intentionally left. As a result, invited users and local agents keep valid participant tokens, existing WebSocket streams stay open, and `CACP-Local-Connector` continues serving AI turns after the owner is gone.

## Root Cause

The current web leave handler in `packages/web/src/App.tsx` only clears local storage and React state. The server has participant removal support for an owner removing non-owner participants, but no room-level owner-leave or room-shutdown API. The connector already exits when its WebSocket is closed by the server, so the missing piece is server-side owner-leave semantics that revoke participants and close sockets.

## Chosen Behavior

Only an explicit owner click on **Leave Room** dissolves the room. Ordinary browser refreshes, transient WebSocket disconnects, or network loss must not dissolve the room.

When the owner explicitly leaves:

1. All active participants in the room are revoked, including the owner, invited humans, observers, and agents.
2. All room WebSocket connections are closed so browsers leave the room and local connectors exit.
3. Agents are marked offline.
4. Any later request using a revoked room token receives `401 invalid_token`.
5. Members cannot remain in the room or continue chatting with AI after owner shutdown.

## API Design

Add a new endpoint:

```http
POST /rooms/:roomId/leave
Authorization: Bearer <participant-token>
Content-Type: application/json

{}
```

Owner response:

```json
{ "ok": true, "status": "room_closed" }
```

For this fix, non-owner callers do not need new server-side leave behavior; the web client can keep its current local-only leave for non-owners. If a non-owner calls the endpoint, return `403 forbidden` to keep the scope minimal.

## Server Design

Modify `packages/server/src/server.ts`:

- Add a helper to close all remembered sockets for a room.
- Add a helper or route logic that collects `store.getParticipants(roomId)` before revocation.
- In a single transaction, revoke each active participant with reason `owner_left_room`.
- Append `participant.removed` for each participant with:
  - `participant_id`
  - `removed_by`: owner id
  - `removed_at`
  - `reason`: `owner_left_room`
- Append `agent.status_changed` with `status: "offline"` for each agent.
- Publish stored events.
- Close all room sockets with WebSocket close code `4001` and reason `owner_left_room`.

The existing participant token lookup already checks participant revocations, so no separate auth middleware change is needed.

## Web Design

Modify `packages/web/src/api.ts`:

- Add `leaveRoom(session)` calling `POST /rooms/:roomId/leave`.

Modify `packages/web/src/App.tsx`:

- In `handleLeaveRoom`, if `session.role === "owner"`, call `leaveRoom(session)` and then clear local state.
- For non-owner sessions, keep the existing local-only clear behavior.
- If owner leave fails, show the existing error banner and keep the session so the owner can retry.

## Connector Behavior

No connector production change should be required. `packages/cli-adapter/src/index.ts` already exits on WebSocket close. The new server close reason is `owner_left_room`, so the connector may log the generic close message and exit. That is sufficient for this bug.

## Testing Design

Add server regression coverage in `packages/server/test/participant-removal.test.ts`:

- Create a room with owner.
- Join a member through owner-approved invite flow.
- Register or pair an agent.
- Call `POST /rooms/:roomId/leave` as owner.
- Assert the owner, member, and agent tokens can no longer call protected endpoints.
- Assert room events include `participant.removed` for member, owner, and agent with reason `owner_left_room`.
- Assert room events include `agent.status_changed` offline for the agent.

Add web API/UI coverage if existing test setup makes it lightweight. The security-critical regression is server-side token revocation and socket shutdown.

## Non-Goals

- Do not dissolve rooms on WebSocket disconnect, page refresh, or network loss.
- Do not implement non-owner server-side self-leave in this change.
- Do not add room archival persistence beyond participant revocation unless required by tests.
- Do not change connector runtime logic unless tests prove it is necessary.
