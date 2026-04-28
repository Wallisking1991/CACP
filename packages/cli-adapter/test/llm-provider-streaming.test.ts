import { describe, expect, it } from "vitest";
import type { SseEvent } from "../src/llm/sse.js";
import { getProviderAdapter } from "../src/llm/providers/registry.js";

function event(data: unknown, name?: string): SseEvent {
  return { event: name, data: typeof data === "string" ? data : JSON.stringify(data) };
}

describe("provider stream extraction", () => {
  it("extracts final content and ignores reasoning content for OpenAI-chat providers", () => {
    const adapter = getProviderAdapter("deepseek");
    expect(adapter.extractTextDelta(event({ choices: [{ delta: { reasoning_content: "hidden" } }] }))).toBeUndefined();
    expect(adapter.extractTextDelta(event({ choices: [{ delta: { content: "visible" } }] }))).toBe("visible");
  });

  it("extracts Anthropic text deltas and ignores thinking blocks", () => {
    const adapter = getProviderAdapter("anthropic");
    expect(adapter.extractTextDelta(event({ delta: { type: "thinking_delta", thinking: "hidden" } }, "content_block_delta"))).toBeUndefined();
    expect(adapter.extractTextDelta(event({ delta: { type: "text_delta", text: "visible" } }, "content_block_delta"))).toBe("visible");
    expect(adapter.isTerminalEvent(event({}, "message_stop"))).toBe(true);
  });
});
