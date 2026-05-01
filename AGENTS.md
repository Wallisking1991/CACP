# Repository Guidelines

## Project Structure & Module Organization
CACP is a pnpm workspace for a local-first collaborative AI room. Source lives under `packages/*/src`, with package tests in `packages/*/test`.

- `packages/protocol`: shared TypeScript types, Zod schemas, and protocol contracts.
- `packages/server`: Fastify/WebSocket server, SQLite event store, auth, pairing, and room governance.
- `packages/cli-adapter`: local CLI agent connector and runner logic.
- `packages/web`: React + Vite room UI; static assets live in `packages/web/public`.
- `docs/`: protocol docs, diagrams, examples, and deployment notes; `scripts/` contains repo utilities.

## Build, Test, and Development Commands
Use Node 20+, Corepack, and the pinned pnpm version.

```powershell
corepack enable
corepack pnpm install
corepack pnpm check        # runs tests, then builds all packages
corepack pnpm test         # builds protocol, then runs Vitest recursively
corepack pnpm build        # builds every workspace package
corepack pnpm dev:server   # starts the Fastify API/WebSocket server
corepack pnpm dev:web      # starts the Vite UI on 127.0.0.1:5173
corepack pnpm dev:adapter  # starts the generic local CLI adapter example
```

For focused work, run `corepack pnpm --filter @cacp/server test` or replace the package name.

## Coding Style & Naming Conventions
Use strict TypeScript, ESM, and NodeNext-compatible relative imports with `.js` extensions. Follow the existing style: two-space indentation, double quotes, semicolons, and small testable helpers. Keep protocol schema changes centralized in `packages/protocol/src/schemas.ts`; update server and web room-state logic when event contracts change.

## Testing Guidelines
Vitest is the test framework. Name tests `*.test.ts` or `*.test.tsx` in each package's `test/` directory. Add or update tests for protocol events, role permissions, invite/pairing flows, room-state derivation, local connector behavior, and user-visible UI changes. Prefer in-memory SQLite (`dbPath: ":memory:"`) for server tests.

## Commit & Pull Request Guidelines
Git history follows Conventional Commits, for example `feat(server): ...`, `fix(web): ...`, `docs: ...`, and `chore: ...`. Keep commits focused and imperative. Pull requests should include a summary, validation commands, linked issue or context when available, screenshots or recordings for UI changes, and notes for protocol, security, deployment, or connector risk.

## Security & Configuration Tips
Only the room server is public; agent execution should stay local through the connector. Never commit secrets or local deployment artifacts: `.env`, `.deploy/*`, `docs/Server info.md`, `docs/deploy-cloud.md`, `docs/examples/*.local.json`, SQLite `*.db*` files, SSH keys, tokens, or production config. Avoid exposing room, invite, pairing, participant, or connector secrets in logs and screenshots.


<claude-mem-context>
# Memory Context

# [2] recent context, 2026-05-01 10:10pm GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (15,612t read) | 4,060,950t work | 100% savings

