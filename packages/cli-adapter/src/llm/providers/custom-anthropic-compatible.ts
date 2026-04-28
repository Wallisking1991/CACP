import { buildAnthropicMessagesRequest, extractAnthropicText, extractAnthropicError, isAnthropicTerminalEvent } from "./anthropic-messages.js";
import type { LlmProviderAdapter } from "./types.js";

export const customAnthropicCompatibleAdapter: LlmProviderAdapter = {
  id: "custom-anthropic-compatible",
  label: "Custom Anthropic-compatible",
  protocol: "anthropic-messages",
  endpointPath: "/messages",
  defaultTemperature: undefined,
  defaultMaxTokens: 1024,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    return buildAnthropicMessagesRequest(input, extras);
  },
  extractTextDelta: extractAnthropicText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isAnthropicTerminalEvent,
  extractProviderError: extractAnthropicError
};
