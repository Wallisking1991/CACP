# LLM API Provider Adapter Design

Date: 2026-04-28
Status: Draft spec for user review
Scope: Replace the current generic OpenAI-compatible / Anthropic-compatible console setup with explicit Local Connector provider adapters for common LLM API services.

## 1. Background

CACP now supports LLM API agents through the Local Connector. The first implementation exposes two room agent types, `llm-openai-compatible` and `llm-anthropic-compatible`, then asks users to manually enter endpoint/model/API-key details in the connector console.

That works for simple providers, but real provider APIs diverge even when they advertise OpenAI compatibility. Examples:

- SiliconFlow uses Chat Completions and adds `enable_thinking`, `thinking_budget`, and `min_p` for supported reasoning/Qwen models.
- Kimi / Moonshot is OpenAI-compatible but uses provider extensions such as `thinking`.
- MiniMax supports OpenAI-compatible calls, recommends `reasoning_split` for separated thinking content, and has stricter temperature constraints.
- OpenAI uses OpenAI-specific reasoning controls such as `reasoning_effort` on supported models.
- Anthropic Claude uses the Messages API, not Chat Completions, with `x-api-key`, `anthropic-version`, `max_tokens`, and Anthropic SSE event names.
- GLM official APIs use Chat Completions-compatible request/response shapes but have official base paths under `api/paas/v4`, support `thinking: { type: "enabled" }`, and may stream `reasoning_content` separately from final content.
- DeepSeek official APIs use Chat Completions-compatible request/response shapes under `https://api.deepseek.com`, support models such as `deepseek-v4-flash` and `deepseek-v4-pro`, and can stream `reasoning_content` separately from final answer content.

The product direction is therefore to keep Web/Server provider-agnostic and move provider selection into the Local Connector console.

## 2. Goals

- Show one LLM API agent choice in Web create-room UI.
- Keep provider selection, provider settings, and API keys local to the connector console.
- Add first-class provider adapters for:
  - SiliconFlow.
  - Kimi / Moonshot.
  - MiniMax.
  - OpenAI.
  - Anthropic Claude API.
  - GLM official / Zhipu / Z.ai.
  - DeepSeek official.
- Preserve custom fallback adapters:
  - Custom OpenAI-compatible.
  - Custom Anthropic-compatible.
- Ask users for the minimum required fields first: provider, API key, and model.
- Use provider-specific default base URLs so most users do not need to type endpoints.
- Keep advanced provider parameters optional and hidden behind an explicit console prompt.
- Continue pre-claim connectivity validation before claiming/registering the pairing.
- Continue streaming final answer text into `agent.output.delta`.
- Keep reasoning/thinking content out of the visible room transcript by default unless a future feature explicitly models it.

## 3. Non-goals

This spec does not include:

- Web UI API-key entry.
- Server-side storage or forwarding of provider API keys.
- Provider account management, billing, or model list discovery.
- Tool use, function calling, web search, file upload, image/audio/video inputs, or MCP bridge for LLM API agents.
- Full provider-native multi-turn message reconstruction. The connector still uses the server-generated `context_prompt` as the turn input.
- Showing chain-of-thought / reasoning tokens in room output.
- Treating Claude Code as an LLM API provider. Claude Code remains a local CLI agent; direct Claude model calls use the Anthropic Claude API adapter.

## 4. Product flow

### 4.1 Web create-room UI

Replace the two provider-family choices with one user-facing option:

```text
LLM API Agent
```

The Web copy should explain:

```text
Provider and API key are configured only in the Local Connector console. API keys are never sent to the room server.
```

The Web and Server should not know whether the connector later chooses SiliconFlow, Kimi, MiniMax, OpenAI, Anthropic, GLM, DeepSeek, or custom.

### 4.2 Server agent type

Add a canonical agent type:

```text
llm-api
```

For backward compatibility, keep accepting existing types:

```text
llm-openai-compatible
llm-anthropic-compatible
```

Recommended behavior:

