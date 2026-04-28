import { describe, expect, it } from "vitest";
import { normalizeProviderBaseUrl } from "../src/llm/providers/base-url.js";
import { getProviderAdapter, listProviderAdapters } from "../src/llm/providers/registry.js";

describe("LLM provider registry", () => {
  it("lists provider choices in stable console order", () => {
    expect(listProviderAdapters().map((adapter) => adapter.id)).toEqual([
      "siliconflow",
      "kimi",
      "minimax",
      "openai",
      "anthropic",
      "glm-official",
      "deepseek",
      "custom-openai-compatible",
      "custom-anthropic-compatible"
    ]);
  });

  it("returns provider defaults by id", () => {
    expect(getProviderAdapter("siliconflow").defaultBaseUrl).toBe("https://api.siliconflow.cn/v1");
    expect(getProviderAdapter("kimi").defaultBaseUrl).toBe("https://api.moonshot.ai/v1");
    expect(getProviderAdapter("minimax").defaultBaseUrl).toBe("https://api.minimax.io/v1");
    expect(getProviderAdapter("openai").defaultBaseUrl).toBe("https://api.openai.com/v1");
    expect(getProviderAdapter("anthropic").defaultBaseUrl).toBe("https://api.anthropic.com/v1");
    expect(getProviderAdapter("glm-official").defaultBaseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(getProviderAdapter("deepseek").defaultBaseUrl).toBe("https://api.deepseek.com");
  });

  it("rejects unknown provider ids", () => {
    expect(() => getProviderAdapter("unknown-provider" as never)).toThrow("unknown_llm_provider: unknown-provider");
  });

  it("normalizes accidental full endpoint URLs", () => {
    expect(normalizeProviderBaseUrl("https://api.siliconflow.cn/v1/chat/completions", "/chat/completions")).toBe("https://api.siliconflow.cn/v1");
    expect(normalizeProviderBaseUrl("https://api.anthropic.com/v1/messages", "/messages")).toBe("https://api.anthropic.com/v1");
    expect(normalizeProviderBaseUrl("https://api.deepseek.com/", "/chat/completions")).toBe("https://api.deepseek.com");
  });
});
