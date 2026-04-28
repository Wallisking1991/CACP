import { describe, expect, it, vi } from "vitest";
import { runLlmTurn, validateLlmConnectivity } from "../src/llm/runner.js";

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      } else {
        controller.close();
      }
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("LLM turn runner", () => {
  it("dispatches through provider adapter", async () => {
    const fetchImpl = vi.fn(async () => createSseResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"
    ]));
    const chunks: string[] = [];
    const result = await runLlmTurn({
      llm: { providerId: "deepseek", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKey: "key", options: {} },
      prompt: "room context",
      fetchImpl,
      onDelta: (chunk) => chunks.push(chunk)
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(chunks).toEqual(["hi"]);
    expect(result.finalText).toBe("hi");
  });

  it("times out stalled connectivity checks with an actionable error", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    await expect(validateLlmConnectivity({
      providerId: "siliconflow",
      protocol: "openai-chat",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3.5-4B",
      apiKey: "secret-key",
      options: {}
    }, fetchImpl as typeof fetch, { timeoutMs: 5 })).rejects.toThrow(
      "LLM API request timed out after 5ms"
    );
  }, 1000);
});
