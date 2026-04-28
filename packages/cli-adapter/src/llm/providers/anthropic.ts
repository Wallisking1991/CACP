import type { LlmProviderAdapter } from "./types.js";

export const anthropicAdapter: LlmProviderAdapter = {
  id: "anthropic",
  label: "Anthropic Claude API",
  protocol: "anthropic-messages",
  endpointPath: "/messages",
  defaultBaseUrl: "https://api.anthropic.com/v1",
  defaultTemperature: undefined,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
