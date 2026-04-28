# LLM API Agent Design

Date: 2026-04-28
Status: Approved design for implementation planning
Scope: Add pure conversation LLM API agents to the existing CACP Local Connector flow.

## 1. Background

CACP currently supports local command-style agents through the CACP Local Connector. Those agents are launched or paired with a room, receive `agent.turn.requested` events, run a local command, stream output back through `agent.output.delta`, and complete the turn with `agent.turn.completed` plus a final room message.

The next capability is to let a room use a directly called LLM API as its active agent. The user wants this as an extension of the CACP Local Connector, not as a server-hosted model runtime. Development testing may use any OpenAI-compatible provider, but provider-specific examples are local-only development notes and must not become product presets or committed configuration.

## 2. Goals

- Add LLM API agent choices to the create-room flow.
- Support two provider families:
  - OpenAI-compatible API.
  - Anthropic-compatible API.
- Keep API keys local to the user's Local Connector process.
- Collect LLM API settings through a temporary console wizard after the connection code is entered or after a local auto-launch starts.
- Stream model output into the existing CACP room event flow.
- Preserve the existing multi-person and Roundtable Mode conversation model.
- Avoid committing provider secrets, local deployment data, or local development examples.

## 3. Non-goals

This design does not include:

- Server-side storage or forwarding of provider API keys.
- Web UI API-key entry.
- Built-in vendor or model presets.
- Automatic fallback to non-streaming responses.
- Tool use, function calling, MCP bridge, or local file/command execution for LLM API agents.
- Connector-side persistent conversation memory.
- Cost, usage, or billing display.
- Model switching after a connector session has started.

## 4. Architecture

Use one product surface: **CACP Local Connector**.

Internally, the current `@cacp/cli-adapter` package can remain the implementation package for MVP, but it should be organized as a multi-runner connector:

```text
packages/cli-adapter/src/
  index.ts                  # pairing, websocket, turn dispatch
  runner.ts                 # existing command runner
  llm/
    types.ts                # shared LLM provider config/result types
    config-wizard.ts        # temporary console input
    openai-compatible.ts    # streaming chat completions runner
    anthropic-compatible.ts # streaming messages runner
```

The existing command-agent types keep using the command runner. New LLM API types use the LLM runner and never spawn a local agent command for a turn.

## 5. Agent types

Add two room pairing agent types:

```text
llm-openai-compatible
llm-anthropic-compatible
```

These are pure conversation agents. They should advertise capabilities such as:

```text
llm.api
chat.stream
llm.openai_compatible or llm.anthropic_compatible
```

They should not advertise file, shell, or write permissions. They do not use the existing read-only / limited-write / full-access semantics. The Web create-room UI should hide permission selection when an LLM API agent type is selected.

## 6. Create-room and pairing flow

### 6.1 Local development mode

When the server can locally launch the connector:

1. User creates a room and selects `OpenAI-compatible API` or `Anthropic-compatible API`.
2. Server creates the room and pairing using the selected agent type.
3. Server auto-launches the Local Connector console.
4. Connector parses the connection payload and sees the LLM API agent type.
5. Connector displays a notice that provider settings are required for this session and that API keys stay local.
6. Connector runs the LLM API console wizard.
7. Only after successful local configuration does the connector claim the pairing and register the agent.
8. Server marks the agent online and may auto-select it as the active agent.

### 6.2 Cloud/download mode

When the server cannot launch a local process:

1. User creates a room and selects an LLM API agent type.
2. Web UI shows the Local Connector download plus connection code.
3. User starts the connector and pastes the connection code.
4. Connector detects the LLM API agent type.
5. Connector prompts for temporary provider settings.
6. After successful configuration, connector claims the pairing and connects to the room stream.

### 6.3 Why configuration happens before claim

The connector must configure the local LLM provider before claiming/registering the pairing. This avoids:

- A failed or cancelled provider configuration leaving a misleading online agent in the room.
- API-key or provider details entering server events.
- A half-configured agent being auto-selected.

The flow is therefore:

```text
parse connection code
  -> if LLM API: collect temporary local settings
  -> claim pairing
  -> register/online agent
  -> connect websocket stream
```

## 7. Console wizard

When the connection is for an LLM API agent, the connector should show a clear message before collecting settings:

```text
This connection is for an LLM API Agent.
Provider settings are required for this connector session.
API keys stay on this machine and are never sent to the CACP room server.
```

The wizard should not offer vendor presets. Provider family comes from the agent type selected in the Web UI. The user manually enters endpoint and model details.

### 7.1 OpenAI-compatible fields

```text
Base URL       required
Model          required
API Key        required, hidden input when possible
Temperature    optional, default 0.7
Max tokens     optional, default 1024
```

### 7.2 Anthropic-compatible fields

```text
Base URL          required
Model             required
API Key           required, hidden input when possible
Temperature       optional, default 0.7
Max tokens        optional, default 1024
Anthropic version fixed to a safe code default for MVP
```

### 7.3 Secret handling

The connector must not print, persist, or send the API key to the server. Hidden input should be attempted. If the terminal cannot hide input, the connector should warn the user before accepting the key.

The API key must not appear in:

- stdout/stderr logs.
- CACP events.
- room transcripts.
- committed docs or examples.

