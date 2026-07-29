import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import {
  deriveRoomState,
  claudeSelectionIsReady,
  agentSelectionIsReady,
  computeAgentReadiness,
} from "../src/room-state.js";

function event(
  type: CacpEvent["type"],
  payload: Record<string, unknown>,
  sequence: number,
  actor_id = "user_1"
): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.3.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

describe("claudeSelectionIsReady", () => {
  it("returns false when selection is missing", () => {
    expect(claudeSelectionIsReady("agent_1", undefined, undefined)).toBe(false);
  });

  it("returns true when fresh mode is selected and ready", () => {
    const selection = {
      agent_id: "agent_1",
      mode: "fresh" as const,
      selected_by: "user_1",
    };
    const ready = {
      agent_id: "agent_1",
      mode: "fresh" as const,
      ready_at: "2026-04-25T00:00:01.000Z",
    };
    expect(claudeSelectionIsReady("agent_1", selection, ready)).toBe(true);
  });

  it("returns true when resume mode matches session id", () => {
    const selection = {
      agent_id: "agent_1",
      mode: "resume" as const,
      session_id: "sess_1",
      selected_by: "user_1",
    };
    const ready = {
      agent_id: "agent_1",
      mode: "resume" as const,
      session_id: "sess_1",
      ready_at: "2026-04-25T00:00:01.000Z",
    };
    expect(claudeSelectionIsReady("agent_1", selection, ready)).toBe(true);
  });

  it("returns false when resume mode session id mismatches", () => {
    const selection = {
      agent_id: "agent_1",
      mode: "resume" as const,
      session_id: "sess_1",
      selected_by: "user_1",
    };
    const ready = {
      agent_id: "agent_1",
      mode: "resume" as const,
      session_id: "sess_2",
      ready_at: "2026-04-25T00:00:01.000Z",
    };
    expect(claudeSelectionIsReady("agent_1", selection, ready)).toBe(false);
  });
});

describe("agentSelectionIsReady", () => {
  it("returns false when selection is missing", () => {
    expect(
      agentSelectionIsReady("agent_1", "claude-code", undefined, undefined)
    ).toBe(false);
  });

  it("returns true when fresh mode is selected and ready", () => {
    const selection = {
      agent_id: "agent_1",
      provider: "claude-code" as const,
      mode: "fresh" as const,
      selected_by: "user_1",
    };
    const ready = {
      agent_id: "agent_1",
      provider: "claude-code" as const,
      mode: "fresh" as const,
      ready_at: "2026-04-25T00:00:01.000Z",
    };
    expect(
      agentSelectionIsReady("agent_1", "claude-code", selection, ready)
    ).toBe(true);
  });
});

describe("computeAgentReadiness", () => {
  it("returns no_agent when no agent is connected", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
    ]);
    expect(computeAgentReadiness(room)).toBe("no_agent");
  });

  it("returns selecting_session when agent is connected but session not selected (Claude)", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
    ]);
    expect(computeAgentReadiness(room, "claude-code")).toBe(
      "selecting_session"
    );
  });

  it("returns ready when claude session is selected and ready", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
      event(
        "claude.session_selected",
        { agent_id: "agent_1", mode: "fresh", selected_by: "user_1" },
        6
      ),
      event(
        "claude.session_ready",
        {
          agent_id: "agent_1",
          mode: "fresh",
          ready_at: "2026-04-25T00:00:07.000Z",
        },
        7
      ),
    ]);
    expect(computeAgentReadiness(room, "claude-code")).toBe("ready");
  });

  it("returns selecting_session when agent is connected but session not selected (generic)", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
      event(
        "agent.registered",
        { agent_id: "agent_1", name: "Kimi", capabilities: ["kimi-cli"] },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "agent.session_catalog.updated",
        {
          agent_id: "agent_1",
          provider: "kimi-cli",
          working_dir: "/tmp",
          sessions: [],
        },
        5
      ),
    ]);
    expect(computeAgentReadiness(room, "kimi-cli")).toBe("selecting_session");
  });

  it("returns ready when generic agent session is selected and ready", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
      event(
        "agent.registered",
        { agent_id: "agent_1", name: "Kimi", capabilities: ["kimi-cli"] },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "agent.session_catalog.updated",
        {
          agent_id: "agent_1",
          provider: "kimi-cli",
          working_dir: "/tmp",
          sessions: [],
        },
        5
      ),
      event(
        "agent.session_selected",
        {
          agent_id: "agent_1",
          provider: "kimi-cli",
          mode: "fresh",
          selected_by: "user_1",
        },
        6
      ),
      event(
        "agent.session_ready",
        {
          agent_id: "agent_1",
          provider: "kimi-cli",
          mode: "fresh",
          ready_at: "2026-04-25T00:00:07.000Z",
        },
        7
      ),
    ]);
    expect(computeAgentReadiness(room, "kimi-cli")).toBe("ready");
  });

  it("returns ready for a legacy connected agent without a local provider", () => {
    const room = deriveRoomState([
      event("room.created", { name: "Test Room" }, 1),
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        2
      ),
      event(
        "agent.registered",
        { agent_id: "agent_1", name: "Legacy Agent", capabilities: ["legacy"] },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
    ]);
    expect(computeAgentReadiness(room, undefined)).toBe("ready");
  });
});
