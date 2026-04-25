import type { Participant, Policy } from "@cacp/protocol";

export interface QuestionResponseRecord {
  respondent_id: string;
  response: unknown;
}

export interface QuestionPolicyInput {
  policy: Policy;
  participants: Participant[];
  responses: QuestionResponseRecord[];
}

export type QuestionPolicyResult =
  | { status: "open" }
  | { status: "closed"; selected_response: unknown; decided_by: string[] };

export function evaluateQuestionPolicy(input: QuestionPolicyInput): QuestionPolicyResult {
  const eligible = input.participants.filter((participant) => participant.type === "human" && ["owner", "admin", "member"].includes(participant.role));
  if (eligible.length === 0) return { status: "open" };
  const eligibleIds = new Set(eligible.map((participant) => participant.id));
  const latest = new Map<string, unknown>();
  for (const response of input.responses) {
    if (eligibleIds.has(response.respondent_id)) latest.set(response.respondent_id, normalizeResponse(response.response));
  }

  if (input.policy.type === "owner_approval") {
    const owner = eligible.find((participant) => participant.role === "owner");
    if (owner && latest.has(owner.id)) return { status: "closed", selected_response: latest.get(owner.id), decided_by: [owner.id] };
    return { status: "open" };
  }

  if (input.policy.type === "unanimous") {
    if (latest.size < eligible.length) return { status: "open" };
    const values = [...latest.values()];
    const first = values[0];
    if (values.every((value) => stableKey(value) === stableKey(first))) {
      return { status: "closed", selected_response: first, decided_by: eligible.map((participant) => participant.id) };
    }
    return { status: "open" };
  }

  const counts = new Map<string, { value: unknown; voters: string[] }>();
  for (const [voterId, value] of latest) {
    const key = stableKey(value);
    const current = counts.get(key) ?? { value, voters: [] };
    current.voters.push(voterId);
    counts.set(key, current);
  }
  const threshold = Math.floor(eligible.length / 2) + 1;
  const winner = [...counts.values()].find((entry) => entry.voters.length >= threshold);
  return winner ? { status: "closed", selected_response: winner.value, decided_by: winner.voters } : { status: "open" };
}

function normalizeResponse(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "choice" in value) return (value as { choice: unknown }).choice;
  if (typeof value === "object" && value !== null && "decision" in value) return (value as { decision: unknown }).decision;
  return value;
}

function stableKey(value: unknown): string {
  return JSON.stringify(value);
}
