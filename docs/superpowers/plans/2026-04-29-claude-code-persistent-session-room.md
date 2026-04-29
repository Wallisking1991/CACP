# Claude Code Persistent Session Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert CACP from a generic local command-agent wrapper into a Claude Code-first room where the local connector runs or resumes one persistent Claude Code session, imports selected Claude history into the shared web timeline, and keeps LLM API agents for pure chat.

**Architecture:** The server remains the room/event authority and never executes Claude locally. The connector owns Claude Code Agent SDK integration, local session discovery/import, persistent runtime, status mapping, and LLM API execution. The Web app renders Claude session setup, imported history, and one rolling runtime status card while leaving the existing normal chat/Roundtable semantics unchanged.

**Tech Stack:** TypeScript, Node 20, pnpm workspace, Zod protocol schemas, Fastify/WebSocket/SQLite server, React/Vite Web UI, Vitest, `@anthropic-ai/claude-agent-sdk`, Claude Code CLI local session storage.

---

## Official Claude Code references checked on 2026-04-29

Use these official docs while implementing and reviewing this plan:

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
  - Relevant because the current CACP Claude profile uses `claude -p --output-format text --no-session-persistence`; this work removes the per-turn print/non-persistent model and uses session resume/create behavior instead.
  - Relevant flags in the docs include `--continue`, `--resume`, `--session-id`, `--output-format`, and `--no-session-persistence`.
- Claude Code Agent SDK sessions: https://code.claude.com/docs/en/agent-sdk/sessions
  - Relevant because sessions contain conversation history, tool calls, tool results, and responses.
  - Relevant TypeScript helpers include session listing and message retrieval APIs described as `listSessions()` and `getSessionMessages()`.
- Claude Code Agent SDK streaming vs single mode: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
  - Relevant because CACP rooms need a long-lived interactive stream; use streaming input mode for persistent conversations rather than one-shot calls per room message.
- Claude Code Agent SDK TypeScript V2 preview: https://code.claude.com/docs/en/agent-sdk/typescript-v2-preview
  - Relevant because the preview exposes session-oriented APIs such as create/resume session helpers, `session.send`, stream handling, and `session.close`.
  - Treat these names as SDK-boundary details isolated in `packages/cli-adapter/src/claude/claude-sdk.ts`.
- Claude Code Agent SDK streaming output: https://code.claude.com/docs/en/agent-sdk/streaming-output
  - Relevant because partial assistant output and stream events should drive `agent.output.delta` and the rolling status card.
- Claude Code Agent SDK user input: https://code.claude.com/docs/en/agent-sdk/user-input
  - Relevant because future approval/input waits should map to one `waiting_for_approval` status card state rather than filling the chat timeline.
- Claude Code local storage docs: https://code.claude.com/docs/en/how-claude-code-works and https://code.claude.com/docs/en/claude-directory
  - Relevant for compatibility fallback only. Prefer official SDK session APIs; inspect `~/.claude/projects/` JSONL transcripts only when the installed SDK does not expose catalog/import helpers.

Implementation rule: do not read or display hidden chain-of-thought. Only display observable stream output, visible messages, tool-use summaries, tool-result summaries, command summaries, and runtime status.

---

## File Structure Map

### Protocol package

- Modify `packages/protocol/src/schemas.ts`
  - Add Claude-specific event types.
  - Export Zod schemas and TypeScript types for Claude session summaries, selection, import messages, import completion/failure, runtime status changes, runtime status completion, and runtime status failure.
- Modify `packages/protocol/test/protocol.test.ts`
  - Validate new event types and payload schemas.

### Server package

- Modify `packages/server/src/pairing.ts`
  - Keep local command support only for `claude-code`.
  - Keep LLM API agent types: `llm-api`, `llm-openai-compatible`, `llm-anthropic-compatible`.
  - Remove Codex/opencode/Echo profile branches and Codex prompt helper.
  - Remove `-p`, `--output-format text`, and `--no-session-persistence` from Claude profile arguments.
- Modify `packages/server/src/event-store.ts`
  - Update `agent_pairings.agent_type` CHECK constraint and migration.
  - Drop unclaimed legacy local command pairings during migration so old `codex`, `opencode`, and `echo` rows cannot break the new constraint.
- Modify `packages/server/src/server.ts`
  - Add Claude session catalog, session selection, transcript import, and runtime status routes.
  - Enforce owner/admin selection and agent-only catalog/import/status publishing.
  - Keep agent turn start/delta/complete/fail endpoints for final answers.
- Add `packages/server/src/claude-events.ts`
  - Small helpers for validating Claude-agent ownership, import batches, and status event construction.
- Modify tests:
  - `packages/server/test/pairing.test.ts`
  - `packages/server/test/event-store.test.ts`
  - `packages/server/test/connection-code-server.test.ts`
  - Add `packages/server/test/claude-session-routes.test.ts`

### Connector package

- Modify `packages/cli-adapter/package.json`
  - Add dependency `@anthropic-ai/claude-agent-sdk`.
- Modify `packages/cli-adapter/src/index.ts`
  - Split message handling into shared room-client callbacks.
  - For Claude Code, use persistent runtime instead of `runCommandForTask`.
  - For LLM API, keep existing `runLlmTurn` path.
  - Stop using `ChatTranscriptWriter` as Claude context storage.
- Add `packages/cli-adapter/src/room-client.ts`
  - Typed `postJson`, event stream setup, and endpoint helpers used by Claude and LLM runtime paths.
- Add `packages/cli-adapter/src/claude/types.ts`
  - Connector-local Claude session, import, runtime status, and SDK wrapper types.
- Add `packages/cli-adapter/src/claude/claude-sdk.ts`
  - Dynamic import boundary for `@anthropic-ai/claude-agent-sdk`.
  - Runtime guards for session APIs, catalog APIs, and message import APIs.
- Add `packages/cli-adapter/src/claude/session-catalog.ts`
  - List project-scoped sessions.
  - Normalize SDK catalog results into CACP metadata.
  - Provide local JSONL fallback behind the same interface.
- Add `packages/cli-adapter/src/claude/transcript-import.ts`
  - Convert Claude SDK messages or JSONL lines into shared CACP import records.
  - Chunk uploads.
- Add `packages/cli-adapter/src/claude/runtime.ts`
  - Start fresh or resume persistent Claude session.
  - Send incremental room prompts.
  - Stream visible answer text and status updates.
  - Close session on connector shutdown.
- Add tests:
  - `packages/cli-adapter/test/claude-sdk.test.ts`
  - `packages/cli-adapter/test/claude-session-catalog.test.ts`
  - `packages/cli-adapter/test/claude-transcript-import.test.ts`
  - `packages/cli-adapter/test/claude-runtime.test.ts`
  - Modify `packages/cli-adapter/test/index-source.test.ts`
  - Modify or remove `packages/cli-adapter/test/runner.test.ts` after `runner.ts` is no longer used by the product path.

### Web package

- Modify `packages/web/src/api.ts`
  - Add Claude session selection API call.
- Modify `packages/web/src/room-state.ts`
  - Add `claudeSessionCatalog`, `claudeSessionSelection`, `claudeImports`, and `claudeRuntimeStatuses`.
  - Derive imported Claude messages into the main `messages` array.
  - Derive rolling status records separately from messages.
- Add `packages/web/src/components/ClaudeSessionPicker.tsx`
  - Owner/admin setup panel for start fresh, resume latest, and choose session.
  - Explicit confirmation before importing a full Claude session.
- Add `packages/web/src/components/ClaudeStatusCard.tsx`
  - Single updating status card per running turn.
  - Bounded recent status entries.
- Modify `packages/web/src/components/Thread.tsx`
  - Render imported Claude messages and import banner in the existing timeline.
  - Render status cards outside the message append flow.
- Modify `packages/web/src/components/Workspace.tsx`
  - Place session picker and status card in the room.
- Modify `packages/web/src/components/Landing.tsx`
  - Remove Codex, opencode, Echo, and generic command-agent options.
  - Keep Claude Code and LLM API choices.
- Modify i18n:
  - `packages/web/src/i18n/messages.en.json`
  - `packages/web/src/i18n/messages.zh.json`
- Add or modify tests:
  - `packages/web/test/room-state.test.ts`
  - `packages/web/test/landing-connector.test.tsx`
  - `packages/web/test/landing-llm-agent.test.tsx`
  - Add `packages/web/test/claude-session-picker.test.tsx`
  - Add `packages/web/test/claude-status-card.test.tsx`
  - Modify `packages/web/test/i18n.test.ts`

### Docs and examples

- Modify `README.md`
- Modify `README.zh-CN.md` if present.
- Modify `docs/protocol.md` or the closest current protocol document.
- Remove or rewrite user-facing docs/examples that advertise Codex, opencode, Echo, or arbitrary command adapters.
- Keep LLM API docs and local-only API-key guidance.

---

## Task 1: Lock supported agent types to Claude Code plus LLM API

**Files:**
- Modify `packages/server/src/pairing.ts`
- Modify `packages/server/src/event-store.ts`
- Modify `packages/server/test/pairing.test.ts`
- Modify `packages/server/test/event-store.test.ts`
- Modify `packages/server/test/connection-code-server.test.ts`

- [ ] **Step 1: Replace legacy command-agent tests with failing Claude Code-first assertions**

In `packages/server/test/pairing.test.ts`, remove tests named:

- `maps Codex CLI approval modes to permission levels`
- `generates a Codex CLI system prompt that references CACP and Roundtable Mode`
- `produces distinct Codex system prompts for each permission level`

Add this test inside `describe("agent pairing profiles", ...)`:

```ts
it("supports only Claude Code as the local command agent while keeping LLM API agents", () => {
  expect(AgentTypeValues).toEqual([
    "claude-code",
    "llm-api",
    "llm-openai-compatible",
    "llm-anthropic-compatible"
  ]);
  expect(isLlmAgentType("llm-api")).toBe(true);
  expect(isLlmAgentType("llm-openai-compatible")).toBe(true);
  expect(isLlmAgentType("llm-anthropic-compatible")).toBe(true);
  expect(isLlmAgentType("claude-code")).toBe(false);
  expect((AgentTypeValues as readonly string[]).includes("codex")).toBe(false);
  expect((AgentTypeValues as readonly string[]).includes("opencode")).toBe(false);
  expect((AgentTypeValues as readonly string[]).includes("echo")).toBe(false);
});

it("builds a Claude Code persistent-session profile instead of a per-turn print command", () => {
  const profile = buildAgentProfile({
    agentType: "claude-code",
    permissionLevel: "limited_write",
    workingDir: "D:\\Development\\2"
  });

  expect(profile.name).toBe("Claude Code Agent");
  expect(profile.command).toBe("claude");
  expect(profile.args).toEqual([]);
  expect(profile.capabilities).toEqual([
    "claude-code",
    "claude.persistent_session",
    "manual_flow_control"
  ]);
  expect(profile.system_prompt).toContain("CACP");
  expect(profile.system_prompt).toContain("Roundtable Mode");
  expect(profile.system_prompt).not.toContain("???");
});

it("does not configure Claude Code with print mode or disabled session persistence", () => {
  const profile = buildAgentProfile({
    agentType: "claude-code",
    permissionLevel: "read_only",
    workingDir: "D:\\Development\\2"
  });

  expect(profile.args).not.toContain("-p");
  expect(profile.args).not.toContain("--print");
  expect(profile.args).not.toContain("--output-format");
  expect(profile.args).not.toContain("--no-session-persistence");
});
```

Update the existing Claude permission-mode tests so they no longer inspect CLI arguments. Replace them with:

```ts
it("keeps permission intent in Claude profile capabilities", () => {
  const readOnly = buildAgentProfile({ agentType: "claude-code", permissionLevel: "read_only", workingDir: "." });
  const limitedWrite = buildAgentProfile({ agentType: "claude-code", permissionLevel: "limited_write", workingDir: "." });
  const fullAccess = buildAgentProfile({ agentType: "claude-code", permissionLevel: "full_access", workingDir: "." });

  expect(readOnly.capabilities).toContain("read_only");
  expect(readOnly.capabilities).toContain("repo.read");
  expect(limitedWrite.capabilities).toContain("limited_write");
  expect(limitedWrite.capabilities).toContain("manual_flow_control");
  expect(fullAccess.capabilities).toContain("full_access");
  expect(fullAccess.capabilities).toContain("manual_flow_control");
});
```

- [ ] **Step 2: Run focused pairing tests and confirm failure**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts
```

Expected result before implementation:

```text
FAIL packages/server/test/pairing.test.ts
Expected AgentTypeValues to equal ["claude-code", "llm-api", ...]
Expected profile.args not to contain --no-session-persistence
```

- [ ] **Step 3: Simplify pairing profile implementation**

Replace `packages/server/src/pairing.ts` with this structure:

```ts
export const CommandAgentTypeValues = ["claude-code"] as const;
export const LlmAgentTypeValues = ["llm-api", "llm-openai-compatible", "llm-anthropic-compatible"] as const;
export const AgentTypeValues = [...CommandAgentTypeValues, ...LlmAgentTypeValues] as const;
export type AgentType = typeof AgentTypeValues[number];
export type LlmAgentType = typeof LlmAgentTypeValues[number];

export function isLlmAgentType(agentType: string): agentType is LlmAgentType {
  return (LlmAgentTypeValues as readonly string[]).includes(agentType);
}

export const PermissionLevelValues = ["read_only", "limited_write", "full_access"] as const;
export type PermissionLevel = typeof PermissionLevelValues[number];

