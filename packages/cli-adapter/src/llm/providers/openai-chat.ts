import { sanitizeLlmError } from "../sanitize.js";
import type { SseEvent } from "../sse.js";
import type { BuildProviderRequestInput, ProviderRequest } from "./types.js";

export function buildOpenAiChatRequest(
  input: BuildProviderRequestInput,
  extras?: Record<string, unknown>
): ProviderRequest {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.prompt }
    ],
    stream: true,
    ...extras
  };

  if (input.maxTokensOverride !== undefined) {
    body.max_tokens = input.maxTokensOverride;
  }

  return {
    url: `${input.baseUrl.replace(/\/$/u, "")}/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body
  };
}

export function extractOpenAiChatText(event: SseEvent): string | undefined {
  if (event.event === "error") return undefined;
  if (event.data === "[DONE]") return undefined;
  try {
    const parsed = JSON.parse(event.data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning_details?: unknown } }> };
    return parsed.choices?.[0]?.delta?.content ?? undefined;
  } catch {
    return undefined;
  }
}

export function extractOpenAiProviderError(event: SseEvent): string | undefined {
  if (event.event !== "error") return undefined;
  try {
    const parsed = JSON.parse(event.data) as { error?: { message?: string } };
    return parsed.error?.message ?? event.data;
  } catch {
    return event.data;
  }
}

export function isOpenAiChatTerminalEvent(event: SseEvent): boolean {
  return event.data === "[DONE]";
}
