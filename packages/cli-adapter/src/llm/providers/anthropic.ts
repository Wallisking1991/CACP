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
    const thinkingType = input.options.thinking_type;
    const thinkingBudget = input.options.thinking_budget_tokens;
    const thinkingEffort = input.options.thinking_effort;

    if (thinkingType === "enabled" && thinkingBudget !== undefined) {
      extras.thinking = { type: "enabled", budget_tokens: thinkingBudget };
      // When thinking is enabled, temperature must not be set (provider constraint)
    } else if (thinkingType === "adaptive" && thinkingEffort !== undefined) {
      extras.thinking = { type: "adaptive", effort: thinkingEffort };
    } else if (thinkingType === "disabled") {
      extras.thinking = { type: "disabled" };
    }

    // Only set temperature when thinking is not enabled (Anthropic constraint)
    if (input.options.temperature !== undefined && thinkingType !== "enabled") {
      extras.temperature = input.options.temperature;
    }
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    return buildAnthropicMessagesRequest(input, extras);
  },
  extractTextDelta: extractAnthropicText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isAnthropicTerminalEvent,
  extractProviderError: extractAnthropicError
};
