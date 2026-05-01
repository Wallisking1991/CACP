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

describe("room state", () => {
  it("derives participants, agents, active agent, messages, and streaming turns", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 2),
      event("room.agent_selected", { agent_id: "agent_1" }, 3),
      event("message.created", { message_id: "msg_1", text: "hello", kind: "human" }, 4, "user_1"),
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 5, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "work" }, 6, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "ing" }, 7, "agent_1")
    ]);

    expect(state.participants).toEqual([{ id: "user_1", display_name: "Alice", role: "owner", type: "human" }]);
    expect(state.agents[0]).toMatchObject({ agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"], status: "unknown" });
    expect(state.activeAgentId).toBe("agent_1");
    expect(state.messages).toEqual([{ message_id: "msg_1", actor_id: "user_1", text: "hello", kind: "human", created_at: "2026-04-25T00:00:04.000Z" }]);
    expect(state.streamingTurns).toEqual([{ turn_id: "turn_1", agent_id: "agent_1", text: "working" }]);
  });

  it("removes streaming turns after completion", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "done" }, 2, "agent_1"),
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
  });

  it("keeps a visible system message when an agent turn fails after streaming output", () => {
    const state = deriveRoomState([
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_1", agent_id: "agent_1", chunk: "error: invalid permission mode\n" }, 2, "agent_1"),
      event("agent.turn.failed", { turn_id: "turn_1", agent_id: "agent_1", error: "command exited with code 1", exit_code: 1 }, 3, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([]);
    expect(state.messages).toEqual([
      {
        message_id: "failed-turn_1",
        actor_id: "agent_1",
        kind: "system",
        text: "Agent turn failed (exit code 1): command exited with code 1\n\nOutput before failure:\nerror: invalid permission mode",
        created_at: "2026-04-25T00:00:03.000Z"
      }
    ]);
  });

  it("derives agent online status", () => {
    const state = deriveRoomState([
      event("agent.registered", { agent_id: "agent_1", name: "Claude", capabilities: ["repo.read"] }, 1),
      event("agent.status_changed", { agent_id: "agent_1", status: "online" }, 2, "agent_1")
    ]);

    expect(state.agents[0]).toMatchObject({ agent_id: "agent_1", status: "online" });
  });

  it("removes agent from agents map when participant.removed is followed by agent.status_changed", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude", capabilities: ["repo.read"] }, 2, "user_1"),
      event("participant.joined", { participant: { id: "agent_1", display_name: "Claude", role: "agent", type: "agent" } }, 3, "agent_1"),
      event("agent.status_changed", { agent_id: "agent_1", status: "offline" }, 4, "agent_1"),
      event("participant.removed", { participant_id: "agent_1", removed_by: "agent_1", removed_at: "2026-04-25T00:00:05.000Z", reason: "disconnected" }, 5, "agent_1"),
      event("agent.status_changed", { agent_id: "agent_1", status: "offline" }, 6, "agent_1")
    ]);

    expect(state.participants).toEqual([{ id: "user_1", display_name: "Alice", role: "owner", type: "human" }]);
    expect(state.agents).toEqual([]);
  });

  it("excludes messages before the last history clear", () => {
    const state = deriveRoomState([
      event("message.created", { message_id: "msg_old", text: "old message", kind: "human" }, 1, "user_1"),
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:02.000Z", scope: "messages" }, 2, "user_1"),
      event("message.created", { message_id: "msg_new", text: "new message", kind: "human" }, 3, "user_1")
    ]);

    expect(state.lastHistoryClearedAt).toBe("2026-04-25T00:00:02.000Z");
    expect(state.messages).toEqual([
      { message_id: "cleared-evt_2", actor_id: "system", text: "__CACP_HISTORY_CLEARED__", kind: "system", created_at: "2026-04-25T00:00:02.000Z" },
      { message_id: "msg_new", actor_id: "user_1", text: "new message", kind: "human", created_at: "2026-04-25T00:00:03.000Z" }
    ]);
  });

  it("derives active and completed AI answer collections", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("ai.collection.started", { collection_id: "collection_1", started_by: "user_1" }, 2, "user_1"),
      event("message.created", { message_id: "msg_1", text: "Alice answer", kind: "human", collection_id: "collection_1" }, 3, "user_1"),
      event("ai.collection.submitted", { collection_id: "collection_1", submitted_by: "user_1", message_ids: ["msg_1"] }, 4, "user_1"),
      event("ai.collection.started", { collection_id: "collection_2", started_by: "user_1" }, 5, "user_1"),
      event("message.created", { message_id: "msg_2", text: "Second answer", kind: "human", collection_id: "collection_2" }, 6, "user_1")
    ]);

    expect(state.messages.find((message) => message.message_id === "msg_2")?.collection_id).toBe("collection_2");
    expect(state.activeCollection).toMatchObject({
      collection_id: "collection_2",
      started_by: "user_1",
      messages: [{ message_id: "msg_2", text: "Second answer", collection_id: "collection_2" }]
    });
    expect(state.collectionHistory).toHaveLength(1);
    expect(state.collectionHistory[0]).toMatchObject({
      collection_id: "collection_1",
      submitted_by: "user_1",
      message_ids: ["msg_1"],
      messages: [{ message_id: "msg_1", text: "Alice answer", collection_id: "collection_1" }]
    });
  });

  it("keeps participants, agents, and invites from all events across history clear", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 2, "agent_1"),
      event("invite.created", { role: "member", expires_at: "2026-04-26T00:00:00.000Z" }, 3, "user_1"),
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:04.000Z", scope: "messages" }, 4, "user_1"),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 5, "user_2"),
      event("agent.registered", { agent_id: "agent_2", name: "Backup Agent", capabilities: ["repo.write"] }, 6, "agent_2"),
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
      event("room.history_cleared", { cleared_by: "user_1", cleared_at: "2026-04-25T00:00:03.000Z", scope: "messages" }, 3, "user_1"),
      event("agent.turn.started", { turn_id: "turn_new", agent_id: "agent_1" }, 4, "agent_1"),
      event("agent.output.delta", { turn_id: "turn_new", agent_id: "agent_1", chunk: "new" }, 5, "agent_1")
    ]);

    expect(state.streamingTurns).toEqual([{ turn_id: "turn_new", agent_id: "agent_1", text: "new" }]);
  });

  it("derives the pending Roundtable request from collection request events", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2, "user_2"),
      event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_2" }, 3, "user_2")
    ]);
    expect(state.pendingRoundtableRequest).toEqual({
      request_id: "collection_request_1",
      requested_by: "user_2",
      requester_name: "Bob",
      created_at: "2026-04-25T00:00:03.000Z"
    });

    const resolved = deriveRoomState([
      event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_2" }, 1, "user_2"),
      event("ai.collection.request_rejected", { request_id: "collection_request_1", rejected_by: "user_1" }, 2, "user_1")
    ]);
    expect(resolved.pendingRoundtableRequest).toBeUndefined();

    const approved = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2, "user_2"),
      event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_2" }, 3, "user_2"),
      event("ai.collection.request_approved", { request_id: "collection_request_1", approved_by: "user_1" }, 4, "user_1")
    ]);
    expect(approved.pendingRoundtableRequest).toBeUndefined();
  });

  it("derives Claude session catalog and selection state", () => {
    const state = deriveRoomState([
      event("room.created", { name: "Room" }, 1, "owner"),
      event("agent.registered", { agent_id: "agent_1", name: "Claude", capabilities: ["claude-code"] }, 2, "owner"),
      event("claude.session_catalog.updated", {
        agent_id: "agent_1",
        working_dir: "D:\\Development\\2",
        sessions: [{
          session_id: "session_1",
          title: "Planning",
          project_dir: "D:\\Development\\2",
          updated_at: "2026-04-29T00:00:00.000Z",
          message_count: 3,
          byte_size: 100,
          importable: true
        }]
      }, 3, "agent_1"),
      event("claude.session_selected", {
        agent_id: "agent_1",
        mode: "resume",
        session_id: "session_1",
        selected_by: "owner"
      }, 4, "owner")
    ]);

    expect(state.claudeSessionCatalog?.sessions[0].session_id).toBe("session_1");
    expect(state.claudeSessionSelection).toEqual({
      agent_id: "agent_1",
      mode: "resume",
      session_id: "session_1",
      selected_by: "owner"
    });
  });

  it("derives owner-only Claude session preview content outside the main timeline", () => {
    const state = deriveRoomState([
      event("claude.session_preview.requested" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        session_id: "session_1",
        requested_by: "owner",
        requested_at: "2026-04-29T00:00:00.000Z"
      }, 1, "owner"),
      event("claude.session_preview.message" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        session_id: "session_1",
        sequence: 0,
        author_role: "user",
        source_kind: "user",
        text: "Preview-only user message"
      }, 2, "agent_1"),
      event("claude.session_preview.completed" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        session_id: "session_1",
        previewed_message_count: 1,
        completed_at: "2026-04-29T00:00:01.000Z"
      }, 3, "agent_1")
    ]);

    expect(state.messages).toEqual([]);
    expect(state.claudeSessionPreviews).toEqual([expect.objectContaining({
      preview_id: "preview_1",
      session_id: "session_1",
      status: "completed",
      messages: [expect.objectContaining({ text: "Preview-only user message" })]
    })]);
  });

  it("renders completed Claude imports in the main message timeline", () => {
    const state = deriveRoomState([
      event("claude.session_import.started", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        title: "Planning",
        message_count: 2,
        started_at: "2026-04-29T00:00:00.000Z"
      }, 1, "agent_1"),
      event("claude.session_import.message", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        sequence: 0,
        original_created_at: "2026-04-28T00:00:00.000Z",
        author_role: "user",
        source_kind: "user",
        text: "Old user message"
      }, 2, "agent_1"),
      event("claude.session_import.message", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        sequence: 1,
        original_created_at: "2026-04-28T00:00:01.000Z",
        author_role: "assistant",
        source_kind: "assistant",
        text: "Old Claude answer"
      }, 3, "agent_1"),
      event("claude.session_import.completed", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        imported_message_count: 2,
        completed_at: "2026-04-29T00:00:02.000Z"
      }, 4, "agent_1"),
      event("message.created", { message_id: "msg_1", text: "Continue below", kind: "human" }, 5, "owner")
    ]);

    expect(state.messages.map((message) => message.text)).toEqual([
      "__CLAUDE_IMPORT_BANNER__",
      "Old user message",
      "Old Claude answer",
      "Continue below"
    ]);
    expect(state.messages[1].kind).toBe("claude_import_user");
    expect(state.messages[2].kind).toBe("claude_import_assistant");
  });

  it("keeps imported Claude transcript contiguous before room messages posted during import", () => {
    const state = deriveRoomState([
      event("claude.session_import.started", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        title: "Planning",
        message_count: 2,
        started_at: "2026-04-29T00:00:00.000Z"
      }, 1, "agent_1"),
      event("message.created", { message_id: "msg_during_import", text: "Human typed while import was running", kind: "human" }, 2, "owner"),
      event("claude.session_import.message", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        sequence: 1,
        original_created_at: "2026-04-28T00:00:01.000Z",
        author_role: "assistant",
        source_kind: "assistant",
        text: "Imported answer"
      }, 3, "agent_1"),
      event("claude.session_import.message", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        sequence: 0,
        original_created_at: "2026-04-28T00:00:00.000Z",
        author_role: "user",
        source_kind: "user",
        text: "Imported question"
      }, 4, "agent_1"),
      event("claude.session_import.completed", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        imported_message_count: 2,
        completed_at: "2026-04-29T00:00:02.000Z"
      }, 5, "agent_1")
    ]);

    expect(state.messages.map((message) => message.text)).toEqual([
      "__CLAUDE_IMPORT_BANNER__",
      "Imported question",
      "Imported answer",
      "Human typed while import was running"
    ]);
  });

  it("shows a failed Claude import even when failure happens before import start", () => {
    const state = deriveRoomState([
      event("claude.session_import.failed", {
        import_id: "import_1",
        agent_id: "agent_1",
        session_id: "session_1",
        error: "Could not read Claude session",
        failed_at: "2026-04-29T00:00:00.000Z"
      }, 1, "agent_1")
    ]);

    expect(state.claudeImports).toEqual([expect.objectContaining({
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      status: "failed",
      error: "Could not read Claude session"
    })]);
    expect(state.messages).toEqual([expect.objectContaining({
      message_id: "claude-import-banner-import_1",
      kind: "claude_import_banner",
      claudeImportId: "import_1"
    })]);
  });

  it("derives one rolling Claude status per turn instead of messages", () => {
    const state = deriveRoomState([
      event("claude.runtime.status_changed", {
        agent_id: "agent_1",
        turn_id: "turn_1",
        status_id: "status_turn_1",
        phase: "thinking",
        current: "Thinking",
        recent: ["Thinking"],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:00:01.000Z"
      }, 1, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1",
        turn_id: "turn_1",
        status_id: "status_turn_1",
        phase: "reading_files",
        current: "Reading README.md",
        recent: ["Thinking", "Reading README.md"],
        metrics: { files_read: 1, searches: 0, commands: 0 },
        started_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:00:02.000Z"
      }, 2, "agent_1")
    ]);

    expect(state.messages).toEqual([]);
    expect(state.claudeRuntimeStatuses).toHaveLength(1);
    expect(state.claudeRuntimeStatuses[0]).toMatchObject({
      turn_id: "turn_1",
      phase: "reading_files",
      current: "Reading README.md"
    });
  });

  it("hides completed or failed Claude statuses and keeps only the most recent active one", () => {
    const state = deriveRoomState([
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_turn_1",
        phase: "thinking", current: "T1", recent: ["T1"],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-29T00:00:00.000Z", updated_at: "2026-04-29T00:00:01.000Z"
      }, 1, "agent_1"),
      event("claude.runtime.status_completed", {
        agent_id: "agent_1", turn_id: "turn_1", status_id: "status_turn_1",
        summary: "Done", completed_at: "2026-04-29T00:00:02.000Z"
      }, 2, "agent_1"),
      event("claude.runtime.status_changed", {
        agent_id: "agent_1", turn_id: "turn_2", status_id: "status_turn_2",
        phase: "thinking", current: "T2", recent: ["T2"],
        metrics: { files_read: 0, searches: 0, commands: 0 },
        started_at: "2026-04-29T00:00:03.000Z", updated_at: "2026-04-29T00:00:04.000Z"
      }, 3, "agent_1")
    ]);

    expect(state.claudeRuntimeStatuses).toHaveLength(1);
    expect(state.claudeRuntimeStatuses[0].turn_id).toBe("turn_2");
    expect(state.claudeRuntimeStatuses[0].phase).toBe("thinking");
  });

  it("derives participant activity and avatar statuses with priority", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1, "user_1"),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2, "user_2"),
      event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["claude-code", "repo.read"] }, 3, "agent_1"),
      event("room.agent_selected", { agent_id: "agent_1" }, 4, "user_1"),
      event("participant.presence_changed", { participant_id: "user_2", presence: "idle", updated_at: "2026-04-25T00:00:05.000Z" }, 5, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:06.000Z" }, 6, "user_2"),
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 7, "agent_1")
    ], { now: "2026-04-25T00:00:07.000Z" });

    expect(state.participantActivity.get("user_2")).toMatchObject({ presence: "idle", typing: true });
    expect(state.avatarStatuses.find((item) => item.id === "user_2")).toMatchObject({ kind: "human", status: "typing", group: "humans" });
    expect(state.avatarStatuses.find((item) => item.id === "agent_1")).toMatchObject({ kind: "agent", status: "working", group: "agents" });
  });

  it("expires stale typing indicators and clears typing on stop", () => {
    const stale = deriveRoomState([
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 1, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:01.000Z" }, 2, "user_2")
    ], { now: "2026-04-25T00:00:10.000Z" });
    expect(stale.participantActivity.get("user_2")?.typing).toBe(false);

    const stopped = deriveRoomState([
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 1, "user_2"),
      event("participant.typing_started", { participant_id: "user_2", scope: "room", started_at: "2026-04-25T00:00:01.000Z" }, 2, "user_2"),
      event("participant.typing_stopped", { participant_id: "user_2", scope: "room", stopped_at: "2026-04-25T00:00:02.000Z" }, 3, "user_2")
    ], { now: "2026-04-25T00:00:03.000Z" });
    expect(stopped.participantActivity.get("user_2")?.typing).toBe(false);
  });

  it("tracks invites with remaining slots via invite.created, join_request.approved, and invite.revoked", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("invite.created", { invite_id: "inv_1", role: "member", expires_at: "2026-04-26T00:00:00.000Z", max_uses: 3 }, 2, "user_1"),
      event("invite.created", { invite_id: "inv_2", role: "observer", expires_at: "2026-04-27T00:00:00.000Z", max_uses: 5 }, 3, "user_1"),
      event("join_request.created", { request_id: "req_1", display_name: "Bob", role: "member", requested_at: "2026-04-26T00:01:00.000Z", expires_at: "2026-04-26T00:11:00.000Z" }, 4),
      event("join_request.approved", { request_id: "req_1", display_name: "Bob", role: "member", status: "approved", requested_at: "2026-04-26T00:01:00.000Z", expires_at: "2026-04-26T00:11:00.000Z", invite_id: "inv_1" }, 5, "user_1"),
      event("join_request.created", { request_id: "req_2", display_name: "Carol", role: "member", requested_at: "2026-04-26T00:02:00.000Z", expires_at: "2026-04-26T00:12:00.000Z" }, 6),
      event("join_request.approved", { request_id: "req_2", display_name: "Carol", role: "member", status: "approved", requested_at: "2026-04-26T00:02:00.000Z", expires_at: "2026-04-26T00:12:00.000Z", invite_id: "inv_1" }, 7, "user_1"),
      event("invite.revoked", { invite_id: "inv_1", revoked_at: "2026-04-26T00:08:00.000Z" }, 8, "user_1")
    ]);

    expect(state.inviteCount).toBe(2);
    expect(state.invites).toHaveLength(2);

    const inv1 = state.invites.find((i) => i.invite_id === "inv_1");
    expect(inv1).toBeDefined();
    expect(inv1!.max_uses).toBe(3);
    expect(inv1!.used_count).toBe(2);
    expect(inv1!.remaining).toBe(1);
    expect(inv1!.revoked).toBe(true);

    const inv2 = state.invites.find((i) => i.invite_id === "inv_2");
    expect(inv2).toBeDefined();
    expect(inv2!.max_uses).toBe(5);
    expect(inv2!.used_count).toBe(0);
    expect(inv2!.remaining).toBe(5);
    expect(inv2!.revoked).toBe(false);
  });
});
