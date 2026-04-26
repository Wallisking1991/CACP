import { describe, expect, it } from "vitest";
import type { CacpEvent, DecisionRequestedPayload, Participant } from "@cacp/protocol";
import {
  deriveDecisionStates,
  evaluateDecisionPolicy,
  extractCacpDecisions,
  interpretDecisionResponse
} from "../src/decisions.js";

const participants: Participant[] = [
  { id: "alice", type: "human", display_name: "Alice", role: "owner" },
  { id: "bob", type: "human", display_name: "Bob", role: "member" },
  { id: "agent_1", type: "agent", display_name: "Claude", role: "agent" }
];

const singleChoiceDecision: DecisionRequestedPayload = {
  decision_id: "decision_cli",
  title: "Choose CLI",
  description: "Choose which CLI should handle the implementation.",
  kind: "single_choice",
  options: [
    { id: "A", label: "Claude Code CLI" },
    { id: "B", label: "Codex CLI" }
  ],
  policy: { type: "majority" },
  blocking: true
};

const approvalDecision: DecisionRequestedPayload = {
  decision_id: "decision_approval",
  title: "Approve plan",
  description: "Approve the proposed implementation plan.",
  kind: "approval",
  options: [
    { id: "approve", label: "Approve" },
    { id: "reject", label: "Reject" }
  ],
  policy: { type: "owner_approval" },
  blocking: true
};

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "agent_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-26T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

