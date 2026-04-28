import type { LlmProviderAdapter } from "./types.js";

export const minimaxAdapter: LlmProviderAdapter = {
  id: "minimax",
  label: "MiniMax",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.minimax.io/v1",
  defaultTemperature: 1.0,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
