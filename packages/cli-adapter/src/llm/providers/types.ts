import type { SseEvent } from "../sse.js";

export type LlmProviderId =
  | "siliconflow"
  | "kimi"
  | "minimax"
  | "openai"
  | "anthropic"
  | "glm-official"
  | "deepseek"
  | "custom-openai-compatible"
  | "custom-anthropic-compatible";

export type LlmProtocolFamily = "openai-chat" | "anthropic-messages";

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface BuildProviderRequestInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  systemPrompt: string;
  options: Record<string, unknown>;
  maxTokensOverride?: number;
}

export interface LlmProviderAdapter {
  id: LlmProviderId;
  label: string;
  protocol: LlmProtocolFamily;
  endpointPath: "/chat/completions" | "/messages";
  defaultBaseUrl?: string;
  alternateBaseUrls?: string[];
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  buildRequest(input: BuildProviderRequestInput): ProviderRequest;
  extractTextDelta(event: SseEvent): string | undefined;
  extractReasoningDelta?(event: SseEvent): string | undefined;
  isTerminalEvent(event: SseEvent): boolean;
  extractProviderError(event: SseEvent): string | undefined;
}