- Web sends `llm-api` for new rooms.
- Server pairing/schema accepts all three LLM API type strings.
- Connector maps all LLM agent types to the provider-selection wizard.
- If the connection code is legacy `llm-openai-compatible`, the provider wizard may preselect or highlight OpenAI-compatible providers, but the user can still choose any provider.
- If the connection code is legacy `llm-anthropic-compatible`, the provider wizard may preselect or highlight Anthropic Claude / custom Anthropic-compatible, but the user can still choose any provider.

### 4.3 Connector console provider selection

After the connector parses a connection code for any LLM API agent type, it prints the local-only notice and asks:

```text
Choose LLM API provider:
1) SiliconFlow
2) Kimi / Moonshot
3) MiniMax
4) OpenAI
5) Anthropic Claude API
6) GLM official / Zhipu / Z.ai
7) DeepSeek official
8) Custom OpenAI-compatible
9) Custom Anthropic-compatible
```

Then it asks required fields:

```text
API Key: <hidden input>
Model: <typed by user>
```

For provider adapters with a known default base URL, the connector should show the default and allow Enter to accept:

```text
Base URL [https://api.siliconflow.cn/v1]:
```

This is not a product preset for a model or API key; it is a provider endpoint default required to make provider selection useful. Users can override it for proxies or alternate official regions.

After required fields, the wizard asks one compact question:

```text
Configure advanced provider options? [y/N]:
```

If the user answers no, the connector uses safe adapter defaults and immediately runs connectivity validation. If yes, the connector asks only adapter-supported optional fields.

## 5. Provider catalog

### 5.1 SiliconFlow

Official docs:

- Chat Completions endpoint and parameters: https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions_copy

Adapter id:

```text
siliconflow
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://api.siliconflow.cn/v1
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Advanced optional fields:

- `temperature`.
- `max_tokens`.
- `enable_thinking` as boolean.
- `thinking_budget` as integer, valid range `128..32768`.
- `min_p` as number `0..1` for Qwen3/Qwen3.5 style models.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning content: `choices[0].delta.reasoning_content` if present; ignore for visible room output in MVP.
- Terminal marker: `[DONE]`.

### 5.2 Kimi / Moonshot

Official docs:

- API overview and OpenAI compatibility: https://platform.kimi.ai/docs/api/overview

Adapter id:

```text
kimi
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://api.moonshot.ai/v1
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Advanced optional fields:

- `temperature`.
- `max_tokens`.
- `thinking.type`, allowed values `enabled` or `disabled` when the selected model supports Kimi thinking.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning content: `choices[0].delta.reasoning_content` if present; ignore for visible room output in MVP.
- Terminal marker: `[DONE]`.

### 5.3 MiniMax

Official docs:

- OpenAI-compatible API: https://platform.minimax.io/docs/api-reference/text-openai-api

Adapter id:

```text
minimax
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://api.minimax.io/v1
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 1.0
}
```

Advanced optional fields:

- `temperature`, constrained to `(0, 1]`; default `1.0`.
- `max_tokens` if accepted by the selected MiniMax model/API compatibility layer.
- `reasoning_split` as boolean. When true, MiniMax can return thinking details separately from content.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning details: `choices[0].delta.reasoning_details` if present; ignore for visible room output in MVP.
- Terminal marker: `[DONE]`.

### 5.4 OpenAI

Official docs:

- Chat Completions API reference: https://platform.openai.com/docs/api-reference/chat/create-chat-completion

Adapter id:

```text
openai
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://api.openai.com/v1
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true
}
```

Advanced optional fields:

- `temperature`, omitted by default because some reasoning models reject sampling parameters.
- `max_completion_tokens` for newer OpenAI models.
- `max_tokens` only for compatibility when a selected model requires legacy Chat Completions behavior.
- `reasoning_effort`, allowed values such as `low`, `medium`, `high` when supported by the selected model.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning fields, if present in future/compatibility responses, are not displayed in MVP.
- Terminal marker: `[DONE]`.

### 5.5 Anthropic Claude API

Official docs:

