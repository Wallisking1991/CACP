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

# [2] recent context, 2026-05-02 12:40am GMT+8

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (24,079t read) | 617,273t work | 96% savings

### May 1, 2026
S102 Codex CLI integration final validation — confirm Tasks 9 + 10 complete, inspect git log/status, and identify any leftover uncommitted work (May 1, 5:27 PM)
S103 Final status report for the 10-task Codex CLI integration plan — confirm full automated completion and remaining manual verification (May 1, 6:02 PM)
S104 Re-confirm Codex CLI integration completion — 10/10 tasks done, branch state stable, awaiting decision on manual smoke-test follow-up (May 1, 6:02 PM)
S105 Redeploy CACP project to production server cacp.zuchongai.com following docs/deploy-cloud.md runbook (May 1, 6:16 PM)
129 9:53p 🔵 Codex smoke test fails with spawn codex ENOENT on Windows
132 10:06p 🔵 PowerShell ConstrainedLanguage blocks UTF-8 console encoding setup in D:\Development\2
133 10:10p 🔵 CACP Codex smoke room read-only listing succeeded
134 10:37p 🔵 CACP cloud deployment runbook loaded for redeploy
135 10:38p 🔵 Deployment configuration files located and loaded
136 " 🔵 Local checkout state and Python toolchain verified for deploy
137 " 🔵 corepack enable fails with EPERM on Windows nodejs install
138 " 🔵 corepack pnpm works without corepack enable shim
139 " 🔵 Local pnpm check passed 245 tests and built all packages
140 10:42p 🟣 Windows Local Connector SEA built successfully
141 " 🔵 Connector exe size 92920320 bytes for new build
142 " 🟣 Web frontend built in cloud deployment mode
143 " 🔵 Cloud-mode dist contains connector exe and references new asset hash
144 10:43p 🔵 Repository has 243 tracked files for deployment packaging
145 " 🟣 Created .deploy/package.py to assemble deployment tar.gz
146 10:44p 🟣 Deployment archive built with 244 entries totaling 33 MB
147 " 🟣 Created deploy-remote.sh template for server-side deployment
148 " 🟣 Created .deploy/deploy.py paramiko deployment driver
149 10:45p 🟣 CACP deployed successfully to cacp.zuchongai.com
150 10:46p 🟣 Public deployment verified at cacp.zuchongai.com
151 " 🔵 Vite asset hash now contains hyphens, breaking simple grep regex
152 10:47p 🟣 Production homepage references new bundle and SPA routing works
153 " 🟣 Production JS bundle contains new useMatch React Router code
155 " ⚖️ Deployment tooling treated as ephemeral and cleaned up
154 " 🔵 Post-deploy git state shows .deploy/ as untracked and main 23 ahead
S106 systematic-debugging: 生产环境创建房间后，通过 Codex 连接时 CACP-Local-Connector 输入连接码后直接闪退；web 上显示 Codex 已上线，但无会话选择弹窗，输入消息也未触发 Agent 回复。Phase 4 fix authoring + commit for the defect. (May 1, 10:48 PM)
156 10:54p 🔵 Production bug: CACP-Local-Connector crashes on Codex connect with stuck UI state
157 " 🔵 Codex pairing code spans 45 files across cli-adapter, server, web, and protocol
S107 Redeploy CACP cloud service at commit a49772b carrying the systematic-debugging Phase-4 fix for defect A (CACP-Local-Connector silent exit on connection-code paste in cloud rooms), per docs/deploy-cloud.md. (May 1, 10:54 PM)
S108 Phase-4 verification of defect-A fix in production followed by Phase-1 investigation of the now-visible follow-up symptom: "无法开启新会话" with stderr error "Unable to locate Codex CLI binaries. Ensure @openai/codex is installed with optional dependencies." (May 1, 11:36 PM)
158 11:38p 🔵 Defect A root cause empirically confirmed: Codex SDK binary lookup fails inside SEA bundle
S109 systematic-debugging: production cloud rooms — connecting via Codex pastes the connection code into CACP-Local-Connector and the connector crashes / silently disappears; the web UI shows Codex as online but never opens the session-selection modal and never replies to messages. Escalation surfaced the underlying error: "Ignoring malformed adapter stream message Error: Unable to locate Codex CLI binaries. Ensure @openai/codex is installed with optional dependencies." with stack trace findCodexPath → CodexExec → Codex → createCodexSdkFromModule → loadCodexSdk. (May 1, 11:47 PM)
159 11:47p 🔵 @openai/codex package is absent from node_modules in CACP repo
160 11:48p 🔵 @openai/codex IS installed in pnpm virtual store with Windows binary vendor present
161 " 🔵 codex.js shim shows fallback resolution: platform package OR local vendor directory
162 11:49p 🔵 Diagnosis phase complete: SEA bundle binary resolution gap is the root cause
163 " 🔴 Codex SDK loader now searches PATH, pnpm store, and npm globals when bundled binary is missing
164 11:51p 🔵 Connector fresh-mode session selection has no error reporting path to web UI
165 11:52p 🔴 Fresh-mode session selection failures now surface to web UI via runtime-status "failed" events
S110 Two-part work: (1) Fix CACP-Local-Connector silent crash and missing web session-selection error when starting a Codex session in cloud production (resolved at commit 0b8f3c2). (2) Redeploy the project to cacp.zuchongai.com per docs/deploy-cloud.md so the fix reaches end users (now in flight). (May 1, 11:52 PM)
### May 2, 2026
S111 Two-part request fulfilled in one trajectory: (1) systematic-debugging fix for the CACP-Local-Connector silent crash on Codex session start (root-caused at `@openai/codex-sdk` `findCodexPath()` failing in SEA/bundled-CJS environments) plus the missing web-side error path when the connector failed mid-handshake; (2) redeploy of the resulting commit to cacp.zuchongai.com per `docs/deploy-cloud.md`. Both halves are now LIVE on production. (May 2, 12:04 AM)
166 12:30a 🔵 CACP cloud deployment runbook reviewed for redeployment
167 12:31a 🔵 Pre-deployment local state inspection for CACP cloud redeploy
168 12:32a 🔵 Full test suite passes pre-deployment across all CACP workspaces
169 12:33a 🔵 Modified codex-sdk files show no content diff despite git M flag
170 " 🟣 Windows CACP Local Connector executable rebuilt via Node SEA
171 " 🔴 Web build ran without VITE_CACP_DEPLOYMENT_MODE due to bash/PowerShell syntax mismatch
172 " 🔵 Working tree clean and main branch is 26 commits ahead of origin/main
173 " 🔴 Web rebuilt successfully with VITE_CACP_DEPLOYMENT_MODE=cloud using bash inline syntax
174 12:34a 🔵 Local deployment artifacts verified with sizes and release identifier resolved
175 12:36a 🟣 Python paramiko deployment script authored for CACP cloud deploy
176 " 🟣 CACP cloud deployment cacp-20260501163414-aaec102 shipped to production
177 12:37a 🔵 Production verification confirms cacp.zuchongai.com deployment is healthy
178 " 🔵 Production JS bundle confirmed to include React Router useMatch hook
179 12:38a ✅ Deployed commits pushed to origin/main making release reproducible from Git
180 " ✅ Post-deployment hygiene: local deploy script and archive removed

Access 617k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>