import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("cli adapter stream wiring", () => {
  const source = () => readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

  it("creates a transcript writer from the runtime room and working directory", () => {
    expect(source()).toContain("new ChatTranscriptWriter({");
    expect(source()).toContain("roomId: config.room_id");
    expect(source()).toContain("baseDir: config.agent.working_dir");
  });

  it("routes agent turns through the LLM runner when llm config exists", () => {
    expect(source()).toContain("runLlmTurn");
    expect(source()).toContain("if (config.llm)");
    expect(source()).toContain("/agent-turns/${payload.turn_id}/delta");
  });

  it("passes parsed stream events into the transcript writer before task handling", () => {
    expect(source()).toContain("transcript.handleEvent(parsed.data)");
  });

  it("prints the connected banner only from the websocket open handler", () => {
    expect(source()).toContain("ws.on(\"open\", () => {");
    expect(source()).toContain("printConnectedBanner({");
    expect(source()).toContain("chatPath: transcript.chatPath");
  });
});
