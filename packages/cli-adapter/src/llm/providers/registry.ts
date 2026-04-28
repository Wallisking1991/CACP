import { anthropicAdapter } from "./anthropic.js";
import { customAnthropicCompatibleAdapter } from "./custom-anthropic-compatible.js";
import { customOpenAiCompatibleAdapter } from "./custom-openai-compatible.js";
import { deepseekAdapter } from "./deepseek.js";
import { glmOfficialAdapter } from "./glm-official.js";
import { kimiAdapter } from "./kimi.js";
import { minimaxAdapter } from "./minimax.js";
import { openAiAdapter } from "./openai.js";
import { siliconFlowAdapter } from "./siliconflow.js";
import type { LlmProviderAdapter, LlmProviderId } from "./types.js";

const adapters = [
  siliconFlowAdapter,
  kimiAdapter,
  minimaxAdapter,
  openAiAdapter,
  anthropicAdapter,
  glmOfficialAdapter,
  deepseekAdapter,
  customOpenAiCompatibleAdapter,
  customAnthropicCompatibleAdapter
] as const satisfies readonly LlmProviderAdapter[];

export function listProviderAdapters(): readonly LlmProviderAdapter[] {
  return adapters;
}

export function getProviderAdapter(id: LlmProviderId): LlmProviderAdapter {
  const adapter = adapters.find((item) => item.id === id);
  if (!adapter) throw new Error(`unknown_llm_provider: ${id}`);
  return adapter;
}