export interface AgentPairingProfile {
  name: string;
  command: string;
  args: string[];
  working_dir: string;
  capabilities: string[];
  system_prompt?: string;
}

export function buildAgentProfile(input: { agentType: AgentType; permissionLevel: PermissionLevel; workingDir?: string; hookUrl?: string }): AgentPairingProfile {
  const workingDir = input.workingDir || ".";
  if (input.agentType === "llm-api") {
    return { name: "LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-openai-compatible") {
    return { name: "OpenAI-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.openai_compatible"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-anthropic-compatible") {
    return { name: "Anthropic-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.anthropic_compatible"], system_prompt: llmApiSystemPrompt() };
  }

  return {
    name: "Claude Code Agent",
    command: "claude",
    args: [],
    working_dir: workingDir,
    capabilities: [
      "claude-code",
      "claude.persistent_session",
      input.permissionLevel,
      ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])
    ],
    system_prompt: claudeSystemPrompt(input.permissionLevel, input.hookUrl)
  };
}

function claudeSystemPrompt(permissionLevel: PermissionLevel, _hookUrl?: string): string {
  const approval = permissionLevel === "read_only"
    ? "当前权限为只读：不要修改文件，不要执行写入、删除、安装依赖或其他会改变环境的操作。"
    : permissionLevel === "limited_write"
      ? "当前权限允许普通文件创建和编辑。对于删除文件、批量重构、安装依赖、访问网络或运行可能改变环境的命令，请先说明风险并等待房主确认。"
      : "当前权限为 Full access：当房主明确要求时，可以创建/修改文件并执行必要命令。对于破坏性、不可逆或大范围操作，仍需先说明风险并等待房主确认。";
  return [
    "你是连接到 CACP 多人协作 AI 房间的 Claude Code Agent。",
    "你运行在房主本地项目目录中的一个持久 Claude Code 会话里。",
    "请基于 Claude Code 自身会话上下文、项目上下文和房间新增消息帮助所有参与者推进任务。",
    "如果需要多人分别回答或形成共识，请提醒房主使用 Roundtable Mode 收集回答。",
    "不要输出结构化治理代码块；当前平台演示只使用普通聊天与 Roundtable Mode。",
    approval
  ].join("\n");
}

function llmApiSystemPrompt(): string {
  return [
    "You are an LLM API Agent connected to a CACP multi-user AI room.",
    "You are a pure conversation agent. Do not claim to read files, modify files, run local commands, call tools, or access private systems.",
    "If multiple participants need to answer separately or reach consensus, remind the room owner to use Roundtable Mode.",
    "Reply in concise, actionable Chinese by default unless the room context asks for another language."
  ].join("\n");
}
```

- [ ] **Step 4: Update SQLite agent type constraint and migration**

In `packages/server/src/event-store.ts`, replace the `agent_pairings` table constraint with:

```sql
agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'llm-api', 'llm-openai-compatible', 'llm-anthropic-compatible')),
```

Replace `migrateAgentPairingAgentTypes()` with a migration that also removes legacy command pairings:

```ts
private migrateAgentPairingAgentTypes(): void {
  const table = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_pairings'`).get() as { sql: string } | undefined;
  if (!table) return;
  const hasNewConstraint = table.sql.includes("'llm-anthropic-compatible'") && !table.sql.includes("'codex'") && !table.sql.includes("'opencode'") && !table.sql.includes("'echo'");
  if (hasNewConstraint) return;
  this.db.exec(`
    CREATE TABLE agent_pairings_next (
      pairing_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'llm-api', 'llm-openai-compatible', 'llm-anthropic-compatible')),
      permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
      working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT
    );
    INSERT INTO agent_pairings_next
      SELECT pairing_id, room_id, token_hash, created_by, agent_type, permission_level, working_dir, created_at, expires_at, claimed_at
      FROM agent_pairings
      WHERE agent_type IN ('claude-code', 'llm-api', 'llm-openai-compatible', 'llm-anthropic-compatible');
    DROP TABLE agent_pairings;
    ALTER TABLE agent_pairings_next RENAME TO agent_pairings;
    CREATE INDEX IF NOT EXISTS idx_agent_pairings_room ON agent_pairings(room_id);
    CREATE INDEX IF NOT EXISTS idx_agent_pairings_token_hash ON agent_pairings(token_hash);
  `);
}
```

- [ ] **Step 5: Add event-store migration regression test**

Append to `packages/server/test/event-store.test.ts`:

```ts
it("migrates away legacy generic command pairings", () => {
  const dbPath = tempDbPath();
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE rooms (room_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE participants (room_id TEXT NOT NULL, id TEXT NOT NULL, token_hash TEXT NOT NULL, display_name TEXT NOT NULL, type TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(room_id, id));
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, protocol TEXT NOT NULL, version TEXT NOT NULL, type TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE TABLE agent_pairings (
      pairing_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex', 'opencode', 'echo')),
      permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
      working_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT
    );
    INSERT INTO agent_pairings VALUES ('pair_claude', 'room_1', 'hash_1', 'owner', 'claude-code', 'read_only', '.', '2026-04-29T00:00:00.000Z', '2026-04-30T00:00:00.000Z', NULL);
    INSERT INTO agent_pairings VALUES ('pair_codex', 'room_1', 'hash_2', 'owner', 'codex', 'read_only', '.', '2026-04-29T00:00:00.000Z', '2026-04-30T00:00:00.000Z', NULL);
  `);
  legacy.close();

  const store = new EventStore(dbPath);
  const rows = store.listAgentPairingsForRoom("room_1");
  expect(rows.map((row) => row.agent_type)).toEqual(["claude-code"]);
  store.close();
});
```

If `tempDbPath()` or `listAgentPairingsForRoom()` does not exist in the current test file, create a local helper and inspect pairings through an existing store method. Keep the assertion exactly about retaining Claude/LLM rows and dropping legacy command rows.

- [ ] **Step 6: Update connection-code server tests**

In `packages/server/test/connection-code-server.test.ts`, add:

```ts
it("rejects removed generic local command agent types", async () => {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  const room = roomResponse.json() as { room_id: string; owner_token: string };

  for (const removedType of ["codex", "opencode", "echo"]) {
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_type: removedType, permission_level: "read_only", working_dir: "." }
    });
    expect(response.statusCode).toBe(400);
  }

  await app.close();
});
```

- [ ] **Step 7: Run server tests for Task 1**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts event-store.test.ts connection-code-server.test.ts
```

Expected:

```text
PASS packages/server/test/pairing.test.ts
PASS packages/server/test/event-store.test.ts
PASS packages/server/test/connection-code-server.test.ts
```

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
git add packages/server/src/pairing.ts packages/server/src/event-store.ts packages/server/test/pairing.test.ts packages/server/test/event-store.test.ts packages/server/test/connection-code-server.test.ts
git commit -m "feat(server): focus local agent pairing on Claude Code"
```

---

## Task 2: Add Claude session and runtime protocol schemas

**Files:**
- Modify `packages/protocol/src/schemas.ts`
- Modify `packages/protocol/test/protocol.test.ts`

- [ ] **Step 1: Add failing protocol tests**

Append to `packages/protocol/test/protocol.test.ts`:

```ts
import {
  CacpEventSchema,
  ClaudeSessionCatalogUpdatedPayloadSchema,
  ClaudeSessionSelectedPayloadSchema,
  ClaudeSessionImportMessagePayloadSchema,
  ClaudeRuntimeStatusChangedPayloadSchema
} from "../src/schemas.js";

it("accepts Claude session catalog events", () => {
  const payload = {
    agent_id: "agent_1",
    working_dir: "D:\\Development\\2",
    sessions: [{
      session_id: "session_1",
      title: "CACP planning",
      project_dir: "D:\\Development\\2",
      updated_at: "2026-04-29T00:00:00.000Z",
      message_count: 12,
      byte_size: 34567,
      importable: true
    }]
  };
  expect(ClaudeSessionCatalogUpdatedPayloadSchema.parse(payload)).toEqual(payload);
  expect(CacpEventSchema.parse({
    protocol: "cacp",
    version: "0.2.0",
    event_id: "evt_1",
    room_id: "room_1",
    type: "claude.session_catalog.updated",
    actor_id: "agent_1",
    created_at: "2026-04-29T00:00:00.000Z",
    payload
  }).type).toBe("claude.session_catalog.updated");
});

it("accepts Claude session selection events", () => {
  expect(ClaudeSessionSelectedPayloadSchema.parse({
    agent_id: "agent_1",
    mode: "resume",
    session_id: "session_1",
    selected_by: "owner_1"
  }).mode).toBe("resume");
  expect(ClaudeSessionSelectedPayloadSchema.parse({
    agent_id: "agent_1",
    mode: "fresh",
    selected_by: "owner_1"
  }).mode).toBe("fresh");
});

it("accepts imported Claude transcript message payloads", () => {
  const payload = {
    import_id: "import_1",
    agent_id: "agent_1",
    session_id: "session_1",
    sequence: 1,
    source_message_id: "msg_sdk_1",
    original_created_at: "2026-04-28T12:00:00.000Z",
    author_role: "assistant",
    source_kind: "assistant",
    text: "Visible Claude answer"
  };
  expect(ClaudeSessionImportMessagePayloadSchema.parse(payload)).toEqual(payload);
});

it("accepts rolling Claude runtime status payloads", () => {
  const payload = {
    agent_id: "agent_1",
    turn_id: "turn_1",
    status_id: "status_turn_1",
    phase: "reading_files",
    current: "Reading packages/server/src/pairing.ts",
    recent: ["Started turn", "Reading packages/server/src/pairing.ts"],
    metrics: { files_read: 1, searches: 0, commands: 0 },
    started_at: "2026-04-29T00:00:00.000Z",
    updated_at: "2026-04-29T00:00:01.000Z"
  };
  expect(ClaudeRuntimeStatusChangedPayloadSchema.parse(payload)).toEqual(payload);
});
```

- [ ] **Step 2: Run protocol tests and confirm failure**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
```

Expected:

```text
FAIL packages/protocol/test/protocol.test.ts
Cannot find exported member ClaudeSessionCatalogUpdatedPayloadSchema
```

- [ ] **Step 3: Add Claude event names to `EventTypeSchema`**

In `packages/protocol/src/schemas.ts`, add these string literals to `EventTypeSchema`:

```ts
"claude.session_catalog.updated",
"claude.session_selected",
"claude.session_import.started",
"claude.session_import.message",
"claude.session_import.completed",
"claude.session_import.failed",
"claude.runtime.status_changed",
"claude.runtime.status_completed",
"claude.runtime.status_failed",
```

Place them near the existing `agent.*` event names so future readers see they belong to agent runtime behavior.

- [ ] **Step 4: Add Claude payload schemas**

Add below `AiCollectionRequestRejectedPayloadSchema` in `packages/protocol/src/schemas.ts`:

```ts
export const ClaudeSessionSummarySchema = z.object({
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  project_dir: z.string().min(1).max(500),
  updated_at: z.string().datetime(),
  message_count: z.number().int().nonnegative(),
  byte_size: z.number().int().nonnegative(),
  importable: z.boolean()
});

export const ClaudeSessionCatalogUpdatedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  working_dir: z.string().min(1).max(500),
  sessions: z.array(ClaudeSessionSummarySchema).max(100)
});

export const ClaudeSessionSelectedPayloadSchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("fresh"),
    selected_by: z.string().min(1)
  }),
  z.object({
    agent_id: z.string().min(1),
    mode: z.literal("resume"),
    session_id: z.string().min(1),
    selected_by: z.string().min(1)
  })
]);

export const ClaudeSessionImportStartedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  title: z.string().min(1).max(200),
  message_count: z.number().int().nonnegative(),
  started_at: z.string().datetime()
});

export const ClaudeSessionImportAuthorRoleSchema = z.enum(["user", "assistant", "tool", "command", "system"]);
export const ClaudeSessionImportSourceKindSchema = z.enum(["user", "assistant", "tool_use", "tool_result", "command", "system"]);

export const ClaudeSessionImportMessagePayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  source_message_id: z.string().min(1).optional(),
  original_created_at: z.string().datetime().optional(),
  author_role: ClaudeSessionImportAuthorRoleSchema,
  source_kind: ClaudeSessionImportSourceKindSchema,
  text: z.string().min(1).max(20000)
});

export const ClaudeSessionImportCompletedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  imported_message_count: z.number().int().nonnegative(),
  completed_at: z.string().datetime()
});

export const ClaudeSessionImportFailedPayloadSchema = z.object({
  import_id: z.string().min(1),
  agent_id: z.string().min(1),
  session_id: z.string().min(1).optional(),
  error: z.string().min(1).max(2000),
  failed_at: z.string().datetime()
});

export const ClaudeRuntimePhaseSchema = z.enum([
  "connecting",
  "resuming_session",
  "importing_session",
  "thinking",
  "reading_files",
  "searching",
  "running_command",
  "waiting_for_approval",
  "generating_answer",
  "completed",
  "failed"
]);

export const ClaudeRuntimeMetricsSchema = z.object({
  files_read: z.number().int().nonnegative().default(0),
  searches: z.number().int().nonnegative().default(0),
  commands: z.number().int().nonnegative().default(0)
});

export const ClaudeRuntimeStatusChangedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  phase: ClaudeRuntimePhaseSchema,
  current: z.string().min(1).max(500),
  recent: z.array(z.string().min(1).max(500)).max(10),
  metrics: ClaudeRuntimeMetricsSchema,
  started_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const ClaudeRuntimeStatusCompletedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  summary: z.string().min(1).max(500),
  metrics: ClaudeRuntimeMetricsSchema,
  completed_at: z.string().datetime()
});

export const ClaudeRuntimeStatusFailedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  error: z.string().min(1).max(2000),
  metrics: ClaudeRuntimeMetricsSchema,
  failed_at: z.string().datetime()
});
```

- [ ] **Step 5: Export Claude TypeScript types**

At the bottom of `packages/protocol/src/schemas.ts`, add:

```ts
export type ClaudeSessionSummary = z.infer<typeof ClaudeSessionSummarySchema>;
export type ClaudeSessionCatalogUpdatedPayload = z.infer<typeof ClaudeSessionCatalogUpdatedPayloadSchema>;
export type ClaudeSessionSelectedPayload = z.infer<typeof ClaudeSessionSelectedPayloadSchema>;
export type ClaudeSessionImportStartedPayload = z.infer<typeof ClaudeSessionImportStartedPayloadSchema>;
export type ClaudeSessionImportMessagePayload = z.infer<typeof ClaudeSessionImportMessagePayloadSchema>;
export type ClaudeSessionImportCompletedPayload = z.infer<typeof ClaudeSessionImportCompletedPayloadSchema>;
export type ClaudeSessionImportFailedPayload = z.infer<typeof ClaudeSessionImportFailedPayloadSchema>;
export type ClaudeRuntimePhase = z.infer<typeof ClaudeRuntimePhaseSchema>;
export type ClaudeRuntimeMetrics = z.infer<typeof ClaudeRuntimeMetricsSchema>;
export type ClaudeRuntimeStatusChangedPayload = z.infer<typeof ClaudeRuntimeStatusChangedPayloadSchema>;
export type ClaudeRuntimeStatusCompletedPayload = z.infer<typeof ClaudeRuntimeStatusCompletedPayloadSchema>;
export type ClaudeRuntimeStatusFailedPayload = z.infer<typeof ClaudeRuntimeStatusFailedPayloadSchema>;
```

- [ ] **Step 6: Run protocol tests**

Run:

```powershell
corepack pnpm --filter @cacp/protocol test -- protocol.test.ts
```

Expected:

```text
PASS packages/protocol/test/protocol.test.ts
```

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add packages/protocol/src/schemas.ts packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add Claude session room events"
```

---

## Task 3: Add server routes for Claude session catalog, selection, import, and status

**Files:**
- Add `packages/server/src/claude-events.ts`
- Modify `packages/server/src/server.ts`
- Add `packages/server/test/claude-session-routes.test.ts`

- [ ] **Step 1: Write failing route tests for catalog and owner selection**

Create `packages/server/test/claude-session-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoomAndOwner() {
  const app = await buildServer({ dbPath: ":memory:" });
  const roomResponse = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Claude Room", display_name: "Owner" } });
  const room = roomResponse.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room };
}

async function registerAgent(app: Awaited<ReturnType<typeof buildServer>>, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: "Claude Code Agent", capabilities: ["claude-code", "claude.persistent_session"] }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

describe("Claude session room routes", () => {
  it("lets the registered agent publish a Claude session catalog", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);

    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-catalog`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
      payload: {
        agent_id: agent.agent_id,
        working_dir: "D:\\Development\\2",
        sessions: [{
          session_id: "session_1",
          title: "Planning",
          project_dir: "D:\\Development\\2",
          updated_at: "2026-04-29T00:00:00.000Z",
          message_count: 2,
          byte_size: 1000,
          importable: true
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    const events = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` }
    });
    expect(events.body).toContain("claude.session_catalog.updated");
    await app.close();
  });

  it("lets only owner or admin select a Claude session", async () => {
    const { app, room } = await createRoomAndOwner();
    const agent = await registerAgent(app, room.room_id, room.owner_token);
    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/invites`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { role: "member" }
    });
    const invite = inviteResponse.json() as { invite_token: string };
    const memberResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join`,
      payload: { invite_token: invite.invite_token, display_name: "Member" }
    });
    const member = memberResponse.json() as { participant_token: string };

    const memberSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${member.participant_token}` },
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1" }
    });
    expect(memberSelect.statusCode).toBe(403);

    const ownerSelect = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/claude/session-selection`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id, mode: "resume", session_id: "session_1" }
    });
    expect(ownerSelect.statusCode).toBe(201);
    expect(ownerSelect.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 2: Run route tests and confirm failure**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- claude-session-routes.test.ts
```

Expected:

```text
FAIL packages/server/test/claude-session-routes.test.ts
statusCode 404 for /claude/session-catalog
```

- [ ] **Step 3: Add server helper module**

Create `packages/server/src/claude-events.ts`:

```ts
import {
  ClaudeRuntimeStatusChangedPayloadSchema,
  ClaudeRuntimeStatusCompletedPayloadSchema,
  ClaudeRuntimeStatusFailedPayloadSchema,
  ClaudeSessionCatalogUpdatedPayloadSchema,
  ClaudeSessionImportCompletedPayloadSchema,
  ClaudeSessionImportFailedPayloadSchema,
  ClaudeSessionImportMessagePayloadSchema,
  ClaudeSessionImportStartedPayloadSchema,
  ClaudeSessionSelectedPayloadSchema,
  type CacpEvent,
  type Participant
} from "@cacp/protocol";
import { event } from "./ids.js";

export const ClaudeSessionCatalogBodySchema = ClaudeSessionCatalogUpdatedPayloadSchema;
export const ClaudeSessionSelectionBodySchema = ClaudeSessionSelectedPayloadSchema.omit({ selected_by: true });

export const ClaudeSessionImportStartBodySchema = ClaudeSessionImportStartedPayloadSchema;
export const ClaudeSessionImportMessagesBodySchema = ClaudeSessionImportMessagePayloadSchema.array().min(1).max(50);
export const ClaudeSessionImportCompleteBodySchema = ClaudeSessionImportCompletedPayloadSchema;
export const ClaudeSessionImportFailBodySchema = ClaudeSessionImportFailedPayloadSchema;

export const ClaudeRuntimeStatusBodySchema = {
  changed: ClaudeRuntimeStatusChangedPayloadSchema,
  completed: ClaudeRuntimeStatusCompletedPayloadSchema,
  failed: ClaudeRuntimeStatusFailedPayloadSchema
} as const;

export function participantIsAgent(participant: Participant): boolean {
  return participant.role === "agent" && participant.type === "agent";
}

export function assertAgentOwnsPayload(participant: Participant, agentId: string): boolean {
  return participantIsAgent(participant) && participant.id === agentId;
}

export function claudeSelectionEvent(roomId: string, actorId: string, payload: unknown): CacpEvent {
  const parsed = ClaudeSessionSelectedPayloadSchema.parse(payload);
  return event(roomId, "claude.session_selected", actorId, parsed);
}
```

- [ ] **Step 4: Add catalog and selection routes to `server.ts`**

Import helper schemas near the top of `packages/server/src/server.ts`:

```ts
import {
  ClaudeRuntimeStatusBodySchema,
  ClaudeSessionCatalogBodySchema,
  ClaudeSessionImportCompleteBodySchema,
  ClaudeSessionImportFailBodySchema,
  ClaudeSessionImportMessagesBodySchema,
  ClaudeSessionImportStartBodySchema,
  ClaudeSessionSelectionBodySchema,
  assertAgentOwnsPayload
} from "./claude-events.js";
```

Add routes after `/rooms/:roomId/agents/select` and before `/rooms/:roomId/agent-action-approvals`:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-catalog", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const body = ClaudeSessionCatalogBodySchema.parse(request.body);
  if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
  appendAndPublish(event(request.params.roomId, "claude.session_catalog.updated", participant.id, body));
  return reply.code(201).send({ ok: true });
});

app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-selection", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
  const body = ClaudeSessionSelectionBodySchema.parse(request.body);
  const targetAgent = findParticipant(request.params.roomId, body.agent_id);
  if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
  appendAndPublish(event(request.params.roomId, "claude.session_selected", participant.id, {
    ...body,
    selected_by: participant.id
  }));
  return reply.code(201).send({ ok: true });
});
```

- [ ] **Step 5: Add import routes**

Append these routes after the selection route:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-imports/start", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const body = ClaudeSessionImportStartBodySchema.parse(request.body);
  if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
  appendAndPublish(event(request.params.roomId, "claude.session_import.started", participant.id, body));
  return reply.code(201).send({ ok: true });
});

app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/messages", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const body = ClaudeSessionImportMessagesBodySchema.parse(request.body);
  if (!body.every((message) => message.import_id === request.params.importId)) return deny(reply, "import_id_mismatch", 400);
  if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
  const storedEvents = store.transaction(() => body.map((message) => store.appendEvent(event(request.params.roomId, "claude.session_import.message", participant.id, message))));
  publishEvents(storedEvents);
  return reply.code(201).send({ ok: true, imported: body.length });
});

app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/complete", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const body = ClaudeSessionImportCompleteBodySchema.parse(request.body);
  if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
  if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
  appendAndPublish(event(request.params.roomId, "claude.session_import.completed", participant.id, body));
  return reply.code(201).send({ ok: true });
});

app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/fail", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const body = ClaudeSessionImportFailBodySchema.parse(request.body);
  if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
  if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
  appendAndPublish(event(request.params.roomId, "claude.session_import.failed", participant.id, body));
  return reply.code(201).send({ ok: true });
});
```

- [ ] **Step 6: Add runtime status route**

Append after import routes:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/runtime-status", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  const raw = request.body as { kind?: unknown; payload?: unknown };
  if (raw.kind !== "changed" && raw.kind !== "completed" && raw.kind !== "failed") return deny(reply, "invalid_status_kind", 400);
  const payload = ClaudeRuntimeStatusBodySchema[raw.kind].parse(raw.payload);
  if (!assertAgentOwnsPayload(participant, payload.agent_id)) return deny(reply, "forbidden", 403);
  const eventType = raw.kind === "changed"
    ? "claude.runtime.status_changed"
    : raw.kind === "completed"
      ? "claude.runtime.status_completed"
      : "claude.runtime.status_failed";
  appendAndPublish(event(request.params.roomId, eventType, participant.id, payload));
  return reply.code(201).send({ ok: true });
});
```

- [ ] **Step 7: Extend tests for import and status**

Append to `packages/server/test/claude-session-routes.test.ts`:

```ts
it("lets only the matching agent publish import messages and runtime status", async () => {
  const { app, room } = await createRoomAndOwner();
  const agent = await registerAgent(app, room.room_id, room.owner_token);
  const otherAgent = await registerAgent(app, room.room_id, room.owner_token);

  const importStart = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/claude/session-imports/start`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
    payload: {
      import_id: "import_1",
      agent_id: agent.agent_id,
      session_id: "session_1",
      title: "Imported",
      message_count: 1,
      started_at: "2026-04-29T00:00:00.000Z"
    }
  });
  expect(importStart.statusCode).toBe(201);

  const wrongAgentMessage = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/claude/session-imports/import_1/messages`,
    headers: { authorization: `Bearer ${otherAgent.agent_token}` },
    payload: [{
      import_id: "import_1",
      agent_id: agent.agent_id,
      session_id: "session_1",
      sequence: 0,
      author_role: "assistant",
      source_kind: "assistant",
      text: "Should be rejected"
    }]
  });
  expect(wrongAgentMessage.statusCode).toBe(403);

  const messageBatch = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/claude/session-imports/import_1/messages`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
    payload: [{
      import_id: "import_1",
      agent_id: agent.agent_id,
      session_id: "session_1",
      sequence: 0,
      author_role: "assistant",
      source_kind: "assistant",
      text: "Imported visible answer"
    }]
  });
  expect(messageBatch.statusCode).toBe(201);
  expect(messageBatch.json()).toEqual({ ok: true, imported: 1 });

  const status = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/claude/runtime-status`,
    headers: { authorization: `Bearer ${agent.agent_token}` },
    payload: {
      kind: "changed",
      payload: {
        agent_id: agent.agent_id,
        turn_id: "turn_1",
        status_id: "status_turn_1",
        phase: "thinking",
        current: "Thinking",
        recent: ["Thinking"],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:00:01.000Z"
      }
    }
  });
  expect(status.statusCode).toBe(201);

  await app.close();
});
```

- [ ] **Step 8: Run route tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- claude-session-routes.test.ts
```

Expected:

```text
PASS packages/server/test/claude-session-routes.test.ts
```

- [ ] **Step 9: Run server package tests**

Run:

```powershell
corepack pnpm --filter @cacp/server test
```

Expected:

```text
Test Files ... passed
```

- [ ] **Step 10: Commit Task 3**

Run:

```powershell
git add packages/server/src/server.ts packages/server/src/claude-events.ts packages/server/test/claude-session-routes.test.ts
git commit -m "feat(server): store Claude session room events"
```

---

## Task 4: Add Claude SDK boundary, session catalog, and transcript import conversion

**Files:**
- Modify `packages/cli-adapter/package.json`
- Add `packages/cli-adapter/src/claude/types.ts`
- Add `packages/cli-adapter/src/claude/claude-sdk.ts`
- Add `packages/cli-adapter/src/claude/session-catalog.ts`
- Add `packages/cli-adapter/src/claude/transcript-import.ts`
- Add `packages/cli-adapter/test/claude-sdk.test.ts`
- Add `packages/cli-adapter/test/claude-session-catalog.test.ts`
- Add `packages/cli-adapter/test/claude-transcript-import.test.ts`

