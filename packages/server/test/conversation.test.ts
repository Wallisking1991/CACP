import { describe, expect, it } from "vitest";
import type { CacpEvent, Participant } from "@cacp/protocol";
import {
  buildAgentContextPrompt,
  extractCacpQuestions,
  findActiveAgentId,
  findOpenTurn,
  hasQueuedFollowup,
  recentConversationMessages
} from "../src/conversation.js";

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

  it("builds a readable prompt from participants and recent messages", () => {
    const participants: Participant[] = [
      { id: "user_1", type: "human", display_name: "Alice", role: "owner" },
      { id: "user_2", type: "human", display_name: "Bob", role: "member" },
      { id: "agent_1", type: "agent", display_name: "Claude Code Agent", role: "agent" }
    ];

    const prompt = buildAgentContextPrompt({
      participants,
      messages: [
        { actorName: "Alice", kind: "human", text: "我们下一步做什么？" },
        { actorName: "Bob", kind: "human", text: "先做多人上下文。" }
      ],
      agentName: "Claude Code Agent"
    });

    expect(prompt).toContain("Claude Code Agent");
    expect(prompt).toContain("Alice(owner)");
    expect(prompt).toContain("Bob(member)");
    expect(prompt).toContain("Alice: 我们下一步做什么？");
    expect(prompt).toContain("Bob: 先做多人上下文。");
  });

  it("extracts structured CACP question blocks", () => {
    const text = [
      "我需要大家决定：",
      "```cacp-question",
      "{\"question\":\"下一步优先做什么？\",\"options\":[\"主聊天框\",\"邀请加入\"]}",
      "```"
    ].join("\n");

    expect(extractCacpQuestions(text)).toEqual([
      { question: "下一步优先做什么？", options: ["主聊天框", "邀请加入"] }
    ]);
  });

  it("extracts a later question block even when prior echoed prompts mention the question fence syntax", () => {
    const priorEcho = buildAgentContextPrompt({
      participants: [{ id: "agent_1", type: "agent", display_name: "Echo", role: "agent" }],
      messages: [],
      agentName: "Echo"
    });
    const nextPrompt = buildAgentContextPrompt({
      participants: [
        { id: "user_1", type: "human", display_name: "Alice", role: "owner" },
        { id: "agent_1", type: "agent", display_name: "Echo", role: "agent" }
      ],
      messages: [
        { actorName: "Echo", kind: "agent", text: `agent:${priorEcho}` },
        { actorName: "Alice", kind: "human", text: "```cacp-question\n{\"question\":\"Continue?\",\"options\":[\"Yes\",\"No\"]}\n```" }
      ],
      agentName: "Echo"
    });

    expect(extractCacpQuestions(`agent:${nextPrompt}`)).toEqual([
      { question: "Continue?", options: ["Yes", "No"] }
    ]);
  });

});
