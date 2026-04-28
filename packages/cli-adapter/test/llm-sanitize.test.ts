import { describe, expect, it } from "vitest";
import { sanitizeLlmError } from "../src/llm/sanitize.js";

describe("LLM error sanitizer", () => {
  it("removes API keys and authorization headers", () => {
    const sanitized = sanitizeLlmError(new Error("Authorization: Bearer sk-secret failed for api_key sk-secret"), "sk-secret");
    expect(sanitized).toContain("Authorization: Bearer [redacted]");
    expect(sanitized).toContain("api_key [redacted]");
    expect(sanitized).not.toContain("sk-secret");
  });
});
