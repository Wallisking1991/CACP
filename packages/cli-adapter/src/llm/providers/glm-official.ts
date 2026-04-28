import type { LlmProviderAdapter } from "./types.js";

export const glmOfficialAdapter: LlmProviderAdapter = {
  id: "glm-official",
  label: "GLM official / Zhipu / Z.ai",
  protocol: "openai-chat",
  endpointPath: "/chat/completions",
  defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  alternateBaseUrls: ["https://api.z.ai/api/paas/v4"],
  defaultTemperature: 1.0,
  defaultMaxTokens: 1024,
  buildRequest: () => { throw new Error("provider_request_builder_not_ready"); },
  extractTextDelta: () => undefined,
  extractReasoningDelta: () => undefined,
  isTerminalEvent: () => false,
  extractProviderError: () => undefined
};
