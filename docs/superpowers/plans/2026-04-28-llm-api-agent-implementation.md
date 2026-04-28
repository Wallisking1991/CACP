# LLM API Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI-compatible and Anthropic-compatible pure conversation agents to CACP Local Connector with local-only console API configuration, pre-claim connectivity validation, and streamed room output.

**Architecture:** Keep one Local Connector package and split it internally into command and LLM API runners. Server owns room pairing, active-agent selection, and turn event endpoints; connector owns provider settings, connectivity validation, streaming provider calls, and sanitized error reporting. Web only selects agent type and never handles provider secrets.

**Tech Stack:** TypeScript, Node 20 fetch/ReadableStream, Fastify, SQLite, Zod, React/Vite, Vitest, pnpm.

---

## File Structure Map

- `packages/server/src/pairing.ts`: command vs LLM agent type constants, pure LLM profile builder, LLM type guard.
- `packages/server/src/event-store.ts`: SQLite `agent_pairings.agent_type` schema and migration for new values.
- `packages/server/src/server.ts`: pairing schemas, connection-code generation, local auto-launch via `--connect <connection_code>`.
- `packages/web/src/components/Landing.tsx`: grouped agent selector and hidden permission UI for LLM API agents.
- `packages/web/src/i18n/messages.en.json`, `messages.zh.json`: new labels and local-only API-key copy.
- `packages/cli-adapter/src/config.ts`: detect LLM connection codes, run console config before claim, return optional `llm` runtime config.
- `packages/cli-adapter/src/llm/types.ts`: provider config and LLM agent helpers.
- `packages/cli-adapter/src/llm/sse.ts`: SSE parsing utilities.
- `packages/cli-adapter/src/llm/sanitize.ts`: secret-safe error formatting.
- `packages/cli-adapter/src/llm/openai-compatible.ts`: OpenAI-compatible streaming and validation.
- `packages/cli-adapter/src/llm/anthropic-compatible.ts`: Anthropic-compatible streaming and validation.
- `packages/cli-adapter/src/llm/config-wizard.ts`: console wizard with retry/cancel.
- `packages/cli-adapter/src/llm/runner.ts`: provider dispatch for `agent.turn.requested`.
- `.gitignore`: ignore `docs/examples/*.local.md`.

---

## Task 1: Server LLM API agent types and connection-code launch

**Files:**
- Modify: `packages/server/src/pairing.ts`
- Modify: `packages/server/src/event-store.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/test/pairing.test.ts`
- Modify: `packages/server/test/connection-code-server.test.ts`
- Modify: `packages/server/test/event-store.test.ts`

- [ ] **Step 1: Write failing pairing tests**

Append to `packages/server/test/pairing.test.ts`:

```ts
import { AgentTypeValues, buildAgentProfile, isLlmAgentType } from "../src/pairing.js";

it("declares LLM API agent types", () => {
  expect(AgentTypeValues).toContain("llm-openai-compatible");
  expect(AgentTypeValues).toContain("llm-anthropic-compatible");
  expect(isLlmAgentType("llm-openai-compatible")).toBe(true);
  expect(isLlmAgentType("llm-anthropic-compatible")).toBe(true);
  expect(isLlmAgentType("codex")).toBe(false);
});

it("builds pure conversation profiles for LLM API agents", () => {
  const openai = buildAgentProfile({ agentType: "llm-openai-compatible", permissionLevel: "read_only", workingDir: "." });
  const anthropic = buildAgentProfile({ agentType: "llm-anthropic-compatible", permissionLevel: "full_access", workingDir: "." });

  expect(openai.command).toBe("");
  expect(openai.args).toEqual([]);
  expect(openai.capabilities).toEqual(["llm.api", "chat.stream", "llm.openai_compatible"]);
  expect(openai.capabilities).not.toContain("read_only");
  expect(anthropic.command).toBe("");
  expect(anthropic.args).toEqual([]);
  expect(anthropic.capabilities).toEqual(["llm.api", "chat.stream", "llm.anthropic_compatible"]);
  expect(anthropic.capabilities).not.toContain("full_access");
});
```

- [ ] **Step 2: Write failing server pairing tests**

Append to `packages/server/test/connection-code-server.test.ts`:

```ts
it("returns LLM API agent type in connection codes", async () => {
  const app = await buildServer({ dbPath: ":memory:" });
  const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-pairings`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { agent_type: "llm-openai-compatible", permission_level: "read_only", working_dir: ".", server_url: "http://127.0.0.1:3737" }
  });

  expect(response.statusCode).toBe(201);
  const parsed = parseConnectionCode((response.json() as { connection_code: string }).connection_code);
  expect(parsed.agent_type).toBe("llm-openai-compatible");
  await app.close();
});

