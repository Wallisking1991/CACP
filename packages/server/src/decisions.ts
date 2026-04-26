import {
  DecisionCancelledPayloadSchema,
  DecisionRequestedPayloadSchema,
  DecisionResolvedPayloadSchema,
  DecisionResponseRecordedPayloadSchema,
  type CacpEvent,
  type DecisionRequestedPayload,
  type Participant,
  type Policy
} from "@cacp/protocol";

export interface DecisionState {
  request: DecisionRequestedPayload;
  responses: Array<{ respondent_id: string; response: unknown; response_label?: string; source_message_id: string; created_at: string }>;
  terminal_status?: "resolved" | "cancelled";
  result?: unknown;
  result_label?: string;
  decided_by?: string[];
  cancelled_by?: string;
  cancelled_reason?: string;
}

export interface InterpretedDecisionResponse {
  response: unknown;
  response_label?: string;
}

export type DecisionPolicyResult =
  | { status: "open"; reason: string }
  | { status: "resolved"; result: unknown; result_label?: string; decided_by: string[]; reason: string };

const decisionBlockPattern = /```cacp-decision[ \t]*\r?\n([\s\S]*?)```/g;
const eligibleRoles = new Set(["owner", "admin", "member"]);

export function extractCacpDecisions(text: string, roomDefaultPolicy: Policy): DecisionRequestedPayload[] {
  const decisions: DecisionRequestedPayload[] = [];
  for (const match of text.matchAll(decisionBlockPattern)) {
    try {
      const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
      const candidate = {
        ...raw,
        policy: raw.policy === "room_default" ? roomDefaultPolicy : raw.policy
      };
      const parsed = DecisionRequestedPayloadSchema.safeParse(candidate);
      if (parsed.success) decisions.push(parsed.data);
    } catch {
      // Ignore malformed AI-emitted decision blocks; the final message is still preserved.
    }
  }
  return decisions;
}

export function deriveDecisionStates(events: CacpEvent[]): DecisionState[] {
  const states = new Map<string, DecisionState>();
  const responseMaps = new Map<string, Map<string, DecisionState["responses"][number]>>();

  for (const event of events) {
    if (event.type === "decision.requested") {
      const parsed = DecisionRequestedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) continue;
      if (!states.has(parsed.data.decision_id)) {
        states.set(parsed.data.decision_id, { request: parsed.data, responses: [] });
        responseMaps.set(parsed.data.decision_id, new Map());
      } else {
        const existingResponses = responseMaps.get(parsed.data.decision_id) ?? new Map();
        states.set(parsed.data.decision_id, { ...states.get(parsed.data.decision_id)!, request: parsed.data, responses: [...existingResponses.values()] });
        responseMaps.set(parsed.data.decision_id, existingResponses);
      }
    }

    if (event.type === "decision.response_recorded") {
      const parsed = DecisionResponseRecordedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) continue;
      const state = states.get(parsed.data.decision_id);
      if (!state) continue;
      const byRespondent = responseMaps.get(parsed.data.decision_id) ?? new Map();
      byRespondent.set(parsed.data.respondent_id, {
        respondent_id: parsed.data.respondent_id,
        response: parsed.data.response,
        response_label: parsed.data.response_label,
        source_message_id: parsed.data.source_message_id,
        created_at: event.created_at
      });
      responseMaps.set(parsed.data.decision_id, byRespondent);
      state.responses = [...byRespondent.values()];
    }

    if (event.type === "decision.resolved") {
      const parsed = DecisionResolvedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) continue;
      const state = states.get(parsed.data.decision_id);
      if (!state) continue;
      state.terminal_status = "resolved";
      state.result = parsed.data.result;
      state.result_label = parsed.data.result_label;
      state.decided_by = parsed.data.decided_by;
    }

    if (event.type === "decision.cancelled") {
      const parsed = DecisionCancelledPayloadSchema.safeParse(event.payload);
      if (!parsed.success) continue;
      const state = states.get(parsed.data.decision_id);
      if (!state) continue;
      state.terminal_status = "cancelled";
      state.cancelled_by = parsed.data.cancelled_by;
      state.cancelled_reason = parsed.data.reason;
    }
  }

  return [...states.values()];
}

export function findActiveDecision(states: DecisionState[]): DecisionState | undefined {
  return states.find((state) => !state.terminal_status && state.request.blocking === true);
}

