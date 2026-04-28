import { describe, expect, it, vi } from "vitest";
import { runLlmTurn } from "../src/llm/runner.js";

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
});
