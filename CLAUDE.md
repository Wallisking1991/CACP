# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CACP (Collaborative Agent Communication Protocol) — a local-first multi-person AI room demo. A web room lets multiple humans chat with a shared local CLI Agent (Claude Code, Codex, opencode, or echo) over a Fastify + WebSocket server backed by SQLite. The current demo no longer uses structured Decision/Question/Policy flow; coordination is now driven by **AI Flow Control** (owner-only batched collection of participant answers before submitting one Agent turn).

The repo is Windows-first (PowerShell scripts, `corepack` toolchain). README.md has the user-facing manual test flow; this file is for repo-development orientation.

## Commands

Toolchain: Node 20+, Corepack, pnpm 9.15.4 (declared via `packageManager`).

```bash
corepack enable
corepack pnpm install

# full check (test + build)
corepack pnpm check

# all tests / all builds
corepack pnpm test
corepack pnpm build

# dev (each rebuilds @cacp/protocol first)
corepack pnpm dev:server   # http://127.0.0.1:3737
corepack pnpm dev:web      # http://127.0.0.1:5173
corepack pnpm dev:adapter  # uses docs/examples/generic-cli-agent.local.json

# per-package test
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test

# single test file / single test name (vitest)
corepack pnpm --filter @cacp/server exec vitest run path/to/file.test.ts
corepack pnpm --filter @cacp/server exec vitest run -t "test name fragment"
```

Test services (Windows PowerShell, foreground console):

```powershell
.\start-test-services.cmd            # start server + web, tail logs, Ctrl+C stops
.\start-test-services.ps1 -Restart   # restart background services
.\start-test-services.ps1 -Stop      # stop tracked services
```

State for the launcher (logs, pids, generated adapter scripts) lives in `.tmp-test-services/` and is gitignored. After modifying server/web source, restart the test services for changes to take effect.

## Architecture

### Workspace layout

pnpm workspace. Four packages under `packages/`:

- `@cacp/protocol` — pure types, zod schemas (`schemas.ts`) and the legacy `policy-engine.ts`. Imported by everyone via `workspace:*`. **Must be built before other packages run or test** — `dev:*` and `test` scripts already do this via `pnpm --filter @cacp/protocol build`. If you see "cannot find module" errors after editing protocol types, you forgot the rebuild.
- `@cacp/server` — Fastify 5 + `@fastify/websocket` + `better-sqlite3`. Single `src/server.ts` builds the app; `src/index.ts` boots it. SQLite path defaults to `cacp.db` in CWD (env: `PORT`, `HOST`, `CACP_DB`).
- `@cacp/cli-adapter` — Node bin (`cacp-cli-adapter`) that opens a WebSocket to a room and runs a configured local CLI command per `task.created` / `agent.turn.requested` event. Two startup modes: file config or `--server <url> --pair <token>` (claims a pairing token, then registers).
- `@cacp/web` — React 19 + Vite. Single-page room UI; all state derived from the event stream.

### Event-sourced room model

The server is the single source of truth and stores everything as an append-only event log:

- `EventStore` (`packages/server/src/event-store.ts`) — `events` and `participants` tables in SQLite. `appendEvent` validates against `CacpEventSchema` and writes JSON.
- `EventBus` (`event-bus.ts`) — in-memory pub/sub keyed by `room_id`; drives the WebSocket stream at `/rooms/:roomId/stream`.
- `conversation.ts` — pure helpers that derive room state from event arrays: `findActiveAgentId`, `findOpenTurn`, `hasQueuedFollowup`, `eventsAfterLastHistoryClear`, `recentConversationMessages`, `buildAgentContextPrompt`, `buildCollectedAnswersPrompt`. The server uses these whenever it needs current state — there is no separate state table.
- Web client mirrors this: `packages/web/src/room-state.ts deriveRoomState` rebuilds participants/agents/messages/streamingTurns/activeCollection from the same event types.

When adding new behavior, prefer adding an event type and deriving from it on both sides over storing new mutable state. The event type enum lives in `protocol/src/schemas.ts EventTypeSchema` and is the contract between all four packages.

### Auth & roles

Tokens (owner, member, observer, agent) are issued at room creation / invite claim / agent register and passed as `Authorization: Bearer <token>`. `auth.ts` resolves a token to a `StoredParticipant` and checks roles via `hasAnyRole` / `hasHumanRole`. Web role permissions are centralized in `packages/web/src/role-permissions.ts`:

- owner: everything, **including AI Flow Control (owner-only)**
- admin: room controls + chat
- member: chat only
- observer: read only

### AI Flow Control (current main flow)

Owner toggles `POST /rooms/:roomId/ai-collection/start`. While a collection is active:

1. Human `message.created` events are tagged with `collection_id` and broadcast immediately (everyone sees them live).
2. The server **does not** create `agent.turn.requested` for those messages.
3. On `submit`, the server emits `ai.collection.submitted`, calls `buildCollectedAnswersPrompt` to merge all queued answers into one prompt, and creates a single `agent.turn.requested`.
4. `cancel` ends the collection without an Agent turn.

If a turn is already in flight, new messages append `agent.turn.followup_queued` instead of starting a parallel turn — see `findOpenTurn` / `hasQueuedFollowup`.

### Agent pairing & local launch

`POST /rooms/:roomId/agent-pairings/start-local` (owner/admin) generates an adapter command (`pnpm --filter @cacp/cli-adapter dev -- --server <url> --pair <token>`) and invokes a `LocalAgentLauncher`. The default launcher (in `server.ts`) opens a new PowerShell console on Windows so the bridge process is visible to the user. Tests inject a fake launcher via `BuildServerOptions.localAgentLauncher`. Adapter logs land in `.tmp-test-services/adapters/`.

`buildAgentProfile` in `pairing.ts` maps `(agent_type, permission_level)` to the actual command + args:

- `claude-code` → `claude -p --output-format text --no-session-persistence ...` with `--permission-mode dontAsk` / `acceptEdits` / `bypassPermissions` for read_only / limited_write / full_access. **Changing permission requires restarting the local agent** — the flag is fixed at spawn time.
- `codex` → `codex exec -`
- `opencode` → `opencode run -`
- `echo` → an inline Node one-liner used for fast end-to-end tests

### Removed / legacy surface

The old structured Decision/Question/Policy flow has been removed from the main UI/server flow but the schemas (`PolicySchema`, `VoteRecordSchema`, `proposal.*` events) and `policy-engine.ts` are still present. Don't add new code that depends on `cacp-decision`/`cacp-question` parsing or the `default_policy` field on room creation. The `room.history_cleared` event still tolerates legacy `scope: "messages_and_decisions"` for compatibility with older local databases — keep this fallback intact when touching history-clear logic.

### Protocol versioning

`ProtocolVersionSchema = "0.1.0" | "0.2.0"`. Current docs are `docs/protocol/cacp-v0.2.md`; v0.1 is kept only as historical reference. New events go into `EventTypeSchema` in protocol and must be handled by both `conversation.ts` (server) and `room-state.ts` (web) to actually appear in the UI.

## Notes for changes

- The SQLite file `packages/server/cacp.db` persists across restarts. Delete it to reset all rooms; it is gitignored (`*.db`).
- `docs/examples/*.local.json` are gitignored — use them for local adapter configs with real tokens.
- Pairing tokens, invite tokens, and participant tokens are all sensitive — don't log them or echo into chat.
- `1.md` is the in-room agent persona / workflow guide (used as a system prompt seed for Claude Code agents joining a room). It is not repo-level guidance for Claude Code working on this codebase.
