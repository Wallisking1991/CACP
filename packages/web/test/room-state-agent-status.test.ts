import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { deriveRoomState } from "../src/room-state.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

describe("room state agent status in message cards", () => {
  it("attaches runtime status to streaming turns", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Hello" }, 2, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1",
        turn_id: "turn_1",
        status_id: "status_1",
        phase: "thinking",
        current: "Analyzing context",
        recent: [],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-25T00:00:01.000Z",
        updated_at: "2026-04-25T00:00:03.000Z"
      }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toHaveLength(1);
    expect(state.streamingTurns[0]).toMatchObject({
      turn_id: "turn_1",
      agent_id: "agent_1",
      text: "Hello",
      phase: "thinking",
      current: "Analyzing context",
      metrics: { files_read: 0, searches: 0, commands: 0 }
    });
  });

  it("updates streaming turn status when runtime phase changes", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_1",
        phase: "thinking", current: "Thinking", metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-25T00:00:01.000Z", updated_at: "2026-04-25T00:00:02.000Z"
      }, 2, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_1",
        phase: "reading_files", current: "Reading src/index.ts", metrics: { files_read: 3, searches: 0, commands: 0 },
        started_at: "2026-04-25T00:00:01.000Z", updated_at: "2026-04-25T00:00:05.000Z"
      }, 3, "agent_1")
    ]);

    expect(state.streamingTurns[0]).toMatchObject({
      phase: "reading_files",
      current: "Reading src/index.ts",
      metrics: { files_read: 3, searches: 0, commands: 0 }
    });
  });

  it("attaches final status to completed agent message", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Done" }, 2, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_1",
        phase: "generating_answer", current: "Generating", metrics: { files_read: 2, searches: 1, commands: 0 },
        started_at: "2026-04-25T00:00:01.000Z", updated_at: "2026-04-25T00:00:04.000Z"
      }, 3, "agent_1"),
      event("claude.runtime.status_completed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_1",
        summary: "Analyzed codebase and provided answer",
        metrics: { files_read: 2, searches: 1, commands: 0 },
        completed_at: "2026-04-25T00:00:06.000Z"
      }, 4, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 5, "agent_1"),
      event("message.created", { message_id: "msg_1", text: "Done", kind: "agent" }, 6, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
    const agentMessage = state.messages.find((m) => m.kind === "agent");
    expect(agentMessage).toBeDefined();
    expect(agentMessage).toMatchObject({
      text: "Done",
      kind: "agent",
      agentPhase: "Completed",
      agentSummary: "Analyzed codebase and provided answer",
      agentMetrics: { files_read: 2, searches: 1, commands: 0 },
      turnFailed: false
    });
    expect(agentMessage?.agentElapsed).toBeDefined();
  });

  it("marks turn failed on same message card instead of creating system message", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Partial output" }, 2, "agent_1"),
      event("agent.turn.failed", { turn_id: "turn_1", agent_id: "agent_1", error: "command exited with code 1" }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      text: "Partial output",
      kind: "agent",
      turnFailed: true,
      turnError: "command exited with code 1"
    });
  });

  it("preserves streaming text and error on failed turn with exit code", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "error: invalid mode\n" }, 2, "agent_1"),
      event("agent.turn.failed", { turn_id: "turn_1", agent_id: "agent_1", error: "command exited with code 1", exit_code: 1 }, 3, "agent_1")
    ]);

    expect(state.messages[0]).toMatchObject({
      text: "error: invalid mode\n",
      kind: "agent",
      turnFailed: true,
      turnError: "command exited with code 1"
    });
  });

  it("accumulates thinking delta text on streaming turns", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("claude.output.thinking_delta", { agent_id: "agent_1", turn_id: "turn_1", text: "", done: false }, 2, "agent_1"),
      event("claude.output.thinking_delta", { agent_id: "agent_1", turn_id: "turn_1", text: "Let me analyze", done: false }, 3, "agent_1"),
      event("claude.output.thinking_delta", { agent_id: "agent_1", turn_id: "turn_1", text: " the structure", done: false }, 4, "agent_1"),
      event("claude.output.thinking_delta", { agent_id: "agent_1", turn_id: "turn_1", text: "", done: true }, 5, "agent_1")
    ]);

    expect(state.streamingTurns).toHaveLength(1);
    expect(state.streamingTurns[0]).toMatchObject({
      turn_id: "turn_1",
      thinkingText: "Let me analyze the structure",
      thinkingDone: true
    });
  });

  it("passes detail field from runtime status to streaming turns", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_1",
        phase: "retrying_api", current: "Retrying API",
        recent: ["Retrying API"],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        detail: { attempt: 2, max_retries: 3, retry_delay_ms: 2000 },
        started_at: "2026-04-25T00:00:01.000Z", updated_at: "2026-04-25T00:00:03.000Z"
      }, 2, "agent_1")
    ]);

    expect(state.streamingTurns[0]).toMatchObject({
      phase: "retrying_api",
      detail: { attempt: 2, max_retries: 3, retry_delay_ms: 2000 }
    });
  });

  it("clears thinking state when turn completes", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("claude.output.thinking_delta", { agent_id: "agent_1", turn_id: "turn_1", text: "Analyzing", done: false }, 2, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Done" }, 3, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 4, "agent_1"),
      event("message.created", { message_id: "msg_1", text: "Done", kind: "agent" }, 5, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
  });

  it("attaches final status from agent.runtime.status_completed (Codex provider)", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "OK" }, 2, "agent_1"),
      event("agent.runtime.status_completed", {
        agent_id: "agent_1", provider: "codex-cli", turn_id: "turn_1", status_id: "status_1",
        summary: "Fixed the bug",
        metrics: { files_read: 1, searches: 0, commands: 1 },
        completed_at: "2026-04-25T00:00:05.000Z"
      }, 3, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 4, "agent_1"),
      event("message.created", { message_id: "msg_1", text: "OK", kind: "agent" }, 5, "agent_1")
    ]);

    const agentMessage = state.messages.find((m) => m.kind === "agent");
    expect(agentMessage).toMatchObject({
      agentPhase: "Completed",
      agentSummary: "Fixed the bug",
      agentMetrics: { files_read: 1, searches: 0, commands: 1 }
    });
  });
});
