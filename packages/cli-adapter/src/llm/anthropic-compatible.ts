import { parseSseText, readResponseText } from "./sse.js";
import { sanitizeLlmError } from "./sanitize.js";
import { DefaultLlmSystemPrompt, type LlmProviderConfig, type LlmRunOptions, type LlmRunResult, type LlmConnectivityResult } from "./types.js";

async function providerError(response: Response, apiKey: string): Promise<Error> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    // ignore
  }
  const sanitized = sanitizeLlmError(`Status: ${response.status} ${response.statusText}\n${text}`, apiKey);
  return new Error(sanitized);
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
      temperature: options.config.temperature,
      max_tokens: options.maxTokensOverride ?? options.config.maxTokens
    })
  });
  if (!response.ok) throw await providerError(response, options.config.apiKey);
  let finalText = "";
  for (const event of parseSseText(await readResponseText(response))) {
    if (event.event === "message_stop") break;
    if (event.event !== "content_block_delta") continue;
    const parsed = JSON.parse(event.data) as { delta?: { type?: string; text?: string } };
    if (parsed.delta?.type !== "text_delta") continue;
    const chunk = parsed.delta.text ?? "";
    if (!chunk) continue;
    finalText += chunk;
    await options.onDelta(chunk);
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
