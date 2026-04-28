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

export function findAnyOpenTurn(events: CacpEvent[]): OpenTurn | undefined {
  const turns = new Map<string, OpenTurn & { closed: boolean }>();
  for (const storedEvent of events) {
    const turnId = typeof storedEvent.payload.turn_id === "string" ? storedEvent.payload.turn_id : undefined;
    const eventAgentId = typeof storedEvent.payload.agent_id === "string" ? storedEvent.payload.agent_id : undefined;
    if (!turnId || !eventAgentId) continue;
    if (storedEvent.type === "agent.turn.requested" || storedEvent.type === "agent.turn.started") {
      const existing = turns.get(turnId);
      turns.set(turnId, { turn_id: turnId, agent_id: eventAgentId, closed: existing?.closed ?? false });
    }
    if (storedEvent.type === "agent.turn.completed" || storedEvent.type === "agent.turn.failed") {
      const existing = turns.get(turnId);
      turns.set(turnId, { turn_id: turnId, agent_id: eventAgentId, closed: true });
      if (!existing) turns.set(turnId, { turn_id: turnId, agent_id: eventAgentId, closed: true });
    }
  }
  const open = [...turns.values()].find((turn) => !turn.closed);
  return open ? { turn_id: open.turn_id, agent_id: open.agent_id } : undefined;
}

export function hasQueuedFollowup(events: CacpEvent[], turnId: string): boolean {
  return events.some((storedEvent) => storedEvent.type === "agent.turn.followup_queued" && storedEvent.payload.turn_id === turnId);
}

export function eventsAfterLastHistoryClear(events: CacpEvent[]): CacpEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const storedEvent = events[index];
    if (storedEvent.type === "room.history_cleared" && (storedEvent.payload.scope === "messages" || storedEvent.payload.scope === "messages_and_decisions")) {
      return events.slice(index + 1);
    }
  }
  return events;
}

export function recentConversationMessages(events: CacpEvent[], limit = 20): ConversationMessage[] {
  return eventsAfterLastHistoryClear(events)
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
    `You are ${input.agentName}, an AI agent participating in a CACP multi-person collaboration room.`,
    "",
    "Current room participants:",
    participants || "- No visible participants",
    "",
    "Recent conversation:",
    messages || "No recent conversation.",
    "",
    "Reply in concise, actionable Chinese by default. Do not modify files unless explicitly asked.",
    "If multiple humans should answer before you continue, ask the host to use Roundtable Mode to collect answers. Do not output structured governance code blocks."
  ].join("\n");
}

export function buildCollectedAnswersPrompt(input: { participants: Participant[]; messages: PromptMessage[]; agentName: string }): string {
  const participants = input.participants
    .map((participant) => `- ${participant.display_name}(${participant.role})`)
    .join("\n");
  const messages = input.messages
    .map((message) => `${message.actorName}: ${message.text}`)
    .join("\n");
  return [
    `You are ${input.agentName}, an AI agent participating in a CACP multi-person collaboration room.`,
    "",
    "The host just ended a Roundtable Mode collection round. Human messages during the collection were not sent to AI one by one.",
    "Synthesize the collected answers below and continue the discussion without mechanically repeating every message.",
    "",
    "Current room participants:",
    participants || "- No visible participants",
    "",
    "Collected answers:",
    messages || "No collected answers.",
    "",
    "Reply in concise, actionable Chinese by default. Do not modify files unless explicitly asked.",
    "If more human input is needed, ask the host to keep using Roundtable Mode. Do not output structured governance code blocks."
  ].join("\n");
}
