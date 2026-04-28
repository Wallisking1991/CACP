import { buildAnthropicMessagesRequest, extractAnthropicText, extractAnthropicError, isAnthropicTerminalEvent } from "./anthropic-messages.js";
import type { LlmProviderAdapter } from "./types.js";

export const anthropicAdapter: LlmProviderAdapter = {
  id: "anthropic",
  label: "Anthropic Claude API",
  protocol: "anthropic-messages",
  endpointPath: "/messages",
  defaultBaseUrl: "https://api.anthropic.com/v1",
  defaultTemperature: undefined,
  defaultMaxTokens: 1024,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    if (input.options.thinking_budget_tokens !== undefined) {
      extras.thinking = { type: "enabled", budget_tokens: input.options.thinking_budget_tokens };
    }
    return buildAnthropicMessagesRequest(input, extras);
  },
  extractTextDelta: extractAnthropicText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isAnthropicTerminalEvent,
  extractProviderError: extractAnthropicError
};
