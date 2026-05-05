import { describe, expect, it } from "vitest";
import {
  AgentTypeSchema,
  AgentRunApprovalRequestBodySchema,
  AgentRunApprovalResolveBodySchema,
  AgentRunCompletedPayloadSchema,
  AgentRunElicitationRequestBodySchema,
  AgentRunElicitationResolveBodySchema,
  AgentRunFailedPayloadSchema,
  AgentRunMetricsSchema,
  AgentRunNodeCompletedPayloadSchema,
  AgentRunNodeDeltaPayloadSchema,
  AgentRunNodeFailedPayloadSchema,
  AgentRunNodeKindSchema,
  AgentRunSourceRefsSchema,
  AgentRunNodeStartedPayloadSchema,
  AgentRunNodeStatusSchema,
  AgentRunNodeUpdatedPayloadSchema,
  AgentRunStartedPayloadSchema,
  CacpEventSchema,
  ClaudeSessionCatalogUpdatedPayloadSchema,
  ClaudeSessionImportStartedPayloadSchema,
  ClaudeSessionImportMessagePayloadSchema,
  ClaudeSessionReadyPayloadSchema,
  ClaudeSessionSelectedPayloadSchema,
  AgentSessionCatalogUpdatedPayloadSchema,
  AgentSessionImportMessagePayloadSchema,
  ParticipantPresenceChangedPayloadSchema,
  ParticipantTypingStartedPayloadSchema,
  ParticipantTypingStoppedPayloadSchema,
  MainInputAcceptedPayloadSchema,
  ConnectorSnapshotEntryPayloadSchema,
  OrbitNoteCreatedPayloadSchema,
  OrbitLikeChangedPayloadSchema,
  OrbitClearedPayloadSchema,
  OrbitNotesQuotedPayloadSchema,
  ConnectorLedgerEntrySchema,
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

  it("rejects retired ai.collection event types", () => {
    for (const type of [
      "ai.collection.started",
      "ai.collection.submitted",
      "ai.collection.cancelled",
      "ai.collection.requested",
      "ai.collection.request_approved",
      "ai.collection.request_rejected"
    ]) {
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

  it("accepts run-trace event types and rejects retired runtime event types", () => {
    for (const type of [
      "agent.run.started",
      "agent.run.completed",
      "agent.run.failed",
      "agent.run.node.started",
      "agent.run.node.delta",
      "agent.run.node.updated",
      "agent.run.node.completed",
      "agent.run.node.failed"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "agent_1",
        created_at: "2026-05-05T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }

    for (const type of [
      "claude.output.thinking_delta",
      "claude.runtime.status_changed",
      "claude.runtime.status_completed",
      "claude.runtime.status_failed",
      "agent.runtime.status_changed",
      "agent.runtime.status_completed",
      "agent.runtime.status_failed",
      "agent.action_approval_requested",
      "agent.action_approval_resolved"
    ]) {
      expect(() => CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "agent_1",
        created_at: "2026-05-05T00:00:00.000Z",
        payload: {}
      })).toThrow();
    }
  });

  it("accepts run node kinds and statuses", () => {
    expect(AgentRunNodeKindSchema.parse("reasoning_summary")).toBe("reasoning_summary");
    expect(AgentRunNodeKindSchema.parse("approval")).toBe("approval");
    expect(AgentRunNodeStatusSchema.parse("waiting_input")).toBe("waiting_input");
    expect(AgentRunNodeStatusSchema.parse("completed")).toBe("completed");
  });

  it("accepts run lifecycle and interaction payloads", () => {
    expect(AgentRunStartedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      started_at: "2026-05-05T00:00:00.000Z"
    })).toEqual({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      started_at: "2026-05-05T00:00:00.000Z"
    });

    expect(AgentRunNodeStartedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      node_id: "toolu_1",
      kind: "tool",
      status: "running",
      title: "Read README.md",
      started_at: "2026-05-05T00:00:01.000Z",
      updated_at: "2026-05-05T00:00:01.000Z"
    })).toMatchObject({
      node_id: "toolu_1",
      kind: "tool",
      status: "running"
    });

    expect(AgentRunApprovalRequestBodySchema.parse({
      agent_id: "agent_1",
      turn_id: "turn_1",
      tool_node_id: "toolu_1",
      tool_use_id: "toolu_1",
      tool_name: "Bash",
      title: "Run Bash",
      display_name: "Bash",
      description: "Execute a workspace command",
      decision_reason: "Needs write access",
      blocked_path: "D:\\Development\\2",
      input: { command: "Get-ChildItem" },
      requested_at: "2026-05-05T00:00:02.000Z"
    })).toMatchObject({
      tool_node_id: "toolu_1",
      tool_name: "Bash",
      decision_reason: "Needs write access"
    });

    expect(AgentRunElicitationResolveBodySchema.parse({
      action: "accept",
      content: { token: "abc" }
    })).toEqual({
      action: "accept",
      content: { token: "abc" }
    });
  });

  it("enforces run node lifecycle and interaction invariants", () => {
    expect(() => AgentRunNodeStartedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      node_id: "toolu_1",
      kind: "tool",
      status: "completed",
      started_at: "2026-05-05T00:00:01.000Z",
      updated_at: "2026-05-05T00:00:01.000Z"
    })).toThrow();

    expect(() => AgentRunNodeUpdatedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "claude-code",
      node_id: "toolu_1",
      status: "failed",
      updated_at: "2026-05-05T00:00:02.000Z"
    })).toThrow();

    expect(() => AgentRunSourceRefsSchema.parse({})).toThrow();
    expect(AgentRunSourceRefsSchema.parse({
      tool_use_id: "toolu_1",
      parent_tool_use_id: null
    })).toEqual({
      tool_use_id: "toolu_1",
      parent_tool_use_id: null
    });
    expect(() => AgentRunSourceRefsSchema.parse({
      parent_tool_use_id: null
    })).toThrow();

    expect(AgentRunApprovalResolveBodySchema.parse({
      decision: "allow"
    })).toEqual({ decision: "allow" });
    expect(() => AgentRunApprovalResolveBodySchema.parse({
      decision: "allow",
      action: "approve"
    })).toThrow();

    expect(AgentRunElicitationRequestBodySchema.parse({
      agent_id: "agent_1",
      turn_id: "turn_1",
      title: "Authenticate MCP",
      display_name: "GitHub",
      description: "Sign in to continue",
      message: "Open the link and confirm once complete.",
      mode: "url",
      url: "https://example.com/oauth/start",
      requested_schema: { type: "object" },
      requested_at: "2026-05-05T00:00:03.000Z"
    })).toMatchObject({
      message: "Open the link and confirm once complete.",
      mode: "url"
    });

    expect(AgentRunElicitationResolveBodySchema.parse({
      action: "accept"
    })).toEqual({ action: "accept" });
    expect(AgentRunElicitationResolveBodySchema.parse({
      action: "cancel"
    })).toEqual({ action: "cancel" });
    expect(() => AgentRunElicitationResolveBodySchema.parse({
      action: "decline",
      content: { token: "abc" }
    })).toThrow();
    expect(() => AgentRunElicitationRequestBodySchema.parse({
      agent_id: "agent_1",
      turn_id: "turn_1",
      message: "Open the link and confirm once complete.",
      mode: "url",
      requested_at: "2026-05-05T00:00:03.000Z"
    })).toThrow();
    expect(() => AgentRunElicitationRequestBodySchema.parse({
      agent_id: "agent_1",
      turn_id: "turn_1",
      message: "Provide a token",
      mode: "form",
      requested_at: "2026-05-05T00:00:03.000Z"
    })).toThrow();
  });

  it("accepts Codex CLI as a local command agent type", () => {
    expect(AgentTypeSchema.parse("codex-cli")).toBe("codex-cli");
    expect(() => AgentTypeSchema.parse("codex")).toThrow();
  });

  it("accepts provider-neutral local agent session catalog events", () => {
    const payload = {
      agent_id: "agent_1",
      provider: "codex-cli",
      working_dir: "D:\\Development\\2",
      sessions: [{
        session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187",
        title: "Codex thread 019de11a",
        project_dir: "D:\\Development\\2",
        updated_at: "2026-05-01T01:15:01.643Z",
        message_count: 3,
        byte_size: 71545,
        importable: true,
        provider: "codex-cli"
      }]
    };

    expect(AgentSessionCatalogUpdatedPayloadSchema.parse(payload)).toEqual(payload);
    expect(CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.2.0",
      event_id: "evt_agent_catalog",
      room_id: "room_1",
      type: "agent.session_catalog.updated",
      actor_id: "agent_1",
      created_at: "2026-05-01T01:15:02.000Z",
      payload
    }).type).toBe("agent.session_catalog.updated");
  });

  it("accepts provider-neutral local agent import payloads and run-trace schemas", () => {
    expect(AgentSessionImportMessagePayloadSchema.parse({
      import_id: "import_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187",
      sequence: 0,
      author_role: "assistant",
      source_kind: "assistant",
      text: "Visible Codex answer"
    })).toMatchObject({ provider: "codex-cli", author_role: "assistant" });

    expect(AgentRunCompletedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      summary: "Completed turn",
      metrics: { files_read: 0, searches: 0, commands: 1 },
      completed_at: "2026-05-01T01:17:02.000Z"
    })).toMatchObject({ provider: "codex-cli", metrics: { commands: 1 } });

    expect(AgentRunFailedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      error: "Command failed",
      metrics: { files_read: 0, searches: 0, commands: 1 },
      failed_at: "2026-05-01T01:17:02.000Z"
    })).toMatchObject({ provider: "codex-cli", error: "Command failed" });

    expect(AgentRunNodeDeltaPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      node_id: "node_1",
      delta: "Reading files"
    })).toEqual({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      node_id: "node_1",
      delta: "Reading files"
    });

    expect(AgentRunNodeUpdatedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      node_id: "node_1",
      status: "streaming",
      updated_at: "2026-05-01T01:17:01.000Z"
    })).toMatchObject({ node_id: "node_1", status: "streaming" });

    expect(AgentRunNodeCompletedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      node_id: "node_1",
      status: "completed",
      updated_at: "2026-05-01T01:17:02.000Z",
      completed_at: "2026-05-01T01:17:02.000Z"
    })).toMatchObject({ status: "completed" });

    expect(AgentRunNodeFailedPayloadSchema.parse({
      run_id: "turn_1",
      turn_id: "turn_1",
      agent_id: "agent_1",
      provider: "codex-cli",
      node_id: "node_1",
      status: "failed",
      error: "Node failed",
      updated_at: "2026-05-01T01:17:02.000Z",
      failed_at: "2026-05-01T01:17:02.000Z"
    })).toMatchObject({ status: "failed", error: "Node failed" });

    expect(AgentRunMetricsSchema.parse({ files_read: 1 })).toEqual({
      files_read: 1,
      searches: 0,
      commands: 0
    });

    expect(AgentRunApprovalResolveBodySchema.parse({
      decision: "deny"
    })).toEqual({ decision: "deny" });

    expect(AgentRunElicitationRequestBodySchema.parse({
      agent_id: "agent_1",
      turn_id: "turn_1",
      message: "Provide OAuth confirmation",
      mode: "form",
      requested_schema: { type: "object", properties: { token: { type: "string" } } },
      requested_at: "2026-05-01T01:17:02.000Z"
    })).toMatchObject({ message: "Provide OAuth confirmation", mode: "form" });
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

