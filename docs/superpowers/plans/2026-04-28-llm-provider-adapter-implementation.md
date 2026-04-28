# LLM Provider Adapter Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic LLM API setup with a Local Connector provider-adapter registry for SiliconFlow, Kimi/Moonshot, MiniMax, OpenAI, Anthropic Claude API, GLM official, DeepSeek official, and custom compatible providers.

**Architecture:** Web and Server expose one canonical `llm-api` agent type while preserving legacy `llm-openai-compatible` and `llm-anthropic-compatible` connection codes. The Connector prompts for provider selection locally, stores API/provider config in memory only, builds provider-specific streaming requests through a registry, and only streams final answer text into CACP room events. Reasoning/thinking deltas are ignored for visible room output in this MVP.

**Tech Stack:** TypeScript, Node 20 fetch/ReadableStream, Fastify, React/Vite, Vitest, pnpm workspace.

---

## File Structure Map

- Create `packages/cli-adapter/src/llm/providers/types.ts`: provider id/protocol/request/adapter interfaces.
- Create `packages/cli-adapter/src/llm/providers/registry.ts`: stable provider choice list and lookup.
- Create `packages/cli-adapter/src/llm/providers/base-url.ts`: normalize accidental full endpoint URLs.
- Create `packages/cli-adapter/src/llm/providers/openai-chat.ts`: shared OpenAI Chat Completions style request and stream helpers.
- Create `packages/cli-adapter/src/llm/providers/anthropic-messages.ts`: shared Anthropic Messages request and stream helpers.
- Create provider modules: `siliconflow.ts`, `kimi.ts`, `minimax.ts`, `openai.ts`, `anthropic.ts`, `glm-official.ts`, `deepseek.ts`, `custom-openai-compatible.ts`, `custom-anthropic-compatible.ts`.
- Modify `packages/cli-adapter/src/llm/types.ts`, `config-wizard.ts`, `runner.ts`, `config.ts`.
- Modify server pairing/schema/store files for `llm-api`.
- Modify Web landing/i18n/tests for one LLM API Agent option.

---

## Task 1: Provider registry and base URL normalization

**Files:**
- Create: `packages/cli-adapter/src/llm/providers/types.ts`
- Create: `packages/cli-adapter/src/llm/providers/registry.ts`
- Create: `packages/cli-adapter/src/llm/providers/base-url.ts`
- Create: `packages/cli-adapter/test/llm-provider-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/cli-adapter/test/llm-provider-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeProviderBaseUrl } from "../src/llm/providers/base-url.js";
import { getProviderAdapter, listProviderAdapters } from "../src/llm/providers/registry.js";

describe("LLM provider registry", () => {
  it("lists provider choices in stable console order", () => {
    expect(listProviderAdapters().map((adapter) => adapter.id)).toEqual([
      "siliconflow",
      "kimi",
      "minimax",
      "openai",
      "anthropic",
      "glm-official",
      "deepseek",
      "custom-openai-compatible",
      "custom-anthropic-compatible"
    ]);
  });

  it("returns provider defaults by id", () => {
    expect(getProviderAdapter("siliconflow").defaultBaseUrl).toBe("https://api.siliconflow.cn/v1");
    expect(getProviderAdapter("kimi").defaultBaseUrl).toBe("https://api.moonshot.ai/v1");
    expect(getProviderAdapter("minimax").defaultBaseUrl).toBe("https://api.minimax.io/v1");
    expect(getProviderAdapter("openai").defaultBaseUrl).toBe("https://api.openai.com/v1");
    expect(getProviderAdapter("anthropic").defaultBaseUrl).toBe("https://api.anthropic.com/v1");
    expect(getProviderAdapter("glm-official").defaultBaseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(getProviderAdapter("deepseek").defaultBaseUrl).toBe("https://api.deepseek.com");
  });

  it("rejects unknown provider ids", () => {
    expect(() => getProviderAdapter("unknown-provider" as never)).toThrow("unknown_llm_provider: unknown-provider");
  });

  it("normalizes accidental full endpoint URLs", () => {
    expect(normalizeProviderBaseUrl("https://api.siliconflow.cn/v1/chat/completions", "/chat/completions")).toBe("https://api.siliconflow.cn/v1");
    expect(normalizeProviderBaseUrl("https://api.anthropic.com/v1/messages", "/messages")).toBe("https://api.anthropic.com/v1");
    expect(normalizeProviderBaseUrl("https://api.deepseek.com/", "/chat/completions")).toBe("https://api.deepseek.com");
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-provider-registry.test.ts
```