- [ ] **Step 1: Add Claude Agent SDK dependency**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter add @anthropic-ai/claude-agent-sdk
```

Expected:

```text
dependencies:
+ @anthropic-ai/claude-agent-sdk ...
```

Then inspect installed type declarations so the wrapper stays aligned with the installed SDK:

```powershell
Get-ChildItem node_modules -Recurse -Filter *.d.ts | Select-String -Pattern "unstable_v2_createSession|unstable_v2_resumeSession|listSessions|getSessionMessages" -List
```

Expected:

```text
...@anthropic-ai\claude-agent-sdk...
```

If the installed SDK names have changed from the official docs, update only `packages/cli-adapter/src/claude/claude-sdk.ts`; the rest of the connector must depend on local wrapper interfaces.

- [ ] **Step 2: Create connector-local Claude types**

Create `packages/cli-adapter/src/claude/types.ts`:

```ts
import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionSummary
} from "@cacp/protocol";

export interface ClaudeSessionCatalogInput {
  workingDir: string;
  homeDir?: string;
}

export interface ClaudeSessionCatalogResult {
  workingDir: string;
  sessions: ClaudeSessionSummary[];
}

export interface ClaudeImportedMessage extends ClaudeSessionImportMessagePayload {}

export interface ClaudeImportResult {
  importId: string;
  sessionId: string;
  title: string;
  messages: ClaudeImportedMessage[];
}

export interface ClaudeRuntimeStatus {
  phase: ClaudeRuntimePhase;
  current: string;
  recent: string[];
  metrics: ClaudeRuntimeMetrics;
}

export interface ClaudeRuntimeCallbacks {
  onStatus(status: ClaudeRuntimeStatus): Promise<void>;
  onDelta(chunk: string): Promise<void>;
}

export interface ClaudePersistentSession {
  sessionId: string | undefined;
  send(prompt: string, callbacks: ClaudeRuntimeCallbacks): Promise<string>;
  close(): Promise<void>;
}

export interface ClaudeSdkSessionMessage {
  id?: string;
  role?: string;
  type?: string;
  content?: unknown;
  timestamp?: string;
  created_at?: string;
}

export interface ClaudeSdkSessionSummary {
  id?: string;
  session_id?: string;
  title?: string;
  updated_at?: string;
  message_count?: number;
  byte_size?: number;
  project_dir?: string;
  cwd?: string;
}

export interface ClaudeSdk {
  createSession(input: { workingDir: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  resumeSession(input: { workingDir: string; sessionId: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  listSessions(input: { workingDir: string }): Promise<ClaudeSdkSessionSummary[]>;
  getSessionMessages(input: { workingDir: string; sessionId: string }): Promise<ClaudeSdkSessionMessage[]>;
}
```

- [ ] **Step 3: Write failing SDK wrapper tests**

Create `packages/cli-adapter/test/claude-sdk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClaudeSdkFromModule } from "../src/claude/claude-sdk.js";

describe("Claude SDK boundary", () => {
  it("normalizes v2 create and resume session functions behind local interfaces", async () => {
    const sent: string[] = [];
    const module = {
      unstable_v2_createSession: async () => ({
        sessionId: "fresh_session",
        send: async (prompt: string) => {
          sent.push(prompt);
          return "fresh answer";
        },
        close: async () => undefined
      }),
      unstable_v2_resumeSession: async (sessionId: string) => ({
        sessionId,
        send: async (prompt: string) => {
          sent.push(prompt);
          return "resumed answer";
        },
        close: async () => undefined
      }),
      listSessions: async () => [{ session_id: "session_1", title: "Session", updated_at: "2026-04-29T00:00:00.000Z" }],
      getSessionMessages: async () => [{ id: "m1", role: "assistant", content: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module);
    const fresh = await sdk.createSession({ workingDir: ".", permissionLevel: "read_only" });
    const resumed = await sdk.resumeSession({ workingDir: ".", sessionId: "session_1", permissionLevel: "read_only" });

    expect(fresh.sessionId).toBe("fresh_session");
    expect(resumed.sessionId).toBe("session_1");
    await fresh.send("hello", { onDelta: async () => undefined, onStatus: async () => undefined });
    expect(sent).toEqual(["hello"]);
  });

  it("throws a clear error when session APIs are missing", () => {
    expect(() => createClaudeSdkFromModule({})).toThrow(/Claude Code Agent SDK session APIs were not found/);
  });
});
```

- [ ] **Step 4: Implement SDK boundary**

Create `packages/cli-adapter/src/claude/claude-sdk.ts`:

```ts
import type {
  ClaudePersistentSession,
  ClaudeRuntimeCallbacks,
  ClaudeSdk,
  ClaudeSdkSessionMessage,
  ClaudeSdkSessionSummary
} from "./types.js";

type UnknownSdkModule = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function messageTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const record = asRecord(item);
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).filter(Boolean).join("");
  }
  const record = asRecord(value);
  return typeof record.text === "string" ? record.text : "";
}

function wrapSession(rawSession: unknown): ClaudePersistentSession {
  const session = asRecord(rawSession);
  const send = session.send;
  const stream = session.stream;
  const close = session.close;
  if (typeof send !== "function" && typeof stream !== "function") {
    throw new Error("Claude Code Agent SDK session object does not expose send or stream");
  }
  return {
    sessionId: typeof session.sessionId === "string" ? session.sessionId : typeof session.session_id === "string" ? session.session_id : undefined,
    async send(prompt: string, callbacks: ClaudeRuntimeCallbacks): Promise<string> {
      if (typeof send === "function") {
        const result = await send.call(rawSession, prompt);
        const text = messageTextFromUnknown(result);
        if (text) await callbacks.onDelta(text);
        return text;
      }
      let finalText = "";
      const iterable = stream!.call(rawSession, prompt) as AsyncIterable<unknown>;
      for await (const item of iterable) {
        const record = asRecord(item);
        const chunk = messageTextFromUnknown(record.delta ?? record.content ?? item);
        if (chunk) {
          finalText += chunk;
          await callbacks.onDelta(chunk);
        }
      }
      return finalText;
    },
    async close(): Promise<void> {
      if (typeof close === "function") await close.call(rawSession);
    }
  };
}

export function createClaudeSdkFromModule(module: UnknownSdkModule): ClaudeSdk {
  const createSession = module.unstable_v2_createSession;
  const resumeSession = module.unstable_v2_resumeSession;
  const listSessions = module.listSessions;
  const getSessionMessages = module.getSessionMessages;
  if (typeof createSession !== "function" || typeof resumeSession !== "function") {
    throw new Error("Claude Code Agent SDK session APIs were not found. Install a Claude Code Agent SDK version that exposes v2 create/resume session APIs.");
  }
  return {
    async createSession(input) {
      return wrapSession(await createSession({
        cwd: input.workingDir,
        systemPrompt: input.systemPrompt,
        permissionLevel: input.permissionLevel
      }));
    },
    async resumeSession(input) {
      return wrapSession(await resumeSession(input.sessionId, {
        cwd: input.workingDir,
        systemPrompt: input.systemPrompt,
        permissionLevel: input.permissionLevel
      }));
    },
    async listSessions(input): Promise<ClaudeSdkSessionSummary[]> {
      if (typeof listSessions !== "function") return [];
      return await listSessions({ cwd: input.workingDir }) as ClaudeSdkSessionSummary[];
    },
    async getSessionMessages(input): Promise<ClaudeSdkSessionMessage[]> {
      if (typeof getSessionMessages !== "function") return [];
      return await getSessionMessages({ cwd: input.workingDir, sessionId: input.sessionId }) as ClaudeSdkSessionMessage[];
    }
  };
}

export async function loadClaudeSdk(): Promise<ClaudeSdk> {
  const module = await import("@anthropic-ai/claude-agent-sdk") as UnknownSdkModule;
  return createClaudeSdkFromModule(module);
}
```

- [ ] **Step 5: Write failing catalog tests**

Create `packages/cli-adapter/test/claude-session-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listClaudeSessions } from "../src/claude/session-catalog.js";

describe("Claude session catalog", () => {
  it("normalizes SDK sessions and sorts newest first", async () => {
    const sdk = {
      listSessions: async () => [
        { session_id: "old", title: "Old", updated_at: "2026-04-28T00:00:00.000Z", message_count: 1, byte_size: 10, project_dir: "D:\\Development\\2" },
        { session_id: "new", title: "New", updated_at: "2026-04-29T00:00:00.000Z", message_count: 2, byte_size: 20, project_dir: "D:\\Development\\2" }
      ]
    };

    const catalog = await listClaudeSessions({ workingDir: "D:\\Development\\2", sdk });

    expect(catalog.workingDir).toBe("D:\\Development\\2");
    expect(catalog.sessions.map((session) => session.session_id)).toEqual(["new", "old"]);
    expect(catalog.sessions[0]).toMatchObject({
      title: "New",
      importable: true,
      message_count: 2,
      byte_size: 20
    });
  });
});
```

- [ ] **Step 6: Implement catalog normalization**

Create `packages/cli-adapter/src/claude/session-catalog.ts`:

```ts
import type { ClaudeSessionSummary } from "@cacp/protocol";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudeSdk, ClaudeSdkSessionSummary, ClaudeSessionCatalogInput, ClaudeSessionCatalogResult } from "./types.js";

function sessionIdOf(session: ClaudeSdkSessionSummary): string | undefined {
  return session.session_id ?? session.id;
}

function titleOf(session: ClaudeSdkSessionSummary, sessionId: string): string {
  const title = session.title?.trim();
  return title ? title.slice(0, 200) : `Claude session ${sessionId.slice(0, 8)}`;
}

function updatedAtOf(session: ClaudeSdkSessionSummary): string {
  return session.updated_at ?? new Date(0).toISOString();
}

export function normalizeClaudeSession(session: ClaudeSdkSessionSummary, workingDir: string): ClaudeSessionSummary | undefined {
  const sessionId = sessionIdOf(session);
  if (!sessionId) return undefined;
  return {
    session_id: sessionId,
    title: titleOf(session, sessionId),
    project_dir: session.project_dir ?? session.cwd ?? workingDir,
    updated_at: updatedAtOf(session),
    message_count: typeof session.message_count === "number" ? Math.max(0, session.message_count) : 0,
    byte_size: typeof session.byte_size === "number" ? Math.max(0, session.byte_size) : 0,
    importable: true
  };
}

export async function listClaudeSessions(input: ClaudeSessionCatalogInput & { sdk?: Pick<ClaudeSdk, "listSessions"> }): Promise<ClaudeSessionCatalogResult> {
  const sdk = input.sdk ?? await loadClaudeSdk();
  const sessions = (await sdk.listSessions({ workingDir: input.workingDir }))
    .map((session) => normalizeClaudeSession(session, input.workingDir))
    .filter((session): session is ClaudeSessionSummary => Boolean(session))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { workingDir: input.workingDir, sessions };
}
```

- [ ] **Step 7: Write failing transcript import conversion tests**

Create `packages/cli-adapter/test/claude-transcript-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildClaudeImportFromSessionMessages, chunkClaudeImportMessages } from "../src/claude/transcript-import.js";

describe("Claude transcript import", () => {
  it("converts visible SDK messages into import payloads", async () => {
    const sdk = {
      getSessionMessages: async () => [
        { id: "u1", role: "user", content: "Please inspect the repo", timestamp: "2026-04-28T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: [{ type: "text", text: "I will inspect it." }], timestamp: "2026-04-28T00:00:01.000Z" },
        { id: "t1", role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }], timestamp: "2026-04-28T00:00:02.000Z" }
      ]
    };

    const result = await buildClaudeImportFromSessionMessages({
      sdk,
      importId: "import_1",
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      sessionId: "session_1",
      title: "Planning"
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ sequence: 0, author_role: "user", source_kind: "user", text: "Please inspect the repo" }),
      expect.objectContaining({ sequence: 1, author_role: "assistant", source_kind: "assistant", text: "I will inspect it." }),
      expect.objectContaining({ sequence: 2, author_role: "tool", source_kind: "tool_use", text: "Tool use: Read README.md" })
    ]);
  });

  it("chunks imported messages into bounded upload batches", () => {
    const messages = Array.from({ length: 55 }, (_, index) => ({
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      sequence: index,
      author_role: "assistant" as const,
      source_kind: "assistant" as const,
      text: `message ${index}`
    }));

    expect(chunkClaudeImportMessages(messages, 50).map((chunk) => chunk.length)).toEqual([50, 5]);
  });
});
```

- [ ] **Step 8: Implement transcript import conversion**

Create `packages/cli-adapter/src/claude/transcript-import.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { ClaudeSessionImportSourceKindSchema } from "@cacp/protocol";
import type { z } from "zod";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudeImportResult, ClaudeImportedMessage, ClaudeSdk, ClaudeSdkSessionMessage } from "./types.js";

type SourceKind = z.infer<typeof ClaudeSessionImportSourceKindSchema>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toolSummary(item: Record<string, unknown>): string {
  const name = typeof item.name === "string" ? item.name : "tool";
  const input = record(item.input);
  const filePath = typeof input.file_path === "string" ? ` ${input.file_path}` : "";
  const command = typeof input.command === "string" ? ` ${input.command}` : "";
  return `Tool use: ${name}${filePath}${command}`;
}

