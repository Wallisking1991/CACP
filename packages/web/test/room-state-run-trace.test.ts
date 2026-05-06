import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { deriveRoomState } from "../src/room-state.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "agent_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-05-06T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

describe("room state run trace projection", () => {
  it("merges streamed and final agent output into the run instead of legacy message views", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1),
      event("agent.run.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        started_at: "2026-05-06T00:00:02.000Z"
      }, 2),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Partial " }, 3),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "answer" }, 4),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1", exit_code: 0 }, 5),
      event("message.created", { message_id: "msg_1", text: "Final answer", kind: "agent", turn_id: "turn_1" }, 6),
      event("agent.run.completed", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        message_id: "msg_1",
        summary: "Answered",
        metrics: { files_read: 0, searches: 0, commands: 0 },
        completed_at: "2026-05-06T00:00:07.000Z"
      }, 7)
    ]);

    expect(state.agentRuns).toHaveLength(1);
    expect(state.agentRuns[0]).toMatchObject({
      run_id: "turn_1",
      message_id: "msg_1",
      answer_text: "Partial answer",
      final_text: "Final answer",
      status: "completed"
    });
    expect(state.messages.find((message) => message.message_id === "msg_1")).toBeUndefined();
    expect(state.streamingTurns.find((turn) => turn.turn_id === "turn_1")).toBeUndefined();
  });

  it("keeps a running run trace answer out of legacy streaming turns", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1),
      event("agent.run.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        started_at: "2026-05-06T00:00:02.000Z"
      }, 2),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "Live answer" }, 3)
    ]);

    expect(state.agentRuns[0]).toMatchObject({
      status: "running",
      answer_text: "Live answer"
    });
    expect(state.streamingTurns).toHaveLength(0);
  });

  it("replays run lifecycle and node deltas", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1),
      event("agent.run.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        started_at: "2026-05-06T00:00:02.000Z"
      }, 2),
      event("agent.run.node.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        node_id: "node_1",
        kind: "tool",
        status: "running",
        title: "Read README.md",
        text: "Opening repository guidance",
        started_at: "2026-05-06T00:00:03.000Z",
        updated_at: "2026-05-06T00:00:03.000Z"
      }, 3),
      event("agent.run.node.delta", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        node_id: "node_1",
        delta_type: "text",
        chunk: "Scanning docs",
        updated_at: "2026-05-06T00:00:04.000Z"
      }, 4),
      event("agent.run.node.updated", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        node_id: "node_1",
        status: "running",
        title: "Read AGENTS.md",
        detail: { path: "AGENTS.md" },
        updated_at: "2026-05-06T00:00:05.000Z"
      }, 5),
      event("agent.run.node.completed", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        node_id: "node_1",
        summary: "Read repo guidance",
        completed_at: "2026-05-06T00:00:06.000Z"
      }, 6),
      event("agent.run.completed", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        message_id: "msg_1",
        summary: "Answered with repo context",
        metrics: { files_read: 1, searches: 0, commands: 0 },
        completed_at: "2026-05-06T00:00:07.000Z"
      }, 7)
    ]);

    expect(state.agentRuns).toHaveLength(1);
    expect(state.agentRuns[0]).toMatchObject({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      status: "completed",
      summary: "Answered with repo context",
      metrics: { files_read: 1, searches: 0, commands: 0 }
    });
    expect(state.agentRuns[0].nodes[0]).toMatchObject({
      node_id: "node_1",
      kind: "tool",
      status: "completed",
      title: "Read AGENTS.md",
      text: "Opening repository guidance",
      text_chunks: ["Scanning docs"],
      detail: { path: "AGENTS.md" },
      summary: "Read repo guidance"
    });
  });

  it("marks agents as working while a run is active", () => {
    const state = deriveRoomState([
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["claude-code"] }, 1, "owner"),
      event("participant.joined", { participant: { id: "agent_1", display_name: "Claude Code Agent", role: "agent", type: "agent" } }, 2, "agent_1"),
      event("agent.status_changed", { agent_id: "agent_1", status: "online" }, 3, "agent_1"),
      event("agent.run.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        started_at: "2026-05-06T00:00:04.000Z"
      }, 4, "agent_1")
    ]);

    expect(state.avatarStatuses.find((avatar) => avatar.id === "agent_1")).toMatchObject({
      status: "working",
      active: true
    });
  });

  it("keeps failed run details visible after terminal failure", () => {
    const state = deriveRoomState([
      event("agent.run.started", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        started_at: "2026-05-06T00:00:01.000Z"
      }, 1),
      event("agent.run.failed", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        error: "codex_turn_incomplete",
        failed_at: "2026-05-06T00:00:08.000Z"
      }, 2)
    ]);

    expect(state.agentRuns[0]).toMatchObject({
      status: "failed",
      error: "codex_turn_incomplete"
    });
  });
});
