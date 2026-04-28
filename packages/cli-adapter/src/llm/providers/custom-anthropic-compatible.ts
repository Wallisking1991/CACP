import type { LlmProviderAdapter } from "./types.js";

export const customAnthropicCompatibleAdapter: LlmProviderAdapter = {
  id: "custom-anthropic-compatible",
  label: "Custom Anthropic-compatible",
  protocol: "anthropic-messages",
  endpointPath: "/messages",
  defaultTemperature: undefined,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
