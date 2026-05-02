import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { isTurnInFlight, humanParticipants } from "../src/room-state.js";

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

describe("isTurnInFlight", () => {
  it("returns true after agent.turn.started", () => {
    const events = [event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1")];
    expect(isTurnInFlight(events)).toBe(true);
  });

  it("returns false after agent.turn.completed", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.completed", { turn_id: "t1", agent_id: "agent_1", message_id: "msg_1" }, 2, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(false);
  });

  it("returns false after agent.turn.failed", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.failed", { turn_id: "t1", agent_id: "agent_1", error: "boom" }, 2, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(false);
  });

  it("handles multiple turns", () => {
    const events = [
      event("agent.turn.started", { turn_id: "t1", agent_id: "agent_1" }, 1, "agent_1"),
      event("agent.turn.completed", { turn_id: "t1", agent_id: "agent_1", message_id: "msg_1" }, 2, "agent_1"),
      event("agent.turn.started", { turn_id: "t2", agent_id: "agent_1" }, 3, "agent_1")
    ];
    expect(isTurnInFlight(events)).toBe(true);
  });
});

describe("humanParticipants", () => {
  it("excludes agent participants from people counts and lists", () => {
    const participants = [
      { id: "user_owner", display_name: "Owner", role: "owner", type: "human" },
      { id: "user_member", display_name: "Member", role: "member", type: "human" },
      { id: "user_observer", display_name: "Observer", role: "observer", type: "observer" },
      { id: "agent_1", display_name: "Claude Code Agent", role: "agent", type: "agent" }
    ];

    expect(humanParticipants(participants).map((participant) => participant.id)).toEqual([
      "user_owner",
      "user_member",
      "user_observer"
    ]);
  });
});
