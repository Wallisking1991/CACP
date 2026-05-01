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

  it("passes the server-provided room name into Claude turn prompts", () => {
    expect(indexSource).toContain("room_name?: string");
    expect(indexSource).toContain('roomName: typeof payload.room_name === "string" ? payload.room_name');
  });

  it("keeps one stable Claude runtime status start time per turn", () => {
    expect(indexSource).toContain("turnStatusStartedAt");
    expect(indexSource).toContain("started_at: startedAt");
  });

  it("can report Claude resume import failures before transcript messages are built", () => {
    expect(indexSource).toContain("randomUUID");
    expect(indexSource).toContain("const importId = `import_${randomUUID()}`");
    expect(indexSource).toContain("await roomClient.failImport(importId");
  });

  it("publishes the connected banner only from the websocket open handler", () => {
    expect(indexSource).toContain('ws.on("open", () => {');
    expect(indexSource).toContain("printConnectedBanner({");
  });

  it("closes the Claude session gracefully on websocket close", () => {
    expect(indexSource).toContain("claudeRuntime?.close()");
  });

  it("detects and instantiates Codex CLI runtime when agent has codex-cli capability", () => {
    expect(indexSource).toContain('config.agent.capabilities.includes("codex-cli")');
    expect(indexSource).toContain("CodexRuntime");
    expect(indexSource).toContain("listCodexSessions");
  });

  it("handles generic agent.session_selected for Codex session management", () => {
    expect(indexSource).toContain('parsed.data.type === "agent.session_selected"');
    expect(indexSource).toContain('parsed.data.type === "agent.session_preview.requested"');
    expect(indexSource).toContain("codexRuntime.selectSession");
  });

  it("publishes Codex session catalog through generic agent endpoints", () => {
    expect(indexSource).toContain("roomClient.publishAgentSessionCatalog");
    expect(indexSource).toContain("roomClient.publishAgentSessionReady");
  });

  it("routes Codex turns through generic runtime status endpoints", () => {
    expect(indexSource).toContain("roomClient.publishAgentRuntimeStatus");
  });

  it("reports Claude session readiness only after the SDK session is selected", () => {
    const selectIndex = indexSource.indexOf('await claudeRuntime.selectSession({ mode: "resume", sessionId: payload.session_id });');
    const completeIndex = indexSource.indexOf("await roomClient.completeImport(importId");
    const readyIndex = indexSource.indexOf("await roomClient.publishSessionReady", completeIndex);
    expect(selectIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeLessThan(completeIndex);
    expect(completeIndex).toBeLessThan(readyIndex);
  });

});
