export type LlmProvider = "openai-compatible" | "anthropic-compatible";
export type LlmAgentType = "llm-openai-compatible" | "llm-anthropic-compatible";

export interface LlmProviderConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

export interface LlmRunOptions {
  config: LlmProviderConfig;
  prompt: string;
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  onDelta: (chunk: string) => void | Promise<void>;
  maxTokensOverride?: number;
}

export interface LlmRunResult {
  finalText: string;
}

export interface LlmConnectivityResult {
  ok: true;
  sampleText: string;
}

export function isLlmAgentType(agentType: string | undefined): agentType is LlmAgentType {
  return agentType === "llm-openai-compatible" || agentType === "llm-anthropic-compatible";
}

export function providerForAgentType(agentType: LlmAgentType): LlmProvider {
  return agentType === "llm-openai-compatible" ? "openai-compatible" : "anthropic-compatible";
}

export const DefaultLlmSystemPrompt = "You are an LLM API Agent connected to a CACP multi-user AI room. You are a pure conversation agent and must not claim to read files, write files, run commands, call tools, or access private systems.";
