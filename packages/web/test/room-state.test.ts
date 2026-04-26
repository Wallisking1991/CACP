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

  it("derives decisions and excludes messages and decisions before the last history clear", () => {
    const state = deriveRoomState([
      event("message.created", { message_id: "msg_old", text: "old message", kind: "human" }, 1, "user_1"),
      event("decision.requested", {
        decision_id: "dec_old",
        title: "Old decision",
        description: "Ignored after clear",
        kind: "single_choice",
        options: [{ id: "old", label: "Old option" }],
        policy: { type: "majority" },
        blocking: true
      }, 2, "agent_1"),
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:03.000Z", scope: "messages_and_decisions" }, 3, "user_1"),
      event("message.created", { message_id: "msg_new", text: "new message", kind: "human" }, 4, "user_1"),
      event("decision.requested", {
        decision_id: "dec_1",
        title: "Choose agent",
        description: "Which agent should continue?",
        kind: "single_choice",
        options: [{ id: "A", label: "Claude Code CLI" }, { id: "B", label: "Codex CLI" }],
        policy: { type: "majority" },
        blocking: true
      }, 5, "agent_1"),
      event("decision.response_recorded", {
        decision_id: "dec_1",
        respondent_id: "user_1",
        response: "B",
        response_label: "Codex CLI",
        source_message_id: "msg_response_1",
        interpretation: { method: "manual", confidence: 1 }
      }, 6, "user_1"),
      event("decision.response_recorded", {
        decision_id: "dec_1",
        respondent_id: "user_1",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_response_2",
        interpretation: { method: "manual", confidence: 1 }
      }, 7, "user_1"),
      event("decision.resolved", {
        decision_id: "dec_1",
        result: "A",
        result_label: "Claude Code CLI",
        decided_by: ["user_1"],
        policy_evaluation: { status: "resolved", reason: "majority policy satisfied" }
      }, 8, "user_1")
    ]);

    expect(state.lastHistoryClearedAt).toBe("2026-04-25T00:00:03.000Z");
    expect(state.messages).toEqual([{ message_id: "msg_new", actor_id: "user_1", text: "new message", kind: "human", created_at: "2026-04-25T00:00:04.000Z" }]);
    expect(state.currentDecision).toBeUndefined();
    expect(state.decisionHistory).toHaveLength(1);
    expect(state.decisionHistory.map((decision) => decision.decision_id)).not.toContain("dec_old");
    expect(state.decisionHistory[0]).toMatchObject({ decision_id: "dec_1", terminal_status: "resolved", result_label: "Claude Code CLI" });
    expect(state.decisionHistory[0].responses.find((response) => response.respondent_id === "user_1")?.response).toBe("A");
  });

  it("keeps open non-blocking decisions visible as current decisions", () => {
    const state = deriveRoomState([
      event("decision.requested", {
        decision_id: "dec_open",
        title: "FYI choice",
        description: "Non-blocking decisions still need UI state.",
        kind: "single_choice",
        options: [{ id: "A", label: "Option A" }],
        policy: { type: "no_approval" },
        blocking: false
      }, 1, "agent_1")
    ]);

    expect(state.currentDecision).toMatchObject({ decision_id: "dec_open", blocking: false });
    expect(state.decisionHistory).toEqual([]);
  });

  it("moves cancelled decisions out of current decision and into history", () => {
    const state = deriveRoomState([
      event("decision.requested", {
        decision_id: "dec_cancelled",
        title: "Should we continue?",
        description: "Cancellation should make the decision terminal.",
        kind: "approval",
        options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
        policy: { type: "majority" },
        blocking: true
      }, 1, "agent_1"),
      event("decision.cancelled", {
        decision_id: "dec_cancelled",
        reason: "Superseded",
        cancelled_by: "user_1"
      }, 2, "user_1")
    ]);

    expect(state.currentDecision).toBeUndefined();
    expect(state.decisionHistory).toHaveLength(1);
    expect(state.decisionHistory[0]).toMatchObject({
      decision_id: "dec_cancelled",
      terminal_status: "cancelled",
      cancelled_reason: "Superseded",
      cancelled_by: "user_1"
    });
  });

  it("keeps participants, agents, and invites from all events across history clear", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 2, "agent_1"),
      event("invite.created", { role: "member", expires_at: "2026-04-26T00:00:00.000Z" }, 3, "user_1"),
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:04.000Z", scope: "messages_and_decisions" }, 4, "user_1"),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 5, "user_2"),
      event("agent.registered", { agent_id: "agent_2", name: "Codex Agent", capabilities: ["repo.write"] }, 6, "agent_2"),
      event("invite.created", { role: "observer", expires_at: "2026-04-27T00:00:00.000Z" }, 7, "user_1")
    ]);

    expect(state.participants.map((participant) => participant.id)).toEqual(["user_1", "user_2"]);
    expect(state.agents.map((agent) => agent.agent_id)).toEqual(["agent_1", "agent_2"]);
    expect(state.inviteCount).toBe(2);
  });

  it("scopes streaming turns to events after the last history clear", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_old", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_old", agent_id: "agent_1", chunk: "old" }, 2, "agent_1"),
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:03.000Z", scope: "messages_and_decisions" }, 3, "user_1"),
      event("agent.turn.started", { turn_id: "turn_new", agent_id: "agent_1" }, 4, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_new", agent_id: "agent_1", chunk: "new" }, 5, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([{ turn_id: "turn_new", agent_id: "agent_1", text: "new" }]);
  });

});
