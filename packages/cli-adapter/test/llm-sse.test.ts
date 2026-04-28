import { describe, expect, it } from "vitest";
import { parseSseText } from "../src/llm/sse.js";

describe("SSE parser", () => {
  it("parses named and unnamed events", () => {
    expect(parseSseText("event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}\n\ndata: [DONE]\n\n")).toEqual([
      { event: "content_block_delta", data: "{\"delta\":{\"text\":\"hi\"}}" },
      { event: undefined, data: "[DONE]" }
    ]);
  });
});
