import { describe, expect, it, vi } from "vitest";
import { runOpenAiCompatibleChat, validateOpenAiCompatibleConnectivity } from "../src/llm/openai-compatible.js";

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

describe("OpenAI-compatible runner", () => {
  it("extracts text deltas and returns final text", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse(
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
      )
    );
    const chunks: string[] = [];
    const result = await runOpenAiCompatibleChat({
      config: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 },
      prompt: "room context",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (chunk) => chunks.push(chunk)
    });
    expect(fetchImpl).toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(request[0]).toBe("https://api.example.com/v1/chat/completions");
    expect(request[1].headers.authorization).toBe("Bearer key");
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(result.finalText).toBe("Hello");
  });

  it("delivers deltas incrementally before stream closes", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      )
    );
    const chunks: string[] = [];
    await runOpenAiCompatibleChat({
      config: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 },
      prompt: "room context",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (chunk) => chunks.push(chunk)
    });
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("throws on SSE error events", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse('event: error\ndata: {"error":{"message":"invalid API key"}}\n\n')
    );
    await expect(
      runOpenAiCompatibleChat({
        config: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "secret-key", temperature: 0.7, maxTokens: 1024 },
        prompt: "room context",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {}
      })
    ).rejects.toThrow("Provider error: invalid API key");
  });

  it("sanitizes API keys from HTTP error responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "invalid API key" } }),
        { status: 401, statusText: "Unauthorized", headers: { "content-type": "application/json" } }
      )
    );
    await expect(
      runOpenAiCompatibleChat({
        config: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "sk-secret", temperature: 0.7, maxTokens: 1024 },
        prompt: "room context",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {}
      })
    ).rejects.toThrow("401 Unauthorized");
  });

  it("validates connectivity with a short prompt", async () => {
    const fetchImpl = vi.fn(async () => streamResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    const result = await validateOpenAiCompatibleConnectivity(
      { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 },
      fetchImpl as unknown as typeof fetch
    );
    expect(result.ok).toBe(true);
    expect(result.sampleText).toBe("ok");
  });
});
