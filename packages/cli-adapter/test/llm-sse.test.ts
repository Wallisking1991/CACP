import { describe, expect, it } from "vitest";
import { parseSseText, parseSseStream } from "../src/llm/sse.js";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    }
  });
}

async function collectStream(chunks: string[]) {
  const events = [];
  for await (const event of parseSseStream(buildStream(chunks).getReader())) {
    events.push(event);
  }
  return events;
}

describe("SSE text parser", () => {
  it("parses named and unnamed events", () => {
    expect(parseSseText("event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}\n\ndata: [DONE]\n\n")).toEqual([
      { event: "content_block_delta", data: "{\"delta\":{\"text\":\"hi\"}}" },
      { event: undefined, data: "[DONE]" }
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseSseText("event: msg\r\ndata: hello\r\n\r\n")).toEqual([
      { event: "msg", data: "hello" }
    ]);
  });

  it("joins multiple data lines with newlines", () => {
    expect(parseSseText("data: line1\ndata: line2\n\n")).toEqual([
      { event: undefined, data: "line1\nline2" }
    ]);
  });

  it("ignores comment lines", () => {
    expect(parseSseText(":keep-alive\nevent: msg\ndata: hello\n\n")).toEqual([
      { event: "msg", data: "hello" }
    ]);
  });

  it("handles event: error with JSON body", () => {
    expect(parseSseText("event: error\ndata: {\"error\":{\"message\":\"bad\"}}\n\n")).toEqual([
      { event: "error", data: '{"error":{"message":"bad"}}' }
    ]);
  });
});

describe("SSE stream parser", () => {
  it("yields events incrementally across multiple chunks", async () => {
    const chunks = [
      "event: content_block_delta\ndata: {\"delta\":{\"t",
      "ext\":\"Hel\"}}\n\nevent: content_block_delta\ndata: {\"delta\":{\"text\":\"lo\"}}\n\n"
    ];
    const events = await collectStream(chunks);
    expect(events).toEqual([
      { event: "content_block_delta", data: '{"delta":{"text":"Hel"}}' },
      { event: "content_block_delta", data: '{"delta":{"text":"lo"}}' }
    ]);
  });

  it("yields first delta before stream closes", async () => {
    const received: string[] = [];
    const stream = buildStream(["data: hello\n\n"]);
    for await (const event of parseSseStream(stream.getReader())) {
      received.push(event.data);
    }
    expect(received).toEqual(["hello"]);
  });

  it("handles split double-newline across chunks", async () => {
    const chunks = ["event: msg\ndata: hello\n", "\nevent: msg2\ndata: world\n\n"];
    const events = await collectStream(chunks);
    expect(events).toEqual([
      { event: "msg", data: "hello" },
      { event: "msg2", data: "world" }
    ]);
  });
});
