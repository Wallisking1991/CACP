import { buildOpenAiChatRequest, extractOpenAiChatText, extractOpenAiProviderError, isOpenAiChatTerminalEvent } from "./openai-chat.js";
import type { LlmProviderAdapter } from "./types.js";

export const siliconFlowAdapter: LlmProviderAdapter = {
  id: "siliconflow",
  label: "SiliconFlow",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.siliconflow.cn/v1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    if (input.options.enable_thinking !== undefined) extras.enable_thinking = input.options.enable_thinking;
    if (input.options.thinking_budget !== undefined) extras.thinking_budget = input.options.thinking_budget;
    if (input.options.min_p !== undefined) extras.min_p = input.options.min_p;
    return buildOpenAiChatRequest(input, extras);
  },
  extractTextDelta: extractOpenAiChatText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isOpenAiChatTerminalEvent,
  extractProviderError: extractOpenAiProviderError
};
