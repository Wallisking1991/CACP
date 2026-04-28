import type { LlmProviderAdapter } from "./types.js";

export const kimiAdapter: LlmProviderAdapter = {
  id: "kimi",
  label: "Kimi / Moonshot",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.moonshot.ai/v1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