function contentToVisibleParts(content: unknown): { text: string; sourceKind: SourceKind }[] {
  if (typeof content === "string") return [{ text: content, sourceKind: "assistant" }];
  if (!Array.isArray(content)) return [];
  const parts: { text: string; sourceKind: SourceKind }[] = [];
  for (const item of content) {
    const itemRecord = record(item);
    if (itemRecord.type === "text" && typeof itemRecord.text === "string") {
      parts.push({ text: itemRecord.text, sourceKind: "assistant" });
    }
    if (itemRecord.type === "tool_use") {
      parts.push({ text: toolSummary(itemRecord), sourceKind: "tool_use" });
    }
    if (itemRecord.type === "tool_result") {
      const text = typeof itemRecord.content === "string" ? itemRecord.content : "Tool result received";
      parts.push({ text, sourceKind: "tool_result" });
    }
  }
  return parts;
}

function authorRoleFor(message: ClaudeSdkSessionMessage, sourceKind: SourceKind): ClaudeImportedMessage["author_role"] {
  if (sourceKind === "tool_use" || sourceKind === "tool_result") return "tool";
  if (message.role === "user") return "user";
  if (message.role === "assistant") return "assistant";
  return "system";
}

export async function buildClaudeImportFromSessionMessages(input: {
  sdk?: Pick<ClaudeSdk, "getSessionMessages">;
  importId?: string;
  agentId: string;
  workingDir: string;
  sessionId: string;
  title: string;
}): Promise<ClaudeImportResult> {
  const sdk = input.sdk ?? await loadClaudeSdk();
  const importId = input.importId ?? `import_${randomUUID()}`;
  const messages = await sdk.getSessionMessages({ workingDir: input.workingDir, sessionId: input.sessionId });
  const imported: ClaudeImportedMessage[] = [];
  for (const message of messages) {
    const sourceMessageId = message.id;
    const originalCreatedAt = message.timestamp ?? message.created_at;
    const parts = message.role === "user"
      ? [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content), sourceKind: "user" as const }]
      : contentToVisibleParts(message.content);
    for (const part of parts) {
      const text = part.text.trim();
      if (!text) continue;
      imported.push({
        import_id: importId,
        agent_id: input.agentId,
        session_id: input.sessionId,
        sequence: imported.length,
        ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
        ...(originalCreatedAt ? { original_created_at: originalCreatedAt } : {}),
        author_role: authorRoleFor(message, part.sourceKind),
        source_kind: part.sourceKind,
        text: text.slice(0, 20000)
      });
    }
  }
  return { importId, sessionId: input.sessionId, title: input.title, messages: imported };
}

export function chunkClaudeImportMessages(messages: ClaudeImportedMessage[], size = 50): ClaudeImportedMessage[][] {
  const chunks: ClaudeImportedMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}
```

- [ ] **Step 9: Run connector Claude conversion tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- claude-sdk.test.ts claude-session-catalog.test.ts claude-transcript-import.test.ts
```

Expected:

```text
PASS packages/cli-adapter/test/claude-sdk.test.ts
PASS packages/cli-adapter/test/claude-session-catalog.test.ts
PASS packages/cli-adapter/test/claude-transcript-import.test.ts
```

- [ ] **Step 10: Commit Task 4**

Run:

```powershell
git add packages/cli-adapter/package.json pnpm-lock.yaml packages/cli-adapter/src/claude packages/cli-adapter/test/claude-sdk.test.ts packages/cli-adapter/test/claude-session-catalog.test.ts packages/cli-adapter/test/claude-transcript-import.test.ts
git commit -m "feat(connector): add Claude Code session SDK boundary"
```

---

## Task 5: Implement connector room client and persistent Claude runtime

**Files:**
- Add `packages/cli-adapter/src/room-client.ts`
- Add `packages/cli-adapter/src/claude/runtime.ts`
- Add `packages/cli-adapter/test/claude-runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `packages/cli-adapter/test/claude-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";

describe("Claude persistent runtime", () => {
  it("resumes one session and reuses it across multiple turns", async () => {
    const prompts: string[] = [];
    let createCalls = 0;
    let resumeCalls = 0;
    const sdk = {
      createSession: async () => {
        createCalls += 1;
        return {
          sessionId: "fresh",
          send: async (prompt: string) => {
            prompts.push(prompt);
            return "fresh answer";
          },
          close: async () => undefined
        };
      },
      resumeSession: async () => {
        resumeCalls += 1;
        return {
          sessionId: "session_1",
          send: async (prompt: string) => {
            prompts.push(prompt);
            return "resumed answer";
          },
          close: async () => undefined
        };
      }
    };
    const statuses: string[] = [];
    const deltas: string[] = [];
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      systemPrompt: "system",
      publishStatus: async (_turnId, status) => { statuses.push(status.phase); },
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); }
    });

    await runtime.selectSession({ mode: "resume", sessionId: "session_1" });
    const first = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "first"
    });
    const second = await runtime.runTurn({
      turnId: "turn_2",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "second"
    });

    expect(createCalls).toBe(0);
    expect(resumeCalls).toBe(1);
    expect(first.finalText).toBe("resumed answer");
    expect(second.finalText).toBe("resumed answer");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Message: first");
    expect(prompts[1]).toContain("Message: second");
    expect(statuses).toContain("resuming_session");
    expect(deltas).toEqual(["resumed answer", "resumed answer"]);
  });
});
```

- [ ] **Step 2: Implement room client helpers**

Create `packages/cli-adapter/src/room-client.ts`:

```ts
import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionCatalogUpdatedPayload,
  ClaudeSessionImportCompletedPayload,
  ClaudeSessionImportFailedPayload,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionImportStartedPayload
} from "@cacp/protocol";

export interface RoomClientInput {
  serverUrl: string;
  roomId: string;
  agentToken: string;
}

export class RoomClient {
  constructor(private readonly input: RoomClientInput) {}

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.input.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.input.agentToken}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    return await response.json() as T;
  }

  publishCatalog(payload: ClaudeSessionCatalogUpdatedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-catalog`, payload);
  }

  startImport(payload: ClaudeSessionImportStartedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/start`, payload);
  }

  uploadImportMessages(importId: string, messages: ClaudeSessionImportMessagePayload[]): Promise<{ ok: true; imported: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/messages`, messages);
  }

  completeImport(importId: string, payload: ClaudeSessionImportCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/complete`, payload);
  }

  failImport(importId: string, payload: ClaudeSessionImportFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/fail`, payload);
  }

  publishRuntimeStatus(kind: "changed" | "completed" | "failed", payload: unknown): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/runtime-status`, { kind, payload });
  }

  startTurn(turnId: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/start`, {});
  }

  publishTurnDelta(turnId: string, chunk: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/delta`, { chunk });
  }

  completeTurn(turnId: string, finalText: string): Promise<{ ok: true; message_id: string }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/complete`, { final_text: finalText, exit_code: 0 });
  }

  failTurn(turnId: string, error: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/fail`, { error });
  }
}

export function statusSummary(input: { elapsedMs: number; metrics: ClaudeRuntimeMetrics }): string {
  const seconds = Math.max(1, Math.round(input.elapsedMs / 1000));
  const parts = [`Completed in ${seconds}s`];
  if (input.metrics.files_read) parts.push(`read ${input.metrics.files_read} files`);
  if (input.metrics.searches) parts.push(`searched ${input.metrics.searches} times`);
  if (input.metrics.commands) parts.push(`ran ${input.metrics.commands} commands`);
  return parts.join(" · ");
}

export function runtimePhaseFromToolName(toolName: string): ClaudeRuntimePhase {
  if (toolName === "Read" || toolName === "LS") return "reading_files";
  if (toolName === "Grep" || toolName === "Glob") return "searching";
  if (toolName === "Bash") return "running_command";
  return "thinking";
}
```

- [ ] **Step 3: Implement prompt builder and runtime**

Create `packages/cli-adapter/src/claude/runtime.ts`:

```ts
import type { ClaudeRuntimeMetrics, ClaudeRuntimePhase } from "@cacp/protocol";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudePersistentSession, ClaudeRuntimeStatus, ClaudeSdk } from "./types.js";

export interface ClaudeTurnInput {
  turnId: string;
  roomName?: string;
  speakerName: string;
  speakerRole: string;
  modeLabel: string;
  text: string;
}

export interface ClaudeRuntimeInput {
  sdk?: Pick<ClaudeSdk, "createSession" | "resumeSession">;
  agentId: string;
  workingDir: string;
  permissionLevel: string;
  systemPrompt?: string;
  publishStatus(turnId: string, status: ClaudeRuntimeStatus): Promise<void>;
  publishDelta(turnId: string, chunk: string): Promise<void>;
}

export interface ClaudeTurnResult {
  finalText: string;
  sessionId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimRecent(recent: string[]): string[] {
  return recent.slice(-10);
}

function promptForTurn(input: ClaudeTurnInput): string {
  return [
    "CACP room message",
    `Room: ${input.roomName ?? "Untitled room"}`,
    `Speaker: ${input.speakerName} (${input.speakerRole})`,
    `Mode: ${input.modeLabel}`,
    `Message: ${input.text}`,
    "Instruction: Continue from the current Claude Code session context and answer for the room."
  ].join("\n");
}

export class ClaudeRuntime {
  private session: ClaudePersistentSession | undefined;
  private readonly sdkPromise: Promise<Pick<ClaudeSdk, "createSession" | "resumeSession">>;

  constructor(private readonly input: ClaudeRuntimeInput) {
    this.sdkPromise = Promise.resolve(input.sdk ?? loadClaudeSdk());
  }

