import type { LlmProviderAdapter } from "./types.js";

export const customOpenAiCompatibleAdapter: LlmProviderAdapter = {
  id: "custom-openai-compatible",
  label: "Custom OpenAI-compatible",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
