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
  if (!response.ok) throw await providerError(response, options.config.apiKey);
  let finalText = "";
  for (const event of parseSseText(await readResponseText(response))) {
    if (event.data === "[DONE]") break;
    const chunk = (JSON.parse(event.data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
    if (!chunk) continue;
    finalText += chunk;
    await options.onDelta(chunk);
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
