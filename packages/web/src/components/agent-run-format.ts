import type { AgentRunNodeView, AgentRunView } from "../room-state.js";

export function providerLabel(provider: string): string {
  if (provider === "claude-code") return "Claude Code";
  if (provider === "codex-cli") return "Codex CLI";
  return "Local agent";
}

export function runStatusLabel(status: AgentRunView["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Working";
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralLabel}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function runMetricsParts(run: AgentRunView): string[] {
  const parts: string[] = [];
  const durationMs = numberField(run.usage?.duration_ms);
  const outputTokens = numberField(run.usage?.output_tokens);
  const totalCost = numberField(run.usage?.total_cost_usd);
  const turns = numberField(run.usage?.num_turns);
  if (durationMs !== undefined) parts.push(formatDuration(durationMs));
  if (run.metrics?.files_read) parts.push(plural(run.metrics.files_read, "file"));
  if (run.metrics?.searches) parts.push(plural(run.metrics.searches, "search", "searches"));
  if (run.metrics?.commands) parts.push(plural(run.metrics.commands, "command"));
  if (outputTokens !== undefined) parts.push(plural(outputTokens, "output token"));
  if (turns !== undefined) parts.push(plural(turns, "turn"));
  return parts;
}

export function metricsSummary(run: AgentRunView): string | undefined {
  const parts = runMetricsParts(run);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function answerTextFor(run: AgentRunView): string | undefined {
  if (run.status === "completed") return run.final_text ?? run.answer_text;
  return run.answer_text ?? run.final_text;
}

export function combinedChunks(node: AgentRunNodeView): string {
  return [...node.text_chunks, ...node.stdout_chunks, ...node.stderr_chunks].join("");
}

export function nodeKindLabel(node: AgentRunNodeView): string {
  if (node.kind === "reasoning_summary") return "Thinking";
  if (node.kind === "tool") return "Tool";
  if (node.kind === "subagent") return "Subagent";
  if (node.kind === "subagent_message") return "Subagent";
  if (node.kind === "hook") return "Hook";
  if (node.kind === "approval") return "Approval";
  if (node.kind === "elicitation") return "Question";
  if (node.kind === "memory") return "Memory";
  if (node.kind === "compaction") return "Compaction";
  if (node.kind === "api_retry") return "API retry";
  return "Status";
}

export function nodeStatusLabel(node: AgentRunNodeView): string {
  if (node.status === "completed" || node.status === "failed") return "";
  const parts = [node.status.replace("_", " ")];
  const elapsed = numberField(node.detail?.elapsed_time_seconds);
  if (elapsed !== undefined) parts.push(`${elapsed}s`);
  return parts.join(" · ");
}

export function shouldRenderNodeSummary(node: AgentRunNodeView): boolean {
  if (!node.summary) return false;
  if (node.summary === node.title) return false;
  if (node.title === "Thinking" && node.summary === "Thinking complete") return false;
  return true;
}

export function processSummary(run: AgentRunView): string {
  const parts: string[] = [];
  if (run.metrics?.searches) parts.push(plural(run.metrics.searches, "search", "searches"));
  if (run.metrics?.files_read) parts.push(plural(run.metrics.files_read, "file"));
  if (run.metrics?.commands) parts.push(plural(run.metrics.commands, "command"));
  return parts.length > 0 ? parts.join(", ") : "activity";
}
