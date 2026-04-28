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

export async function runAnthropicCompatibleMessages(options: LlmRunOptions): Promise<LlmRunResult> {
  const response = await (options.fetchImpl ?? fetch)(`${options.config.baseUrl.replace(/\/$/u, "")}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: options.config.model,
      system: options.systemPrompt ?? DefaultLlmSystemPrompt,
      messages: [{ role: "user", content: options.prompt }],
      stream: true,
      temperature: (options.config.options?.temperature as number | undefined) ?? 1,
      max_tokens: options.maxTokensOverride ?? (options.config.options?.max_tokens as number | undefined) ?? 1024
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw formatProviderError(response.status, response.statusText, body, options.config.apiKey);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Anthropic-compatible response has no readable body");

  let finalText = "";
  try {
    for await (const event of parseSseStream(reader)) {
      if (event.event === "error") {
        const errorMsg = extractErrorMessage(event.data) ?? event.data;
        throw new Error(sanitizeLlmError(`Provider error: ${errorMsg}`, options.config.apiKey));
      }
      if (event.event === "message_stop") break;
      if (event.event !== "content_block_delta") continue;
      const parsed = JSON.parse(event.data) as { delta?: { type?: string; text?: string } };
      if (parsed.delta?.type !== "text_delta") continue;
      const chunk = parsed.delta.text ?? "";
      if (!chunk) continue;
      finalText += chunk;
      await options.onDelta(chunk);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Provider error:")) throw error;
    throw new Error(sanitizeLlmError(`Anthropic-compatible stream error: ${error instanceof Error ? error.message : String(error)}`, options.config.apiKey));
  }

  if (!finalText) throw new Error("Anthropic-compatible stream completed without text output");
  return { finalText };
}

export async function validateAnthropicCompatibleConnectivity(config: LlmProviderConfig, fetchImpl?: typeof fetch): Promise<LlmConnectivityResult> {
  const result = await runAnthropicCompatibleMessages({
    config,
    prompt: "Connectivity test. Reply with a short OK.",
    fetchImpl,
    onDelta: () => {},
    maxTokensOverride: 16
  });
  return { ok: true as const, sampleText: result.finalText };
}
