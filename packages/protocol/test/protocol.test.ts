import { describe, expect, it } from "vitest";
import {
  CacpEventSchema,
  DecisionRequestedPayloadSchema,
  DecisionResponseRecordedPayloadSchema,
  DecisionResolvedPayloadSchema,
  DecisionCancelledPayloadSchema,
  evaluatePolicy,
  type Participant,
  type Policy,
  type VoteRecord
} from "../src/index.js";

const participants: Participant[] = [
  { id: "u_owner", type: "human", display_name: "Owner", role: "owner" },
  { id: "u_admin", type: "human", display_name: "Admin", role: "admin" },
  { id: "u_member", type: "human", display_name: "Member", role: "member" },
  { id: "u_observer", type: "observer", display_name: "Observer", role: "observer" }
];

describe("CACP event schema", () => {
  it("accepts a valid event and rejects unknown event types", () => {
    expect(CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.1.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "message.created",
      actor_id: "u_owner",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: { text: "hello" }
    }).type).toBe("message.created");

    expect(() => CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.1.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "unknown.event",
      actor_id: "u_owner",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: {}
    })).toThrow();
  });

  it("accepts room agent selection and agent turn events", () => {
    for (const type of [
      "room.configured",
      "room.agent_selected",
      "agent.pairing_created",
      "agent.status_changed",
      "agent.action_approval_requested",
      "agent.action_approval_resolved",
      "agent.turn.requested",
      "agent.turn.followup_queued",
      "agent.turn.started",
      "agent.output.delta",
      "agent.turn.completed",
      "agent.turn.failed"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.1.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-04-25T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
  });

  it("accepts v0.2 decision events and payloads", () => {
    expect(CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.2.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "decision.requested",
      actor_id: "agent_1",
      created_at: "2026-04-26T00:00:00.000Z",
      payload: {
        decision_id: "dec_1",
        title: "Choose CLI",
        description: "Pick the first CLI integration.",
        kind: "single_choice",
        options: [{ id: "A", label: "Claude Code CLI" }],
        policy: { type: "majority" },
        blocking: true
      }
    }).type).toBe("decision.requested");

    expect(DecisionRequestedPayloadSchema.parse({
      decision_id: "dec_1",
      title: "Approve write",
      description: "Allow file writes?",
      kind: "approval",
      options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
      policy: { type: "owner_approval" },
      blocking: true
    }).kind).toBe("approval");

    expect(DecisionResponseRecordedPayloadSchema.parse({
      decision_id: "dec_1",
      respondent_id: "user_1",
      response: "approve",
      response_label: "Approve",
      source_message_id: "msg_1",
      interpretation: { method: "deterministic", confidence: 1 }
    }).response).toBe("approve");

    expect(DecisionResolvedPayloadSchema.parse({
      decision_id: "dec_1",
      result: "approve",
      result_label: "Approve",
      decided_by: ["user_1"],
      policy_evaluation: { status: "approved", reason: "owner selected approve" }
    }).result).toBe("approve");

    expect(DecisionCancelledPayloadSchema.parse({
      decision_id: "dec_1",
      reason: "Skipped by owner",
      cancelled_by: "user_1"
    }).reason).toBe("Skipped by owner");
  });

});

describe("policy engine", () => {
  it("approves owner approval, majority, role quorum, and no approval policies", () => {
    expect(evaluatePolicy({ type: "owner_approval" }, participants, [{ voter_id: "u_owner", vote: "approve" }]).status).toBe("approved");
    expect(evaluatePolicy({ type: "majority" }, participants, [
      { voter_id: "u_owner", vote: "approve" },
      { voter_id: "u_admin", vote: "approve" }
    ]).status).toBe("approved");
    expect(evaluatePolicy({ type: "role_quorum", required_roles: ["owner", "admin"], min_approvals: 1 }, participants, [
      { voter_id: "u_admin", vote: "approve" }
    ]).status).toBe("approved");
    expect(evaluatePolicy({ type: "no_approval" }, participants, []).status).toBe("approved");
  });

  it("does not count agent type votes even when role is admin", () => {
    const mixedParticipants: Participant[] = [
      { id: "u_owner", type: "human", display_name: "Owner", role: "owner" },
      { id: "agent_admin", type: "agent", display_name: "Agent Admin", role: "admin" }
    ];

    const result = evaluatePolicy({ type: "majority" }, mixedParticipants, [
      { voter_id: "agent_admin", vote: "approve" }
    ]);

    expect(result.status).toBe("pending");
    expect(result.approvals).toBe(0);
    expect(result.eligible_voters).toBe(1);
  });

  it("does not count observer type votes even when role is member", () => {
    const mixedParticipants: Participant[] = [
      { id: "u_owner", type: "human", display_name: "Owner", role: "owner" },
      { id: "observer_member", type: "observer", display_name: "Observer Member", role: "member" }
    ];

    const result = evaluatePolicy({ type: "majority" }, mixedParticipants, [
      { voter_id: "observer_member", vote: "approve" }
    ]);

    expect(result.status).toBe("pending");
    expect(result.approvals).toBe(0);
    expect(result.eligible_voters).toBe(1);
  });

  it("uses the latest vote from each eligible voter", () => {
    const result = evaluatePolicy({ type: "majority" }, participants, [
      { voter_id: "u_owner", vote: "reject" },
      { voter_id: "u_admin", vote: "approve" },
      { voter_id: "u_owner", vote: "approve" }
    ]);

    expect(result.status).toBe("approved");
    expect(result.approvals).toBe(2);
    expect(result.rejections).toBe(0);
  });

  it("rejects majority policies when rejection threshold is reached", () => {
    const result = evaluatePolicy({ type: "majority" }, participants, [
      { voter_id: "u_owner", vote: "reject" },
      { voter_id: "u_admin", vote: "reject" }
    ]);

    expect(result.status).toBe("rejected");
    expect(result.rejections).toBe(2);
  });

  it("ignores votes from roles outside a role quorum policy", () => {
    const result = evaluatePolicy({ type: "role_quorum", required_roles: ["owner"], min_approvals: 1 }, participants, [
      { voter_id: "u_admin", vote: "approve" }
    ]);

    expect(result.status).toBe("pending");
    expect(result.approvals).toBe(0);
    expect(result.eligible_voters).toBe(1);
  });

  it("expires policies at the exact expiration boundary", () => {
    const expiresAt = "2026-04-25T00:00:00.000Z";

    expect(evaluatePolicy(
      { type: "majority", expires_at: expiresAt },
      participants,
      [],
      new Date(expiresAt)
    ).status).toBe("expired");
  });

  it("rejects unanimous on rejection and expires old policies", () => {
    const votes: VoteRecord[] = [
      { voter_id: "u_owner", vote: "approve" },
      { voter_id: "u_admin", vote: "reject" }
    ];
    const expired: Policy = { type: "majority", expires_at: "2026-04-25T00:00:00.000Z" };

    expect(evaluatePolicy({ type: "unanimous" }, participants, votes).status).toBe("rejected");
    expect(evaluatePolicy(expired, participants, [], new Date("2026-04-25T00:01:00.000Z")).status).toBe("expired");
  });
});
