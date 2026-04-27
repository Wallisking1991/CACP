# Cloud Room Server Deployment Design

## Goal

Convert CACP from a local demo into a cloud-hosted room service where the server hosts only collaboration state, invitations, messages, WebSocket streams, and local-agent pairing. All AI/CLI execution must happen on each user's own computer through a downloadable Local Connector.

Production domain target: `https://cacp.zuchongai.com`.

## Product Boundary

Cloud server responsibilities:

- Serve the React room UI.
- Create unique rooms and owner sessions.
- Create and validate invitation links.
- Synchronize messages and room events over HTTPS/WSS.
- Create short-lived Agent pairing tokens.
- Accept Local Connector registration and streamed Agent output.

Cloud server must not:

- Start local agents.
- Execute shell commands for users.
- Access user files.
- Grant or confirm local `limited_write` / `full_access` permissions.

Local Connector responsibilities:

- Run on the user's own computer.
- Claim a pairing token from the cloud server.
- Launch Claude Code, Codex, opencode, or Echo locally.
- Stream output back to the cloud room.
- Require explicit local confirmation for elevated permission modes.

## Deployment Mode

Add production-oriented configuration:

```env
CACP_DEPLOYMENT_MODE=cloud
CACP_ENABLE_LOCAL_LAUNCH=false
CACP_PUBLIC_ORIGIN=https://cacp.zuchongai.com
HOST=127.0.0.1
PORT=3737
CACP_DB=/var/lib/cacp/cacp.db
```

In cloud mode, `/rooms/:roomId/agent-pairings/start-local` returns a disabled/forbidden response, and the web UI hides one-click local launch. Users instead copy a connector command such as:

```powershell
cacp-connector --server https://cacp.zuchongai.com --pair <pairing-token>
```

## Identity and Room Model

Phase 1 does not add user accounts. The system remains anonymous but token-secured:

- Creator receives an `owner_token`.
- Invitees join with an invite token and receive participant tokens.
- Local Connector joins with a pairing token and receives an agent token.

Create a persistent `rooms` table:

```sql
rooms (
  room_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_participant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
)
```

Room IDs must be non-enumerable random IDs, at least 128 bits of entropy, with database uniqueness as the final guard. On collision, regenerate and retry.

## Invitation Security

Replace the in-memory invite map with a persistent table:

```sql
invites (
  invite_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
)
```

Invitation rules:

- Token is shown to the user only once.
- Database stores only `token_hash`, not plaintext token.
- Default expiry is 24 hours.
- Optional use limit is supported.
- Revoked, expired, over-used, or room-mismatched invites are rejected.

## Agent Pairing Security

Replace the in-memory pairing map with a persistent table:

```sql
agent_pairings (
  pairing_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  permission_level TEXT NOT NULL,
  working_dir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT
)
```

Pairing rules:

- Default expiry is 15 minutes.
- Pairing is single-use.
- Claiming sets `claimed_at` in the same transaction that registers the Agent participant.
- Expired or claimed pairing tokens are rejected.

## Server Hardening

Minimum cloud controls:

- HTTPS/WSS through Caddy or equivalent reverse proxy.
- WebSocket Origin allowlist using `CACP_PUBLIC_ORIGIN`.
- Request body size limits.
- Rate limits for room creation, invite creation, join attempts, pairing creation, and messages.
- Maximum message length.
- Maximum participants, agents, and open WebSocket connections per room.
- No plaintext token logging.
- SQLite database stored under `/var/lib/cacp` with backups.

## Web UI Changes

Update the room setup flow:

- Keep create room and join room flows.
- Keep invite link creation.
- Replace “Start local agent” with “Connect local agent”.
- Show connector command, expiry, permission level, and safety note.
- Show Agent online/offline status after connector claim.

## Deployment Plan Shape

Implementation should happen in four phases:

1. Cloud safety foundation: config, disabled local launch, persistent rooms/invites/pairings, stronger IDs and tokens, base limits.
2. Web flow update: connector-focused Agent pairing UI.
3. Debian deployment: Node 20, Corepack/pnpm, build, systemd, Caddy, HTTPS for `cacp.zuchongai.com`.
4. Connector distribution: start with command-line package usage, later add Windows zip/exe packaging.

## Validation

Required checks before deployment:

- Unit tests for unique ID generation and invite/pairing lifecycle.
- Server tests for expired, revoked, over-used, claimed, and mismatched tokens.
- Web tests for cloud mode hiding local launch and showing connector instructions.
- Full `corepack pnpm check` locally.
- Remote smoke test: create room, create invite, join room, create pairing, claim connector, stream a test Agent response.
