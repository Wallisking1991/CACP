import { describe, expect, it, vi } from "vitest";
import { promptForLlmApiConfig } from "../src/llm/config-wizard.js";

describe("LLM API config wizard", () => {
  it("collects settings and validates before returning", async () => {
    const lines: string[] = [];
    const validate = vi.fn(async () => ({ ok: true as const, sampleText: "ok" }));
    const config = await promptForLlmApiConfig("llm-openai-compatible", {
      question: vi.fn().mockResolvedValueOnce("8").mockResolvedValueOnce("https://api.example.com/v1").mockResolvedValueOnce("model-a").mockResolvedValueOnce("n"),
      secret: vi.fn().mockResolvedValueOnce("secret-key"),
      chooseRetry: vi.fn(),
      writeLine: (line) => lines.push(line),
      close: vi.fn()
    }, validate);
    expect(config).toEqual({
      providerId: "custom-openai-compatible",
      protocol: "openai-chat",
      baseUrl: "https://api.example.com/v1",
      model: "model-a",
      apiKey: "secret-key",
      options: {}
    });
    expect(validate).toHaveBeenCalledWith(config);
    expect(lines.join("\n")).toContain("Testing LLM API connectivity...");
    expect(lines.join("\n")).toContain("LLM API connectivity test succeeded");
    expect(lines.join("\n")).not.toContain("secret-key");
  });

  it("prints sanitized validation failures and supports cancel", async () => {
    const lines: string[] = [];
    const validate = vi.fn(async () => { throw new Error("Status: 401 Unauthorized\nProvider error: invalid API key"); });
    const config = await promptForLlmApiConfig("llm-anthropic-compatible", {
      question: vi.fn().mockResolvedValueOnce("9").mockResolvedValueOnce("https://api.example.com/v1").mockResolvedValueOnce("model-a").mockResolvedValueOnce("n"),
      secret: vi.fn().mockResolvedValueOnce("bad-key"),
      chooseRetry: vi.fn().mockResolvedValueOnce(false),
      writeLine: (line) => lines.push(line),
      close: vi.fn()
    }, validate);
    expect(config).toBeUndefined();
    expect(lines.join("\n")).toContain("LLM API connectivity test failed.");
    expect(lines.join("\n")).not.toContain("bad-key");
  });
});