describe("orbit and connector event schemas", () => {
  it("accepts main input event types", () => {
    for (const type of [
      "main_input.accepted",
      "main_input.queued",
      "main_input.triggered",
      "main_input.cancelled",
      "main_input.failed"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
  });

  it("accepts connector snapshot event types", () => {
    for (const type of [
      "connector.snapshot.requested",
      "connector.snapshot.started",
      "connector.snapshot.entry",
      "connector.snapshot.completed",
      "connector.snapshot.failed"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }
  });

  it("accepts flat orbit event types and rejects retired round events", () => {
    for (const type of [
      "orbit.note.created",
      "orbit.like.changed",
      "orbit.cleared",
      "orbit.notes.quoted"
    ] as const) {
      expect(CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      }).type).toBe(type);
    }

    for (const type of ["orbit.round.opened", "orbit.round.promoted"]) {
      expect(() => CacpEventSchema.parse({
        protocol: "cacp",
        version: "0.2.0",
        event_id: `evt_${type}`,
        room_id: "room_1",
        type,
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      })).toThrow();
    }
  });

  it("accepts valid main_input.accepted payloads", () => {
    const payload = {
      input_id: "input_1",
      author_id: "user_1",
      text: "Hello agent",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    };
    const parsed = MainInputAcceptedPayloadSchema.parse(payload);
    expect(parsed.input_id).toBe("input_1");
    expect(parsed.source).toBe("composer");
  });

  it("accepts valid connector snapshot entry payloads", () => {
    const payload = {
      request_id: "req_1",
      connector_id: "conn_1",
      entry: {
        ledger_version: 1,
        room_id: "room_1",
        connector_id: "conn_1",
        agent_id: "agent_1",
        sequence: 1,
        entry_id: "entry_1",
        entry_type: "human_input",
        actor_id: "user_1",
        actor_name: "Alice",
        actor_role: "owner",
        text: "Hello",
        source: "composer",
        created_at: "2026-05-01T00:00:00.000Z"
      }
    };
    const parsed = ConnectorSnapshotEntryPayloadSchema.parse(payload);
    expect(parsed.entry.sequence).toBe(1);
    expect(parsed.entry.entry_type).toBe("human_input");
  });

  it("accepts flat orbit note, clear, and quoted payloads", () => {
    expect(OrbitNoteCreatedPayloadSchema.parse({
      note_id: "note_1",
      author_id: "user_1",
      author_name: "Alice",
      text: "Great idea",
      created_at: "2026-05-01T00:00:00.000Z"
    })).not.toHaveProperty("round_id");

    expect(OrbitClearedPayloadSchema.parse({
      cleared_by: "user_1",
      cleared_at: "2026-05-01T00:00:00.000Z"
    })).toEqual({
      cleared_by: "user_1",
      cleared_at: "2026-05-01T00:00:00.000Z"
    });

    const quoted = OrbitNotesQuotedPayloadSchema.parse({ note_ids: ["note_1", "note_2"] });
    expect(quoted).toEqual({ note_ids: ["note_1", "note_2"] });
    expect(quoted).not.toHaveProperty("input_id");
    expect(() => OrbitNotesQuotedPayloadSchema.parse({ note_ids: [] })).toThrow();
  });

  it("accepts valid orbit like changed payloads", () => {
    const payload = {
      note_id: "note_1",
      participant_id: "user_2",
      liked: true,
      likes: 1
    };
    const parsed = OrbitLikeChangedPayloadSchema.parse(payload);
    expect(parsed.liked).toBe(true);
    expect(parsed.likes).toBe(1);
  });

  it("accepts valid connector ledger entries", () => {
    const entry = {
      ledger_version: 1,
      room_id: "room_1",
      connector_id: "conn_1",
      agent_id: "agent_1",
      sequence: 1,
      entry_id: "entry_1",
      entry_type: "human_input",
      actor_id: "user_1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Hello",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    };
    const parsed = ConnectorLedgerEntrySchema.parse(entry);
    expect(parsed.ledger_version).toBe(1);
    expect(parsed.sequence).toBe(1);
  });

  it("rejects connector ledger entries whose text exceeds 8000 chars", () => {
    const entry = {
      ledger_version: 1,
      room_id: "room_1",
      connector_id: "conn_1",
      agent_id: "agent_1",
      sequence: 1,
      entry_id: "entry_1",
      entry_type: "human_input",
      actor_id: "user_1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "x".repeat(8001),
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    };
    expect(() => ConnectorLedgerEntrySchema.parse(entry)).toThrow();
  });

  it("accepts connector ledger entries with text exactly 8000 chars", () => {
    const entry = {
      ledger_version: 1,
      room_id: "room_1",
      connector_id: "conn_1",
      agent_id: "agent_1",
      sequence: 1,
      entry_id: "entry_1",
      entry_type: "human_input",
      actor_id: "user_1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "x".repeat(8000),
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    };
    expect(() => ConnectorLedgerEntrySchema.parse(entry)).not.toThrow();
  });

  it("rejects connector ledger entries whose actor_name exceeds 120 chars", () => {
    const entry = {
      ledger_version: 1,
      room_id: "room_1",
      connector_id: "conn_1",
      agent_id: "agent_1",
      sequence: 1,
      entry_id: "entry_1",
      entry_type: "human_input",
      actor_id: "user_1",
      actor_name: "a".repeat(121),
      actor_role: "owner",
      text: "Hello",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    };
    expect(() => ConnectorLedgerEntrySchema.parse(entry)).toThrow();
  });
});
