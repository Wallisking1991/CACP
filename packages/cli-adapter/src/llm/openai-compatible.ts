import { parseSseStream } from "./sse.js";
import { sanitizeLlmError } from "./sanitize.js";
import { DefaultLlmSystemPrompt, type LlmProviderConfig, type LlmRunOptions, type LlmRunResult, type LlmConnectivityResult } from "./types.js";

function formatProviderError(status: number, statusText: string, body: string, apiKey: string): Error {
  const sanitized = sanitizeLlmError(`Status: ${status} ${statusText}\n${body}`, apiKey);
  return new Error(sanitized);
}

function extractErrorMessage(data: string): string | undefined {
  try {
    const parsed = JSON.parse(data) as { error?: { message?: string } };
    return parsed.error?.message;
  } catch {
    return undefined;
  }
}

export async function runOpenAiCompatibleChat(options: LlmRunOptions): Promise<LlmRunResult> {
  const response = await (options.fetchImpl ?? fetch)(`${options.config.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${options.config.apiKey}` },
    body: JSON.stringify({
      model: options.config.model,
      messages: [
        { role: "system", content: options.systemPrompt ?? DefaultLlmSystemPrompt },
        { role: "user", content: options.prompt }
      ],
      stream: true,
      temperature: options.config.temperature,
      max_tokens: options.maxTokensOverride ?? options.config.maxTokens
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw formatProviderError(response.status, response.statusText, body, options.config.apiKey);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenAI-compatible response has no readable body");

  let finalText = "";
  try {
    for await (const event of parseSseStream(reader)) {
      if (event.event === "error") {
        const errorMsg = extractErrorMessage(event.data) ?? event.data;
        throw new Error(sanitizeLlmError(`Provider error: ${errorMsg}`, options.config.apiKey));
      }
      if (event.data === "[DONE]") break;
      const chunk = (JSON.parse(event.data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
      if (!chunk) continue;
      finalText += chunk;
      await options.onDelta(chunk);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Provider error:")) throw error;
    throw new Error(sanitizeLlmError(`OpenAI-compatible stream error: ${error instanceof Error ? error.message : String(error)}`, options.config.apiKey));
  }

  if (!finalText) throw new Error("OpenAI-compatible stream completed without text output");
  return { finalText };
}

export async function validateOpenAiCompatibleConnectivity(config: LlmProviderConfig, fetchImpl?: typeof fetch): Promise<LlmConnectivityResult> {
  const result = await runOpenAiCompatibleChat({
    config,
    prompt: "Connectivity test. Reply with a short OK.",
    fetchImpl,
    onDelta: () => {},
    maxTokensOverride: 16
  });
  return { ok: true as const, sampleText: result.finalText };
}
