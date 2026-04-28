import { describe, expect, it } from "vitest";
import type { CacpEvent, Participant } from "@cacp/protocol";
import {
  buildAgentContextPrompt,
  eventsAfterLastHistoryClear,
  findActiveAgentId,
  findOpenTurn,
  hasQueuedFollowup,
  recentConversationMessages
} from "../src/conversation.js";

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

describe("conversation helpers", () => {
  it("finds the latest active agent selection", () => {
    expect(findActiveAgentId([
      event("room.agent_selected", { agent_id: "agent_old" }, 1),
      event("room.agent_selected", { agent_id: "agent_new" }, 2)
    ])).toBe("agent_new");
  });

  it("finds open turns and queued followups", () => {
    const open = [
      event("agent.turn.requested", { turn_id: "turn_1", agent_id: "agent_1", context_prompt: "hi" }, 1),
      event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 2),
      event("agent.turn.followup_queued", { turn_id: "turn_1", agent_id: "agent_1" }, 3)
    ];
    expect(findOpenTurn(open, "agent_1")).toEqual({ turn_id: "turn_1", agent_id: "agent_1" });
    expect(hasQueuedFollowup(open, "turn_1")).toBe(true);

    expect(findOpenTurn([
      ...open,
      event("agent.turn.completed", { turn_id: "turn_1", agent_id: "agent_1", message_id: "msg_1" }, 4)
    ], "agent_1")).toBeUndefined();
  });

  it("scopes context after the latest history clear", () => {
    const scoped = eventsAfterLastHistoryClear([
      event("message.created", { message_id: "msg_old", text: "old" }, 1),
      event("room.history_cleared", { scope: "messages", cleared_by: "user_1", cleared_at: "2026-04-25T00:00:02.000Z" }, 2),
      event("message.created", { message_id: "msg_new", text: "new" }, 3)
    ]);

    expect(scoped.map((item) => item.payload.message_id)).toEqual(["msg_new"]);
  });

  it("returns only the latest durable conversation messages", () => {
    const events = Array.from({ length: 25 }, (_, index) => event("message.created", {
      message_id: `msg_${index + 1}`,
      text: `message ${index + 1}`,
      kind: index % 2 === 0 ? "human" : "agent"
    }, index + 1, index % 2 === 0 ? "user_1" : "agent_1"));

    const recent = recentConversationMessages(events, 20);

    expect(recent).toHaveLength(20);
    expect(recent[0].text).toBe("message 6");
    expect(recent[19].text).toBe("message 25");
  });

  it("builds a readable prompt from participants and recent messages without structured governance blocks", () => {
    const participants: Participant[] = [
      { id: "user_1", type: "human", display_name: "Alice", role: "owner" },
      { id: "user_2", type: "human", display_name: "Bob", role: "member" },
      { id: "agent_1", type: "agent", display_name: "Claude Code Agent", role: "agent" }
    ];

    const prompt = buildAgentContextPrompt({
      participants,
      messages: [
        { actorName: "Alice", kind: "human", text: "What should we do next?" },
        { actorName: "Bob", kind: "human", text: "Build shared context first." }
      ],
      agentName: "Claude Code Agent"
    });

    expect(prompt).toContain("Claude Code Agent");
    expect(prompt).toContain("Alice(owner)");
    expect(prompt).toContain("Bob(member)");
    expect(prompt).toContain("Alice: What should we do next?");
    expect(prompt).toContain("Bob: Build shared context first.");
    expect(prompt).toContain("Roundtable Mode");
    expect(prompt).not.toContain("cacp-decision");
    expect(prompt).not.toContain("cacp-question");
  });
});
