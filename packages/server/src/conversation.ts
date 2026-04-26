import { z } from "zod";
import type { CacpEvent, Participant } from "@cacp/protocol";

export interface OpenTurn {
  turn_id: string;
  agent_id: string;
}

export interface ConversationMessage {
  actor_id: string;
  text: string;
  kind: string;
}

export interface PromptMessage {
  actorName: string;
  kind: string;
  text: string;
}

export interface CacpQuestion {
  question: string;
  options: string[];
}

const QuestionBlockSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).default([])
});
const questionBlockPattern = /```cacp-question[ \t]*\r?\n([\s\S]*?)```/g;

export function findActiveAgentId(events: CacpEvent[]): string | undefined {
  for (const storedEvent of [...events].reverse()) {
    if (storedEvent.type !== "room.agent_selected") continue;
    if (typeof storedEvent.payload.agent_id === "string" && storedEvent.payload.agent_id.length > 0) {
      return storedEvent.payload.agent_id;
    }
  }
  return undefined;
}

export function findOpenTurn(events: CacpEvent[], agentId: string): OpenTurn | undefined {
  const turns = new Map<string, OpenTurn & { closed: boolean }>();
  for (const storedEvent of events) {
    const turnId = typeof storedEvent.payload.turn_id === "string" ? storedEvent.payload.turn_id : undefined;
    const eventAgentId = typeof storedEvent.payload.agent_id === "string" ? storedEvent.payload.agent_id : undefined;
    if (!turnId || eventAgentId !== agentId) continue;
    if (storedEvent.type === "agent.turn.requested" || storedEvent.type === "agent.turn.started") {
      const existing = turns.get(turnId);
      turns.set(turnId, { turn_id: turnId, agent_id: agentId, closed: existing?.closed ?? false });
    }
    if (storedEvent.type === "agent.turn.completed" || storedEvent.type === "agent.turn.failed") {
      const existing = turns.get(turnId);
      turns.set(turnId, { turn_id: turnId, agent_id: agentId, closed: true });
      if (!existing) turns.set(turnId, { turn_id: turnId, agent_id: agentId, closed: true });
    }
  }
  const open = [...turns.values()].find((turn) => !turn.closed);
  return open ? { turn_id: open.turn_id, agent_id: open.agent_id } : undefined;
}

export function hasQueuedFollowup(events: CacpEvent[], turnId: string): boolean {
  return events.some((storedEvent) => storedEvent.type === "agent.turn.followup_queued" && storedEvent.payload.turn_id === turnId);
}

export function recentConversationMessages(events: CacpEvent[], limit = 20): ConversationMessage[] {
  return events
    .filter((storedEvent) => storedEvent.type === "message.created" && typeof storedEvent.payload.text === "string")
    .slice(-limit)
    .map((storedEvent) => ({
      actor_id: storedEvent.actor_id,
      text: String(storedEvent.payload.text),
      kind: typeof storedEvent.payload.kind === "string" ? storedEvent.payload.kind : "human"
    }));
}

export function buildAgentContextPrompt(input: { participants: Participant[]; messages: PromptMessage[]; agentName: string }): string {
  const participants = input.participants
    .map((participant) => `- ${participant.display_name}(${participant.role})`)
    .join("\n");
  const messages = input.messages
    .map((message) => `${message.actorName}: ${message.text}`)
    .join("\n");
  return [
    `你是 ${input.agentName}，正在一个 CACP 多人协作 AI 房间中参与讨论。`,
    "",
    "当前房间参与者：",
    participants || "- 暂无参与者",
    "",
    "最近对话：",
    messages || "暂无历史对话。",
    "",
    "请基于以上多人共享上下文，用简洁、可执行的中文回复下一条消息。除非明确要求，不要修改文件。",
    "如果你需要多人做结构化决策，请输出一个独立的 fenced code block，信息标记为 `cacp-question`，内容为 JSON，包含 question 和 options。"
  ].join("\n");
}

export function extractCacpQuestions(text: string): CacpQuestion[] {
  const questions: CacpQuestion[] = [];
  for (const match of text.matchAll(questionBlockPattern)) {
    try {
      const parsed = QuestionBlockSchema.safeParse(JSON.parse(match[1].trim()));
      if (parsed.success) questions.push(parsed.data);
    } catch {
      // Ignore malformed AI-emitted question blocks; the final message is still preserved.
    }
  }
  return questions;
}
