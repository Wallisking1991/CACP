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

  it("merges failed turn into agent message card with error flag", () => {
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
        kind: "agent",
        text: "error: invalid permission mode\n",
        created_at: "2026-04-25T00:00:03.000Z",
        turnFailed: true,
        turnError: "command exited with code 1"
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

  it("updates participant role via participant.role_updated event", () => {
    const state = deriveRoomState([
      event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 1),
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 2),
      event("participant.role_updated", { participant_id: "user_2", old_role: "member", new_role: "admin", updated_by: "user_1", updated_at: "2026-04-25T00:00:03.000Z" }, 3, "user_1")
    ]);

    expect(state.participants).toEqual([
      { id: "user_1", display_name: "Alice", role: "owner", type: "human" },
      { id: "user_2", display_name: "Bob", role: "admin", type: "human" }
    ]);
  });

  it("derives generic Codex session catalog and selection state", () => {
    const state = deriveRoomState([
      event("agent.registered", { agent_id: "agent_1", name: "Codex", capabilities: ["codex-cli"] }, 1, "owner"),
      event("agent.session_catalog.updated" as CacpEvent["type"], {
        agent_id: "agent_1",
        provider: "codex-cli",
        working_dir: "D:\\Development\\2",
        sessions: [{
          session_id: "session_1",
          title: "Codex thread",
          project_dir: "D:\\Development\\2",
          updated_at: "2026-05-01T00:00:00.000Z",
          message_count: 2,
          byte_size: 100,
          importable: true,
          provider: "codex-cli"
        }]
      }, 2, "agent_1"),
      event("agent.session_selected" as CacpEvent["type"], {
        agent_id: "agent_1",
        provider: "codex-cli",
        mode: "resume",
        session_id: "session_1",
        selected_by: "owner"
      }, 3, "owner")
    ]);

    expect(state.agentSessionCatalog?.provider).toBe("codex-cli");
    expect(state.agentSessionCatalog?.sessions[0].session_id).toBe("session_1");
    expect(state.agentSessionSelection).toEqual({
      agent_id: "agent_1",
      provider: "codex-cli",
      mode: "resume",
      session_id: "session_1",
      selected_by: "owner"
    });
  });

  it("derives generic Codex session readiness separately from selection", () => {
    const state = deriveRoomState([
      event("agent.session_selected" as CacpEvent["type"], {
        agent_id: "agent_1",
        provider: "codex-cli",
        mode: "fresh",
        selected_by: "owner"
      }, 1, "owner"),
      event("agent.session_ready" as CacpEvent["type"], {
        agent_id: "agent_1",
        provider: "codex-cli",
        mode: "fresh",
        session_id: "thread_123",
        ready_at: "2026-05-01T00:00:01.000Z"
      }, 2, "agent_1")
    ]);

    expect((state as any).agentSessionReady).toEqual({
      agent_id: "agent_1",
      provider: "codex-cli",
      mode: "fresh",
      session_id: "thread_123",
      ready_at: "2026-05-01T00:00:01.000Z"
    });
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

  it("derives Claude session readiness separately from selection", () => {
    const state = deriveRoomState([
      event("claude.session_selected", {
        agent_id: "agent_1",
        mode: "resume",
        session_id: "session_1",
        selected_by: "owner"
      }, 1, "owner"),
      event("claude.session_ready", {
        agent_id: "agent_1",
        mode: "resume",
        session_id: "session_1",
        ready_at: "2026-05-01T00:00:01.000Z"
      }, 2, "agent_1")
    ]);

    expect((state as any).claudeSessionReady).toEqual({
      agent_id: "agent_1",
      mode: "resume",
      session_id: "session_1",
      ready_at: "2026-05-01T00:00:01.000Z"
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

  it("derives owner-only generic Codex session preview content outside the main timeline", () => {
    const state = deriveRoomState([
      event("agent.session_preview.requested" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        requested_by: "owner",
        requested_at: "2026-05-01T00:00:00.000Z"
      }, 1, "owner"),
      event("agent.session_preview.message" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        sequence: 0,
        author_role: "assistant",
        source_kind: "assistant",
        text: "Preview-only Codex answer"
      }, 2, "agent_1"),
      event("agent.session_preview.completed" as CacpEvent["type"], {
        preview_id: "preview_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        previewed_message_count: 1,
        completed_at: "2026-05-01T00:00:01.000Z"
      }, 3, "agent_1")
    ]);

    expect(state.messages).toEqual([]);
    expect((state as any).agentSessionPreviews).toEqual([expect.objectContaining({
      preview_id: "preview_1",
      provider: "codex-cli",
      session_id: "session_1",
      status: "completed",
      messages: [expect.objectContaining({ text: "Preview-only Codex answer", provider: "codex-cli" })]
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

  it("renders completed generic Codex imports in the main message timeline", () => {
    const state = deriveRoomState([
      event("agent.session_import.started" as CacpEvent["type"], {
        import_id: "import_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        title: "Codex thread",
        message_count: 2,
        started_at: "2026-05-01T00:00:00.000Z"
      }, 1, "agent_1"),
      event("agent.session_import.message" as CacpEvent["type"], {
        import_id: "import_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        sequence: 0,
        original_created_at: "2026-05-01T00:00:01.000Z",
        author_role: "user",
        source_kind: "user",
        text: "Old user message"
      }, 2, "agent_1"),
      event("agent.session_import.message" as CacpEvent["type"], {
        import_id: "import_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        sequence: 1,
        original_created_at: "2026-05-01T00:00:02.000Z",
        author_role: "assistant",
        source_kind: "assistant",
        text: "Old Codex answer"
      }, 3, "agent_1"),
      event("agent.session_import.completed" as CacpEvent["type"], {
        import_id: "import_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        session_id: "session_1",
        imported_message_count: 2,
        completed_at: "2026-05-01T00:00:03.000Z"
      }, 4, "agent_1")
    ]);

    expect(state.messages.map((message) => message.text)).toEqual([
      "__AGENT_IMPORT_BANNER__",
      "Old user message",
      "Old Codex answer"
    ]);
    expect(state.messages[1].kind).toBe("agent_import_user");
    expect(state.messages[2].kind).toBe("agent_import_assistant");
    expect((state as any).agentImports).toEqual([expect.objectContaining({
      import_id: "import_1",
      provider: "codex-cli",
      status: "completed",
      imported_message_count: 2
    })]);
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

  describe("Orbit events", () => {
    it("derives orbit notes from orbit.note.created", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Hello orbit" }, 1, "user_1")
      ]);
      expect(state.orbitNotes).toHaveLength(1);
      expect(state.orbitNotes[0]).toMatchObject({ note_id: "note_1", text: "Hello orbit", created_by: "user_1", likes: 0, liked_by_me: false, quoted: false });
    });

    it("updates note likes from orbit.like.changed with liked:true", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Note" }, 1, "user_1"),
        event("orbit.like.changed", { note_id: "note_1", participant_id: "user_2", liked: true, likes: 1 }, 2, "user_2")
      ]);
      expect(state.orbitNotes[0].likes).toBe(1);
    });

    it("tracks whether the current participant liked an orbit note", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Note" }, 1, "user_1"),
        event("orbit.like.changed", { note_id: "note_1", participant_id: "user_2", liked: true, likes: 1 }, 2, "user_2")
      ], { currentParticipantId: "user_2" });
      expect(state.orbitNotes[0]).toMatchObject({ likes: 1, liked_by_me: true });
    });

    it("updates note likes from orbit.like.changed with liked:false", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Note" }, 1, "user_1"),
        event("orbit.like.changed", { note_id: "note_1", participant_id: "user_2", liked: true, likes: 1 }, 2, "user_2"),
        event("orbit.like.changed", { note_id: "note_1", participant_id: "user_2", liked: false, likes: 0 }, 3, "user_2")
      ]);
      expect(state.orbitNotes[0].likes).toBe(0);
    });

    it("derives flat orbit notes with payload created_at and quoted state", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Flat note", created_at: "2026-05-01T12:00:00.000Z" }, 1, "user_1"),
        event("orbit.notes.quoted", { note_ids: ["note_1"] }, 2, "user_1")
      ], { currentParticipantId: "user_2" });
      expect(state.orbitNotes).toEqual([{ note_id: "note_1", text: "Flat note", created_by: "user_1", created_at: "2026-05-01T12:00:00.000Z", likes: 0, liked_by_me: false, quoted: true }]);
      expect(state).not.toHaveProperty("orbitRounds");
    });

    it("clears orbit notes when orbit.cleared arrives", () => {
      const state = deriveRoomState([
        event("orbit.note.created", { note_id: "note_1", text: "Flat note", created_at: "2026-05-01T12:00:00.000Z" }, 1, "user_1"),
        event("orbit.cleared", { cleared_by: "user_1", cleared_at: "2026-05-01T12:00:01.000Z" }, 2, "user_1")
      ], { currentParticipantId: "user_2" });
      expect(state.orbitNotes).toEqual([]);
    });
  });

  describe("Main input queue events", () => {
    it("derives main input queue from main_input.accepted", () => {
      const state = deriveRoomState([
        event("main_input.accepted", { input_id: "input_1", text: "Hello agent" }, 1, "user_1")
      ]);
      expect(state.mainInputQueue).toHaveLength(1);
      expect(state.mainInputQueue[0]).toMatchObject({ input_id: "input_1", text: "Hello agent", status: "accepted", actor_id: "user_1" });
    });

    it("updates input status through lifecycle events", () => {
      const events = [
        event("main_input.accepted", { input_id: "input_1", text: "Hello" }, 1, "user_1"),
        event("main_input.queued", { input_id: "input_1" }, 2, "system"),
        event("main_input.triggered", { input_id: "input_1" }, 3, "system")
      ];
      const queued = deriveRoomState(events.slice(0, 2));
      expect(queued.mainInputQueue[0].status).toBe("queued");

      const triggered = deriveRoomState(events);
      expect(triggered.mainInputQueue).toHaveLength(0);
    });

    it("marks input as cancelled or failed", () => {
      const cancelled = deriveRoomState([
        event("main_input.accepted", { input_id: "input_1", text: "Hello" }, 1, "user_1"),
        event("main_input.cancelled", { input_id: "input_1" }, 2, "user_1")
      ]);
      expect(cancelled.mainInputQueue).toHaveLength(0);

      const failed = deriveRoomState([
        event("main_input.accepted", { input_id: "input_1", text: "Hello" }, 1, "user_1"),
        event("main_input.failed", { input_id: "input_1" }, 2, "system")
      ]);
      expect(failed.mainInputQueue).toHaveLength(0);
    });
  });

  describe("Connector sync events", () => {
    it("derives connector sync cursor from connector.snapshot.completed", () => {
      const state = deriveRoomState([
        event("connector.snapshot.completed", { request_id: "snap_1", connector_id: "agent_1", last_sequence: 10 }, 1, "agent_1")
      ]);
      expect(state.connectorSyncCursor).toMatchObject({ connector_id: "agent_1", last_sequence: 10 });
    });

    it("renders connector snapshot ledger entries into the main timeline", () => {
      const state = deriveRoomState([
        event("connector.snapshot.entry", {
          request_id: "snap_1",
          connector_id: "agent_1",
          entry: {
            ledger_version: 1,
            room_id: "room_1",
            connector_id: "agent_1",
            agent_id: "agent_1",
            sequence: 3,
            entry_id: "entry_3",
            entry_type: "agent_final",
            actor_id: "agent_1",
            actor_name: "Agent",
            actor_role: "agent",
            text: "Ledger answer",
            source: "composer",
            created_at: "2026-05-01T00:00:00.000Z",
            turn_id: "turn_1"
          }
        }, 1, "agent_1")
      ]);
      expect(state.messages).toEqual([expect.objectContaining({
        message_id: "entry_3",
        actor_id: "agent_1",
        kind: "agent",
        text: "Ledger answer"
      })]);
    });
  });
});
