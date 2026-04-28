import { describe, expect, it, vi } from "vitest";
import { promptForLlmApiConfig } from "../src/llm/config-wizard.js";

describe("LLM provider config wizard", () => {
  it("selects SiliconFlow defaults and advanced thinking options", async () => {
    const config = await promptForLlmApiConfig("llm-api", {
      question: vi.fn()
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("Qwen/Qwen3.5-4B")
        .mockResolvedValueOnce("y")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce("4096")
        .mockResolvedValueOnce("y")
        .mockResolvedValueOnce("4096")
        .mockResolvedValueOnce("0.05"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: () => {},
      close: vi.fn()
    }, async () => ({ ok: true as const, sampleText: "ok" }));
    expect(config).toMatchObject({
      providerId: "siliconflow",
      protocol: "openai-chat",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "Qwen/Qwen3.5-4B",
      options: { temperature: 1, max_tokens: 4096, enable_thinking: true, thinking_budget: 4096, min_p: 0.05 }
    });
  });

  it("collects only required fields when advanced options are declined", async () => {
    const config = await promptForLlmApiConfig("llm-api", {
      question: vi.fn().mockResolvedValueOnce("7").mockResolvedValueOnce("").mockResolvedValueOnce("deepseek-v4-pro").mockResolvedValueOnce("n"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: () => {},
      close: vi.fn()
    }, async () => ({ ok: true as const, sampleText: "ok" }));
    expect(config).toMatchObject({ providerId: "deepseek", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", options: {} });
  });
});