it("local launch passes --connect so LLM configuration can happen before claim", async () => {
  const launches: Array<{ args: string[] }> = [];
  const app = await buildServer({ dbPath: ":memory:", localAgentLauncher: (input) => { launches.push({ args: input.args }); return { pid: 1234 }; } });
  const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agent-pairings/start-local`,
    headers: { authorization: `Bearer ${room.owner_token}`, host: "127.0.0.1:3737" },
    payload: { agent_type: "llm-anthropic-compatible", permission_level: "read_only", working_dir: ".", server_url: "http://127.0.0.1:3737" }
  });

  expect(response.statusCode).toBe(201);
  const connectIndex = launches[0].args.indexOf("--connect");
  expect(connectIndex).toBeGreaterThanOrEqual(0);
  expect(parseConnectionCode(launches[0].args[connectIndex + 1]).agent_type).toBe("llm-anthropic-compatible");
  expect(launches[0].args).not.toContain("--pair");
  await app.close();
});
```

- [ ] **Step 3: Write failing EventStore test**

Append to `packages/server/test/event-store.test.ts` and import `EventStore` if needed:

```ts
it("persists LLM API agent pairings", () => {
  const store = new EventStore(":memory:");
  try {
    const stored = store.createAgentPairing({
      pairing_id: "pair_llm",
      room_id: "room_llm",
      token_hash: "sha256:abc",
      created_by: "user_owner",
      agent_type: "llm-openai-compatible",
      permission_level: "read_only",
      working_dir: ".",
      created_at: "2026-04-28T00:00:00.000Z",
      expires_at: "2026-04-28T00:15:00.000Z"
    });
    expect(stored.agent_type).toBe("llm-openai-compatible");
  } finally {
    store.close();
  }
});
```

- [ ] **Step 4: Run failing tests**

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts
```

Expected: FAIL because new agent types and `--connect` local launch are not implemented.

- [ ] **Step 5: Implement server support**

In `packages/server/src/pairing.ts`, define LLM agent types and profiles:

```ts
export const CommandAgentTypeValues = ["claude-code", "codex", "opencode", "echo"] as const;
export const LlmAgentTypeValues = ["llm-openai-compatible", "llm-anthropic-compatible"] as const;
export const AgentTypeValues = [...CommandAgentTypeValues, ...LlmAgentTypeValues] as const;
export type AgentType = typeof AgentTypeValues[number];
export type LlmAgentType = typeof LlmAgentTypeValues[number];

export function isLlmAgentType(agentType: string): agentType is LlmAgentType {
  return (LlmAgentTypeValues as readonly string[]).includes(agentType);
}
```

At the start of `buildAgentProfile()`, add:

```ts
  if (input.agentType === "llm-openai-compatible") {
    return { name: "OpenAI-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.openai_compatible"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-anthropic-compatible") {
    return { name: "Anthropic-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.anthropic_compatible"], system_prompt: llmApiSystemPrompt() };
  }
```

Add `llmApiSystemPrompt()` near the other prompt helpers:

```ts
function llmApiSystemPrompt(): string {
  return [
    "You are an LLM API Agent connected to a CACP multi-user AI room.",
    "You are a pure conversation agent. Do not claim to read files, modify files, run local commands, call tools, or access private systems.",
    "If multiple participants need to answer separately or reach consensus, remind the room owner to use Roundtable Mode.",
    "Reply in concise, actionable Chinese by default unless the room context asks for another language."
  ].join("\n");
}
```

In `packages/server/src/event-store.ts`, update the `agent_pairings.agent_type` CHECK list to include both LLM values. Add a constructor migration call after table creation:

```ts
    this.migrateAgentPairingAgentTypes();
```

Add this method inside `EventStore`:

```ts
  private migrateAgentPairingAgentTypes(): void {
    const table = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_pairings'`).get() as { sql: string } | undefined;
    if (!table || table.sql.includes("llm-openai-compatible")) return;
    this.db.exec(`
      CREATE TABLE agent_pairings_next (
        pairing_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex', 'opencode', 'echo', 'llm-openai-compatible', 'llm-anthropic-compatible')),
        permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
        working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT
      );
      INSERT INTO agent_pairings_next SELECT pairing_id, room_id, token_hash, created_by, agent_type, permission_level, working_dir, created_at, expires_at, claimed_at FROM agent_pairings;
      DROP TABLE agent_pairings;
      ALTER TABLE agent_pairings_next RENAME TO agent_pairings;
      CREATE INDEX IF NOT EXISTS idx_agent_pairings_room ON agent_pairings(room_id);
    `);
  }
```

In `packages/server/src/server.ts`, change local launch helpers to connection-code helpers:

```ts
function pairingCommand(connectionCode: string): string {
  return `npx @cacp/cli-adapter --connect ${connectionCode}`;
}

function pairingLaunchArgs(connectionCode: string): string[] {
  return ["pnpm", "--filter", "@cacp/cli-adapter", "dev", "--", "--connect", connectionCode];
}
```

Update pairing creation so both cloud and local-launch paths build one connection code containing `agent_type` and pass that connection code to `pairingLaunchArgs()`.

- [ ] **Step 6: Run and commit**

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts
git add packages/server/src/pairing.ts packages/server/src/event-store.ts packages/server/src/server.ts packages/server/test/pairing.test.ts packages/server/test/connection-code-server.test.ts packages/server/test/event-store.test.ts
git commit -m "feat(server): support llm api agent pairings"
```

Expected: tests pass and commit succeeds.
---

## Task 2: Web create-room UI for LLM API agents

**Files:**
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Create: `packages/web/test/landing-llm-agent.test.tsx`
- Modify: `packages/web/test/landing-connector.test.tsx`

- [ ] **Step 1: Write failing Web tests**

Create `packages/web/test/landing-llm-agent.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

vi.mock("../src/runtime-config.js", () => ({ isCloudMode: () => false }));

describe("Landing LLM API agent setup", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows LLM API agent choices grouped with command agents", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    expect(screen.getByRole("group", { name: "Local command agents" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "LLM API agents" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenAI-compatible API" })).toHaveValue("llm-openai-compatible");
    expect(screen.getByRole("option", { name: "Anthropic-compatible API" })).toHaveValue("llm-anthropic-compatible");
  });

  it("hides permission selection and explains local API-key entry", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-openai-compatible" } });
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();
    expect(screen.getByText("API keys are entered only in the Local Connector console and are never sent to the room server.")).toBeInTheDocument();
  });

  it("submits read_only as server compatibility default for LLM API agents", () => {
    const onCreate = vi.fn();
    render(<LangProvider><Landing onCreate={onCreate} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-anthropic-compatible" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agentType: "llm-anthropic-compatible", permissionLevel: "read_only" }));
  });
});
```

Append to `packages/web/test/landing-connector.test.tsx`:

```tsx
  it("shows LLM connector instructions in cloud mode", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} loading={false} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-openai-compatible" } });
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();
    expect(screen.getByText("Download and run the connector, paste the connection code, then enter LLM API settings in the connector console.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run failing Web tests**

```powershell
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx
```

Expected: FAIL because the UI does not have LLM choices or copy.

- [ ] **Step 3: Implement Web UI changes**

In `packages/web/src/components/Landing.tsx`, replace `agentTypes` with:

```ts
const commandAgentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode" },
  { value: "codex", labelKey: "agentType.codex" },
  { value: "opencode", labelKey: "agentType.opencode" },
  { value: "echo", labelKey: "agentType.echo" }
] as const;

const llmAgentTypes = [
  { value: "llm-openai-compatible", labelKey: "agentType.llmOpenAiCompatible" },
  { value: "llm-anthropic-compatible", labelKey: "agentType.llmAnthropicCompatible" }
] as const;
const llmAgentTypeValues = new Set<string>(llmAgentTypes.map((item) => item.value));
```

After state declarations add:

```ts
  const selectedLlmApiAgent = llmAgentTypeValues.has(agentType);
```

In `handleCreateSubmit()`, submit:

```ts
      permissionLevel: selectedLlmApiAgent ? "read_only" : permissionLevel
```

Use grouped options:

```tsx
              <optgroup label={t("agentType.group.localCommand")}>
                {commandAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
              </optgroup>
              <optgroup label={t("agentType.group.llmApi")}>
                {llmAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
              </optgroup>
```

Render permission UI only when `!selectedLlmApiAgent`, and render this explanatory copy when selected:

```tsx
            {selectedLlmApiAgent && (
              <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "12px 0 0" }}>
                {t("landing.create.llmApiKeyLocalOnly")}
              </p>
            )}
```

In the cloud connector instruction paragraph use:

```tsx
{selectedLlmApiAgent ? t("landing.connector.llmInstructions") : t("landing.connector.instructions")}
```

- [ ] **Step 4: Add i18n messages**

Add to `packages/web/src/i18n/messages.en.json`:

```json
  "agentType.group.localCommand": "Local command agents",
  "agentType.group.llmApi": "LLM API agents",
  "agentType.llmOpenAiCompatible": "OpenAI-compatible API",
  "agentType.llmAnthropicCompatible": "Anthropic-compatible API",
  "landing.create.llmApiKeyLocalOnly": "API keys are entered only in the Local Connector console and are never sent to the room server.",
  "landing.connector.llmInstructions": "Download and run the connector, paste the connection code, then enter LLM API settings in the connector console.",
```

Add to `packages/web/src/i18n/messages.zh.json`:

```json
  "agentType.group.localCommand": "本地命令 Agent",
  "agentType.group.llmApi": "LLM API Agent",
  "agentType.llmOpenAiCompatible": "OpenAI-compatible API",
  "agentType.llmAnthropicCompatible": "Anthropic-compatible API",
  "landing.create.llmApiKeyLocalOnly": "API Key 只会在本地连接器控制台输入，不会发送到房间服务器。",
  "landing.connector.llmInstructions": "下载并运行连接器，粘贴连接码，然后在连接器控制台输入 LLM API 配置。",
```

- [ ] **Step 5: Run and commit**

```powershell
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx
git add packages/web/src/components/Landing.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/landing-llm-agent.test.tsx packages/web/test/landing-connector.test.tsx
git commit -m "feat(web): add llm api agent selection"
```

Expected: tests pass and commit succeeds.

---

## Task 3: LLM provider streaming runners and sanitization

**Files:**
- Create: `packages/cli-adapter/src/llm/types.ts`
- Create: `packages/cli-adapter/src/llm/sse.ts`
- Create: `packages/cli-adapter/src/llm/sanitize.ts`
- Create: `packages/cli-adapter/src/llm/openai-compatible.ts`
- Create: `packages/cli-adapter/src/llm/anthropic-compatible.ts`
- Create: `packages/cli-adapter/test/llm-sse.test.ts`
- Create: `packages/cli-adapter/test/llm-sanitize.test.ts`
- Create: `packages/cli-adapter/test/llm-openai-compatible.test.ts`
- Create: `packages/cli-adapter/test/llm-anthropic-compatible.test.ts`

- [ ] **Step 1: Write failing parser and sanitizer tests**

Create `packages/cli-adapter/test/llm-sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSseText } from "../src/llm/sse.js";