- Messages examples: https://docs.anthropic.com/en/api/messages-examples
- Streaming Messages: https://docs.anthropic.com/en/api/messages-streaming
- API overview and headers: https://platform.claude.com/docs/claude/reference/getting-started-with-the-api

Adapter id:

```text
anthropic
```

Protocol family:

```text
anthropic-messages
```

Default base URL:

```text
https://api.anthropic.com/v1
```

Endpoint:

```text
POST /messages
```

Headers:

```text
x-api-key: <apiKey>
anthropic-version: 2023-06-01
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "system": "<CACP LLM API Agent system prompt>",
  "messages": [
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "max_tokens": 1024
}
```

Advanced optional fields:

- `max_tokens`.
- `temperature`, omitted by default.
- `thinking`, shaped as `{ "type": "enabled", "budget_tokens": <number> }` when the selected Claude model supports extended thinking.

Streaming extraction:

- Final answer text: `content_block_delta` events with `delta.type === "text_delta"`.
- Thinking deltas, if present, are ignored for visible room output in MVP.
- Terminal event: `message_stop`.
- Error event: `event: error`.

### 5.6 GLM official / Zhipu / Z.ai

Official docs:

- Z.ai Chat Completion API: https://docs.z.ai/api-reference/llm/chat-completion
- GLM-5.1 model/API examples: https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1

Adapter id:

```text
glm-official
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://open.bigmodel.cn/api/paas/v4
```

Alternate official base URL:

```text
https://api.z.ai/api/paas/v4
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 1.0,
  "max_tokens": 1024
}
```

Advanced optional fields:

- `temperature`.
- `max_tokens`.
- `thinking.type`, allowed values `enabled` or `disabled` when supported by the selected GLM model.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning content: `choices[0].delta.reasoning_content` if present; ignore for visible room output in MVP.
- Terminal marker: `[DONE]` if returned by the compatibility stream.

### 5.7 DeepSeek official

Official docs:

- Chat Completion API: https://api-docs.deepseek.com/api/create-chat-completion
- Thinking Mode: https://api-docs.deepseek.com/guides/thinking_mode
- Streaming reasoning example: https://api-docs.deepseek.com/guides/reasoning_model_api_example_streaming

Adapter id:

```text
deepseek
```

Protocol family:

```text
openai-chat
```

Default base URL:

```text
https://api.deepseek.com
```

Endpoint:

```text
POST /chat/completions
```

Headers:

```text
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Required fields:

- API key.
- Model.

Default request body:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 1.0,
  "max_tokens": 1024
}
```

Advanced optional fields:

- `temperature`. For reasoning models, users may leave this blank to avoid unsupported sampling controls.
- `max_tokens`.
- `thinking.type`, allowed values `enabled` or `disabled`; official docs describe this as the thinking/non-thinking switch.
- `reasoning_effort`, allowed values `high` or `max`; compatibility aliases such as `low`, `medium`, and `xhigh` may be mapped by the provider.

Streaming extraction:

- Final answer text: `choices[0].delta.content`.
- Reasoning content: `choices[0].delta.reasoning_content` if present; ignore for visible room output in MVP.
- Terminal marker: `[DONE]`.

Notes:

- DeepSeek thinking mode can stream reasoning content before final answer content. CACP should not display or persist that reasoning content by default.
- CACP MVP does not use tool calls for LLM API agents. Therefore the connector does not need to preserve or replay DeepSeek reasoning content for tool-call continuation.

### 5.8 Custom OpenAI-compatible

Adapter id:

```text
custom-openai-compatible
```

Required fields:

- Base URL.
- API key.
- Model.

Request body uses the existing OpenAI-compatible default:

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Advanced optional fields should be minimal for MVP: temperature and max tokens only.

### 5.9 Custom Anthropic-compatible

Adapter id:

```text
custom-anthropic-compatible
```

Required fields:

- Base URL.
- API key.
- Model.

Request body uses the existing Anthropic-compatible default:

