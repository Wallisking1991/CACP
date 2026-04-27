# Repository Guidelines

## Project Structure & Module Organization
CACP is a pnpm workspace for a local-first collaborative AI room demo. Source is under `packages/`:

- `packages/protocol`: shared TypeScript types, zod schemas, and protocol contracts.
- `packages/server`: Fastify/WebSocket server, SQLite event store, auth, pairing, and conversation helpers.
- `packages/cli-adapter`: local CLI agent bridge and runner logic.
- `packages/web`: React 19 + Vite room UI, components, i18n, and browser state derivation.

Tests live beside each package in `test/` and use `*.test.ts` or `*.test.tsx`. Protocol docs and examples live in `docs/`; generated/local runtime state belongs in `.tmp-test-services/` and must stay untracked.

## Build, Test, and Development Commands
Use Node 20+, Corepack, and the pinned pnpm version.

```powershell
corepack enable
corepack pnpm install
corepack pnpm check       # full validation: tests, then build
corepack pnpm test        # run all Vitest suites; builds protocol first
corepack pnpm build       # build all workspace packages
corepack pnpm dev:server  # Fastify server on 127.0.0.1:3737
corepack pnpm dev:web     # Vite web UI on 127.0.0.1:5173
corepack pnpm dev:adapter # run the CLI adapter with the sample local config
```

For package-focused work, run `corepack pnpm --filter @cacp/server test` or replace the package name.

## Coding Style & Naming Conventions
Write strict TypeScript using ESM/NodeNext patterns. Keep relative imports with `.js` extensions, use double quotes and semicolons, and follow the existing two-space indentation. Prefer small pure helpers for derived state (`conversation.ts`, `room-state.ts`) and keep protocol changes centralized in `packages/protocol/src/schemas.ts`.

## Testing Guidelines
Vitest is the test framework. Add or update tests with behavioral changes, especially when changing event types, role permissions, pairing, or room-state derivation. Server tests should prefer in-memory SQLite (`dbPath: ":memory:"`). Run the relevant filtered test plus `corepack pnpm check` before opening a PR.

## Commit & Pull Request Guidelines
Recent history uses Conventional Commit style such as `feat(server,cli-adapter): ...`, `fix(web): ...`, and `docs: ...`. Keep commits scoped and imperative. PRs should include a short summary, validation commands run, linked issues if any, and screenshots or short recordings for UI changes.

## Security & Configuration Tips
Treat room, invite, pairing, and participant tokens as secrets. Do not commit `.env`, `*.db`, or `docs/examples/*.local.json`. Restart test services after server/web changes; inspect `.tmp-test-services/*.log` when launch behavior is unclear.