describe("decision helpers", () => {
  it("extracts CACP decision blocks and applies room default policy", () => {
    const textWithCacpDecisionBlock = [
      "We need a room decision:",
      "```cacp-decision",
      JSON.stringify({
        decision_id: "decision_cli",
        title: "Choose CLI",
        description: "Choose which CLI should handle the implementation.",
        kind: "single_choice",
        options: singleChoiceDecision.options,
        policy: "room_default",
        blocking: true
      }),
      "```"
    ].join("\n");

    expect(extractCacpDecisions(textWithCacpDecisionBlock, { type: "majority" })[0]).toMatchObject({
      title: "Choose CLI",
      policy: { type: "majority" }
    });
  });

  it("extracts decision drafts without requiring an AI-provided decision_id", () => {
    const textWithDraftDecisionBlock = [
      "Decision needed:",
      "```cacp-decision",
      JSON.stringify({
        title: "Choose CLI",
        description: "Choose which CLI should handle the implementation.",
        kind: "single_choice",
        options: singleChoiceDecision.options,
        policy: "room_default",
        blocking: true
      }),
      "```"
    ].join("\n");

    const decisions = extractCacpDecisions(textWithDraftDecisionBlock, { type: "majority" });
    expect(decisions[0]).toMatchObject({
      title: "Choose CLI",
      policy: { type: "majority" }
    });
    expect(decisions[0]).not.toHaveProperty("decision_id");
  });

  it("ignores malformed decision blocks while extracting valid adjacent drafts", () => {
    const text = [
      "```cacp-decision",
      "{not valid json",
      "```",
      "```cacp-decision",
      JSON.stringify({
        title: "Approve plan",
        description: "Approve the proposed implementation plan.",
        kind: "approval",
        options: approvalDecision.options,
        policy: { type: "owner_approval" },
        blocking: true
      }),
      "```"
    ].join("\n");

    expect(extractCacpDecisions(text, { type: "majority" })).toHaveLength(1);
    expect(extractCacpDecisions(text, { type: "majority" })[0]).toMatchObject({
      title: "Approve plan",
      policy: { type: "owner_approval" }
    });
  });

  it("interprets single-choice responses by explicit choice", () => {
    expect(interpretDecisionResponse({ decision: singleChoiceDecision, text: "I choose A" })).toMatchObject({
      response: "A",
      response_label: "Claude Code CLI"
    });
  });

  it("does not match single-choice labels as arbitrary substrings", () => {
    const yesNoDecision: DecisionRequestedPayload = {
      ...singleChoiceDecision,
      decision_id: "decision_yes_no",
      options: [
        { id: "Y", label: "Yes" },
        { id: "N", label: "No" }
      ]
    };

    expect(interpretDecisionResponse({ decision: yesNoDecision, text: "no need to decide yet" })).toBeUndefined();
    expect(interpretDecisionResponse({ decision: yesNoDecision, text: "choose No" })).toMatchObject({
      response: "N",
      response_label: "No"
    });
  });

  it("interprets approval responses in Chinese", () => {
    expect(interpretDecisionResponse({ decision: approvalDecision, text: "同意" })).toMatchObject({
      response: "approve",
      response_label: "Approve"
    });
  });

  it("derives latest decision state and resolves majority policy", () => {
    const stateWithTwoLatestAResponses = deriveDecisionStates([
      event("decision.requested", singleChoiceDecision, 1),
      event("decision.response_recorded", {
        decision_id: "decision_cli",
        respondent_id: "alice",
        response: "B",
        response_label: "Codex CLI",
        source_message_id: "msg_1",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 2, "alice"),
      event("decision.response_recorded", {
        decision_id: "decision_cli",
        respondent_id: "alice",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_2",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 3, "alice"),
      event("decision.response_recorded", {
        decision_id: "decision_cli",
        respondent_id: "bob",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_3",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 4, "bob")
    ])[0];

    expect(stateWithTwoLatestAResponses.responses).toHaveLength(2);
    expect(evaluateDecisionPolicy({ decision: stateWithTwoLatestAResponses, participants }).status).toBe("resolved");
  });

  it("keeps role_quorum decisions open instead of falling back to majority", () => {
    const roleQuorumDecision: DecisionRequestedPayload = {
      ...singleChoiceDecision,
      decision_id: "decision_role_quorum",
      policy: { type: "role_quorum", required_roles: ["owner"], min_approvals: 1 }
    };
    const state = deriveDecisionStates([
      event("decision.requested", roleQuorumDecision, 1),
      event("decision.response_recorded", {
        decision_id: "decision_role_quorum",
        respondent_id: "alice",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_1",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 2, "alice"),
      event("decision.response_recorded", {
        decision_id: "decision_role_quorum",
        respondent_id: "bob",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_2",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 3, "bob")
    ])[0];

    expect(evaluateDecisionPolicy({ decision: state, participants })).toMatchObject({
      status: "open",
      reason: "unsupported decision policy: role_quorum"
    });
  });

  it("keeps no_approval decisions open instead of falling back to majority", () => {
    const noApprovalDecision: DecisionRequestedPayload = {
      ...singleChoiceDecision,
      decision_id: "decision_no_approval",
      policy: { type: "no_approval" }
    };
    const state = deriveDecisionStates([
      event("decision.requested", noApprovalDecision, 1),
      event("decision.response_recorded", {
        decision_id: "decision_no_approval",
        respondent_id: "alice",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_1",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 2, "alice"),
      event("decision.response_recorded", {
        decision_id: "decision_no_approval",
        respondent_id: "bob",
        response: "A",
        response_label: "Claude Code CLI",
        source_message_id: "msg_2",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 3, "bob")
    ])[0];

    expect(evaluateDecisionPolicy({ decision: state, participants })).toMatchObject({
      status: "open",
      reason: "unsupported decision policy: no_approval"
    });
  });

  it("resolves owner_approval using any owner and the latest owner response", () => {
    const multiOwnerParticipants: Participant[] = [
      { id: "alice", type: "human", display_name: "Alice", role: "owner" },
      { id: "bob", type: "human", display_name: "Bob", role: "owner" },
      { id: "agent_1", type: "agent", display_name: "Claude", role: "agent" }
    ];
    const state = deriveDecisionStates([
      event("decision.requested", approvalDecision, 1),
      event("decision.response_recorded", {
        decision_id: "decision_approval",
        respondent_id: "bob",
        response: "approve",
        response_label: "Approve",
        source_message_id: "msg_1",
        interpretation: { method: "deterministic", confidence: 1 }
      }, 2, "bob")
    ])[0];

    expect(evaluateDecisionPolicy({ decision: state, participants: multiOwnerParticipants })).toMatchObject({
      status: "resolved",
      result: "approve",
      result_label: "Approve",
      decided_by: ["bob"]
    });
  });

});
