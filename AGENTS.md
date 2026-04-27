# Repository Guidelines

## Project Structure & Module Organization
CACP is a pnpm workspace for a local-first collaborative AI room. Source lives under `packages/*/src`, with colocated package tests in `packages/*/test`.

- `packages/protocol`: shared TypeScript types, zod schemas, and protocol contracts.
- `packages/server`: Fastify/WebSocket server, SQLite event store, auth, pairing, and room governance.
- `packages/cli-adapter`: local CLI agent connector and runner.
- `packages/web`: React + Vite room UI; static assets live in `packages/web/public`.
- `docs/`: protocol docs, architecture diagrams, examples, deployment notes; `scripts/` contains repo utilities.

## Build, Test, and Development Commands
Use Node 20+, Corepack, and the pinned pnpm version.

```powershell
corepack enable
corepack pnpm install
corepack pnpm check        # runs tests, then builds all packages
corepack pnpm test         # builds protocol, then runs Vitest recursively
corepack pnpm build        # builds every workspace package
corepack pnpm dev:server   # Fastify API/WebSocket server on 127.0.0.1:3737
corepack pnpm dev:web      # Vite UI on 127.0.0.1:5173
corepack pnpm dev:adapter  # starts the generic local CLI adapter example
```

For focused work, run `corepack pnpm --filter @cacp/server test` or replace the package name.

## Coding Style & Naming Conventions
Use strict TypeScript, ESM, and NodeNext-compatible relative imports with `.js` extensions. Follow the existing style: two-space indentation, double quotes, semicolons, and small testable helpers. Keep protocol schema changes centralized in `packages/protocol/src/schemas.ts`; update both server derivation logic and web room-state handling when event contracts change.

## Testing Guidelines
Vitest is the test framework. Name tests `*.test.ts` or `*.test.tsx` in each package's `test/` directory. Add or update tests for protocol events, role permissions, invite/pairing flows, room-state derivation, local connector behavior, and user-visible UI changes. Prefer in-memory SQLite (`dbPath: ":memory:"`) for server tests.

## Commit & Pull Request Guidelines
Git history follows Conventional Commits, for example `feat(server): ...`, `fix(web): ...`, `docs: ...`, and `chore: ...`. Keep commits focused and imperative. Pull requests should include a summary, validation commands run, linked issue/context when available, screenshots or recordings for UI changes, and notes for protocol, security, deployment, or connector risk.

## Security & Configuration Tips
Never commit secrets or local deployment artifacts: `.env`, `.deploy/*`, `docs/Server info.md`, `docs/examples/*.local.json`, SQLite `*.db*` files, SSH keys, tokens, or production config. Avoid exposing room, invite, pairing, participant, or connector secrets in logs and screenshots.
