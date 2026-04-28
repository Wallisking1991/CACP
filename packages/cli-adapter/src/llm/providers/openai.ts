import { buildOpenAiChatRequest, extractOpenAiChatText, extractOpenAiProviderError, isOpenAiChatTerminalEvent } from "./openai-chat.js";
import type { LlmProviderAdapter } from "./types.js";

export const openAiAdapter: LlmProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultTemperature: undefined,
  defaultMaxTokens: undefined,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_completion_tokens !== undefined) extras.max_completion_tokens = input.options.max_completion_tokens;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    if (input.options.reasoning_effort !== undefined) extras.reasoning_effort = input.options.reasoning_effort;
    return buildOpenAiChatRequest(input, extras);
  },
  extractTextDelta: extractOpenAiChatText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isOpenAiChatTerminalEvent,
  extractProviderError: extractOpenAiProviderError
};
