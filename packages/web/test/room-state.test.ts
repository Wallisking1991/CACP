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
    expect(state.agents[0]).toMatchObject({ agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"], status: "unknown" });
    expect(state.activeAgentId).toBe("agent_1");
    expect(state.messages).toEqual([{ message_id: "msg_1", actor_id: "user_1", text: "你好", kind: "human", created_at: "2026-04-25T00:00:04.000Z" }]);
    expect(state.streamingTurns).toEqual([{ turn_id: "turn_1", agent_id: "agent_1", text: "正在分析" }]);
    expect(state.questions[0]).toMatchObject({ question_id: "q_1", options: ["A", "B"], closed: false });
  });

  it("removes streaming turns after completion", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "done" }, 2, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
  });
  it("derives agent status and question voting state", () => {
    const state = deriveRoomState([
      event("room.configured", { default_policy: { type: "majority" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude", capabilities: ["tool.approval"] }, 2),
      event("agent.status_changed", { agent_id: "agent_1", status: "online" }, 3, "agent_1"),
      event("question.created", { question_id: "q_1", question: "Approve?", options: ["approve", "reject"], blocking: true, question_type: "agent_action_approval" }, 4, "agent_1"),
      event("question.response_submitted", { question_id: "q_1", respondent_id: "user_1", response: "approve", comment: "ok" }, 5, "user_1"),
      event("question.closed", { question_id: "q_1", evaluation: { status: "closed", selected_response: "approve", decided_by: ["user_1"] } }, 6, "user_1")
    ]);

    expect(state.roomPolicy).toEqual({ type: "majority" });
    expect(state.agents[0]).toMatchObject({ agent_id: "agent_1", status: "online" });
    expect(state.questions[0]).toMatchObject({ question_id: "q_1", blocking: true, closed: true, selected_response: "approve", question_type: "agent_action_approval" });
    expect(state.questions[0].responses).toEqual([{ respondent_id: "user_1", response: "approve", comment: "ok" }]);
  });

});
