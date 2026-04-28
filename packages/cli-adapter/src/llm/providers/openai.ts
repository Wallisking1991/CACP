import type { LlmProviderAdapter } from "./types.js";

export const openAiAdapter: LlmProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultTemperature: undefined,
  defaultMaxTokens: undefined,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
