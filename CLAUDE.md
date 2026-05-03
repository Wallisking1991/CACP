# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CACP (Collaborative Agent Communication Protocol) is a local-first collaborative AI room. The public server hosts room state and the web UI; agent execution stays local through the Local Connector. Multiple humans can join the same room, talk freely via Orbit side-channel notes, and dispatch ordered AI turns through a Send-to-Agent FIFO queue. The connected agent can be a local Claude Code / Codex CLI session or an LLM API agent.

Live demo: https://cacp.zuchongai.com/

## Context Management
- When resuming compacted sessions, start fresh rather than continuing if context is large
- Avoid re-exploring or re-planning when a plan document already exists - read it and execute
- Prefer concise execution over verbose planning phases

## Testing Discipline
- Always run tests after multi-file changes; report pass count (e.g., '709/709 passing')
- Scope test runs to affected packages when possible to save time
- Fix failing tests before committing

## Cross-Platform Shell
- This environment is Windows; do NOT use PowerShell env var syntax in bash commands
- For packaging/transfer, prefer Python/paramiko fallback over tar append (which fails on Windows)
- PowerShell ConstrainedLanguage mode blocks UTF-8 encoding setup - use alternatives

## Working Style

These guidelines apply to every task in this repository — read them before starting any non-trivial work.

### Understand the request before writing code

- **Do not start coding until you fully understand what the user wants.** Read the request carefully and reconcile it against the actual state of the project.
- **Ask clarifying questions whenever the request is ambiguous, under-specified, or could plausibly be solved more than one way.** Ground your questions in concrete observations from the codebase (specific files, current behavior, conflicting signals) rather than asking generic preference questions. Use `AskUserQuestion` for this.
- It is better to ask one extra round of questions than to deliver something that misses the user's intent.

### Use the right skill for the job

- This repository has a rich set of skills available (e.g. `test-driven-development`, `subagent-driven-development`, `systematic-debugging`, `brainstorming`, `writing-plans`, `executing-plans`, `requesting-code-review`, `playwright-cli`, `claude-mem:mem-search`, etc.).
- **Actively pick the most appropriate skill for the current task** instead of defaulting to ad-hoc work. If you are debugging, use `systematic-debugging`; if you are about to implement a feature or bugfix, use `test-driven-development`; if you are planning a multi-step task, use `writing-plans`; and so on. The skill index in the system reminder is the source of truth.

### Design changes do not need to preserve old data

- The whole project is currently in **public testing** — there are no production users whose data must be migrated.
- When a design change, schema change, or optimization would otherwise require a migration or compatibility shim, **prefer the cleaner redesign** and let any existing rooms/events/sessions be dropped. Do not invent backwards-compatibility layers, dual-format readers, or "legacy" branches for data shapes.

### Browser testing with `/playwright-cli`

- For changes whose correctness can only be confirmed in the actual UI — high-risk modifications, large refactors, end-to-end flow changes, or anything affecting room joining, agent connection, the composer, the Orbit panel, or session selection — start the dev servers (`dev:server`, `dev:web`, and `dev:adapter` if the agent is involved) and use the `playwright-cli` skill to drive Edge against the real app. Verify the happy path and the relevant edge cases before reporting the work as done.
- **Do not run a browser session for every change.** Skip it for type-only edits, isolated unit-tested helpers, copy/i18n tweaks, or other low-risk work where Vitest plus a careful read of the diff is sufficient. Judge necessity per task; explain when you choose to skip.

### Run tests with the right scope

The repository has ~120 test files across four packages. Running the full matrix on every save wastes minutes per iteration without adding signal. Match test scope to change blast radius — and always run a wider suite at milestone boundaries so quality is never sacrificed for speed.

**Tier the runs by what you changed:**

| Change | Iterate with | Verify with |
|---|---|---|
| Comments, i18n strings, CSS, dead-code removal | Read the diff; no tests needed | Affected package's `test` script |
| One pure helper / one component | Single test file | Affected package's `test` script |
| Cross-module change inside one package | Affected package's `test` script | Same |
| Schema / protocol contract change | `protocol` + `server` + `web` | Full `corepack pnpm check` |
| Refactor, server↔web integration, anything risky | Affected package's `test` script | Full `corepack pnpm check` |

