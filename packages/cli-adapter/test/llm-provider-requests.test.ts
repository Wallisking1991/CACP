import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "../src/llm/providers/registry.js";

function build(id: Parameters<typeof getProviderAdapter>[0], options: Record<string, unknown> = {}) {
  const adapter = getProviderAdapter(id);
  return adapter.buildRequest({
    baseUrl: adapter.defaultBaseUrl ?? "https://custom.example.com/v1",
    model: "model-a",
    apiKey: "secret-key",
    prompt: "room context",
    systemPrompt: "system prompt",
    options
  });
}

describe("LLM provider request builders", () => {
  it("builds provider-specific OpenAI-chat requests", () => {
    expect(build("siliconflow", { enable_thinking: true, thinking_budget: 4096, min_p: 0.05 }).body).toMatchObject({ enable_thinking: true, thinking_budget: 4096, min_p: 0.05 });
    expect(build("kimi", { thinking_type: "enabled" }).body).toMatchObject({ thinking: { type: "enabled" } });
    expect(build("minimax", { reasoning_split: true }).body).toMatchObject({ reasoning_split: true });
    expect(build("openai", { max_completion_tokens: 2048, reasoning_effort: "high" }).body).toMatchObject({ max_completion_tokens: 2048, reasoning_effort: "high" });
    expect(build("glm-official", { thinking_type: "enabled" }).body).toMatchObject({ thinking: { type: "enabled" } });
    expect(build("deepseek", { thinking_type: "enabled", reasoning_effort: "high" }).body).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  it("builds Anthropic messages requests", () => {
    const request = build("anthropic", { max_tokens: 2048, thinking_budget_tokens: 1024 });
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("secret-key");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.body).toMatchObject({ stream: true, max_tokens: 2048, thinking: { type: "enabled", budget_tokens: 1024 } });
  });
});
