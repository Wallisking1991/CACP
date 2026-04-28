import { buildOpenAiChatRequest, extractOpenAiChatText, extractOpenAiProviderError, isOpenAiChatTerminalEvent } from "./openai-chat.js";
import type { LlmProviderAdapter } from "./types.js";

export const minimaxAdapter: LlmProviderAdapter = {
  id: "minimax",
  label: "MiniMax",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.minimax.io/v1",
  defaultTemperature: 1.0,
  defaultMaxTokens: 1024,
  buildRequest(input) {
    const extras: Record<string, unknown> = {};
    if (input.options.temperature !== undefined) extras.temperature = input.options.temperature;
    if (input.options.max_tokens !== undefined) extras.max_tokens = input.options.max_tokens;
    // Default reasoning_split to true so reasoning content is separated and not leaked into delta.content
    extras.reasoning_split = input.options.reasoning_split ?? true;
    return buildOpenAiChatRequest(input, extras);
  },
  extractTextDelta: extractOpenAiChatText,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: isOpenAiChatTerminalEvent,
  extractProviderError: extractOpenAiProviderError
};
