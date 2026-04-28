# Contributing to CACP

Thank you for your interest in CACP. This project is a local-first collaborative AI room demo with a cloud room server and a local connector. Contributions are welcome through pull requests.

## Contribution Flow

1. Fork the repository.
2. Create a focused branch from `master`.
3. Make one logical change per pull request.
4. Add or update tests when behavior changes.
5. Run validation locally before opening a pull request.
6. Open a pull request and complete the checklist.

Do not push directly to `master`. Maintainers merge pull requests after review and passing CI.

## Local Setup

Use Node 20+, Corepack, and the pinned pnpm version:

```powershell
corepack enable
corepack pnpm install
corepack pnpm check
```

Useful development commands:

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm dev:server
corepack pnpm dev:web
corepack pnpm dev:adapter
```

For focused package work:

```powershell
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
```

## Project Areas

- `packages/protocol`: shared TypeScript types, zod schemas, and protocol contracts.
- `packages/server`: Fastify/WebSocket server, SQLite storage, auth, pairing, invites, and room governance.
- `packages/cli-adapter`: local CLI agent connector and runner logic.
- `packages/web`: React + Vite room UI and browser state derivation.
- `docs/`: protocol and design documentation.

Protocol, server, connector, deployment, and CI changes require extra maintainer attention because they affect compatibility, security, or production operations.

## Coding Standards

- Use strict TypeScript.
- Keep ESM/NodeNext-compatible imports with `.js` extensions for relative imports.
- Use two-space indentation, double quotes, and semicolons.
- Prefer small, testable helpers for derived state and protocol logic.
- Keep protocol schema changes centralized in `packages/protocol/src/schemas.ts`.
- Follow existing naming and file organization unless the pull request explains a focused improvement.

## Testing Expectations

Run this before opening a pull request:

```powershell
corepack pnpm check
```

Add or update tests when changing:

- protocol event types or schemas;
- role permissions or participant removal;
- invite, join approval, or pairing flows;
- room-state derivation;
- local connector behavior;
- UI behavior visible to users.

Server tests should prefer in-memory SQLite with `dbPath: ":memory:"`.

## Commit Messages

Use Conventional Commit style:

```text
feat(server): add room governance check
fix(web): mask connector code
docs: clarify local connector setup
chore: update CI workflow
```

Keep commits focused and imperative.

## Pull Request Requirements

Every pull request should include:

- a short summary;
- validation commands run;
- linked issue or context when available;
- screenshots or short recordings for UI changes;
- notes for protocol, security, deployment, or connector risks.

Maintainers may ask for smaller pull requests if the change mixes unrelated concerns.

## Security and Secrets

Never commit secrets or local deployment files, including:

- `.deploy/*`;
- `docs/Server info.md`;
- `.env` files;
- database files such as `*.db`, `*.db-shm`, and `*.db-wal`;
- SSH keys, tokens, invite tokens, participant tokens, or production configuration.

Report security issues privately using `SECURITY.md`. Do not publish exploit details in public issues.