**Single-file iteration (skips the redundant protocol rebuild that each package's `test` script prepends):**

```bash
corepack pnpm --filter @cacp/server exec vitest run test/main-inputs.test.ts
corepack pnpm --filter @cacp/web   exec vitest run -t "orbit panel"
```

Use `corepack pnpm --filter @cacp/protocol build` once at the start of a session if `packages/protocol/src/` has changed; afterwards `exec vitest run` reuses the built `dist/`.

**Let vitest pick affected tests:**

```bash
corepack pnpm --filter @cacp/server exec vitest run --changed
```

**Hard rules to keep quality non-negotiable:**

- Run the **affected package's full `test` script** before declaring a task complete — no matter how scoped your single-file iteration was.
- Run **`corepack pnpm check`** before committing anything that touches `protocol`, crosses packages, or is non-trivial. CI runs the same command, so skipping it locally just shifts the failure later.
- When fixing a bug, the regression test must be added and run **as part of the affected package's full suite**, not just in isolation — adjacent tests often reveal accidental impact.
- Do not silence, skip, or `.only` tests to make iteration faster. Narrow the run with file paths or `-t` filters instead.

## Repository Structure

This is a pnpm workspace monorepo with four packages under `packages/`:

- `@cacp/protocol` — Shared TypeScript types, Zod schemas, policy engine, and connection-code encoding. **All protocol contracts live here.**
- `@cacp/server` — Fastify HTTP/WebSocket server with SQLite storage (better-sqlite3). Uses event sourcing: all state changes append immutable events to SQLite and broadcast over WebSockets.
- `@cacp/web` — React + Vite frontend. Derives all UI state by replaying the event log (shared logic with server). Connects to the server via WebSocket for real-time updates.
- `@cacp/cli-adapter` — Local CLI agent connector. Connects to a room via WebSocket and either runs a local Claude Code / Codex session, runs shell commands, or calls LLM APIs through a provider adapter registry.

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

Run a single test file (use `exec vitest run` to skip the protocol rebuild that the `test` script prepends — only build protocol once per session, when `packages/protocol/src/` has actually changed):
```bash
corepack pnpm --filter @cacp/server exec vitest run test/server.test.ts
corepack pnpm --filter @cacp/web   exec vitest run test/room-state.test.ts
```

Run only tests affected by uncommitted changes:
```bash
corepack pnpm --filter @cacp/server exec vitest run --changed
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

Key event families:
- **Room/participant lifecycle** — `room.created`, `participant.joined`, `participant.left`, `participant.removed`
- **Messages** — `message.created` (human or agent)
- **Agent turn streaming** — `agent.turn.requested`, `agent.turn.started`, `agent.output.delta`, `agent.turn.completed`, `agent.turn.failed`
- **Send-to-Agent FIFO queue** — `main_input.accepted`, `main_input.queued`, `main_input.triggered`, `main_input.cancelled`, `main_input.failed` (auto-triggered when an agent turn finishes)
- **Orbit side-channel** — `orbit.round.opened`, `orbit.note.created`, `orbit.like.changed`, `orbit.round.promoted` (Send-to-People notes and promotion to the main thread)
- **Connector ledger snapshots** — `connector.snapshot.requested`, `connector.snapshot.started`, `connector.snapshot.entry`, `connector.snapshot.completed`, `connector.snapshot.failed` (live-only, not persisted)
- **Agent connection lifecycle** — `agent.pairing_created`, `agent.registered`, `agent.status_changed`
- **Owner-approved joins** — `join_request.created`, `join_request.approved`, `join_request.rejected`

### Protocol Package (`packages/protocol`)

Source of truth for all schemas. `src/schemas.ts` defines every Zod schema and exported type — changes to event types, payloads, or participant roles must start here.

`src/policy-engine.ts` evaluates governance policies (`owner_approval`, `majority`, `role_quorum`, `unanimous`, `no_approval`) against vote records.

`src/connection-code.ts` encodes/decodes base64url pairing tokens used by the CLI adapter.

### Server (`packages/server`)

`src/server.ts` builds the Fastify app and wires together:
- `EventStore` (`event-store.ts`) — SQLite persistence for events, participants, rooms, invites, agent pairings, join requests
- `EventBus` (`event-bus.ts`) — in-memory pub/sub for WebSocket broadcasting
- `relay.ts` — relay-only and targeted-delivery envelopes for orbit/snapshot events that should not be persisted (includes `publishRelayOnly`, `publishTargeted`, `roleDelivery` helpers)
- `conversation.ts` — event-log queries: finding open agent turns, recent messages, building context prompts
- `main-inputs.ts` — Send-to-Agent FIFO queue derivation (queue is reconstructed from the event stream)
- `orbit-state.ts` — Orbit room state with deterministic round IDs and promotion payload escaping
- `auth.ts` — role-based permission checks
- `config.ts` — environment-based server configuration (`CACP_DEPLOYMENT_MODE`, `CACP_TOKEN_SECRET`, etc.)

The server supports two deployment modes:
- **local** — default, enables local agent auto-launch, permissive CORS
- **cloud** — requires `CACP_PUBLIC_ORIGIN` and `CACP_TOKEN_SECRET`, disables local launch

### Web Frontend (`packages/web`)

`src/room-state.ts` is the client-side state engine. It replays the full event log into a `RoomViewState` containing participants, messages, agents, streaming turns, the Orbit side-channel view, the main-input queue, and join requests. This mirrors the server's event-log querying logic — changes to event semantics generally need updates in both `packages/server/src/conversation.ts` and `packages/web/src/room-state.ts`.

`src/api.ts` contains all HTTP API calls and WebSocket connection logic.

`src/room-cache.ts` persists the event log to IndexedDB for offline replay (note: vitest tests must stub IndexedDB in environments where it is unavailable).

`vite.config.ts` proxies `/rooms` and `/health` to `http://127.0.0.1:3737` during development.

The web build mode is controlled by `VITE_CACP_DEPLOYMENT_MODE`:
- `local` (default) — shows local-agent launch UI
- `cloud` — shows connection-code modal and Local Connector download

The composer offers two send actions: **Send to People** posts an Orbit note (humans only); **Send to Agent** appends to the FIFO queue that triggers exactly one AI turn per entry.

### CLI Adapter (`packages/cli-adapter`)

`src/index.ts` is the entry point. It connects to the room WebSocket and routes events to one of three runtimes:
- `src/claude/` — local Claude Code session runner with fresh-mode session selection and resume
- `src/codex/` — Codex CLI session runner; `findCodexPath` searches PATH, the pnpm virtual store, and npm globals so the SEA-bundled connector can locate `@openai/codex` binaries at runtime
- `src/llm/runner.ts` — LLM API agent runner using the provider adapter registry

`src/llm/providers/registry.ts` maps provider IDs to adapters. Supported providers include OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, SiliconFlow, GLM, and custom OpenAI/Anthropic-compatible endpoints. All adapters follow a consistent pattern: `buildRequest`, `extractTextDelta`, `extractProviderError`, `isTerminalEvent`.

The adapter handles two server event types directly: `task.created` (run a shell command and report output) and `agent.turn.requested` (run shell or LLM, streaming deltas back).

Adapter startup modes:
- Config file: `cacp-cli-adapter config.json`
- Connection code: `cacp-cli-adapter --connect <code>`
- Interactive prompt (double-click): pastes a connection code

## Testing

All packages use Vitest. The web package uses jsdom; jsdom is set up via `packages/web/test/setup.ts` and the web tests rely on `fake-indexeddb` for the room cache.

Server tests should prefer in-memory SQLite by passing `dbPath: ":memory:"` to `buildServer()`.

Tests live in `packages/*/test/` as `*.test.ts` or `*.test.tsx`. Add or update tests when changing protocol events, role permissions, invite/pairing flows, room-state derivation, local connector behavior, or user-visible UI.

For the discipline around **which** tests to run during iteration vs. before committing, see *Working Style → Run tests with the right scope* above.

## Code Style

- Strict TypeScript with ESM/NodeNext module resolution
- Relative imports use `.js` extensions
- Two-space indentation, double quotes, semicolons
- Conventional Commit messages (`feat(server):`, `fix(web):`, `docs:`, `chore:`)

## Important File Locations

- Protocol schemas: `packages/protocol/src/schemas.ts`
- Connection-code helper: `packages/protocol/src/connection-code.ts`
- Policy engine: `packages/protocol/src/policy-engine.ts`
- Server entry / routes: `packages/server/src/server.ts`
- Event store: `packages/server/src/event-store.ts`
- Server conversation helpers: `packages/server/src/conversation.ts`
- Main-input FIFO queue: `packages/server/src/main-inputs.ts`
- Orbit state: `packages/server/src/orbit-state.ts`
- Relay helpers: `packages/server/src/relay.ts`
- Server config / env vars: `packages/server/src/config.ts`
- Agent profile mapping: `packages/server/src/pairing.ts`
- Web state derivation: `packages/web/src/room-state.ts`
- Web API client: `packages/web/src/api.ts`
- Web event log replay: `packages/web/src/event-log.ts`
- CLI adapter entry: `packages/cli-adapter/src/index.ts`
- LLM provider registry: `packages/cli-adapter/src/llm/providers/registry.ts`
- Codex binary discovery: `packages/cli-adapter/src/codex/`
- Deployment runbook: `docs/deploy-cloud.md`
- CI: `.github/workflows/ci.yml`

## Notes

- `@cacp/protocol` must be built before other packages can use it. The root `test`, `dev:*`, and `build` scripts handle this automatically.
- The web UI and server both derive state from the same event log — changes to event semantics may need updates in both `packages/server/src/conversation.ts` and `packages/web/src/room-state.ts`.
- Orbit and connector-snapshot events use the relay-only path and skip durable storage; do not assume they appear in the persisted event log.
- Do not commit secrets or local deployment artifacts: `.env`, `.deploy/*`, `docs/Server info.md`, `docs/deploy-cloud.md`, `docs/examples/*.local.json`, SQLite `*.db*` files, SSH keys, tokens, or production config.