### May 1, 2026
80 10:21a 🟣 TDD test added for countPendingJoinRequestsByInvite EventStore method
85 10:22a 🟣 EventStore.countPendingJoinRequestsByInvite implemented with schema migration
83 10:23a 🔵 Existing migration pattern in EventStore constructor examined for schema change
86 10:24a 🔵 Rate limiting and join request flow inspection
87 10:26a 🟣 Invite creation enforces room capacity and configurable max uses
88 10:27a 🟣 Invite consumption deferred to approval with auto-revocation
89 " ✅ Server capacity test corrected and all tests passing
90 10:32a ⚖️ Invite link error UX improvement requested with gated approval workflow
91 11:28a 🔵 Comprehensive exploration of RoomControlCenter and related CACP web frontend components completed
92 11:30a 🔵 App.tsx reveals top-level CACP application architecture with routing, sessions, and WebSocket event flow
93 11:31a ⚖️ UI redesign interaction model finalized
94 11:55a 🔵 Baseline test suite fully passing before refactor
95 " ⚖️ Implementation decomposed into 11 tracked tasks with TDD approach
96 " 🟣 Popover base component created via TDD cycle
97 " 🟣 Popover component passes all 5 TDD tests
98 " ✅ Task 3 complete, implementation moving to BellIcon
99 " 🟣 BellIcon test created for notification button
100 " 🟣 BellIcon test fails as expected before implementation
101 11:56a 🟣 BellIcon implemented and passing in RoomIcons
102 " ✅ Task 1 complete, Task 6 RoleAvatarRail refactoring started
103 11:57a ✅ RoleAvatarRail test refactored for click-based interactions
104 " ✅ RoleAvatarRail interface expanded with click callbacks
S95 Redesign CACP room header buttons and overall room controls UI to look premium/high-end (May 1, 1:05 PM)
105 1:05p 🔵 Playwright screenshot command timed out after 30 seconds
106 " 🔵 Screenshot file created but Playwright process remains hung
107 1:06p 🔵 Playwright screenshot file never existed; existence check was a false positive
108 1:07p 🔵 Playwright screenshot file found at /tmp/cacp-screenshot.png, 502 KB
109 " 🔵 MiniMax VLM requires Unix-style path; Windows C:/ path fails
111 " 🔵 VLM analysis reveals screenshot captured broken/loading UI state
112 " 🔵 Playwright landing page screenshot succeeds while room page hangs
110 " ✅ Screenshot copied to workspace root for VLM accessibility
113 " 🔵 Room page requires valid session; redirects without one
114 1:08p 🔵 Room creation API expects `name` field, not `roomName`
115 1:09p 🔵 Room successfully created via API with corrected payload
116 " ✅ Created Playwright script to screenshot room page with injected session
117 " 🔵 Playwright screenshot script failed due to wrong cwd and npx invocation
118 " ✅ Revised Playwright screenshot approach using ESM module and node direct execution
119 " 🔵 ESM screenshot script failed because playwright-core is not resolvable from /tmp
120 1:10p 🔵 Launcher page approach successfully captured room page screenshot
S97 Activate the `using-superpowers` skill to establish skill invocation rules for the session (May 1, 1:15 PM)
121 1:35p 🔵 Codex SDK local execution behavior verified through spike
122 " ⚖️ Provider-neutral local code agent protocol adopted for Codex CLI integration
123 " ⚖️ 10-task implementation plan defined across protocol, server, web, and connector
S98 Activate using-superpowers skill, review Codex CLI integration plans, and begin Task 1 protocol schema implementation via TDD (May 1, 1:35 PM)
S96 Activate the `using-superpowers` skill to establish skill invocation rules for the session (May 1, 1:35 PM)
S99 Continue the 10-task TDD plan extending CACP for codex-cli alongside claude-code; close out Task 5 (Web Generic Session UI) by finishing the wiring work, repairing latent test failures from Codex CLI registration, re-verifying all packages, and committing the result. (May 1, 1:37 PM)
124 1:38p 🟣 Protocol generic local agent session events implemented
125 " 🟣 Server pairing tests updated for Codex CLI support
S100 Task 5 of the 10-task TDD plan — adding the Web Generic Session UI for the codex-cli + claude-code unified agent family in the CACP monorepo. Scope of this checkpoint: repair Codex-CLI-induced test breakage in `landing-connector.test.tsx` and `landing-llm-agent.test.tsx`, finish wiring `AgentSessionPicker` / `AgentStatusCard` through `AgentAvatarPopover.tsx` and `Workspace.tsx`, re-verify all package suites, and land everything as a single commit alongside the previously-unstaged Task 4 deltas. (May 1, 1:40 PM)
S101 Codex CLI integration Task 9 + Task 10 — connector routing and full validation/packaging for the CACP monorepo (May 1, 5:19 PM)
S102 Codex CLI integration final validation — confirm Tasks 9 + 10 complete, inspect git log/status, and identify any leftover uncommitted work (May 1, 5:27 PM)
S103 Final status report for the 10-task Codex CLI integration plan — confirm full automated completion and remaining manual verification (May 1, 6:02 PM)
S104 Re-confirm Codex CLI integration completion — 10/10 tasks done, branch state stable, awaiting decision on manual smoke-test follow-up (May 1, 6:16 PM)
126 6:23p ✅ Added @openai/codex-sdk to @cacp/cli-adapter
127 6:24p 🔵 pnpm add was a manifest no-op; Codex SDK already committed
128 9:34p ✅ Session initialized with using-superpowers skill
129 9:53p 🔵 Codex smoke test fails with spawn codex ENOENT on Windows
130 " 🔴 Codex SDK no longer forces bare "codex" executable override
131 " 🔴 Server avoids appending events through closed SQLite during shutdown
132 10:06p 🔵 PowerShell ConstrainedLanguage blocks UTF-8 console encoding setup in D:\Development\2

Access 4061k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>