import { describe, expect, it, vi } from "vitest";
import { runLlmTurn } from "../src/llm/runner.js";

describe("LLM turn runner", () => {
  it("dispatches OpenAI-compatible turns", async () => {
    const runOpenAi = vi.fn(async (options: { onDelta: (chunk: string) => void }) => { options.onDelta("hi"); return { finalText: "hi" }; });
    const chunks: string[] = [];
    const result = await runLlmTurn({ llm: { provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key", temperature: 0.7, maxTokens: 1024 }, prompt: "room context", onDelta: (chunk) => chunks.push(chunk), runners: { runOpenAi, runAnthropic: vi.fn() } });
    expect(runOpenAi).toHaveBeenCalled();
    expect(chunks).toEqual(["hi"]);
    expect(result.finalText).toBe("hi");
  });
});
