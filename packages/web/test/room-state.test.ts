import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { deriveRoomState } from "../src/room-state.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.1.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

describe("room state", () => {
  it("derives participants, agents, active agent, messages, streaming turns, and questions", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 2),
      event("room.agent_selected", { agent_id: "agent_1" }, 3),
      event("message.created", { message_id: "msg_1", text: "你好", kind: "human" }, 4, "user_1"),
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 5, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "正在" }, 6, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "分析" }, 7, "agent_1"),
      event("question.created", { question_id: "q_1", question: "下一步？", options: ["A", "B"] }, 8, "agent_1")
    ]);

    expect(state.participants).toEqual([{ id: "user_1", display_name: "Alice", role: "owner", type: "human" }]);
    expect(state.agents).toEqual([{ agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }]);
    expect(state.activeAgentId).toBe("agent_1");
    expect(state.messages).toEqual([{ message_id: "msg_1", actor_id: "user_1", text: "你好", kind: "human", created_at: "2026-04-25T00:00:04.000Z" }]);
    expect(state.streamingTurns).toEqual([{ turn_id: "turn_1", agent_id: "agent_1", text: "正在分析" }]);
    expect(state.questions).toEqual([{ question_id: "q_1", question: "下一步？", options: ["A", "B"] }]);
  });

  it("removes streaming turns after completion", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "done" }, 2, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
  });
});