export function interpretDecisionResponse(input: { decision: DecisionRequestedPayload; text: string }): InterpretedDecisionResponse | undefined {
  const normalizedText = input.text.trim().toLowerCase();
  if (!normalizedText) return undefined;

  if (input.decision.kind === "single_choice") {
    const exact = input.decision.options.find((option) => option.id.toLowerCase() === normalizedText);
    if (exact) return { response: exact.id, response_label: exact.label };

    for (const option of input.decision.options) {
      const id = escapeRegExp(option.id.toLowerCase());
      const patterns = [
        new RegExp(`^choose\\s+${id}$`, "i"),
        new RegExp(`^i\\s+choose\\s+${id}$`, "i"),
        new RegExp(`^选\\s*${id}$`, "i")
      ];
      if (patterns.some((pattern) => pattern.test(normalizedText))) return { response: option.id, response_label: option.label };
    }

    const labelMatch = input.decision.options.find((option) => normalizedText.includes(option.label.toLowerCase()));
    if (labelMatch) return { response: labelMatch.id, response_label: labelMatch.label };
  }

  if (input.decision.kind === "approval") {
    if (["approve", "yes", "agree", "同意", "可以"].includes(normalizedText)) {
      const option = input.decision.options.find((candidate) => candidate.id === "approve");
      return { response: "approve", response_label: option?.label ?? "Approve" };
    }
    if (["reject", "no", "disagree", "不同意", "不可以"].includes(normalizedText)) {
      const option = input.decision.options.find((candidate) => candidate.id === "reject");
      return { response: "reject", response_label: option?.label ?? "Reject" };
    }
  }

  return undefined;
}

export function evaluateDecisionPolicy(input: { decision: DecisionState; participants: Participant[] }): DecisionPolicyResult {
  if (input.decision.terminal_status === "resolved") {
    return {
      status: "resolved",
      result: input.decision.result,
      result_label: input.decision.result_label,
      decided_by: input.decision.decided_by ?? [],
      reason: "decision already resolved"
    };
  }
  if (input.decision.terminal_status === "cancelled") return openResult("decision cancelled");

  const policyType = input.decision.request.policy.type;
  if (policyType !== "owner_approval" && policyType !== "unanimous" && policyType !== "majority") {
    return openResult(`unsupported decision policy: ${policyType}`);
  }

  const eligible = input.participants.filter((participant) => participant.type === "human" && eligibleRoles.has(participant.role));
  if (eligible.length === 0) return openResult("no eligible voters");
  const eligibleIds = new Set(eligible.map((participant) => participant.id));
  const latest = new Map<string, DecisionState["responses"][number]>();
  for (const response of input.decision.responses) {
    if (eligibleIds.has(response.respondent_id)) latest.set(response.respondent_id, response);
  }

  if (policyType === "owner_approval") {
    const owner = eligible.find((participant) => participant.role === "owner");
    const response = owner ? latest.get(owner.id) : undefined;
    if (!response) return openResult("waiting for owner approval");
    return resolvedFromResponses([response], response, "owner approval received");
  }

  if (policyType === "unanimous") {
    if (latest.size < eligible.length) return openResult("waiting for unanimous responses");
    const responses = [...latest.values()];
    const first = responses[0];
    if (responses.every((response) => stableKey(response.response) === stableKey(first.response))) {
      return resolvedFromResponses(responses, first, "unanimous policy satisfied");
    }
    return openResult("unanimous policy not satisfied");
  }

  const threshold = Math.floor(eligible.length / 2) + 1;
  const counts = new Map<string, { response: DecisionState["responses"][number]; voters: DecisionState["responses"] }>();
  for (const response of latest.values()) {
    const key = stableKey(response.response);
    const entry = counts.get(key) ?? { response, voters: [] };
    entry.voters.push(response);
    counts.set(key, entry);
  }
  const winner = [...counts.values()].find((entry) => entry.voters.length >= threshold);
  return winner ? resolvedFromResponses(winner.voters, winner.response, "majority policy satisfied") : openResult("majority threshold not met");
}

function openResult(reason: string): DecisionPolicyResult {
  return { status: "open", reason };
}

function resolvedFromResponses(responses: DecisionState["responses"], selected = responses[0], reason = "decision policy satisfied"): DecisionPolicyResult {
  return {
    status: "resolved",
    result: selected.response,
    result_label: selected.response_label,
    decided_by: responses.map((response) => response.respondent_id),
    reason
  };
}

function stableKey(value: unknown): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
