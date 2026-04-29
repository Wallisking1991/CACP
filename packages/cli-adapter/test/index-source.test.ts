import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexSource = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");

describe("connector index source", () => {
  it("uses ClaudeRuntime for Claude Code turns instead of spawning one command per turn", () => {
    expect(indexSource).toContain("ClaudeRuntime");
    expect(indexSource).not.toContain("runCommandForTask({");
  });

  it("does not use chat.md transcript as Claude Code context storage", () => {
    expect(indexSource).not.toContain("new ChatTranscriptWriter");
    expect(indexSource).not.toContain("transcript.handleEvent");
  });

  it("creates a room client for posting Claude events to the server REST API", () => {
    expect(indexSource).toContain("new RoomClient({");
    expect(indexSource).toContain("roomClient.publishCatalog");
    expect(indexSource).toContain("roomClient.startTurn");
  });

  it("routes agent turns through the LLM runner when llm config exists", () => {
    expect(indexSource).toContain("runLlmTurn");
    expect(indexSource).toContain("if (config.llm)");
    expect(indexSource).toContain("roomClient.publishTurnDelta");
  });

  it("silently ignores task.created for all agents instead of calling fail", () => {
    expect(indexSource).toContain("Ignoring task.created because this connector no longer runs generic local command tasks.");
  });

  it("sanitizes LLM runtime errors before sending to server", () => {
    expect(indexSource).toContain("sanitizeLlmError");
    expect(indexSource).toContain("config.llm ? sanitizeLlmError");
  });

  it("handles claude.session_selected events for persistent session management", () => {
    expect(indexSource).toContain('parsed.data.type === "claude.session_selected"');
    expect(indexSource).toContain("claudeRuntime.selectSession");
  });

  it("publishes the connected banner only from the websocket open handler", () => {
    expect(indexSource).toContain('ws.on("open", () => {');
    expect(indexSource).toContain("printConnectedBanner({");
  });

  it("closes the Claude session gracefully on websocket close", () => {
    expect(indexSource).toContain("claudeRuntime?.close()");
  });
});
