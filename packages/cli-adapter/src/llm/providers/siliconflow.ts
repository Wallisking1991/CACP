import type { LlmProviderAdapter } from "./types.js";

export const siliconFlowAdapter: LlmProviderAdapter = {
  id: "siliconflow",
  label: "SiliconFlow",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://api.siliconflow.cn/v1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