Expected: FAIL because provider modules do not exist.

- [ ] **Step 3: Implement types and URL helper**

Create `packages/cli-adapter/src/llm/providers/types.ts`:

```ts
import type { SseEvent } from "../sse.js";

export type LlmProviderId =
  | "siliconflow"
  | "kimi"
  | "minimax"
  | "openai"
  | "anthropic"
  | "glm-official"
  | "deepseek"
  | "custom-openai-compatible"
  | "custom-anthropic-compatible";

export type LlmProtocolFamily = "openai-chat" | "anthropic-messages";

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface BuildProviderRequestInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  systemPrompt: string;
  options: Record<string, unknown>;
  maxTokensOverride?: number;
}

export interface LlmProviderAdapter {
  id: LlmProviderId;
  label: string;
  protocol: LlmProtocolFamily;
  endpointPath: "/chat/completions" | "/messages";
  defaultBaseUrl?: string;
  alternateBaseUrls?: string[];
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  buildRequest(input: BuildProviderRequestInput): ProviderRequest;
  extractTextDelta(event: SseEvent): string | undefined;
  extractReasoningDelta?(event: SseEvent): string | undefined;
  isTerminalEvent(event: SseEvent): boolean;
  extractProviderError(event: SseEvent): string | undefined;
}
```

Create `packages/cli-adapter/src/llm/providers/base-url.ts`:

```ts
export function normalizeProviderBaseUrl(input: string, endpointPath: string): string {
  const trimmed = input.trim().replace(/\/+$/u, "");
  if (!trimmed) return trimmed;
  return trimmed.endsWith(endpointPath) ? trimmed.slice(0, -endpointPath.length).replace(/\/+$/u, "") : trimmed;
}
```

- [ ] **Step 4: Implement registry and minimal adapter metadata**

Create `packages/cli-adapter/src/llm/providers/registry.ts`:

```ts
import { anthropicAdapter } from "./anthropic.js";
import { customAnthropicCompatibleAdapter } from "./custom-anthropic-compatible.js";
import { customOpenAiCompatibleAdapter } from "./custom-openai-compatible.js";
import { deepseekAdapter } from "./deepseek.js";
import { glmOfficialAdapter } from "./glm-official.js";
import { kimiAdapter } from "./kimi.js";
import { minimaxAdapter } from "./minimax.js";
import { openAiAdapter } from "./openai.js";
import { siliconFlowAdapter } from "./siliconflow.js";
import type { LlmProviderAdapter, LlmProviderId } from "./types.js";

const adapters = [
  siliconFlowAdapter,
  kimiAdapter,
  minimaxAdapter,
  openAiAdapter,
  anthropicAdapter,
  glmOfficialAdapter,
  deepseekAdapter,
  customOpenAiCompatibleAdapter,
  customAnthropicCompatibleAdapter
] as const satisfies readonly LlmProviderAdapter[];

export function listProviderAdapters(): readonly LlmProviderAdapter[] {
  return adapters;
}

export function getProviderAdapter(id: LlmProviderId): LlmProviderAdapter {
  const adapter = adapters.find((item) => item.id === id);
  if (!adapter) throw new Error(`unknown_llm_provider: ${id}`);
  return adapter;
}
```

Create provider files with the right ids/defaults. Use this template and replace the constants per provider:

```ts
import type { LlmProviderAdapter } from "./types.js";

export const siliconFlowAdapter: LlmProviderAdapter = {
  id: "siliconflow",
  label: "SiliconFlow",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.siliconflow.cn/v1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
```

Provider constants:

