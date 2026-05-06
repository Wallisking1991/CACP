import type { AgentRunView } from "../room-state.js";
import { AgentRunNodeList } from "./AgentRunNodeList.js";

export interface AgentRunCardProps {
  run: AgentRunView;
  agentName: string;
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

function providerLabel(provider: string): string {
  if (provider === "claude-code") return "Claude Code";
  if (provider === "codex-cli") return "Codex CLI";
  return "Local agent";
}

function runStatusLabel(status: AgentRunView["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Working";
}

function metricsSummary(run: AgentRunView): string | undefined {
  if (!run.metrics) return undefined;
  const parts: string[] = [];
  if (run.metrics.files_read) parts.push(`${run.metrics.files_read} files`);
  if (run.metrics.searches) parts.push(`${run.metrics.searches} searches`);
  if (run.metrics.commands) parts.push(`${run.metrics.commands} commands`);
  return parts.join(" · ") || undefined;
}

function answerTextFor(run: AgentRunView): string | undefined {
  if (run.status === "completed") return run.final_text ?? run.answer_text;
  return run.answer_text ?? run.final_text;
}

export function AgentRunCard({
  run,
  agentName,
  onResolveApproval,
  onResolveElicitation
}: AgentRunCardProps) {
  const provider = providerLabel(run.provider);
  const status = runStatusLabel(run.status);
  const metrics = metricsSummary(run);
  const answerText = answerTextFor(run);
  const hasAnswer = answerText !== undefined && answerText.length > 0;
  const nodeList = (
    <AgentRunNodeList
      runId={run.run_id}
      nodes={run.nodes}
      onResolveApproval={onResolveApproval}
      onResolveElicitation={onResolveElicitation}
    />
  );

  return (
    <article className={`message message-ai-card agent-run-card agent-run-card--${run.status}`}>
      <div className="message-meta">
        <span>{agentName}</span>
        <span>{provider}</span>
      </div>
      <div className="agent-run-card__header">
        <span className="agent-run-card__status">{status}</span>
        {metrics && <span className="agent-run-card__metrics">{metrics}</span>}
      </div>
      {run.summary && <div className="agent-run-card__summary">{run.summary}</div>}
      {run.error && <div className="agent-run-card__error">{run.error}</div>}

      {run.status === "running" ? (
        <>
          {run.nodes.length > 0 ? nodeList : <div className="agent-run-card__summary">Thinking...</div>}
          {hasAnswer && <div className="agent-run-card__answer message-body">{answerText}</div>}
        </>
      ) : (
        <>
          {hasAnswer && <div className="agent-run-card__answer message-body">{answerText}</div>}
          <details className="agent-run-card__details">
            <summary>Run details</summary>
            {nodeList}
          </details>
        </>
      )}
    </article>
  );
}