describe("SSE parser", () => {
  it("parses named and unnamed events", () => {
    expect(parseSseText("event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}\n\ndata: [DONE]\n\n")).toEqual([
      { event: "content_block_delta", data: "{\"delta\":{\"text\":\"hi\"}}" },
      { event: undefined, data: "[DONE]" }
    ]);
  });
});
```

Create `packages/cli-adapter/test/llm-sanitize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeLlmError } from "../src/llm/sanitize.js";

describe("LLM error sanitizer", () => {
  it("removes API keys and authorization headers", () => {
    const sanitized = sanitizeLlmError(new Error("Authorization: Bearer sk-secret failed for api_key sk-secret"), "sk-secret");
    expect(sanitized).toContain("Authorization: Bearer [redacted]");
    expect(sanitized).toContain("api_key [redacted]");
    expect(sanitized).not.toContain("sk-secret");
  });
});
```

- [ ] **Step 2: Write failing provider runner tests**

Create tests that mock `fetch` with `ReadableStream` SSE responses:

```ts
function streamResponse(text: string, status = 200, statusText = "OK"): Response {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }), { status, statusText, headers: { "content-type": "text/event-stream" } });
}
```

For `llm-openai-compatible.test.ts`, assert the runner posts to `baseUrl + "/chat/completions"`, sends `Authorization: Bearer <key>`, extracts `choices[0].delta.content`, returns `{ finalText: "Hello" }`, and validation returns `{ ok: true, sampleText: "ok" }`.

For `llm-anthropic-compatible.test.ts`, assert the runner posts to `baseUrl + "/messages"`, sends `x-api-key`, sends `anthropic-version: 2023-06-01`, extracts `content_block_delta` text deltas, returns `{ finalText: "Hello" }`, and validation returns `{ ok: true, sampleText: "ok" }`.

Use these two essential expectations in both files:

```ts
expect(chunks).toEqual(["Hel", "lo"]);
expect(result.finalText).toBe("Hello");
```

- [ ] **Step 3: Run failing LLM tests**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-sse.test.ts llm-sanitize.test.ts llm-openai-compatible.test.ts llm-anthropic-compatible.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement shared LLM files**

Create `types.ts` with:

```ts
export type LlmProvider = "openai-compatible" | "anthropic-compatible";
export type LlmAgentType = "llm-openai-compatible" | "llm-anthropic-compatible";
export interface LlmProviderConfig { provider: LlmProvider; baseUrl: string; model: string; apiKey: string; temperature: number; maxTokens: number }
export interface LlmRunOptions { config: LlmProviderConfig; prompt: string; systemPrompt?: string; fetchImpl?: typeof fetch; onDelta: (chunk: string) => void | Promise<void>; maxTokensOverride?: number }
export interface LlmRunResult { finalText: string }
export interface LlmConnectivityResult { ok: true; sampleText: string }
export function isLlmAgentType(agentType: string | undefined): agentType is LlmAgentType { return agentType === "llm-openai-compatible" || agentType === "llm-anthropic-compatible"; }
export function providerForAgentType(agentType: LlmAgentType): LlmProvider { return agentType === "llm-openai-compatible" ? "openai-compatible" : "anthropic-compatible"; }
export const DefaultLlmSystemPrompt = "You are an LLM API Agent connected to a CACP multi-user AI room. You are a pure conversation agent and must not claim to read files, write files, run commands, call tools, or access private systems.";
```

Create `sse.ts` with `parseSseText(text)` and `readResponseText(response)`.

Create `sanitize.ts` with `sanitizeLlmError(error, apiKey)` that redacts `Authorization: Bearer ...`, `api_key ...`, `x-api-key ...`, and direct occurrences of the API key.

Create `openai-compatible.ts` with:

```ts
export async function runOpenAiCompatibleChat(options: LlmRunOptions): Promise<LlmRunResult> {
  const response = await (options.fetchImpl ?? fetch)(`${options.config.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${options.config.apiKey}` },
    body: JSON.stringify({ model: options.config.model, messages: [{ role: "system", content: options.systemPrompt ?? DefaultLlmSystemPrompt }, { role: "user", content: options.prompt }], stream: true, temperature: options.config.temperature, max_tokens: options.maxTokensOverride ?? options.config.maxTokens })
  });
  if (!response.ok) throw await providerError(response, options.config.apiKey);
  let finalText = "";
  for (const event of parseSseText(await readResponseText(response))) {
    if (event.data === "[DONE]") break;
    const chunk = (JSON.parse(event.data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
    if (!chunk) continue;
    finalText += chunk;
    await options.onDelta(chunk);
  }
  if (!finalText) throw new Error("OpenAI-compatible stream completed without text output");
  return { finalText };
}
```

Also export `validateOpenAiCompatibleConnectivity(config, fetchImpl)` that calls the same runner with prompt `Connectivity test. Reply with a short OK.` and `maxTokensOverride: 16`.

Create `anthropic-compatible.ts` with the same structure, endpoint `/messages`, headers `x-api-key` and `anthropic-version`, body `system` plus `messages`, parsing `content_block_delta` events with `delta.type === "text_delta"`.

- [ ] **Step 5: Run and commit**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-sse.test.ts llm-sanitize.test.ts llm-openai-compatible.test.ts llm-anthropic-compatible.test.ts
git add packages/cli-adapter/src/llm packages/cli-adapter/test/llm-sse.test.ts packages/cli-adapter/test/llm-sanitize.test.ts packages/cli-adapter/test/llm-openai-compatible.test.ts packages/cli-adapter/test/llm-anthropic-compatible.test.ts
git commit -m "feat(connector): add llm api streaming runners"
```

Expected: tests pass and commit succeeds.
---

## Task 4: Console wizard and pre-claim runtime configuration

**Files:**
- Create: `packages/cli-adapter/src/llm/config-wizard.ts`
- Modify: `packages/cli-adapter/src/config.ts`
- Create: `packages/cli-adapter/test/llm-config-wizard.test.ts`
- Modify: `packages/cli-adapter/test/config.test.ts`

- [ ] **Step 1: Write failing wizard tests**

Create `packages/cli-adapter/test/llm-config-wizard.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { promptForLlmApiConfig } from "../src/llm/config-wizard.js";

describe("LLM API config wizard", () => {
  it("collects settings and validates before returning", async () => {
    const lines: string[] = [];
    const validate = vi.fn(async () => ({ ok: true as const, sampleText: "ok" }));
    const config = await promptForLlmApiConfig("llm-openai-compatible", {
      question: vi.fn().mockResolvedValueOnce("https://api.example.com/v1").mockResolvedValueOnce("model-a").mockResolvedValueOnce("0.2").mockResolvedValueOnce("256"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: (line) => lines.push(line)
    }, validate);
    expect(config).toEqual({ provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model-a", apiKey: "secret-key", temperature: 0.2, maxTokens: 256 });
    expect(validate).toHaveBeenCalledWith(config);
    expect(lines.join("\n")).toContain("LLM API connectivity test succeeded");
    expect(lines.join("\n")).not.toContain("secret-key");
  });

  it("prints sanitized validation failures and supports cancel", async () => {
    const lines: string[] = [];
    const validate = vi.fn(async () => { throw new Error("Status: 401 Unauthorized\nProvider error: invalid API key"); });
    const config = await promptForLlmApiConfig("llm-anthropic-compatible", {
      question: vi.fn().mockResolvedValueOnce("https://api.example.com/v1").mockResolvedValueOnce("model-a").mockResolvedValueOnce("").mockResolvedValueOnce(""),
      secret: vi.fn().mockResolvedValueOnce("bad-key"),
      chooseRetry: vi.fn().mockResolvedValueOnce(false),
      writeLine: (line) => lines.push(line)
    }, validate);
    expect(config).toBeUndefined();
    expect(lines.join("\n")).toContain("LLM API connectivity test failed.");
    expect(lines.join("\n")).not.toContain("bad-key");
  });
});
```

- [ ] **Step 2: Write failing pre-claim config tests**

Append to `packages/cli-adapter/test/config.test.ts`:

```ts
it("configures LLM API settings from connection code before claiming", async () => {
  const code = buildConnectionCode({ server_url: "https://cacp.example.com", pairing_token: "pair_llm", expires_at: "2026-04-28T08:15:00.000Z", agent_type: "llm-openai-compatible" });
  const callOrder: string[] = [];
  const fetchImpl = vi.fn(async () => {
    callOrder.push("claim");
    return new Response(JSON.stringify({ room_id: "room_1", agent_id: "agent_1", agent_token: "agent_token", agent: { name: "OpenAI-compatible LLM API Agent", command: "", args: [], working_dir: ".", capabilities: ["llm.api"] }, agent_type: "llm-openai-compatible" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const config = await loadRuntimeConfigFromArgs(["--connect", code], fetchImpl, {
    configureLlmAgent: async (agentType) => { callOrder.push(`configure:${agentType}`); return { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model-a", apiKey: "secret", temperature: 0.7, maxTokens: 1024 }; }
  });

  expect(callOrder).toEqual(["configure:llm-openai-compatible", "claim"]);
  expect(config.llm?.provider).toBe("openai-compatible");
  expect(config.agent.command).toBe("");
});

it("does not claim when LLM API configuration is cancelled", async () => {
  const code = buildConnectionCode({ server_url: "https://cacp.example.com", pairing_token: "pair_llm", expires_at: "2026-04-28T08:15:00.000Z", agent_type: "llm-anthropic-compatible" });
  const fetchImpl = vi.fn() as unknown as typeof fetch;
  await expect(loadRuntimeConfigFromArgs(["--connect", code], fetchImpl, { configureLlmAgent: async () => undefined })).rejects.toThrow("llm_api_configuration_cancelled");
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run failing tests**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-config-wizard.test.ts config.test.ts
```

Expected: FAIL because wizard and config options do not exist.

- [ ] **Step 4: Implement config wizard**

Create `packages/cli-adapter/src/llm/config-wizard.ts` with injectable prompts:

```ts
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { providerForAgentType, type LlmAgentType, type LlmConnectivityResult, type LlmProviderConfig } from "./types.js";
import { sanitizeLlmError } from "./sanitize.js";

export interface LlmConfigPrompter { question(prompt: string): Promise<string>; secret(prompt: string): Promise<string>; chooseRetry(prompt: string): Promise<boolean>; writeLine(line: string): void }
type ValidateLlmConfig = (config: LlmProviderConfig) => Promise<LlmConnectivityResult>;
function numberOrDefault(value: string, fallback: number): number { const parsed = Number(value.trim()); return Number.isFinite(parsed) ? parsed : fallback; }

export async function promptForLlmApiConfig(agentType: LlmAgentType, prompter: LlmConfigPrompter, validate: ValidateLlmConfig): Promise<LlmProviderConfig | undefined> {
  prompter.writeLine("This connection is for an LLM API Agent.");
  prompter.writeLine("Provider settings are required for this connector session.");
  prompter.writeLine("API keys stay on this machine and are never sent to the CACP room server.");
  while (true) {
    const baseUrl = (await prompter.question("Base URL: ")).trim();
    const model = (await prompter.question("Model: ")).trim();
    const apiKey = (await prompter.secret("API Key: ")).trim();
    const temperature = numberOrDefault(await prompter.question("Temperature [0.7]: "), 0.7);
    const maxTokens = Math.trunc(numberOrDefault(await prompter.question("Max tokens [1024]: "), 1024));
    const config = { provider: providerForAgentType(agentType), baseUrl, model, apiKey, temperature, maxTokens };
    try {
      const result = await validate(config);
      prompter.writeLine(`LLM API connectivity test succeeded. The agent will now connect to the room.${result.sampleText ? ` Sample: ${result.sampleText}` : ""}`);
      return config;
    } catch (cause) {
      prompter.writeLine("LLM API connectivity test failed.");
      prompter.writeLine(sanitizeLlmError(cause, apiKey));
      if (!(await prompter.chooseRetry("Re-enter LLM API settings? [Y/n]: "))) return undefined;
    }
  }
}

export function createConsolePrompter(): LlmConfigPrompter {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return {
    question: (prompt) => rl.question(prompt),
    secret: async (prompt) => {
      if (!defaultStdin.isTTY || !defaultStdin.setRawMode) { console.log("Warning: this terminal may echo input. Paste only in a trusted local console."); return await rl.question(prompt); }
      defaultStdout.write(prompt);
      defaultStdin.setRawMode(true);
      let value = "";
      return await new Promise<string>((resolve) => {
        const onData = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          if (text === "\r" || text === "\n" || text === "\r\n") { defaultStdin.setRawMode(false); defaultStdin.off("data", onData); defaultStdout.write("\n"); resolve(value); return; }
          if (text === "\b" || text === "\u007f") { value = value.slice(0, -1); return; }
          value += text;
        };
        defaultStdin.on("data", onData);
      });
    },
    chooseRetry: async (prompt) => { const answer = (await rl.question(prompt)).trim().toLowerCase(); return answer === "" || answer === "y" || answer === "yes"; },
    writeLine: (line) => console.log(line)
  };
}
```

- [ ] **Step 5: Implement pre-claim config flow**

In `packages/cli-adapter/src/config.ts`, add optional `llm` to `AdapterConfigSchema`, export `ConfigureLlmAgent`, and change `loadRuntimeConfigFromArgs(args, fetchImpl, options)` to accept a third `RuntimeConfigOptions` argument.

Use this logic for `prompt` and `connect` modes before `claimPairing()`:

```ts
    let llm: LlmProviderConfig | undefined;
    if (isLlmAgentType(payload.agent_type)) {
      llm = await (options.configureLlmAgent ?? defaultConfigureLlmAgent)(payload.agent_type);
      if (!llm) throw new Error("llm_api_configuration_cancelled");
    }
    return claimPairing(payload.server_url, payload.pairing_token, workingDir, fetchImpl, llm);
```

`defaultConfigureLlmAgent()` must call `promptForLlmApiConfig()` and dispatch validation:

```ts
async function defaultConfigureLlmAgent(agentType: LlmAgentType): Promise<LlmProviderConfig | undefined> {
  return await promptForLlmApiConfig(agentType, createConsolePrompter(), async (config) => {
    if (config.provider === "openai-compatible") return await validateOpenAiCompatibleConnectivity(config);
    return await validateAnthropicCompatibleConnectivity(config);
  });
}
```

- [ ] **Step 6: Run and commit**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-config-wizard.test.ts config.test.ts
git add packages/cli-adapter/src/llm/config-wizard.ts packages/cli-adapter/src/config.ts packages/cli-adapter/test/llm-config-wizard.test.ts packages/cli-adapter/test/config.test.ts
git commit -m "feat(connector): configure llm api before pairing claim"
```

Expected: tests pass and commit succeeds.

---

## Task 5: Route agent turns through the LLM API runner

**Files:**
- Create: `packages/cli-adapter/src/llm/runner.ts`
- Modify: `packages/cli-adapter/src/index.ts`
- Create: `packages/cli-adapter/test/llm-runner.test.ts`
- Modify: `packages/cli-adapter/test/index-source.test.ts`

- [ ] **Step 1: Write failing LLM runner tests**

Create `packages/cli-adapter/test/llm-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runLlmTurn } from "../src/llm/runner.js";

