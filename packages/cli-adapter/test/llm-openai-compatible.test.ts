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
