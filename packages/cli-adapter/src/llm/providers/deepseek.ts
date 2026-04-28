import { buildOpenAiChatRequest, extractOpenAiChatText, extractOpenAiProviderError, isOpenAiChatTerminalEvent } from "./openai-chat.js";
import type { LlmProviderAdapter } from "./types.js";

export const deepseekAdapter: LlmProviderAdapter = {
  id: "deepseek",
  label: "DeepSeek official",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.deepseek.com",
  defaultTemperature: 1.0,
  defaultMaxTokens: 1024,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    if (input.options.thinking_type !== undefined) extras.thinking = { type: input.options.thinking_type };
    if (input.options.reasoning_effort !== undefined) extras.reasoning_effort = input.options.reasoning_effort;
    return buildOpenAiChatRequest(input, extras);
  },
  extractTextDelta: extractOpenAiChatText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isOpenAiChatTerminalEvent,
  extractProviderError: extractOpenAiProviderError
};