describe("LLM turn runner", () => {
  it("dispatches OpenAI-compatible turns", async () => {
    const runOpenAi = vi.fn(async (options: { onDelta: (chunk: string) => void }) => { options.onDelta("hi"); return { finalText: "hi" }; });
    const chunks: string[] = [];
    const result = await runLlmTurn({ llm: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 }, prompt: "room context", onDelta: (chunk) => chunks.push(chunk), runners: { runOpenAi, runAnthropic: vi.fn() } });
    expect(runOpenAi).toHaveBeenCalled();
    expect(chunks).toEqual(["hi"]);
    expect(result.finalText).toBe("hi");
  });
});
```

Append to `packages/cli-adapter/test/index-source.test.ts`:

```ts
  it("routes agent turns through the LLM runner when llm config exists", () => {
    expect(source()).toContain("runLlmTurn");
    expect(source()).toContain("if (config.llm)");
    expect(source()).toContain("/agent-turns/${payload.turn_id}/delta");
  });
```

- [ ] **Step 2: Run failing tests**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-runner.test.ts index-source.test.ts
```

Expected: FAIL because LLM runner and index wiring do not exist.

- [ ] **Step 3: Implement `runLlmTurn()`**

Create `packages/cli-adapter/src/llm/runner.ts`:

```ts
import { runAnthropicCompatibleMessages } from "./anthropic-compatible.js";
import { runOpenAiCompatibleChat } from "./openai-compatible.js";
import type { LlmProviderConfig, LlmRunResult } from "./types.js";

export interface LlmTurnRunners { runOpenAi: typeof runOpenAiCompatibleChat; runAnthropic: typeof runAnthropicCompatibleMessages }
export interface RunLlmTurnOptions { llm: LlmProviderConfig; prompt: string; systemPrompt?: string; onDelta: (chunk: string) => void | Promise<void>; runners?: LlmTurnRunners }

export async function runLlmTurn(options: RunLlmTurnOptions): Promise<LlmRunResult> {
  const runners = options.runners ?? { runOpenAi: runOpenAiCompatibleChat, runAnthropic: runAnthropicCompatibleMessages };
  if (options.llm.provider === "openai-compatible") return await runners.runOpenAi({ config: options.llm, prompt: options.prompt, systemPrompt: options.systemPrompt, onDelta: options.onDelta });
  return await runners.runAnthropic({ config: options.llm, prompt: options.prompt, systemPrompt: options.systemPrompt, onDelta: options.onDelta });
}
```

