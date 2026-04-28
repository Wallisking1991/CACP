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

  it("silently ignores task.created for LLM API agents instead of calling fail", () => {
    expect(source()).not.toContain("llm_api_agents_do_not_run_tasks");
    expect(source()).toContain("Pure conversation LLM API agents do not run tasks");
    expect(source()).toContain("if (config.llm)");
  });

  it("sanitizes LLM runtime errors before sending to server", () => {
    expect(source()).toContain("sanitizeLlmError");
    expect(source()).toContain("config.llm ? sanitizeLlmError");
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
