import { describe, expect, it } from "vitest";
import {
  CacpEventSchema,
  AiCollectionRequestedPayloadSchema,
  AiCollectionRequestApprovedPayloadSchema,
  AiCollectionRequestRejectedPayloadSchema,
  ClaudeSessionCatalogUpdatedPayloadSchema,
  ClaudeSessionImportStartedPayloadSchema,
  ClaudeSessionSelectedPayloadSchema,
  ClaudeSessionReadyPayloadSchema,
  ClaudeSessionImportMessagePayloadSchema,
  ClaudeRuntimeStatusChangedPayloadSchema,
  ParticipantPresenceChangedPayloadSchema,
  ParticipantTypingStartedPayloadSchema,
  ParticipantTypingStoppedPayloadSchema,
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

  it("accepts AI flow control and history clear event types", () => {
    for (const type of [
      "ai.collection.started",
      "ai.collection.submitted",
      "ai.collection.cancelled",
      "ai.collection.requested",
      "ai.collection.request_approved",
      "ai.collection.request_rejected",
      "room.history_cleared"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-04-26T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
  });

  it("accepts AI collection request payload shapes", () => {
    const requested = AiCollectionRequestedPayloadSchema.parse({
      request_id: "req_1",
      requested_by: "user_a"
    });
    expect(requested.request_id).toBe("req_1");
    expect(requested.requested_by).toBe("user_a");

    const approved = AiCollectionRequestApprovedPayloadSchema.parse({
      request_id: "req_1",
      approved_by: "user_b",
      collection_id: "col_1"
    });
    expect(approved.collection_id).toBe("col_1");

    const rejected = AiCollectionRequestRejectedPayloadSchema.parse({
      request_id: "req_1",
      rejected_by: "user_c"
    });
    expect(rejected.rejected_by).toBe("user_c");
  });

  it("rejects removed structured decision and question event types", () => {
    for (const type of ["decision.requested", "decision.resolved", "question.created", "question.closed"]) {
      expect(() => CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-04-26T00:00:00.000Z",
        payload: {}
      })).toThrow();
    }
  });

  it("accepts Claude session catalog events", () => {
    const payload = {
      agent_id: "agent_1",
      working_dir: "D:\\Development\\2",
      sessions: [{
        session_id: "session_1",
        title: "CACP planning",
        project_dir: "D:\\Development\\2",
        updated_at: "2026-04-29T00:00:00.000Z",
        message_count: 12,
        byte_size: 34567,
        importable: true
      }]
    };
    expect(ClaudeSessionCatalogUpdatedPayloadSchema.parse(payload)).toEqual(payload);
    expect(CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.2.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "claude.session_catalog.updated",
      actor_id: "agent_1",
      created_at: "2026-04-29T00:00:00.000Z",
      payload
    }).type).toBe("claude.session_catalog.updated");
  });

  it("strips transcript previews from Claude session catalog payloads", () => {
    const parsed = ClaudeSessionCatalogUpdatedPayloadSchema.parse({
      agent_id: "agent_1",
      working_dir: "D:\\Development\\2",
      sessions: [{
        session_id: "session_1",
        title: "CACP planning",
        project_dir: "D:\\Development\\2",
        updated_at: "2026-04-29T00:00:00.000Z",
        message_count: 12,
        byte_size: 34567,
        importable: true,
        messages: [{ author_role: "user", text: "should not be catalog metadata" }]
      }]
    });

    expect(parsed.sessions[0]).not.toHaveProperty("messages");
  });

  it("accepts Claude session selection events", () => {
    expect(ClaudeSessionSelectedPayloadSchema.parse({
      agent_id: "agent_1",
      mode: "resume",
      session_id: "session_1",
      selected_by: "owner_1"
    }).mode).toBe("resume");
    expect(ClaudeSessionSelectedPayloadSchema.parse({
      agent_id: "agent_1",
      mode: "fresh",
      selected_by: "owner_1"
    }).mode).toBe("fresh");
  });



  it("accepts Claude session ready payloads after connector startup", () => {
    expect(ClaudeSessionReadyPayloadSchema.parse({
      agent_id: "agent_1",
      mode: "fresh",
      session_id: "session_new",
      ready_at: "2026-04-29T00:00:00.000Z"
    }).mode).toBe("fresh");
    expect(ClaudeSessionReadyPayloadSchema.parse({
      agent_id: "agent_1",
      mode: "resume",
      session_id: "session_1",
      ready_at: "2026-04-29T00:00:00.000Z"
    }).mode).toBe("resume");
  });

  it("accepts imported Claude transcript message payloads", () => {
    const payload = {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      sequence: 1,
      source_message_id: "msg_sdk_1",
      original_created_at: "2026-04-28T12:00:00.000Z",
      author_role: "assistant",
      source_kind: "assistant",
      text: "Visible Claude answer"
    };
    expect(ClaudeSessionImportMessagePayloadSchema.parse(payload)).toEqual(payload);
  });

  it("limits a single Claude session import to a bounded number of visible messages", () => {
    const payload = {
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      title: "Large session",
      message_count: 1001,
      started_at: "2026-04-29T00:00:00.000Z"
    };

    expect(() => ClaudeSessionImportStartedPayloadSchema.parse(payload)).toThrow();
  });

  it("accepts rolling Claude runtime status payloads", () => {
    const payload = {
      agent_id: "agent_1",
      turn_id: "turn_1",
      status_id: "status_turn_1",
      phase: "reading_files",
      current: "Reading packages/server/src/pairing.ts",
      recent: ["Started turn", "Reading packages/server/src/pairing.ts"],
      metrics: { files_read: 1, searches: 0, commands: 0 },
      started_at: "2026-04-29T00:00:00.000Z",
      updated_at: "2026-04-29T00:00:01.000Z"
    };
    expect(ClaudeRuntimeStatusChangedPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("accepts participant presence and typing activity events", () => {
    const presencePayload = ParticipantPresenceChangedPayloadSchema.parse({
      participant_id: "user_1",
      presence: "idle",
      updated_at: "2026-04-30T00:00:00.000Z"
    });
    expect(presencePayload.presence).toBe("idle");

    const typingStartedPayload = ParticipantTypingStartedPayloadSchema.parse({
      participant_id: "user_1",
      scope: "room",
      started_at: "2026-04-30T00:00:01.000Z"
    });
    expect(typingStartedPayload.scope).toBe("room");

    const typingStoppedPayload = ParticipantTypingStoppedPayloadSchema.parse({
      participant_id: "user_1",
      scope: "room",
      stopped_at: "2026-04-30T00:00:02.000Z"
    });
    expect(typingStoppedPayload.participant_id).toBe("user_1");

    for (const type of [
      "participant.presence_changed",
      "participant.typing_started",
      "participant.typing_stopped"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-04-30T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
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