  async selectSession(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void> {
    const sdk = await this.sdkPromise;
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    if (selection.mode === "fresh") {
      this.session = await sdk.createSession({
        workingDir: this.input.workingDir,
        permissionLevel: this.input.permissionLevel,
        systemPrompt: this.input.systemPrompt
      });
      return;
    }
    this.session = await sdk.resumeSession({
      workingDir: this.input.workingDir,
      sessionId: selection.sessionId,
      permissionLevel: this.input.permissionLevel,
      systemPrompt: this.input.systemPrompt
    });
  }

  async runTurn(turn: ClaudeTurnInput): Promise<ClaudeTurnResult> {
    if (!this.session) {
      await this.selectSession({ mode: "fresh" });
    }
    const started = Date.now();
    const recent: string[] = [];
    const metrics: ClaudeRuntimeMetrics = { files_read: 0, searches: 0, commands: 0 };
    const publish = async (phase: ClaudeRuntimePhase, current: string) => {
      recent.push(current);
      await this.input.publishStatus(turn.turnId, {
        phase,
        current,
        recent: trimRecent(recent),
        metrics
      });
    };

    await publish(this.session?.sessionId ? "resuming_session" : "connecting", this.session?.sessionId ? `Using Claude session ${this.session.sessionId}` : "Starting Claude session");
    await publish("thinking", "Sending room message to Claude Code");
    const finalText = await this.session!.send(promptForTurn(turn), {
      onStatus: async (status) => {
        metrics.files_read += status.metrics.files_read ?? 0;
        metrics.searches += status.metrics.searches ?? 0;
        metrics.commands += status.metrics.commands ?? 0;
        await publish(status.phase, status.current);
      },
      onDelta: async (chunk) => {
        await publish("generating_answer", "Claude Code is generating an answer");
        await this.input.publishDelta(turn.turnId, chunk);
      }
    });
    await publish("completed", `Claude Code completed in ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`);
    return { finalText, sessionId: this.session?.sessionId };
  }

  async close(): Promise<void> {
    if (this.session) await this.session.close();
  }
}
```

- [ ] **Step 4: Run runtime tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- claude-runtime.test.ts
```

Expected:

```text
PASS packages/cli-adapter/test/claude-runtime.test.ts
```

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add packages/cli-adapter/src/room-client.ts packages/cli-adapter/src/claude/runtime.ts packages/cli-adapter/test/claude-runtime.test.ts
git commit -m "feat(connector): run Claude Code as a persistent session"
```

---

## Task 6: Integrate Claude runtime into connector startup and room event handling

**Files:**
- Modify `packages/cli-adapter/src/index.ts`
- Modify `packages/cli-adapter/test/index-source.test.ts`
- Modify or delete `packages/cli-adapter/src/runner.ts`
- Modify or delete `packages/cli-adapter/test/runner.test.ts`
- Modify `packages/cli-adapter/src/connected-banner.ts`
- Modify `packages/cli-adapter/test/connected-banner.test.ts`

- [ ] **Step 1: Add source-level regression tests**

In `packages/cli-adapter/test/index-source.test.ts`, add:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexSource = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");

describe("connector index source", () => {
  it("uses ClaudeRuntime for Claude Code turns instead of spawning one command per turn", () => {
    expect(indexSource).toContain("ClaudeRuntime");
    expect(indexSource).not.toContain("runCommandForTask({");
  });

  it("does not use chat.md transcript as Claude Code context storage", () => {
    expect(indexSource).not.toContain("new ChatTranscriptWriter");
    expect(indexSource).not.toContain("transcript.handleEvent");
  });
});
```

Merge with any existing tests in this file rather than duplicating imports.

- [ ] **Step 2: Run index-source test and confirm failure**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- index-source.test.ts
```

Expected:

```text
FAIL packages/cli-adapter/test/index-source.test.ts
Expected indexSource not to contain runCommandForTask({
```

- [ ] **Step 3: Refactor connector imports**

In `packages/cli-adapter/src/index.ts`, remove imports:

```ts
import { runCommandForTask } from "./runner.js";
import { taskReportForExitCode } from "./task-result.js";
import { appendTurnOutput, turnCompleteBody } from "./turn-result.js";
import { ChatTranscriptWriter } from "./transcript.js";
```

Keep `appendTurnOutput` only if still needed for LLM API streaming. If it is only used to accumulate LLM final text, replace it with direct string concatenation:

```ts
finalText += chunk;
```

Add imports:

```ts
import { RoomClient, statusSummary } from "./room-client.js";
import { listClaudeSessions } from "./claude/session-catalog.js";
import { buildClaudeImportFromSessionMessages, chunkClaudeImportMessages } from "./claude/transcript-import.js";
import { ClaudeRuntime } from "./claude/runtime.js";
```

- [ ] **Step 4: Create room client and optional Claude runtime after registration**

After `registered` is created, add:

```ts
const roomClient = new RoomClient({
  serverUrl: config.server_url,
  roomId: config.room_id,
  agentToken: registered.agent_token
});

const isClaudeCode = !config.llm && config.agent.capabilities.includes("claude-code");
const claudeRuntime = isClaudeCode ? new ClaudeRuntime({
  agentId: registered.agent_id,
  workingDir: config.agent.working_dir,
  permissionLevel: config.permission_level ?? "read_only",
  systemPrompt: config.agent.system_prompt,
  publishDelta: async (turnId, chunk) => {
    await roomClient.publishTurnDelta(turnId, chunk);
  },
  publishStatus: async (turnId, status) => {
    const now = new Date().toISOString();
    await roomClient.publishRuntimeStatus("changed", {
      agent_id: registered.agent_id,
      turn_id: turnId,
      status_id: `status_${turnId}`,
      phase: status.phase,
      current: status.current,
      recent: status.recent,
      metrics: status.metrics,
      started_at: now,
      updated_at: now
    });
  }
}) : undefined;
```

If `RuntimeConfig` does not currently expose `permission_level`, add it in `packages/cli-adapter/src/config.ts` from the pairing claim response and cover it in `packages/cli-adapter/test/config.test.ts`.

- [ ] **Step 5: Publish catalog on WebSocket open**

Inside `ws.on("open", ...)`, replace transcript banner fields with Claude-specific status:

```ts
ws.on("open", () => {
  printConnectedBanner({
    roomId: config.room_id,
    agentName: config.agent.name,
    workingDir: config.agent.working_dir,
    claudeSessionMode: isClaudeCode ? "pending-selection" : "not-applicable"
  });
  console.log(`Connected adapter stream for room ${config.room_id}`);
  if (isClaudeCode) {
    void listClaudeSessions({ workingDir: config.agent.working_dir })
      .then((catalog) => roomClient.publishCatalog({
        agent_id: registered.agent_id,
        working_dir: catalog.workingDir,
        sessions: catalog.sessions
      }))
      .catch((error) => {
        console.error("Failed to publish Claude session catalog", error instanceof Error ? error.message : String(error));
      });
  }
});
```

Update `connected-banner.ts` tests so the banner says:

```text
Claude Code session selection is pending in the web room.
```

and no longer references `chat.md` as a required artifact.

- [ ] **Step 6: Handle `claude.session_selected` events**

Inside `handleMessage`, before task/turn handling, add:

```ts
if (parsed.data.type === "claude.session_selected" && claudeRuntime) {
  const payload = parsed.data.payload as { agent_id?: string; mode?: string; session_id?: string };
  if (payload.agent_id !== registered.agent_id) return;
  if (payload.mode === "fresh") {
    await claudeRuntime.selectSession({ mode: "fresh" });
    return;
  }
  if (payload.mode === "resume" && payload.session_id) {
    const catalog = await listClaudeSessions({ workingDir: config.agent.working_dir });
    const selected = catalog.sessions.find((session) => session.session_id === payload.session_id);
    const importResult = await buildClaudeImportFromSessionMessages({
      agentId: registered.agent_id,
      workingDir: config.agent.working_dir,
      sessionId: payload.session_id,
      title: selected?.title ?? `Claude session ${payload.session_id.slice(0, 8)}`
    });
    const startedAt = new Date().toISOString();
    await roomClient.startImport({
      import_id: importResult.importId,
      agent_id: registered.agent_id,
      session_id: payload.session_id,
      title: importResult.title,
      message_count: importResult.messages.length,
      started_at: startedAt
    });
    try {
      for (const chunk of chunkClaudeImportMessages(importResult.messages)) {
        await roomClient.uploadImportMessages(importResult.importId, chunk);
      }
      await roomClient.completeImport(importResult.importId, {
        import_id: importResult.importId,
        agent_id: registered.agent_id,
        session_id: payload.session_id,
        imported_message_count: importResult.messages.length,
        completed_at: new Date().toISOString()
      });
      await claudeRuntime.selectSession({ mode: "resume", sessionId: payload.session_id });
    } catch (error) {
      await roomClient.failImport(importResult.importId, {
        import_id: importResult.importId,
        agent_id: registered.agent_id,
        session_id: payload.session_id,
        error: error instanceof Error ? error.message : String(error),
        failed_at: new Date().toISOString()
      });
    }
  }
  return;
}
```

- [ ] **Step 7: Route Claude Code turns to persistent runtime**

In the existing `agent.turn.requested` branch, replace the non-LLM `runCommandForTask` block with:

```ts
if (claudeRuntime) {
  const startedAt = Date.now();
  await roomClient.startTurn(payload.turn_id);
  const result = await claudeRuntime.runTurn({
    turnId: payload.turn_id,
    roomName: config.room_name,
    speakerName: typeof parsed.data.payload.speaker_name === "string" ? parsed.data.payload.speaker_name : "Room participant",
    speakerRole: typeof parsed.data.payload.speaker_role === "string" ? parsed.data.payload.speaker_role : "member",
    modeLabel: typeof parsed.data.payload.mode === "string" ? parsed.data.payload.mode : "normal",
    text: payload.context_prompt
  });
  await roomClient.publishRuntimeStatus("completed", {
    agent_id: registered.agent_id,
    turn_id: payload.turn_id,
    status_id: `status_${payload.turn_id}`,
    summary: statusSummary({ elapsedMs: Date.now() - startedAt, metrics: { files_read: 0, searches: 0, commands: 0 } }),
    metrics: { files_read: 0, searches: 0, commands: 0 },
    completed_at: new Date().toISOString()
  });
  await roomClient.completeTurn(payload.turn_id, result.finalText);
}
```

Keep the `config.llm` branch unchanged except for using `roomClient.startTurn`, `roomClient.publishTurnDelta`, and `roomClient.completeTurn` if that reduces duplication.

- [ ] **Step 8: Remove connector generic task execution**

In `handleMessage`, for `task.created`:

```ts
if (parsed.data.type === "task.created") {
  const payload = parsed.data.payload as { task_id?: string; target_agent_id?: string };
  if (payload.target_agent_id === registered.agent_id) {
    console.log("Ignoring task.created because this connector no longer runs generic local command tasks.");
  }
  return;
}
```

If no code imports `packages/cli-adapter/src/runner.ts`, delete `runner.ts`, `task-result.ts`, and their tests. If package tests still depend on them as utility tests, remove those tests because the user-facing product no longer supports generic local command adapters.

- [ ] **Step 9: Ensure graceful close shuts down Claude session**

In `ws.on("close", ...)` before `process.exitCode = 0`, add:

```ts
void claudeRuntime?.close().catch((error) => {
  console.error("Failed to close Claude session", error);
});
```

- [ ] **Step 10: Run connector tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test
```

Expected:

```text
Test Files ... passed
```

- [ ] **Step 11: Commit Task 6**

Run:

```powershell
git add packages/cli-adapter/src/index.ts packages/cli-adapter/src/config.ts packages/cli-adapter/src/connected-banner.ts packages/cli-adapter/test/index-source.test.ts packages/cli-adapter/test/config.test.ts packages/cli-adapter/test/connected-banner.test.ts
git add -u packages/cli-adapter/src packages/cli-adapter/test
git commit -m "feat(connector): integrate persistent Claude room runtime"
```

---

## Task 7: Derive Claude session state, imported timeline messages, and rolling statuses in Web

**Files:**
- Modify `packages/web/src/room-state.ts`
- Modify `packages/web/test/room-state.test.ts`

- [ ] **Step 1: Add failing room-state tests**

Append to `packages/web/test/room-state.test.ts`:

```ts
it("derives Claude session catalog and selection state", () => {
  const state = deriveRoomState([
    event("room.created", "owner", { name: "Room" }),
    event("agent.registered", "owner", { agent_id: "agent_1", name: "Claude", capabilities: ["claude-code"] }),
    event("claude.session_catalog.updated", "agent_1", {
      agent_id: "agent_1",
      working_dir: "D:\\Development\\2",
      sessions: [{
        session_id: "session_1",
        title: "Planning",
        project_dir: "D:\\Development\\2",
        updated_at: "2026-04-29T00:00:00.000Z",
        message_count: 3,
        byte_size: 100,
        importable: true
      }]
    }),
    event("claude.session_selected", "owner", {
      agent_id: "agent_1",
      mode: "resume",
      session_id: "session_1",
      selected_by: "owner"
    })
  ]);

  expect(state.claudeSessionCatalog?.sessions[0].session_id).toBe("session_1");
  expect(state.claudeSessionSelection).toEqual({
    agent_id: "agent_1",
    mode: "resume",
    session_id: "session_1",
    selected_by: "owner"
  });
});

it("renders completed Claude imports in the main message timeline", () => {
  const state = deriveRoomState([
    event("claude.session_import.started", "agent_1", {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      title: "Planning",
      message_count: 2,
      started_at: "2026-04-29T00:00:00.000Z"
    }),
    event("claude.session_import.message", "agent_1", {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      sequence: 0,
      original_created_at: "2026-04-28T00:00:00.000Z",
      author_role: "user",
      source_kind: "user",
      text: "Old user message"
    }),
    event("claude.session_import.message", "agent_1", {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      sequence: 1,
      original_created_at: "2026-04-28T00:00:01.000Z",
      author_role: "assistant",
      source_kind: "assistant",
      text: "Old Claude answer"
    }),
    event("claude.session_import.completed", "agent_1", {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      imported_message_count: 2,
      completed_at: "2026-04-29T00:00:02.000Z"
    }),
    event("message.created", "owner", { message_id: "msg_1", text: "Continue below", kind: "human" })
  ]);

  expect(state.messages.map((message) => message.text)).toEqual([
    "__CLAUDE_IMPORT_BANNER__",
    "Old user message",
    "Old Claude answer",
    "Continue below"
  ]);
  expect(state.messages[1].kind).toBe("claude_import_user");
  expect(state.messages[2].kind).toBe("claude_import_assistant");
});

it("derives one rolling Claude status per turn instead of messages", () => {
  const state = deriveRoomState([
    event("claude.runtime.status_changed", "agent_1", {
      agent_id: "agent_1",
      turn_id: "turn_1",
      status_id: "status_turn_1",
      phase: "thinking",
      current: "Thinking",
      recent: ["Thinking"],
      metrics: { files_read: 0, searches: 0, commands: 0 },
      started_at: "2026-04-29T00:00:00.000Z",
      updated_at: "2026-04-29T00:00:01.000Z"
    }),
    event("claude.runtime.status_changed", "agent_1", {
      agent_id: "agent_1",
      turn_id: "turn_1",
      status_id: "status_turn_1",
      phase: "reading_files",
      current: "Reading README.md",
      recent: ["Thinking", "Reading README.md"],
      metrics: { files_read: 1, searches: 0, commands: 0 },
      started_at: "2026-04-29T00:00:00.000Z",
      updated_at: "2026-04-29T00:00:02.000Z"
    })
  ]);

  expect(state.messages).toEqual([]);
  expect(state.claudeRuntimeStatuses).toHaveLength(1);
  expect(state.claudeRuntimeStatuses[0]).toMatchObject({
    turn_id: "turn_1",
    phase: "reading_files",
    current: "Reading README.md"
  });
});
```

If the test file uses a different helper than `event(...)`, adapt the payloads to that helper while preserving assertions.

- [ ] **Step 2: Add Web state interfaces**

In `packages/web/src/room-state.ts`, add imports:

```ts
import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionSummary
} from "@cacp/protocol";
```

Add interfaces:

```ts
export interface ClaudeSessionCatalogView {
  agent_id: string;
  working_dir: string;
  sessions: ClaudeSessionSummary[];
}

export type ClaudeSessionSelectionView =
  | { agent_id: string; mode: "fresh"; selected_by: string }
  | { agent_id: string; mode: "resume"; session_id: string; selected_by: string };

export interface ClaudeImportView {
  import_id: string;
  agent_id: string;
  session_id: string;
  title: string;
  message_count: number;
  imported_message_count?: number;
  status: "started" | "completed" | "failed";
  error?: string;
}

export interface ClaudeRuntimeStatusView {
  agent_id: string;
  turn_id: string;
  status_id: string;
  phase: ClaudeRuntimePhase;
  current: string;
  recent: string[];
  metrics: ClaudeRuntimeMetrics;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  failed_at?: string;
  summary?: string;
  error?: string;
}
```

Extend `MessageView`:

```ts
export interface MessageView {
  message_id?: string;
  actor_id: string;
  text: string;
  kind: string;
  created_at: string;
  collection_id?: string;
  cancelledMessageCount?: number;
  claudeImportId?: string;
  claudeSessionId?: string;
  claudeSourceKind?: string;
}
```

Extend `RoomViewState`:

```ts
claudeSessionCatalog?: ClaudeSessionCatalogView;
claudeSessionSelection?: ClaudeSessionSelectionView;
claudeImports: ClaudeImportView[];
claudeRuntimeStatuses: ClaudeRuntimeStatusView[];
```

- [ ] **Step 3: Derive catalog, selection, imports, and statuses**

Inside `deriveRoomState`, initialize:

```ts
let claudeSessionCatalog: ClaudeSessionCatalogView | undefined;
let claudeSessionSelection: ClaudeSessionSelectionView | undefined;
const claudeImports = new Map<string, ClaudeImportView>();
const claudeRuntimeStatuses = new Map<string, ClaudeRuntimeStatusView>();
```

In the first full `for (const event of events)` loop, add:

```ts
if (event.type === "claude.session_catalog.updated" && typeof event.payload.agent_id === "string" && typeof event.payload.working_dir === "string" && Array.isArray(event.payload.sessions)) {
  claudeSessionCatalog = {
    agent_id: event.payload.agent_id,
    working_dir: event.payload.working_dir,
    sessions: event.payload.sessions as ClaudeSessionSummary[]
  };
}
if (event.type === "claude.session_selected" && typeof event.payload.agent_id === "string" && typeof event.payload.mode === "string" && typeof event.payload.selected_by === "string") {
  if (event.payload.mode === "fresh") {
    claudeSessionSelection = { agent_id: event.payload.agent_id, mode: "fresh", selected_by: event.payload.selected_by };
  }
  if (event.payload.mode === "resume" && typeof event.payload.session_id === "string") {
    claudeSessionSelection = { agent_id: event.payload.agent_id, mode: "resume", session_id: event.payload.session_id, selected_by: event.payload.selected_by };
  }
}
```

In the `scopedEvents` loop before `message.created`, add import/status handling:

```ts
if (event.type === "claude.session_import.started" && typeof event.payload.import_id === "string" && typeof event.payload.agent_id === "string" && typeof event.payload.session_id === "string" && typeof event.payload.title === "string") {
  claudeImports.set(event.payload.import_id, {
    import_id: event.payload.import_id,
    agent_id: event.payload.agent_id,
    session_id: event.payload.session_id,
    title: event.payload.title,
    message_count: typeof event.payload.message_count === "number" ? event.payload.message_count : 0,
    status: "started"
  });
  messages.push({
    message_id: `claude-import-banner-${event.payload.import_id}`,
    actor_id: "system",
    text: "__CLAUDE_IMPORT_BANNER__",
    kind: "claude_import_banner",
    created_at: event.created_at,
    claudeImportId: event.payload.import_id,
    claudeSessionId: event.payload.session_id
  });
}
if (event.type === "claude.session_import.message" && typeof event.payload.import_id === "string" && typeof event.payload.session_id === "string" && typeof event.payload.text === "string") {
  messages.push({
    message_id: `claude-import-${event.payload.import_id}-${typeof event.payload.sequence === "number" ? event.payload.sequence : messages.length}`,
    actor_id: typeof event.payload.agent_id === "string" ? event.payload.agent_id : event.actor_id,
    text: event.payload.text,
    kind: `claude_import_${typeof event.payload.author_role === "string" ? event.payload.author_role : "system"}`,
    created_at: typeof event.payload.original_created_at === "string" ? event.payload.original_created_at : event.created_at,
    claudeImportId: event.payload.import_id,
    claudeSessionId: event.payload.session_id,
    claudeSourceKind: typeof event.payload.source_kind === "string" ? event.payload.source_kind : undefined
  });
}
if (event.type === "claude.session_import.completed" && typeof event.payload.import_id === "string") {
  const existing = claudeImports.get(event.payload.import_id);
  if (existing) claudeImports.set(event.payload.import_id, {
    ...existing,
    status: "completed",
    imported_message_count: typeof event.payload.imported_message_count === "number" ? event.payload.imported_message_count : existing.message_count
  });
}
if (event.type === "claude.session_import.failed" && typeof event.payload.import_id === "string") {
  const existing = claudeImports.get(event.payload.import_id);
  if (existing) claudeImports.set(event.payload.import_id, {
    ...existing,
    status: "failed",
    error: typeof event.payload.error === "string" ? event.payload.error : "Import failed"
  });
}
if (event.type === "claude.runtime.status_changed" && typeof event.payload.turn_id === "string" && typeof event.payload.status_id === "string") {
  claudeRuntimeStatuses.set(event.payload.status_id, event.payload as unknown as ClaudeRuntimeStatusView);
}
if (event.type === "claude.runtime.status_completed" && typeof event.payload.status_id === "string") {
  const existing = claudeRuntimeStatuses.get(event.payload.status_id);
  if (existing) claudeRuntimeStatuses.set(event.payload.status_id, {
    ...existing,
    phase: "completed",
    summary: typeof event.payload.summary === "string" ? event.payload.summary : "Claude Code completed",
    completed_at: typeof event.payload.completed_at === "string" ? event.payload.completed_at : event.created_at
  });
}
if (event.type === "claude.runtime.status_failed" && typeof event.payload.status_id === "string") {
  const existing = claudeRuntimeStatuses.get(event.payload.status_id);
  if (existing) claudeRuntimeStatuses.set(event.payload.status_id, {
    ...existing,
    phase: "failed",
    error: typeof event.payload.error === "string" ? event.payload.error : "Claude Code failed",
    failed_at: typeof event.payload.failed_at === "string" ? event.payload.failed_at : event.created_at
  });
}
```

In the returned state, add:

```ts
claudeSessionCatalog,
claudeSessionSelection,
claudeImports: [...claudeImports.values()],
claudeRuntimeStatuses: [...claudeRuntimeStatuses.values()]
```

- [ ] **Step 4: Run Web room-state tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts
```

Expected:

```text
PASS packages/web/test/room-state.test.ts
```

- [ ] **Step 5: Commit Task 7**

Run:

```powershell
git add packages/web/src/room-state.ts packages/web/test/room-state.test.ts
git commit -m "feat(web): derive Claude session room state"
```

---

## Task 8: Build Web Claude session picker and rolling status card

**Files:**
- Modify `packages/web/src/api.ts`
- Add `packages/web/src/components/ClaudeSessionPicker.tsx`
- Add `packages/web/src/components/ClaudeStatusCard.tsx`
- Modify `packages/web/src/components/Workspace.tsx`
- Modify `packages/web/src/components/Thread.tsx`
- Modify `packages/web/src/components/Landing.tsx`
- Modify `packages/web/src/i18n/messages.en.json`
- Modify `packages/web/src/i18n/messages.zh.json`
- Add `packages/web/test/claude-session-picker.test.tsx`
- Add `packages/web/test/claude-status-card.test.tsx`
- Modify `packages/web/test/landing-connector.test.tsx`
- Modify `packages/web/test/landing-llm-agent.test.tsx`
- Modify `packages/web/test/i18n.test.ts`

- [ ] **Step 1: Add API helper**

In `packages/web/src/api.ts`, add:

```ts
export async function selectClaudeSession(input: {
  serverUrl: string;
  roomId: string;
  token: string;
  agentId: string;
  mode: "fresh" | "resume";
  sessionId?: string;
}): Promise<{ ok: true }> {
  const response = await fetch(`${input.serverUrl}/rooms/${input.roomId}/claude/session-selection`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`
    },
    body: JSON.stringify({
      agent_id: input.agentId,
      mode: input.mode,
      ...(input.mode === "resume" ? { session_id: input.sessionId } : {})
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return await response.json() as { ok: true };
}
```

- [ ] **Step 2: Add failing picker test**

Create `packages/web/test/claude-session-picker.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSessionPicker } from "../src/components/ClaudeSessionPicker.js";

describe("ClaudeSessionPicker", () => {
  it("warns before uploading a full Claude session and selects resume", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <ClaudeSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        catalog={{
          agent_id: "agent_1",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Planning",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-04-29T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true
          }]
        }}
        selection={undefined}
        onSelect={onSelect}
      />
    );

    expect(screen.getByText(/Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Resume Planning/ }));
    expect(screen.getByText(/upload the complete selected Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm upload and resume/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ mode: "resume", sessionId: "session_1" }));
  });
});
```

- [ ] **Step 3: Implement session picker**

Create `packages/web/src/components/ClaudeSessionPicker.tsx`:

```tsx
import { useState } from "react";
import type { ClaudeSessionCatalogView, ClaudeSessionSelectionView } from "../room-state.js";

interface Props {
  canManageRoom: boolean;
  agentId: string;
  catalog?: ClaudeSessionCatalogView;
  selection?: ClaudeSessionSelectionView;
  onSelect(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void>;
}

export function ClaudeSessionPicker({ canManageRoom, agentId, catalog, selection, onSelect }: Props) {
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!canManageRoom || selection || !catalog || catalog.agent_id !== agentId) return null;
  const latest = catalog.sessions[0];
  const pending = pendingSessionId ? catalog.sessions.find((session) => session.session_id === pendingSessionId) : undefined;

  async function submit(selectionInput: { mode: "fresh" } | { mode: "resume"; sessionId: string }) {
    setBusy(true);
    try {
      await onSelect(selectionInput);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="claude-session-picker" aria-label="Claude Code session setup">
      <div>
        <p className="eyebrow">Claude Code session</p>
        <h2>Choose how Claude joins this room</h2>
        <p>Connector working directory: <code>{catalog.working_dir}</code></p>
      </div>
      <div className="claude-session-actions">
        <button type="button" disabled={busy} onClick={() => submit({ mode: "fresh" })}>Start fresh</button>
        {latest ? <button type="button" disabled={busy || !latest.importable} onClick={() => setPendingSessionId(latest.session_id)}>Resume latest: {latest.title}</button> : null}
      </div>
      {catalog.sessions.length ? (
        <ul className="claude-session-list">
          {catalog.sessions.map((session) => (
            <li key={session.session_id}>
              <span>{session.title}</span>
              <span>{session.message_count} messages · {Math.round(session.byte_size / 1024)} KB</span>
              <button type="button" disabled={busy || !session.importable} onClick={() => setPendingSessionId(session.session_id)}>Resume {session.title}</button>
            </li>
          ))}
        </ul>
      ) : <p>No existing Claude Code sessions were detected for this project. Start fresh to continue.</p>}
      {pending ? (
        <div className="claude-session-confirm" role="dialog" aria-modal="true" aria-label="Confirm Claude session upload">
          <p>This will upload the complete selected Claude Code session to the CACP room. All room members can view it. Continue?</p>
          <button type="button" disabled={busy} onClick={() => submit({ mode: "resume", sessionId: pending.session_id })}>Confirm upload and resume</button>
          <button type="button" disabled={busy} onClick={() => setPendingSessionId(undefined)}>Cancel</button>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Add failing status card test**

Create `packages/web/test/claude-status-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeStatusCard } from "../src/components/ClaudeStatusCard.js";

describe("ClaudeStatusCard", () => {
  it("renders one rolling card with bounded recent status entries", () => {
    render(
      <ClaudeStatusCard
        status={{
          agent_id: "agent_1",
          turn_id: "turn_1",
          status_id: "status_turn_1",
          phase: "reading_files",
          current: "Reading packages/server/src/pairing.ts",
          recent: Array.from({ length: 12 }, (_, index) => `step ${index}`),
          metrics: { files_read: 3, searches: 1, commands: 0 },
          started_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:00:10.000Z"
        }}
      />
    );

    expect(screen.getByText(/Reading packages\/server\/src\/pairing.ts/)).toBeInTheDocument();
    expect(screen.getByText(/read 3 files/)).toBeInTheDocument();
    expect(screen.queryByText("step 0")).not.toBeInTheDocument();
    expect(screen.getByText("step 11")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement status card**

Create `packages/web/src/components/ClaudeStatusCard.tsx`:

```tsx
import type { ClaudeRuntimeStatusView } from "../room-state.js";

const phaseLabels: Record<string, string> = {
  connecting: "Connecting",
  resuming_session: "Resuming session",
  importing_session: "Importing session",
  thinking: "Thinking",
  reading_files: "Reading files",
  searching: "Searching",
  running_command: "Running command",
  waiting_for_approval: "Waiting for approval",
  generating_answer: "Generating answer",
  completed: "Completed",
  failed: "Failed"
};

export function ClaudeStatusCard({ status }: { status: ClaudeRuntimeStatusView }) {
  const recent = status.recent.slice(-5);
  const metrics = [
    status.metrics.files_read ? `read ${status.metrics.files_read} files` : "",
    status.metrics.searches ? `searched ${status.metrics.searches} times` : "",
    status.metrics.commands ? `ran ${status.metrics.commands} commands` : ""
  ].filter(Boolean).join(" · ");
  return (
    <section className={`claude-status-card claude-status-card--${status.phase}`} aria-label="Claude Code work status">
      <div className="claude-status-card__header">
        <strong>{phaseLabels[status.phase] ?? status.phase}</strong>
        {metrics ? <span>{metrics}</span> : null}
      </div>
      <p>{status.summary ?? status.error ?? status.current}</p>
      {recent.length ? (
        <ol>
          {recent.map((item, index) => <li key={`${status.status_id}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Integrate picker and card into Workspace**

In `packages/web/src/components/Workspace.tsx`, import:

```tsx
import { selectClaudeSession } from "../api.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";
```

Near the top of the room body, render:

```tsx
<ClaudeSessionPicker
  canManageRoom={currentParticipant?.role === "owner" || currentParticipant?.role === "admin"}
  agentId={state.activeAgentId ?? ""}
  catalog={state.claudeSessionCatalog}
  selection={state.claudeSessionSelection}
  onSelect={(selection) => selectClaudeSession({
    serverUrl,
    roomId,
    token,
    agentId: state.activeAgentId ?? "",
    mode: selection.mode,
    sessionId: selection.mode === "resume" ? selection.sessionId : undefined
  })}
/>
{state.claudeRuntimeStatuses.map((status) => (
  <ClaudeStatusCard key={status.status_id} status={status} />
))}
```

Use the exact prop names already available in `Workspace.tsx`; if they differ, map existing `roomId`, `token`, `serverUrl`, and `currentParticipant` variables to the snippet above.

- [ ] **Step 7: Render imported messages and banner in Thread**

In `packages/web/src/components/Thread.tsx`, add cases:

```tsx
if (message.kind === "claude_import_banner") {
  return (
    <div key={message.message_id} className="message message--claude-import-banner">
      Imported Claude Code session history · shared with all room members
    </div>
  );
}

if (message.kind.startsWith("claude_import_")) {
  return (
    <article key={message.message_id} className={`message message--${message.kind}`}>
      <div className="message__meta">
        <span>{message.kind === "claude_import_user" ? "Claude session user" : message.kind === "claude_import_assistant" ? "Claude Code" : "Claude session tool"}</span>
        <span>Imported</span>
      </div>
      <div className="message__body">{message.text}</div>
    </article>
  );
}
```

Place this before the normal human/agent message rendering branch.

- [ ] **Step 8: Remove generic command choices from Landing**

In `packages/web/src/components/Landing.tsx`, remove local agent options for:

- Codex CLI Agent
- opencode CLI Agent
- Echo Test Agent
- custom/generic command copy

Keep:

- Claude Code Agent
- LLM API Agent
- OpenAI-compatible LLM API Agent
- Anthropic-compatible LLM API Agent

Update tests in `packages/web/test/landing-connector.test.tsx`:

```tsx
expect(screen.getByText(/Claude Code Agent/)).toBeInTheDocument();
expect(screen.queryByText(/Codex CLI Agent/)).not.toBeInTheDocument();
expect(screen.queryByText(/opencode CLI Agent/)).not.toBeInTheDocument();
expect(screen.queryByText(/Echo Test Agent/)).not.toBeInTheDocument();
```

- [ ] **Step 9: Add i18n strings**

Add English strings to `packages/web/src/i18n/messages.en.json`:

```json
{
  "claude.session.title": "Claude Code session",
  "claude.session.startFresh": "Start fresh",
  "claude.session.resumeLatest": "Resume latest",
  "claude.session.confirmUpload": "This will upload the complete selected Claude Code session to the CACP room. All room members can view it. Continue?",
  "claude.status.title": "Claude Code work status"
}
```

Add Chinese strings to `packages/web/src/i18n/messages.zh.json`:

```json
{
  "claude.session.title": "Claude Code 会话",
  "claude.session.startFresh": "开启新会话",
  "claude.session.resumeLatest": "恢复最新会话",
  "claude.session.confirmUpload": "这会把所选 Claude Code 会话完整上传到 CACP 房间，所有房间成员都可以查看。是否继续？",
  "claude.status.title": "Claude Code 工作状态"
}
```

Merge into existing JSON objects without duplicating top-level braces.

- [ ] **Step 10: Run Web tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- claude-session-picker.test.tsx claude-status-card.test.tsx room-state.test.ts landing-connector.test.tsx landing-llm-agent.test.tsx i18n.test.ts
```

Expected:

```text
PASS packages/web/test/claude-session-picker.test.tsx
PASS packages/web/test/claude-status-card.test.tsx
PASS packages/web/test/room-state.test.ts
PASS packages/web/test/landing-connector.test.tsx
PASS packages/web/test/landing-llm-agent.test.tsx
PASS packages/web/test/i18n.test.ts
```

- [ ] **Step 11: Commit Task 8**

Run:

```powershell
git add packages/web/src/api.ts packages/web/src/room-state.ts packages/web/src/components/ClaudeSessionPicker.tsx packages/web/src/components/ClaudeStatusCard.tsx packages/web/src/components/Workspace.tsx packages/web/src/components/Thread.tsx packages/web/src/components/Landing.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test
git commit -m "feat(web): add Claude session setup and status UI"
```

---

## Task 9: Documentation cleanup and product boundary update

**Files:**
- Modify `README.md`
- Modify `README.zh-CN.md` if present
- Modify relevant docs under `docs/`
- Remove or rewrite generic command-agent examples

- [ ] **Step 1: Find generic command-agent references**

Run:

```powershell
Select-String -Path README.md,README.zh-CN.md,docs\*.md,docs\**\*.md -Pattern "Codex|opencode|Echo|generic CLI|command agent|--no-session-persistence|chat.md" -CaseSensitive:$false
```

Expected before cleanup: references exist for older local command-agent docs and `chat.md`.

- [ ] **Step 2: Update README product description**

In `README.md`, replace generic local-agent wording with:

```md
CACP is a local-first collaborative AI room. The public server hosts room state and the Web UI; agent execution stays local through the Local Connector.

Local execution is Claude Code-first:

- Claude Code runs in the owner's project directory through the Local Connector.
- The connector can start fresh or resume a detected Claude Code session.
- Resumed Claude Code session history is uploaded into the shared room timeline only after the room owner confirms.
- Imported Claude Code history is visible to all room members and should be treated as shared room content.

Pure conversation LLM API agents remain supported for OpenAI-compatible and Anthropic-compatible providers. API keys stay local to the connector and are validated before pairing.
```

- [ ] **Step 3: Update Chinese README**

If `README.zh-CN.md` exists, add:

```md
CACP 是一个本地优先的多人协作 AI 房间。公共服务器只承载房间状态和 Web UI；智能体执行仍然通过本地连接器在用户机器上完成。

本地执行以 Claude Code 为核心：

- Claude Code 通过本地连接器运行在房主选择的项目目录中。
- 连接器可以开启新会话，也可以恢复检测到的 Claude Code 会话。
- 只有房主确认后，恢复的 Claude Code 会话历史才会上传到共享房间时间线。
- 导入的 Claude Code 历史对所有房间成员可见，应视为共享房间内容。

LLM API 智能体仍然保留，适用于纯对话场景。API Key 只保存在本地连接器中，并在配对前进行连通性验证。
```

- [ ] **Step 4: Update protocol docs**

In the protocol document, add a concise event table:

```md
### Claude Code session events

| Event | Publisher | Visibility | Purpose |
| --- | --- | --- | --- |
| `claude.session_catalog.updated` | Local Connector | managers before selection | Metadata for detected local Claude sessions |
| `claude.session_selected` | owner/admin | all stream subscribers | Owner choice to start fresh or resume |
| `claude.session_import.started` | Local Connector | all members | Start of full shared session import |
| `claude.session_import.message` | Local Connector | all members | One visible imported transcript item |
| `claude.session_import.completed` | Local Connector | all members | Import completed marker |
| `claude.session_import.failed` | Local Connector | all members | Import failure marker |
| `claude.runtime.status_changed` | Local Connector | all members | Rolling status-card update |
| `claude.runtime.status_completed` | Local Connector | all members | Rolling status-card completion |
| `claude.runtime.status_failed` | Local Connector | all members | Rolling status-card failure |
```

Add a warning:

```md
Imported Claude Code session history may contain local paths, code snippets, command output, logs, and business context. The owner must confirm before upload, and all room members can view the imported history after upload.
```

- [ ] **Step 5: Remove outdated generic examples**

For docs/examples that only show Codex/opencode/Echo/generic command adapters:

```powershell
git rm <path-to-obsolete-example>
```

For docs that also contain current LLM API or Claude Code content, edit them instead of deleting.

- [ ] **Step 6: Verify cleanup**

Run:

```powershell
Select-String -Path README.md,README.zh-CN.md,docs\*.md,docs\**\*.md -Pattern "Codex|opencode|Echo|generic CLI|--no-session-persistence" -CaseSensitive:$false
```

Expected:

```text
```

No matches for removed command-agent support. `chat.md` may appear only as an optional export/debug note and must not be described as Claude Code context storage.

- [ ] **Step 7: Commit Task 9**

Run:

```powershell
git add README.md README.zh-CN.md docs
git add -u docs
git commit -m "docs: describe Claude Code-first connector model"
```

---

## Task 10: End-to-end validation and final cleanup

**Files:**
- No planned source files. This task validates all previous work and fixes only failures found by the commands below.

- [ ] **Step 1: Run full package checks**

Run:

```powershell
corepack pnpm check
```

Expected:

```text
... vitest ...
... tsc ...
Done
```

- [ ] **Step 2: Run targeted grep checks**

Run:

```powershell
Select-String -Path packages\**\*.ts,packages\**\*.tsx,packages\**\*.json,README.md,docs\**\*.md -Pattern "--no-session-persistence|Codex CLI Agent|opencode CLI Agent|Echo Test Agent" -CaseSensitive:$false
```

Expected: no matches.

Run:

```powershell
Select-String -Path packages\cli-adapter\src\*.ts,packages\cli-adapter\src\**\*.ts -Pattern "runCommandForTask|ChatTranscriptWriter" -CaseSensitive:$false
```

Expected: no matches in the active connector runtime. If `ChatTranscriptWriter` remains as an export/debug module, it must not be imported by `index.ts`.

- [ ] **Step 3: Manual smoke test with a real Claude Code install**

Terminal A:

```powershell
corepack pnpm dev:server
```

Terminal B:

```powershell
corepack pnpm dev:web
```

Browser:

```text
Open http://127.0.0.1:5173
Create room
Select Claude Code Agent
Copy connection code
```

Terminal C in the project directory:

```powershell
Set-Location D:\Development\2
corepack pnpm --filter @cacp/cli-adapter dev -- --connect <connection_code>
```

Expected in connector:

```text
Registered Claude Code Agent as agent_...
Connected adapter stream for room room_...
Claude Code session selection is pending in the web room.
```

Expected in Web:

```text
Claude Code session picker appears for owner/admin.
Start fresh and resume options are visible if sessions are found.
Generic Codex/opencode/Echo options are absent.
```

- [ ] **Step 4: Manual smoke test for resume/import**

In Web:

```text
Click Resume latest or choose a listed session.
Read the upload warning.
Confirm upload and resume.
```

Expected:

```text
Imported Claude Code session banner appears in the main chat timeline.
Imported user/assistant/tool messages appear before new room messages.
All room members, including a newly joined member, can see the imported history.
```

- [ ] **Step 5: Manual smoke test for one rolling status card**

Send a new room message that triggers Claude:

```text
请检查当前项目的 server pairing 逻辑，并总结是否还存在 generic command agent 支持。
```

Expected:

```text
One Claude Code work status card appears.
The card updates in place as Claude thinks/reads/searches/generates.
The main chat timeline does not receive one status message per state.
Claude's final answer appears as a normal agent message below the status card.
```

- [ ] **Step 6: Manual smoke test for LLM API agents**

Create a second room using OpenAI-compatible or Anthropic-compatible LLM API agent.

Expected:

```text
Provider setup still validates before pairing.
LLM API response streams into the room.
No Claude session picker is shown for LLM API agents.
No local command/task execution UI is shown for LLM API agents.
```

- [ ] **Step 7: Inspect git status**

Run:

```powershell
git status --short
```

Expected:

```text
```

No untracked or unstaged files except intentionally local ignored artifacts such as `.env`, `.deploy/*`, or local logs.

- [ ] **Step 8: Final commit for validation fixes**

If Step 1-7 required fixes after Task 9, commit them:

```powershell
git add <fixed-files>
git commit -m "fix: stabilize Claude Code persistent session room"
```

If there were no fixes, skip this commit.

---

## Implementation order and review checkpoints

Use this order:

1. Task 1: agent support lock.
2. Task 2: protocol events.
3. Task 3: server routes.
4. Task 4: connector SDK/catalog/import boundary.
5. Task 5: connector persistent runtime.
6. Task 6: connector integration.
7. Task 7: Web room-state derivation.
8. Task 8: Web UI.
9. Task 9: docs cleanup.
10. Task 10: validation.

Review after each commit:

- Does the code still preserve the local-first boundary?
- Did this task accidentally remove LLM API support?
- Did this task add any server-side API key or server-side Claude execution?
- Did this task reintroduce Codex/opencode/Echo as a product option?
- Did this task make `chat.md` a Claude context requirement again?
- Does the status behavior update one card instead of appending many chat messages?

---

## Self-review checklist

- Spec coverage:
  - Claude Code-first local command model is covered in Tasks 1, 6, and 9.
  - LLM API support is preserved in Tasks 1, 6, 8, and 10.
  - Persistent Claude runtime is covered in Tasks 4, 5, and 6.
  - Startup catalog and owner selection are covered in Tasks 3, 4, 6, and 8.
  - Complete session import into Web timeline is covered in Tasks 2, 3, 4, 6, 7, and 8.
  - Rolling status card is covered in Tasks 2, 3, 5, 6, 7, and 8.
  - `chat.md` downgrade is covered in Tasks 6 and 9.
  - Existing normal chat/Roundtable behavior is intentionally not redesigned.
- Placeholder scan:
  - No implementation step depends on a named future decision.
  - Every route, event name, file path, test command, and commit command is specified.
- Type consistency:
  - Protocol event payload names use `agent_id`, `session_id`, `import_id`, `turn_id`, `status_id`.
  - Web state names mirror protocol payload names.
  - Connector SDK wrapper hides unstable Claude SDK names behind `ClaudeSdk`.
- Operational guardrails:
  - Server never reads local Claude files.
  - Connector publishes catalog/import/status only as the paired agent.
  - Owner/admin explicitly selects session and confirms import in Web UI.
  - Imported Claude history is shared with all room members.
