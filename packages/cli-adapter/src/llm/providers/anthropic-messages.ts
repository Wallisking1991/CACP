import type { SseEvent } from "../sse.js";
import type { BuildProviderRequestInput, ProviderRequest } from "./types.js";

export function buildAnthropicMessagesRequest(
  input: BuildProviderRequestInput,
  extras?: Record<string, unknown>
): ProviderRequest {
  const body: Record<string, unknown> = {
    model: input.model,
    system: input.systemPrompt,
    messages: [{ role: "user", content: input.prompt }],
    stream: true,
    ...extras
  };

  if (input.maxTokensOverride !== undefined) {
    body.max_tokens = input.maxTokensOverride;
  }

  return {
    url: `${input.baseUrl.replace(/\/$/u, "")}/messages`,
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body
  };
}

export function extractAnthropicText(event: SseEvent): string | undefined {
  if (event.event !== "content_block_delta") return undefined;
  try {
    const parsed = JSON.parse(event.data) as { delta?: { type?: string; text?: string } };
    if (parsed.delta?.type !== "text_delta") return undefined;
    return parsed.delta.text ?? undefined;
  } catch {
    return undefined;
  }
}

export function extractAnthropicError(event: SseEvent): string | undefined {
  if (event.event !== "error") return undefined;
  try {
    const parsed = JSON.parse(event.data) as { error?: { message?: string } };
    return parsed.error?.message ?? event.data;
  } catch {
    return event.data;
  }
}

export function isAnthropicTerminalEvent(event: SseEvent): boolean {
  return event.event === "message_stop";
}