```json
{
  "model": "<model>",
  "system": "<system prompt>",
  "messages": [
    { "role": "user", "content": "<context_prompt>" }
  ],
  "stream": true,
  "max_tokens": 1024
}
```

Advanced optional fields should be minimal for MVP: max tokens and temperature only.

## 6. Connector architecture

Create a provider adapter registry under `packages/cli-adapter/src/llm/providers/`.

Suggested file structure:

```text
packages/cli-adapter/src/llm/
  types.ts
  config-wizard.ts
  runner.ts
  sse.ts
  sanitize.ts
  providers/
    registry.ts
    types.ts
    openai-chat.ts
    anthropic-messages.ts
    siliconflow.ts
    kimi.ts
    minimax.ts
    openai.ts
    anthropic.ts
    glm-official.ts
    deepseek.ts
    custom-openai-compatible.ts
    custom-anthropic-compatible.ts
```

The two transport-level runners are reusable:

- `openai-chat.ts`: builds and streams Chat Completions-like requests.
- `anthropic-messages.ts`: builds and streams Anthropic Messages-like requests.

Provider-specific files define metadata and request-body transformations.

### 6.1 Adapter interface

```ts
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

export interface LlmProviderAdapter {
  id: LlmProviderId;
  label: string;
  protocol: LlmProtocolFamily;
  defaultBaseUrl?: string;
  alternateBaseUrls?: string[];
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  requiredFields: Array<"apiKey" | "model" | "baseUrl">;
  advancedFields: ProviderAdvancedField[];
  buildRequest(input: BuildProviderRequestInput): ProviderRequest;
  extractTextDelta(event: SseEvent): string | undefined;
  extractReasoningDelta?(event: SseEvent): string | undefined;
  isTerminalEvent(event: SseEvent): boolean;
  extractProviderError?(event: SseEvent): string | undefined;
}
```

### 6.2 Runtime config shape

Current config:

```ts
interface LlmProviderConfig {
  provider: "openai-compatible" | "anthropic-compatible";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}
```

Replace with:

```ts
interface LlmProviderConfig {
  providerId: LlmProviderId;
  protocol: LlmProtocolFamily;
  baseUrl: string;
  model: string;
  apiKey: string;
  options: Record<string, unknown>;
}
```

`options` remains local-only. It must never be included in server claim/register payloads or room events.

## 7. Request building rules

### 7.1 Base URL normalization

Provider adapters declare whether their `defaultBaseUrl` includes a version prefix.

Examples:

- SiliconFlow: base `https://api.siliconflow.cn/v1`, append `/chat/completions`.
- Kimi: base `https://api.moonshot.ai/v1`, append `/chat/completions`.
- MiniMax: base `https://api.minimax.io/v1`, append `/chat/completions`.
- OpenAI: base `https://api.openai.com/v1`, append `/chat/completions`.
- Anthropic: base `https://api.anthropic.com/v1`, append `/messages`.
- GLM official: base `https://open.bigmodel.cn/api/paas/v4`, append `/chat/completions`.
- DeepSeek official: base `https://api.deepseek.com`, append `/chat/completions`.

If a user accidentally enters a full endpoint ending in `/chat/completions` or `/messages`, the connector should either normalize it safely or print a clear warning. The previous SiliconFlow local note mistake showed this is easy to get wrong.

### 7.2 Connectivity validation

Connectivity validation must use the selected provider adapter and the same stream parser as normal turns.

Validation prompt:

```text
Connectivity test. Reply with a short OK.
```

Validation constraints:

- Use `stream: true`.
- Use a small output budget.
- Do not include room history or user content.
- Succeed only if at least one final-answer text delta is received or the provider returns a valid terminal response with text.
- Fail with sanitized, useful errors.

### 7.3 Reasoning/thinking output

Providers may return reasoning content in fields such as:

- `choices[0].delta.reasoning_content`.
- `choices[0].delta.reasoning_details`.
- Anthropic thinking content blocks.

MVP policy:

- Do not send reasoning deltas to `/agent-turns/:turnId/delta`.
- Do not include reasoning content in final room message.
- Do not write reasoning content into the chat transcript.
- Reasoning support only controls provider behavior; it does not expose chain-of-thought to users.

