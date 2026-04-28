import { describe, expect, it, vi } from "vitest";
import { runAnthropicCompatibleMessages, validateAnthropicCompatibleConnectivity } from "../src/llm/anthropic-compatible.js";

function streamResponse(text: string, status = 200, statusText = "OK"): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }
    }),
    { status, statusText, headers: { "content-type": "text/event-stream" } }
  );
}

describe("Anthropic-compatible runner", () => {
  it("extracts text deltas and returns final text", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse(
        'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hel"}}\n\nevent: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"lo"}}\n\nevent: message_stop\ndata: {}\n\n'
      )
    );
    const chunks: string[] = [];
    const result = await runAnthropicCompatibleMessages({
      config: { provider: "anthropic-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 },
      prompt: "room context",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (chunk) => chunks.push(chunk)
    });
    expect(fetchImpl).toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(request[0]).toBe("https://api.example.com/v1/messages");
    expect(request[1].headers["x-api-key"]).toBe("key");
    expect(request[1].headers["anthropic-version"]).toBe("2023-06-01");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(result.finalText).toBe("Hello");
  });

  it("throws on SSE error events", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse('event: error\ndata: {"error":{"type":"authentication_error","message":"invalid API key"}}\n\n')
    );
    await expect(
      runAnthropicCompatibleMessages({
        config: { provider: "anthropic-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "secret-key", temperature: 0.7, maxTokens: 1024 },
        prompt: "room context",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {}
      })
    ).rejects.toThrow("Provider error: invalid API key");
  });

  it("sanitizes API keys from HTTP error responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { type: "authentication_error", message: "invalid API key" } }),
        { status: 401, statusText: "Unauthorized", headers: { "content-type": "application/json" } }
      )
    );
    await expect(
      runAnthropicCompatibleMessages({
        config: { provider: "anthropic-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "sk-secret", temperature: 0.7, maxTokens: 1024 },
        prompt: "room context",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {}
      })
    ).rejects.toThrow("401 Unauthorized");
  });

  it("validates connectivity with a short prompt", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse('event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"ok"}}\n\nevent: message_stop\ndata: {}\n\n')
    );
    const result = await validateAnthropicCompatibleConnectivity(
      { provider: "anthropic-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 },
      fetchImpl as unknown as typeof fetch
    );
    expect(result.ok).toBe(true);
    expect(result.sampleText).toBe("ok");
  });
});