- [ ] **Step 4: Wire `index.ts`**

Import `runLlmTurn` in `packages/cli-adapter/src/index.ts`. Inside the `agent.turn.requested` branch, after `/start`, branch on `config.llm`:

```ts
          if (config.llm) {
            const result = await runLlmTurn({
              llm: config.llm,
              prompt: payload.context_prompt,
              systemPrompt: config.agent.system_prompt,
              onDelta: async (chunk) => {
                finalText = appendTurnOutput(finalText, { stream: "stdout", chunk });
                await postJson(config.server_url, `/rooms/${config.room_id}/agent-turns/${payload.turn_id}/delta`, registered.agent_token, { chunk });
              }
            });
            await postJson(config.server_url, `/rooms/${config.room_id}/agent-turns/${payload.turn_id}/complete`, registered.agent_token, turnCompleteBody(result.finalText, 0));
          } else {
            // Keep the existing runCommandForTask path here.
          }
```

In the `task.created` branch, before spawning commands, add:

```ts
          if (config.llm) {
            await postJson(config.server_url, `/rooms/${config.room_id}/tasks/${payload.task_id}/fail`, registered.agent_token, { error: "llm_api_agents_do_not_run_tasks" });
            return;
          }
```

- [ ] **Step 5: Run and commit**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-runner.test.ts index-source.test.ts
git add packages/cli-adapter/src/llm/runner.ts packages/cli-adapter/src/index.ts packages/cli-adapter/test/llm-runner.test.ts packages/cli-adapter/test/index-source.test.ts
git commit -m "feat(connector): run llm api agent turns"
```

Expected: tests pass and commit succeeds.
---

## Task 6: Hygiene, full validation, and manual acceptance

**Files:**
- Modify: `.gitignore`
- Create locally but do not commit: `docs/examples/llm-api-agent.local.md`

- [ ] **Step 1: Ignore local Markdown test notes**

Add this line to `.gitignore`:

```gitignore
docs/examples/*.local.md
```

- [ ] **Step 2: Create a local-only test note**

Create `docs/examples/llm-api-agent.local.md` locally. Do not stage it.

```markdown
# Local LLM API Agent Test Notes

This file is ignored by Git. Do not commit provider endpoints, API keys, private model names, or local test results.

Provider family: OpenAI-compatible or Anthropic-compatible
Base URL: paste local test endpoint
Model: paste local test model
API Key: paste only in the connector console
Temperature: 0.7
Max tokens: 1024
```

- [ ] **Step 3: Verify ignore behavior**

```powershell
git status --short --ignored docs/examples/llm-api-agent.local.md
```

Expected: output starts with `!! docs/examples/llm-api-agent.local.md`.

- [ ] **Step 4: Run focused tests**

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx
corepack pnpm --filter @cacp/cli-adapter test -- llm-sse.test.ts llm-sanitize.test.ts llm-openai-compatible.test.ts llm-anthropic-compatible.test.ts llm-config-wizard.test.ts llm-runner.test.ts config.test.ts index-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run full repository check**

```powershell
corepack pnpm check
```

Expected: all package tests and builds pass.

- [ ] **Step 6: Manual happy-path validation**

Run server:

```powershell
corepack pnpm dev:server
```

Run web:

```powershell
corepack pnpm dev:web
```

Manual checks:

```text
1. Open http://127.0.0.1:5173.
2. Create a room with Agent type OpenAI-compatible API.
3. Confirm a Local Connector console opens.
4. Confirm the console says this is an LLM API Agent and API keys stay local.
5. Enter local provider test values.
6. Confirm the console prints LLM API connectivity test succeeded before the agent appears online.
7. Send a normal room message and confirm streamed output appears incrementally.
8. Start Roundtable Mode, enter two human messages, submit, and confirm the LLM API Agent responds to collected context.
```

- [ ] **Step 7: Manual failure-path validation**

Manual checks:

```text
1. Create another room with Agent type OpenAI-compatible API.
2. Enter a deliberately invalid key or model in the connector console.
3. Confirm the console prints LLM API connectivity test failed and sanitized details.
4. Confirm the room does not show a registered or online agent for the failed connector attempt.
5. Choose retry, enter valid values, and confirm the agent registers only after success.
```

- [ ] **Step 8: Secret hygiene check**

```powershell
git status --short
git diff --cached --name-only
git grep -n "sk-\|api_key\|Authorization: Bearer\|x-api-key" -- . ":!pnpm-lock.yaml"
```

Expected: local test note remains ignored; no real provider secret appears in tracked files. Source-code references to header names are acceptable.

- [ ] **Step 9: Commit hygiene change**

```powershell
git add .gitignore
git commit -m "chore: ignore local llm api test notes"
```

Expected: commit succeeds.

---

## Self-Review Checklist

Spec coverage:

- Add LLM API agent choices to Web create-room flow: Task 2.
- Support OpenAI-compatible and Anthropic-compatible provider families: Tasks 1, 3, 4, 5.
- Keep API keys local to connector process: Tasks 4 and 6.
- Collect settings in console after connection code or local auto-launch: Tasks 1 and 4.
- Run connectivity validation after settings and before claim: Task 4.
- Stream model output into existing CACP turn endpoints: Tasks 3 and 5.
- Preserve multi-person and Roundtable context through server `context_prompt`: Task 5 uses `payload.context_prompt` unchanged.
- Avoid committed provider examples or secrets: Task 6.
- Keep LLM API agents as pure conversation agents: Tasks 1, 2, and 5.

Type consistency:

- Server, Web, and Connector all use `llm-openai-compatible` and `llm-anthropic-compatible` as agent type strings.
- Connector maps those to `openai-compatible` and `anthropic-compatible` provider values.
- Web sends `permission_level: "read_only"` for LLM API agents only as a compatibility default.
- `AdapterConfig.llm` is optional, so command-agent paths still use `runCommandForTask()`.
- `runLlmTurn()` returns `{ finalText }`, which maps to `turnCompleteBody(finalText, 0)`.

Regression checks:

- Local auto-launch uses `--connect <connection_code>` so LLM configuration happens before claim.
- Raw `--server --pair` remains available for command-agent development flows.
- Existing command-agent tests remain green.
- Cloud connector modal still exposes only download plus connection code, never provider settings.