A later feature can add a separate visible "thinking summary" surface if needed.

## 8. Console UX

Example SiliconFlow happy path:

```text
This connection is for an LLM API Agent.
Provider settings are required for this connector session.
API keys stay on this machine and are never sent to the CACP room server.

Choose LLM API provider:
1) SiliconFlow
2) Kimi / Moonshot
3) MiniMax
4) OpenAI
5) Anthropic Claude API
6) GLM official / Zhipu / Z.ai
7) DeepSeek official
8) Custom OpenAI-compatible
9) Custom Anthropic-compatible
Provider [1-9]: 1

Base URL [https://api.siliconflow.cn/v1]:
Model: Qwen/Qwen3.5-4B
API Key: ********
Configure advanced provider options? [y/N]: y
Temperature [0.7]: 1
Max tokens [1024]: 4096
Enable thinking [provider default / y / n]: y
Thinking budget [4096, 128-32768]: 4096
min_p [blank=provider default, 0-1]:

Running LLM API connectivity test...
LLM API connectivity test succeeded. The agent will now connect to the room.
```

Example GLM official happy path:

```text
Provider [1-9]: 6
Base URL [https://open.bigmodel.cn/api/paas/v4]:
Model: glm-5.1
API Key: ********
Configure advanced provider options? [y/N]: y
Temperature [1.0]:
Max tokens [1024]: 4096
Thinking mode [provider default / enabled / disabled]: enabled
```

Example DeepSeek official happy path:

```text
Provider [1-9]: 7
Base URL [https://api.deepseek.com]:
Model: deepseek-v4-pro
API Key: ********
Configure advanced provider options? [y/N]: y
Temperature [1.0]:
Max tokens [1024]: 4096
Thinking mode [provider default / enabled / disabled]: enabled
Reasoning effort [provider default / high / max]: high
```

If validation fails:

```text
LLM API connectivity test failed.
Status: 401 Unauthorized
Provider error: invalid API key
Re-enter LLM API settings? [Y/n]:
```

## 9. Error handling and sanitization

All errors that leave the provider adapter must be sanitized before:

- Printing to console.
- Posting to Server turn fail endpoints.
- Writing transcript or event-derived logs.

Sanitization must redact:

- Exact API key value.
- `Authorization: Bearer ...`.
- `x-api-key: ...`.
- Common JSON forms such as `"api_key":"..."` and `"apiKey":"..."`.

Provider HTTP errors should be formatted as:

```text
Status: <code> <statusText>
Provider error: <provider message if available>
```

Raw full request bodies and headers must never be included in errors.

## 10. Server and Web changes

### 10.1 Protocol/server

- Add `llm-api` to server agent type values.
- Keep legacy LLM type values accepted.
- LLM agent profile remains pure conversation:

```text
capabilities: ["llm.api", "chat.stream"]
command: ""
args: []
```

- Do not add provider id, model, base URL, or API parameters to server events.

### 10.2 Web

- Show a single LLM API Agent option.
- Hide permission selector for LLM API Agent.
- Keep cloud connector modal and local launch behavior.
- Update copy to say provider is selected in Local Connector console.

## 11. Testing requirements

### 11.1 Connector unit tests

Provider registry:

- Lists all nine provider choices in stable order.
- Returns default base URLs for provider adapters.
- Rejects unknown provider ids.

Wizard:

- Prompts provider selection before API settings.
- Accepts default provider base URL when user presses Enter.
- Collects only required fields when advanced options are declined.
- Collects SiliconFlow advanced `enable_thinking`, `thinking_budget`, and `min_p`.
- Collects Kimi / GLM / DeepSeek `thinking.type`.
- Collects MiniMax `reasoning_split`.
- Collects OpenAI `reasoning_effort` and `max_completion_tokens`.
- Collects Anthropic `thinking.budget_tokens` only when advanced options are enabled.
- Does not print or return API key in logs/errors except inside local runtime config.
- Closes readline in success, retry, cancel, and Ctrl+C paths.