```text
kimi.ts -> kimiAdapter, id kimi, label Kimi / Moonshot, default https://api.moonshot.ai/v1
minimax.ts -> minimaxAdapter, id minimax, label MiniMax, default https://api.minimax.io/v1
openai.ts -> openAiAdapter, id openai, label OpenAI, default https://api.openai.com/v1
anthropic.ts -> anthropicAdapter, id anthropic, protocol anthropic-messages, endpoint /messages, default https://api.anthropic.com/v1
glm-official.ts -> glmOfficialAdapter, id glm-official, label GLM official / Zhipu / Z.ai, default https://open.bigmodel.cn/api/paas/v4, alternate ["https://api.z.ai/api/paas/v4"]
deepseek.ts -> deepseekAdapter, id deepseek, label DeepSeek official, default https://api.deepseek.com
custom-openai-compatible.ts -> customOpenAiCompatibleAdapter, id custom-openai-compatible, no defaultBaseUrl
custom-anthropic-compatible.ts -> customAnthropicCompatibleAdapter, id custom-anthropic-compatible, protocol anthropic-messages, endpoint /messages, no defaultBaseUrl
```

- [ ] **Step 5: Run GREEN**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-provider-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/cli-adapter/src/llm/providers packages/cli-adapter/test/llm-provider-registry.test.ts
git commit -m "feat(connector): add llm provider registry"
```

---

## Task 2: Provider request builders and stream extraction

**Files:**
- Create: `packages/cli-adapter/src/llm/providers/openai-chat.ts`
- Create: `packages/cli-adapter/src/llm/providers/anthropic-messages.ts`
- Modify: all provider modules in `packages/cli-adapter/src/llm/providers/`
- Create: `packages/cli-adapter/test/llm-provider-requests.test.ts`
- Create: `packages/cli-adapter/test/llm-provider-streaming.test.ts`

- [ ] **Step 1: Write failing request builder tests**

Create `packages/cli-adapter/test/llm-provider-requests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "../src/llm/providers/registry.js";

function build(id: Parameters<typeof getProviderAdapter>[0], options: Record<string, unknown> = {}) {
  const adapter = getProviderAdapter(id);
  return adapter.buildRequest({
    baseUrl: adapter.defaultBaseUrl ?? "https://custom.example.com/v1",
    model: "model-a",
    apiKey: "secret-key",
    prompt: "room context",
    systemPrompt: "system prompt",
    options
  });
}

describe("LLM provider request builders", () => {
  it("builds provider-specific OpenAI-chat requests", () => {
    expect(build("siliconflow", { enable_thinking: true, thinking_budget: 4096, min_p: 0.05 }).body).toMatchObject({ enable_thinking: true, thinking_budget: 4096, min_p: 0.05 });
    expect(build("kimi", { thinking_type: "enabled" }).body).toMatchObject({ thinking: { type: "enabled" } });
    expect(build("minimax", { reasoning_split: true }).body).toMatchObject({ reasoning_split: true });
    expect(build("openai", { max_completion_tokens: 2048, reasoning_effort: "high" }).body).toMatchObject({ max_completion_tokens: 2048, reasoning_effort: "high" });
    expect(build("glm-official", { thinking_type: "enabled" }).body).toMatchObject({ thinking: { type: "enabled" } });
    expect(build("deepseek", { thinking_type: "enabled", reasoning_effort: "high" }).body).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  it("builds Anthropic messages requests", () => {
    const request = build("anthropic", { max_tokens: 2048, thinking_budget_tokens: 1024 });
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("secret-key");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.body).toMatchObject({ stream: true, max_tokens: 2048, thinking: { type: "enabled", budget_tokens: 1024 } });
  });
});
```

- [ ] **Step 2: Write failing stream extraction tests**

Create `packages/cli-adapter/test/llm-provider-streaming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SseEvent } from "../src/llm/sse.js";
import { getProviderAdapter } from "../src/llm/providers/registry.js";

function event(data: unknown, name?: string): SseEvent {
  return { event: name, data: typeof data === "string" ? data : JSON.stringify(data) };
}

