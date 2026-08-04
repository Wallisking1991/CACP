# Repository Guidelines

## Project Structure & Module Organization

CACP is a pnpm workspace for a local-first collaborative AI room. Package source
code lives in `packages/*/src`; tests live in the corresponding
`packages/*/test` directory.

- `packages/protocol`: shared TypeScript types, Zod schemas, and wire contracts.
- `packages/server`: Fastify/WebSocket API, SQLite storage, auth, and governance.
- `packages/cli-adapter`: local CLI agent connector and runner logic.
- `packages/web`: React/Vite UI; static assets are in `packages/web/public`.
- `docs/`: protocol, design, examples, and deployment documentation.
- `scripts/`: packaging, validation, and repository utilities.

## Build, Test, and Development Commands

Use Node 22.12+ (Node 24 recommended), Corepack, and the pinned pnpm version.

```powershell
corepack enable
corepack pnpm install       # install workspace dependencies
corepack pnpm validate      # format check, lint, typecheck, coverage, and build
corepack pnpm test          # build protocol, then run unit tests
corepack pnpm build         # build every workspace package
corepack pnpm dev:server    # run the API/WebSocket server
corepack pnpm dev:web       # run Vite at 127.0.0.1:5173
corepack pnpm dev:adapter   # run the local CLI adapter example
```

For focused work, use `corepack pnpm --filter @cacp/server test`, replacing the
package name as needed.

## Coding Style & Naming Conventions

Write strict TypeScript and ESM. Relative NodeNext imports must include `.js`
extensions. Follow `.editorconfig` and Prettier: two-space indentation, double
quotes, semicolons, LF endings, and an 80-column target. Use small, testable
helpers and follow existing file naming. Centralize protocol schema changes in
`packages/protocol/src/schemas.ts`, then update server and web state handling.

## Testing Guidelines

Vitest is the test framework. Name tests `*.test.ts` or `*.test.tsx` under each
package's `test/` directory. Add coverage for changed protocol events,
permissions, pairing/invite flows, room-state derivation, connectors, and
user-visible UI. Prefer `dbPath: ":memory:"` for server tests. Run
`corepack pnpm validate` before submitting.

## Commit & Pull Request Guidelines

Use focused, imperative Conventional Commits such as `feat(server): add policy`
or `fix(web): mask connector code`. Pull requests should include a concise
summary, linked context, validation commands, screenshots for UI changes, and
notes about protocol, security, deployment, or connector risk.

## Security & Configuration

Agent execution stays local; only the room server is public. Never commit
secrets, `.env`, `.deploy/*`, production configuration, SQLite `*.db*` files,
keys, tokens, or local deployment documentation. Follow `SECURITY.md` for
private vulnerability reports, and redact invite, pairing, participant, and
connector secrets from logs and screenshots.

## Agent skills

### Issue tracker

Issues and specs use local Markdown under `.scratch/<feature-slug>/`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles use the default label strings. See
`docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See
`docs/agents/domain.md`.