## 8. Conversation context

MVP uses the existing server-built `context_prompt` from `agent.turn.requested`.

The connector does not reconstruct structured multi-turn messages from the room event stream in this iteration. Instead, it maps each turn to a provider request containing:

- a CACP LLM API Agent system prompt, and
- the current server-generated `context_prompt` as the user content.

For OpenAI-compatible APIs, the request is shaped like:

```json
{
  "model": "<user-entered-model>",
  "messages": [
    { "role": "system", "content": "<CACP LLM API Agent system prompt>" },
    { "role": "user", "content": "<context_prompt from CACP server>" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

For Anthropic-compatible APIs, the request is shaped like:

```json
{
  "model": "<user-entered-model>",
  "system": "<CACP LLM API Agent system prompt>",
  "messages": [
    { "role": "user", "content": "<context_prompt from CACP server>" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

This preserves the current CACP multi-person model:

- normal room messages trigger live AI turns,
- Roundtable Mode collects multiple human responses before sending them to the active agent,
- the server builds a collected-answers context prompt for the next agent turn.

## 9. Streaming output

Streaming is required for MVP.

The connector maps provider stream deltas into existing turn output endpoints:

```text
provider stream text chunk
  -> POST /rooms/:roomId/agent-turns/:turnId/delta
  -> server emits agent.output.delta
  -> web displays incremental output
```

When the provider stream ends, the connector sends the accumulated final text:

```text
POST /rooms/:roomId/agent-turns/:turnId/complete
```

The server then emits `agent.turn.completed` and the final `message.created` event, as it already does for command agents.

### 9.1 OpenAI-compatible streaming parser

The runner should parse Server-Sent Events lines. For normal chunks, extract text from:

```text
choices[0].delta.content
```

The runner treats `[DONE]` as stream completion.

### 9.2 Anthropic-compatible streaming parser

The runner should parse Anthropic-style streaming events and extract text deltas from text delta events. Message-stop or equivalent terminal stream events complete the turn.

## 10. Error handling

MVP does not silently fall back to non-streaming mode.

If provider configuration, authentication, network access, model availability, rate limits, or stream parsing fails during a turn, the connector reports:

```text
POST /rooms/:roomId/agent-turns/:turnId/fail
```

The error message should be useful but sanitized. It must not include API keys or full authorization headers.

If the user cancels the console wizard before claim, the connector should exit without registering an agent.

## 11. Web UI behavior

The create-room screen should group or clearly label agent choices:

```text
Local command agents
- Claude Code
- Codex
- opencode
- Echo

LLM API agents
- OpenAI-compatible API
- Anthropic-compatible API
```

When an LLM API agent is selected:

- hide the permission-level selector,
- show explanatory copy that API keys are entered in the Local Connector console only,
- keep local-mode auto-launch behavior,
- keep cloud-mode download plus connection-code behavior.

## 12. Documentation and local examples

Committed documentation should describe generic fields and safety boundaries only. It should not include vendor-specific model presets or real endpoint/key examples as product defaults.

A local ignored development note may be created for manual testing, for example:

```text
docs/examples/llm-api-agent.local.md
```

This file can contain the developer's temporary provider values, but it must not be committed.

The repository ignore rules should cover:

```gitignore
docs/examples/*.local.json
docs/examples/*.local.md
```

## 13. Tests

### 13.1 Protocol and server tests

- New LLM API agent types are accepted by pairing schemas.
- Connection codes round-trip new LLM API agent types.
- Pairing claim for an LLM API agent registers an agent participant.
- LLM API agent registration stores pure conversation capabilities.
- LLM API agents can become active agents.

### 13.2 Connector tests

- Command agent connection codes continue using the command runner.
- LLM API agent connection codes trigger the console wizard before claim.
- Cancelled or failed LLM configuration does not claim/register the pairing.
- OpenAI-compatible stream parser extracts text deltas and handles `[DONE]`.
- Anthropic-compatible stream parser extracts text deltas and detects completion.
- Sanitization prevents API keys from appearing in logs, transcript output, or events.

### 13.3 Web tests

- Create-room UI includes the two LLM API choices.
- Permission selection is hidden for LLM API agents.
- API-key-local-only explanatory text appears for LLM API agents.
- Existing command-agent create-room behavior still works.
- Cloud connector modal remains available for LLM API agents.

## 14. Manual validation

Manual validation should include:

1. Start server and web locally.
2. Create a room with `OpenAI-compatible API`.
3. Confirm the Local Connector console launches automatically.
4. Confirm the console says LLM API provider settings are required and keys stay local.
5. Enter development test provider values.
6. Confirm the agent appears online in the room.
7. Send a normal message and observe streaming output.
8. Start Roundtable Mode, collect multiple human messages, submit, and observe an LLM response based on collected context.
9. Stop the connector and verify API-key material is absent from server events, logs, transcripts, tracked docs, and Git status.

## 15. Implementation boundary

This design intentionally keeps the first LLM API integration close to the current CACP turn model. It unlocks real API-backed room conversation while preserving the local-first security boundary. Structured provider-native multi-turn message history, tool use, and provider-specific advanced features are future extensions.

## 16. References

- Anthropic Messages API examples: https://docs.anthropic.com/en/api/messages-examples
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat/create-chat-completion
