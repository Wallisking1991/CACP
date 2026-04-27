# Local Connector and Invite Security Design

## Goal

Harden the cloud room experience for public use while keeping the Local Connector simple for non-technical room owners. Users download the Windows Local Connector once, then use short-lived connection codes and one-use invite links for each room session.

## Local Connector Model

The Local Connector is distributed as a reusable Windows executable:

- Users download `CACP-Local-Connector.exe` once.
- Each new room generates a short-lived connection code in the Web UI.
- The owner copies the connection code from Web and pastes it into the local executable.
- The executable claims the pairing token, starts the local Agent session, and keeps running until the owner closes it.
- Closing the Connector ends the local Agent session.

The connection code is a wrapper around the server URL, pairing token, expiry, and optional display metadata:

```text
CACP-CONNECT:v1:<base64url-json>
```

The pairing token remains single-use and expires after 15 minutes. The resulting `agent_token` is kept only in process memory. The Connector does not persist long-lived credentials, because local Agents are temporary room sessions rather than registered devices.

## Invite Link Model

Invite links are unique, one-use, and regenerated on demand:

- Every click on “Copy invite” creates a new invite token and URL.
- The server stores only a token hash.
- Each invite can create at most one join request.
- Used, expired, revoked, or room-mismatched invites are rejected.
- Default invite expiry should be short for public rooms, preferably 15-60 minutes.

This prevents one copied link from being reused or forwarded repeatedly.

## Join Approval Flow

Invite links do not directly create participants. They create pending join requests:

1. Invitee opens the link and enters a display name.
2. Server validates and consumes the invite token.
3. Server creates a pending `join_request` with expiry, requester name, role, and metadata such as IP/user agent if available.
4. Invitee sees a waiting-room screen.
5. Owner receives an in-room notification and can approve or reject.
6. The waiting browser polls a request-status endpoint until the owner decides.
7. Approval creates the participant and returns a participant token through that status endpoint. Rejection closes the request and the consumed invite cannot be reused.

Pending join requests should expire automatically after about 10 minutes.

## Owner Removal and Forced Exit

Owners can remove joined non-owner participants and connected Agents:

- Removal marks the participant as revoked/removed server-side.
- Existing WebSocket connections for that participant are closed. If the participant is an Agent, the Connector should treat the close/removal event as terminal and stop the local Agent process.
- Future HTTP and WebSocket requests using that token fail with `participant_removed` or `invalid_token`.
- A room event records who removed whom and when.

This must be enforced by the server, not only by the UI.

## Data Model Additions

Add persistent records for join requests and participant revocation. Suggested tables and endpoints:

```sql
join_requests (
  request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  invite_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
)

participant_revocations (
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  removed_by TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(room_id, participant_id)
)
```

Existing participant token lookups must reject revoked participants. For the MVP, use polling instead of a second invitee WebSocket. Suggested endpoints are `POST /rooms/:roomId/join-requests`, `GET /rooms/:roomId/join-requests/:requestId`, `POST /rooms/:roomId/join-requests/:requestId/approve`, `POST /rooms/:roomId/join-requests/:requestId/reject`, and `POST /rooms/:roomId/participants/:participantId/remove`.

## UI Requirements

Owner UI:

- “Copy invite” always creates and copies a fresh one-use invite link.
- Show pending join requests with Approve and Reject actions.
- Show a member management action to remove participants/Agents.
- Show Connector download once and per-room connection code separately.

Invitee UI:

- Opening an invite link shows a name form.
- Submitting shows “Waiting for owner approval”.
- Approved requests enter the room automatically.
- Rejected/expired requests show a clear failure message.

Connector UI:

- Double-click starts a console prompt asking for a connection code.
- Successful claim shows connected room and “keep this window open”.
- Closing the window disconnects the local Agent.

## Security Controls

- Rate limit invite creation, join request creation, approval attempts, and polling.
- Keep invite tokens and pairing tokens out of events and logs.
- Treat connection codes as secrets and show expiry clearly.
- Only owners can approve/reject requests and remove participants.
- Agents cannot approve invites or remove people.
- Removed participants cannot regain access without a new invite and approval.

## Validation

Required tests:

- Copy invite twice produces two different one-use links.
- Reusing an invite after a join request fails.
- Invitee cannot enter until approved.
- Rejected or expired join request cannot be approved later.
- Removed participant loses WebSocket and API access.
- Connector can claim a valid connection code and cannot reuse it.
- Full `corepack pnpm check` passes.