describe("provider stream extraction", () => {
  it("extracts final content and ignores reasoning content for OpenAI-chat providers", () => {
    const adapter = getProviderAdapter("deepseek");
    expect(adapter.extractTextDelta(event({ choices: [{ delta: { reasoning_content: "hidden" } }] }))).toBeUndefined();
    expect(adapter.extractTextDelta(event({ choices: [{ delta: { content: "visible" } }] }))).toBe("visible");
  });

  it("extracts Anthropic text deltas and ignores thinking blocks", () => {
    const adapter = getProviderAdapter("anthropic");
    expect(adapter.extractTextDelta(event({ delta: { type: "thinking_delta", thinking: "hidden" } }, "content_block_delta"))).toBeUndefined();
    expect(adapter.extractTextDelta(event({ delta: { type: "text_delta", text: "visible" } }, "content_block_delta"))).toBe("visible");
    expect(adapter.isTerminalEvent(event({}, "message_stop"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run RED**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-provider-requests.test.ts llm-provider-streaming.test.ts
```

Expected: FAIL because builders still throw.

- [ ] **Step 4: Implement shared helpers and provider modules**

Create `openai-chat.ts` with helpers: `optionalNumber`, `optionalString`, `optionalBoolean`, `buildOpenAiChatRequest()`, `extractOpenAiChatText()`, `extractOpenAiProviderError()`, and `isOpenAiChatTerminalEvent()`. `buildOpenAiChatRequest()` must append `/chat/completions`, send `Authorization: Bearer <apiKey>`, include system/user messages, `stream: true`, and only add optional provider fields when present.

Create `anthropic-messages.ts` with helpers: `buildAnthropicMessagesRequest()`, `extractAnthropicText()`, `extractAnthropicError()`, and `isAnthropicTerminalEvent()`. It must append `/messages`, send `x-api-key` and `anthropic-version: 2023-06-01`, and extract only `text_delta`.

Update provider modules:

```ts
// SiliconFlow extras
enable_thinking, thinking_budget, min_p

// Kimi and GLM extras
thinking: { type: options.thinking_type }

// MiniMax extras
reasoning_split

// OpenAI extras
max_completion_tokens, reasoning_effort; omit temperature by default

// DeepSeek extras
thinking: { type: options.thinking_type }, reasoning_effort

// Anthropic extras
thinking: { type: "enabled", budget_tokens: options.thinking_budget_tokens }
```

All OpenAI-chat providers use `extractOpenAiChatText()` and ignore `reasoning_content` / `reasoning_details`. Anthropic providers use `extractAnthropicText()` and ignore thinking blocks.

- [ ] **Step 5: Run GREEN**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-provider-registry.test.ts llm-provider-requests.test.ts llm-provider-streaming.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/cli-adapter/src/llm/providers packages/cli-adapter/test/llm-provider-requests.test.ts packages/cli-adapter/test/llm-provider-streaming.test.ts
git commit -m "feat(connector): build provider specific llm requests"
```

---

## Task 3: Provider-aware console wizard

**Files:**
- Modify: `packages/cli-adapter/src/llm/types.ts`
- Modify: `packages/cli-adapter/src/llm/config-wizard.ts`
- Modify: `packages/cli-adapter/test/llm-config-wizard.test.ts`
- Create: `packages/cli-adapter/test/llm-config-wizard-providers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/cli-adapter/test/llm-config-wizard-providers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { promptForLlmApiConfig } from "../src/llm/config-wizard.js";

describe("LLM provider config wizard", () => {
  it("selects SiliconFlow defaults and advanced thinking options", async () => {
    const config = await promptForLlmApiConfig("llm-api", {
      question: vi.fn()
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("Qwen/Qwen3.5-4B")
        .mockResolvedValueOnce("y")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("4096")
        .mockResolvedValueOnce("y")
        .mockResolvedValueOnce("4096")
        .mockResolvedValueOnce("0.05"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: () => {},
      close: vi.fn()
    }, async () => ({ ok: true as const, sampleText: "ok" }));
    expect(config).toMatchObject({
      providerId: "siliconflow",
      protocol: "openai-chat",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3.5-4B",
      options: { temperature: 1, max_tokens: 4096, enable_thinking: true, thinking_budget: 4096, min_p: 0.05 }
    });
  });

  it("collects only required fields when advanced options are declined", async () => {
    const config = await promptForLlmApiConfig("llm-api", {
      question: vi.fn().mockResolvedValueOnce("7").mockResolvedValueOnce("").mockResolvedValueOnce("deepseek-v4-pro").mockResolvedValueOnce("n"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: () => {},
      close: vi.fn()
    }, async () => ({ ok: true as const, sampleText: "ok" }));
    expect(config).toMatchObject({ providerId: "deepseek", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", options: {} });
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-config-wizard-providers.test.ts
```

Expected: FAIL because wizard does not prompt for provider ids.

- [ ] **Step 3: Update runtime config type**

Modify `packages/cli-adapter/src/llm/types.ts`:

```ts
import type { LlmProtocolFamily, LlmProviderId } from "./providers/types.js";

export type LlmAgentType = "llm-api" | "llm-openai-compatible" | "llm-anthropic-compatible";

export interface LlmProviderConfig {
  providerId: LlmProviderId;
  protocol: LlmProtocolFamily;
  baseUrl: string;
  model: string;
  apiKey: string;
  options: Record<string, unknown>;
}
```

Keep `LlmRunOptions`, `LlmRunResult`, `LlmConnectivityResult`, `isLlmAgentType()`, and `DefaultLlmSystemPrompt`, but update `isLlmAgentType()` to include `llm-api`.

- [ ] **Step 4: Implement provider prompts**

In `config-wizard.ts`, list `listProviderAdapters()`, ask `Provider [1-9]`, accept default base URL on blank input, ask `Model`, hidden `API Key`, and `Configure advanced provider options? [y/N]`.

Advanced prompt rules:

```text
SiliconFlow: temperature, max_tokens, enable_thinking, thinking_budget, min_p
Kimi: temperature, max_tokens, thinking_type
MiniMax: temperature, max_tokens, reasoning_split
OpenAI: max_completion_tokens, reasoning_effort
Anthropic: max_tokens, temperature, thinking_budget_tokens
GLM: temperature, max_tokens, thinking_type
DeepSeek: temperature, max_tokens, thinking_type, reasoning_effort
Custom OpenAI-compatible: temperature, max_tokens
Custom Anthropic-compatible: max_tokens, temperature
```

Use option keys exactly as listed above.

- [ ] **Step 5: Update old wizard tests**

Update `llm-config-wizard.test.ts` to select custom OpenAI-compatible (`8`) and new config shape:

```ts
expect(config).toEqual({
  providerId: "custom-openai-compatible",
  protocol: "openai-chat",
  baseUrl: "https://api.example.com/v1",
  model: "model-a",
  apiKey: "secret-key",
  options: {}
});
```

- [ ] **Step 6: Run GREEN**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-config-wizard.test.ts llm-config-wizard-providers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/cli-adapter/src/llm/types.ts packages/cli-adapter/src/llm/config-wizard.ts packages/cli-adapter/test/llm-config-wizard.test.ts packages/cli-adapter/test/llm-config-wizard-providers.test.ts
git commit -m "feat(connector): prompt for llm api provider settings"
```

---

## Task 4: Runner dispatch and pre-claim validation

**Files:**
- Modify: `packages/cli-adapter/src/config.ts`
- Modify: `packages/cli-adapter/src/llm/runner.ts`
- Modify: `packages/cli-adapter/test/config.test.ts`
- Modify: `packages/cli-adapter/test/llm-runner.test.ts`

- [ ] **Step 1: Write failing runner/config tests**

Update `llm-runner.test.ts` to pass:

```ts
llm: { providerId: "deepseek", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKey: "secret-key", options: {} }
```

and assert a mocked stream returns `finalText: "hi"`.

Append to `config.test.ts`:

```ts
it("configures provider configs before claiming llm-api pairings", async () => {
  const code = buildConnectionCode({ server_url: "https://cacp.example.com", pairing_token: "pair_llm", expires_at: "2026-04-28T08:15:00.000Z", agent_type: "llm-api" });
  const callOrder: string[] = [];
  const fetchImpl = vi.fn(async () => {
    callOrder.push("claim");
    return new Response(JSON.stringify({ room_id: "room_1", agent_id: "agent_1", agent_token: "agent_token", agent: { name: "LLM API Agent", command: "", args: [], working_dir: ".", capabilities: ["llm.api", "chat.stream"] }, agent_type: "llm-api" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const config = await loadRuntimeConfigFromArgs(["--connect", code], fetchImpl, {
    configureLlmAgent: async () => { callOrder.push("configure"); return { providerId: "siliconflow", protocol: "openai-chat", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3.5-4B", apiKey: "secret", options: { enable_thinking: true } }; }
  });
  expect(callOrder).toEqual(["configure", "claim"]);
  expect(config.llm?.providerId).toBe("siliconflow");
});
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-runner.test.ts config.test.ts
```

Expected: FAIL because schema/runner still use old shape.

- [ ] **Step 3: Implement schema and runner dispatch**

In `config.ts`, change `AdapterConfigSchema.llm` to:

```ts
llm: z.object({
  providerId: z.enum(["siliconflow", "kimi", "minimax", "openai", "anthropic", "glm-official", "deepseek", "custom-openai-compatible", "custom-anthropic-compatible"]),
  protocol: z.enum(["openai-chat", "anthropic-messages"]),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().min(1),
  options: z.record(z.string(), z.unknown()).default({})
}).optional()
```

In `runner.ts`, lookup `getProviderAdapter(config.providerId)`, call `adapter.buildRequest()`, then use protocol-specific transport. Export `validateLlmConnectivity(config, fetchImpl?)` that calls `runLlmTurn()` with the connectivity prompt and `maxTokensOverride: 16`.

- [ ] **Step 4: Run GREEN**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-runner.test.ts config.test.ts llm-config-wizard-providers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/cli-adapter/src/config.ts packages/cli-adapter/src/llm/runner.ts packages/cli-adapter/test/config.test.ts packages/cli-adapter/test/llm-runner.test.ts
git commit -m "feat(connector): run llm turns through provider adapters"
```

---

## Task 5: Server canonical `llm-api` compatibility

**Files:**
- Modify: `packages/server/src/pairing.ts`
- Modify: `packages/server/src/event-store.ts`
- Modify: `packages/server/test/pairing.test.ts`
- Modify: `packages/server/test/connection-code-server.test.ts`
- Modify: `packages/server/test/event-store.test.ts`

- [ ] **Step 1: Write failing server tests**

Add tests asserting:

```ts
expect(AgentTypeValues).toContain("llm-api");
expect(isLlmAgentType("llm-api")).toBe(true);
expect(buildAgentProfile({ agentType: "llm-api", permissionLevel: "full_access", workingDir: "." }).capabilities).toEqual(["llm.api", "chat.stream"]);
```

Also add a connection-code test for `agent_type: "llm-api"`.

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts
```

Expected: FAIL because `llm-api` is not accepted.

- [ ] **Step 3: Implement server support**

In `pairing.ts`, include:

```ts
export const LlmAgentTypeValues = ["llm-api", "llm-openai-compatible", "llm-anthropic-compatible"] as const;
```

For `llm-api`, return:

```ts
{ name: "LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream"], system_prompt: llmApiSystemPrompt() }
```

In `event-store.ts`, add `llm-api` to the `agent_pairings.agent_type` check constraint and migration SQL.

- [ ] **Step 4: Run GREEN**

```powershell
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts server-governance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/server/src/pairing.ts packages/server/src/event-store.ts packages/server/test/pairing.test.ts packages/server/test/connection-code-server.test.ts packages/server/test/event-store.test.ts
git commit -m "feat(server): add canonical llm api agent type"
```

---

## Task 6: Web single LLM API Agent option

**Files:**
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Modify: `packages/web/test/landing-llm-agent.test.tsx`
- Modify: `packages/web/test/landing-connector.test.tsx`

- [ ] **Step 1: Write failing Web tests**

Update `landing-llm-agent.test.tsx` so it expects one option:

```tsx
expect(screen.getByRole("option", { name: "LLM API Agent" })).toHaveValue("llm-api");
expect(screen.queryByRole("option", { name: "OpenAI-compatible API" })).not.toBeInTheDocument();
expect(screen.queryByRole("option", { name: "Anthropic-compatible API" })).not.toBeInTheDocument();
```

Also assert LLM copy:

```tsx
expect(screen.getByText("Provider and API key are configured only in the Local Connector console and are never sent to the room server.")).toBeInTheDocument();
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx
```

Expected: FAIL because Web still has two LLM provider-family options.

- [ ] **Step 3: Implement Web changes**

In `Landing.tsx`:

```ts
const llmAgentTypes = [
  { value: "llm-api", labelKey: "agentType.llmApi" }
] as const;
```

In English i18n:

```json
"agentType.llmApi": "LLM API Agent",
"landing.create.llmApiKeyLocalOnly": "Provider and API key are configured only in the Local Connector console and are never sent to the room server.",
"landing.connector.llmInstructions": "Download and run the connector, paste the connection code, then choose the LLM API provider and enter API settings in the connector console."
```

In Chinese i18n:

```json
"agentType.llmApi": "LLM API Agent",
"landing.create.llmApiKeyLocalOnly": "服务商和 API Key 只在本地 Connector 控制台配置，永远不会发送到房间服务器。",
"landing.connector.llmInstructions": "下载并运行 Connector，粘贴连接码，然后在 Connector 控制台选择 LLM API 服务商并输入 API 设置。"
```

- [ ] **Step 4: Run GREEN**

```powershell
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/web/src/components/Landing.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/landing-llm-agent.test.tsx packages/web/test/landing-connector.test.tsx
git commit -m "feat(web): consolidate llm api agent selection"
```

---

## Task 7: Full validation and secret hygiene

**Files:**
- Update any stale CLI adapter tests that still assert old provider-family config.
- No changes to ignored `docs/examples/llm-api-agent.local.md`.

- [ ] **Step 1: Run focused tests**

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- llm-provider-registry.test.ts llm-provider-requests.test.ts llm-provider-streaming.test.ts llm-config-wizard.test.ts llm-config-wizard-providers.test.ts llm-runner.test.ts config.test.ts index-source.test.ts
corepack pnpm --filter @cacp/server test -- pairing.test.ts connection-code-server.test.ts event-store.test.ts server-governance.test.ts
corepack pnpm --filter @cacp/web test -- landing-llm-agent.test.tsx landing-connector.test.tsx i18n.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full repository check**

```powershell
corepack pnpm check
```

Expected: all package tests and builds pass.

- [ ] **Step 3: Verify ignored local note**

```powershell
git status --short --ignored docs/examples/llm-api-agent.local.md
```

Expected:

```text
!! docs/examples/llm-api-agent.local.md
```

- [ ] **Step 4: Run tracked secret grep**

```powershell
git grep -n "sk-\|api_key\|apiKey\|Authorization: Bearer\|x-api-key" -- . ":!pnpm-lock.yaml"
```

Expected: only placeholder docs/tests/source header-name references; no real key from the ignored local note.

- [ ] **Step 5: Commit cleanup if files changed**

```powershell
git add packages/cli-adapter packages/server packages/web
git commit -m "test: validate llm provider adapter integration"
```

Skip this commit if no files changed during Task 7.

---

## Manual Acceptance Checklist

1. Start server and web locally.
2. Create room with `LLM API Agent`.
3. Confirm connector console lists nine providers.
4. Select SiliconFlow and validate local test credentials before agent registration.
5. Send a message and confirm only final answer text streams into the room.
6. Validate GLM official and DeepSeek official with valid local credentials.
7. Validate invalid-key failure: sanitized error, no claim/register.
8. Confirm server events do not include API key, provider config, model, or base URL.
9. Confirm `docs/examples/llm-api-agent.local.md` remains ignored.

---

## Self-Review Checklist

- Provider registry and all nine provider ids: Tasks 1-2.
- Provider console wizard and advanced options: Task 3.
- Pre-claim connectivity and provider runner dispatch: Task 4.
- Canonical `llm-api` with legacy compatibility: Task 5.
- Single Web LLM API Agent option: Task 6.
- Full checks and secret hygiene: Task 7.
