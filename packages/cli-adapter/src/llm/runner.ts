import { runAnthropicCompatibleMessages } from "./anthropic-compatible.js";
import { runOpenAiCompatibleChat } from "./openai-compatible.js";
import type { LlmProviderConfig, LlmRunResult } from "./types.js";

export interface LlmTurnRunners {
  runOpenAi: typeof runOpenAiCompatibleChat;
  runAnthropic: typeof runAnthropicCompatibleMessages;
}

export interface RunLlmTurnOptions {
  llm: LlmProviderConfig;
  prompt: string;
  systemPrompt?: string;
  onDelta: (chunk: string) => void | Promise<void>;
  runners?: LlmTurnRunners;
}

export async function runLlmTurn(options: RunLlmTurnOptions): Promise<LlmRunResult> {
  const runners = options.runners ?? { runOpenAi: runOpenAiCompatibleChat, runAnthropic: runAnthropicCompatibleMessages };
  if (options.llm.provider === "openai-compatible") {
    return await runners.runOpenAi({ config: options.llm, prompt: options.prompt, systemPrompt: options.systemPrompt, onDelta: options.onDelta });
  }
  return await runners.runAnthropic({ config: options.llm, prompt: options.prompt, systemPrompt: options.systemPrompt, onDelta: options.onDelta });
}
