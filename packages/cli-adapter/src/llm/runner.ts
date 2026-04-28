import { getProviderAdapter } from "./providers/registry.js";
import { DefaultLlmSystemPrompt, type LlmProviderConfig, type LlmRunResult } from "./types.js";
import { parseSseStream } from "./sse.js";
import { sanitizeLlmError } from "./sanitize.js";

export interface RunLlmTurnOptions {
  llm: LlmProviderConfig;
  prompt: string;
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  onDelta: (chunk: string) => void | Promise<void>;
  maxTokensOverride?: number;
}

export async function runLlmTurn(options: RunLlmTurnOptions): Promise<LlmRunResult> {
  const adapter = getProviderAdapter(options.llm.providerId);
  const request = adapter.buildRequest({
    baseUrl: options.llm.baseUrl,
    model: options.llm.model,
    apiKey: options.llm.apiKey,
    prompt: options.prompt,
    systemPrompt: options.systemPrompt ?? DefaultLlmSystemPrompt,
    options: options.llm.options,
    maxTokensOverride: options.maxTokensOverride
  });

  const response = await (options.fetchImpl ?? fetch)(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(sanitizeLlmError(`Status: ${response.status} ${response.statusText}\n${body}`, options.llm.apiKey));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("LLM API response has no readable body");

  let finalText = "";
  try {
    for await (const event of parseSseStream(reader)) {
      const errorMsg = adapter.extractProviderError(event);
      if (errorMsg) {
        throw new Error(sanitizeLlmError(`Provider error: ${errorMsg}`, options.llm.apiKey));
      }
      if (adapter.isTerminalEvent(event)) break;
      const chunk = adapter.extractTextDelta(event);
      if (!chunk) continue;
      finalText += chunk;
      await options.onDelta(chunk);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Provider error:")) throw error;
    throw new Error(sanitizeLlmError(`LLM API stream error: ${error instanceof Error ? error.message : String(error)}`, options.llm.apiKey));
  }

  if (!finalText) throw new Error("LLM API stream completed without text output");
  return { finalText };
}

export async function validateLlmConnectivity(config: LlmProviderConfig, fetchImpl?: typeof fetch): Promise<{ ok: true; sampleText: string }> {
  const result = await runLlmTurn({
    llm: config,
    prompt: "Connectivity test. Reply with a short OK.",
    fetchImpl,
    onDelta: () => {},
    maxTokensOverride: 16
  });
  return { ok: true as const, sampleText: result.finalText };
}