Request builders:

- SiliconFlow request includes `enable_thinking` only when configured.
- SiliconFlow request omits thinking fields when not configured.
- GLM request can include `thinking: { type: "enabled" }`.
- DeepSeek request can include `reasoning_effort` and `thinking: { type: "enabled" }`.
- MiniMax request can include `reasoning_split`.
- OpenAI request can include `max_completion_tokens` and `reasoning_effort`.
- Anthropic request uses `/messages`, `x-api-key`, and `anthropic-version`.
- Custom adapters retain current compatibility behavior.

Streaming:

- OpenAI-chat parser extracts content deltas and ignores reasoning deltas.
- MiniMax parser ignores `reasoning_details` for visible output.
- GLM parser ignores `reasoning_content` for visible output.
- DeepSeek parser ignores `reasoning_content` for visible output.
- Anthropic parser extracts `text_delta` and ignores thinking blocks.
- Provider `event: error` fails the turn with sanitized details.

Config/claim:

- LLM configuration still occurs before pairing claim.
- Failed validation does not claim/register the agent.
- Cancelled provider setup does not claim/register the agent.

### 11.2 Server tests

- `llm-api` is accepted in pairing creation.
- Legacy LLM types are still accepted.
- Connection codes round-trip `llm-api`.
- Claimed `llm-api` agents register pure conversation capabilities.

### 11.3 Web tests

- Create-room UI shows one LLM API Agent option.
- Permission selector is hidden for LLM API Agent.
- Copy says provider/API key are configured in the Local Connector console.
- Create-room submits `agentType: "llm-api"`.

### 11.4 Full validation

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
corepack pnpm check
```

Manual validation:

1. Create a room with LLM API Agent.
2. Confirm Local Connector console asks for provider selection.
3. Select SiliconFlow, enter local test values, verify connectivity succeeds before agent registration.
4. Send a live message and confirm streaming final answer appears in the room.
5. Select GLM official with a valid model and verify connectivity succeeds.
6. Select DeepSeek official with `deepseek-v4-flash`, `deepseek-v4-pro`, or another currently enabled account model and verify connectivity succeeds.
7. Enter an invalid key and confirm sanitized validation failure plus no agent registration.
8. Confirm API key/provider details are absent from server events and tracked files.

## 12. Migration plan

Implementation should be staged:

1. Add provider registry and shared provider config shape while preserving existing provider runners.
2. Refactor console wizard to choose provider and collect required fields.
3. Move current OpenAI-compatible logic behind `custom-openai-compatible` and provider-specific OpenAI-chat adapters.
4. Move current Anthropic-compatible logic behind `custom-anthropic-compatible` and Anthropic Claude adapter.
5. Add `llm-api` server type and update Web to use the single LLM API Agent option.
6. Keep legacy connection codes working.
7. Remove or hide Web provider-family labels after tests pass.

## 13. Security and local-only data

- API keys remain in memory inside the Local Connector process.
- Provider id, model, base URL, and advanced options are local-only unless explicitly shown in console for user confirmation.
- Do not send provider config to Server.
- Do not commit `docs/examples/llm-api-agent.local.md` or any `*.local.md` / `*.local.json` provider notes.
- Do not add real API endpoints beyond public provider base URLs in committed examples.
- Do not log request bodies containing API keys.

## 14. Acceptance criteria

The feature is ready when:

- Web exposes one LLM API Agent choice.
- Connector console lets users choose SiliconFlow, Kimi/Moonshot, MiniMax, OpenAI, Anthropic Claude API, GLM official, DeepSeek official, or custom compatible adapters.
- Each provider adapter builds the correct request shape for its API family.
- Connectivity validation succeeds/fails before claim and prints explicit sanitized results.
- Streaming final answer output works for OpenAI-chat and Anthropic Messages families.
- Reasoning/thinking output is not exposed in room transcript by default.
- Legacy LLM connection codes remain compatible.
- `corepack pnpm check` passes.
