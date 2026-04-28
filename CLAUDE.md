# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CACP is a local-first collaborative AI room demo. It consists of a cloud room server, a React web UI, and a local CLI agent connector. Humans create rooms, invite others, and collaborate with AI agents that can execute CLI commands or call LLM APIs.

## Repository Structure

This is a pnpm workspace monorepo with four packages under `packages/`:

- `@cacp/protocol` — Shared TypeScript types, Zod schemas, policy engine, and connection-code encoding. All protocol contracts live here.
- `@cacp/server` — Fastify HTTP/WebSocket server with SQLite storage (better-sqlite3). Uses event sourcing: all state changes append immutable events to SQLite and broadcast over WebSockets. Handles auth, pairing, invites, join requests, room governance, agent turns, and tasks.
- `@cacp/web` — React + Vite frontend. Derives all UI state by replaying the event log (shared logic with server). Connects to the server via WebSocket for real-time updates.
- `@cacp/cli-adapter` — Local CLI agent connector. Connects to a room via WebSocket, receives `task.created` and `agent.turn.requested` events, and either runs shell commands or calls LLM APIs through a provider adapter registry.

## Development Commands

Prerequisites: Node 20+, Corepack enabled (`corepack enable`).

Install dependencies:
```bash
corepack pnpm install
```

Run validation (tests + build, same as CI):
```bash
corepack pnpm check
```

Run all tests:
```bash
corepack pnpm test
```

Run tests for a single package:
```bash
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
corepack pnpm --filter @cacp/cli-adapter test
```

Build all packages:
```bash
corepack pnpm build
```

Build a specific package:
```bash
corepack pnpm --filter @cacp/protocol build
```

Development servers (each in its own terminal):
```bash
# Terminal 1 — server on http://127.0.0.1:3737
corepack pnpm dev:server

# Terminal 2 — web dev server on http://127.0.0.1:5173 (proxies /rooms and /health to server)
corepack pnpm dev:web

# Terminal 3 — adapter with example config
corepack pnpm dev:adapter
```

Build the Windows Local Connector SEA executable:
```bash
corepack pnpm build:connector:win
```

## Architecture

### Event Sourcing

All room state is stored as an append-only log of `CacpEvent` records in SQLite. The server never mutates existing events; every action appends new events. Both the server and the web client derive current state by replaying the event log.

Key event types:
- `room.created`, `participant.joined`, `participant.left`, `participant.removed`
- `message.created` — human or agent messages
- `agent.turn.requested`, `agent.turn.started`, `agent.output.delta`, `agent.turn.completed`, `agent.turn.failed` — agent streaming turn lifecycle
- `ai.collection.started`, `ai.collection.submitted`, `ai.collection.cancelled` — Roundtable Mode (collects human messages before triggering agent)
- `agent.pairing_created`, `agent.registered`, `agent.status_changed` — agent connection lifecycle
- `join_request.created`, `join_request.approved`, `join_request.rejected` — owner-approved joins

### Protocol Package (`packages/protocol`)

This is the source of truth for all schemas. `packages/protocol/src/schemas.ts` defines every Zod schema and exported type. Changes to event types, payloads, or participant roles must start here.

`packages/protocol/src/policy-engine.ts` evaluates governance policies (`owner_approval`, `majority`, `role_quorum`, `unanimous`, `no_approval`) against vote records.

`packages/protocol/src/connection-code.ts` encodes/decodes base64url pairing tokens used by the CLI adapter.

### Server (`packages/server`)

`src/server.ts` builds the Fastify app. It wires together:
- `EventStore` — SQLite persistence for events, participants, rooms, invites, agent pairings, join requests
- `EventBus` — in-memory pub/sub for WebSocket broadcasting
- `conversation.ts` — event-log queries: finding open agent turns, recent messages, building context prompts
- `auth.ts` — role-based permission checks
- `config.ts` — environment-based server configuration (`CACP_DEPLOYMENT_MODE`, `CACP_TOKEN_SECRET`, etc.)

The server supports two deployment modes:
- **local** — default, enables local agent auto-launch, permissive CORS
- **cloud** — requires `CACP_PUBLIC_ORIGIN` and `CACP_TOKEN_SECRET`, disables local launch

### Web Frontend (`packages/web`)

`src/room-state.ts` is the client-side state engine. It replays the full event log into a `RoomViewState` object containing participants, messages, agents, streaming turns, collections, and join requests. This mirrors the server's event-log querying logic.

`src/api.ts` contains all HTTP API calls and WebSocket connection logic.

`vite.config.ts` proxies `/rooms` and `/health` to `http://127.0.0.1:3737` during development.

The web build mode is controlled by `VITE_CACP_DEPLOYMENT_MODE`:
- `local` (default) — shows local-agent launch UI
- `cloud` — shows connection-code modal and connector download

### CLI Adapter (`packages/cli-adapter`)

`src/index.ts` is the entry point. It connects to the room WebSocket and handles two event types:
- `task.created` — runs a shell command and reports output/completion/failure
- `agent.turn.requested` — either runs a shell command or calls an LLM API, streaming deltas back to the server

`src/llm/runner.ts` executes LLM turns via the provider adapter registry.
`src/llm/providers/registry.ts` maps provider IDs to adapters. Supported providers include OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, SiliconFlow, GLM, and custom OpenAI/Anthropic-compatible endpoints.

The adapter can be started in three ways:
- Config file: `cacp-cli-adapter config.json`
- Connection code: `cacp-cli-adapter --connect <code>`
- Interactive prompt (double-click): pastes a connection code

## Testing

All packages use Vitest. The web package uses jsdom.

Server tests should prefer in-memory SQLite by passing `dbPath: ":memory:"` to `buildServer()`.

Run a single test file:
```bash
corepack pnpm --filter @cacp/server test -- test/server.test.ts
corepack pnpm --filter @cacp/web test -- test/room-state.test.ts
```

## Code Style

- Strict TypeScript with ESM/NodeNext module resolution
- Relative imports use `.js` extensions
- Two-space indentation, double quotes, semicolons
- Conventional Commit messages (`feat(server):`, `fix(web):`, `docs:`, `chore:`)

## Important File Locations

- Protocol schemas: `packages/protocol/src/schemas.ts`
- Server routes and business logic: `packages/server/src/server.ts`
- Web state derivation: `packages/web/src/room-state.ts`
- Web API client: `packages/web/src/api.ts`
- LLM provider registry: `packages/cli-adapter/src/llm/providers/registry.ts`
- Server config/env vars: `packages/server/src/config.ts`
- Protocol docs: `docs/protocol/cacp-v0.2.md`
- Deployment runbook: `docs/deploy-cloud.md`
- CI: `.github/workflows/ci.yml`

## Notes

- `@cacp/protocol` must be built before other packages can use it. The root `test`, `dev:*`, and `build` scripts handle this automatically.
- The web UI and server both derive state from the same event log — changes to event semantics may need updates in both `packages/server/src/conversation.ts` and `packages/web/src/room-state.ts`.
- The CLI adapter's LLM provider adapters follow a consistent pattern: `buildRequest`, `extractTextDelta`, `extractProviderError`, `isTerminalEvent`.
- Do not commit secrets, local deployment files (`.deploy/*`, `docs/Server info.md`), `.env` files, or SQLite database files.
