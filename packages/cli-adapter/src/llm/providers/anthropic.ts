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

    if (thinkingType === "enabled") {
      // Use user-provided budget or a safe default so thinking is not silently disabled
      const budget = typeof thinkingBudget === "number" && thinkingBudget > 0 ? thinkingBudget : 1024;
      extras.thinking = { type: "enabled", budget_tokens: budget };
      // Anthropic requires max_tokens > budget_tokens when thinking is enabled
      const userMax = typeof input.options.max_tokens === "number" && input.options.max_tokens > 0 ? input.options.max_tokens : 0;
      extras.max_tokens = Math.max(userMax, budget + 1024);
    } else if (thinkingType === "adaptive") {
      extras.thinking = { type: "adaptive" };
      if (typeof thinkingEffort === "string") {
        extras.output_config = { effort: thinkingEffort };
      }
    } else if (thinkingType === "disabled") {
      extras.thinking = { type: "disabled" };
    }

    // Only set temperature when thinking is not enabled (Anthropic constraint)
    if (input.options.temperature !== undefined && thinkingType !== "enabled") {
      extras.temperature = input.options.temperature;
    }
    if (thinkingType !== "enabled" && input.options.max_tokens !== undefined) {
      extras.max_tokens = input.options.max_tokens;
    }
    return buildAnthropicMessagesRequest(input, extras);
  },
  extractTextDelta: extractAnthropicText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isAnthropicTerminalEvent,
  extractProviderError: extractAnthropicError
};
