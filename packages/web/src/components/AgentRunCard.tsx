import type { AgentRunView } from "../room-state.js";
import { AgentRunNodeList } from "./AgentRunNodeList.js";
import { answerTextFor, metricsSummary, processSummary, providerLabel, runStatusLabel } from "./agent-run-format.js";

export interface AgentRunCardProps {
  run: AgentRunView;
  agentName: string;
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
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
  const processOpen = run.status === "running" || (run.status === "failed" && !hasAnswer);
  const process = run.nodes.length > 0 ? (
    <details className="agent-run-card__process" open={processOpen}>
      <summary>Work process · {processSummary(run)}</summary>
      {nodeList}
    </details>
  ) : run.status === "running" ? (
    <div className="agent-run-card__process-empty">Thinking...</div>
  ) : null;
  const answer = hasAnswer ? <div className="agent-run-card__answer message-body">{answerText}</div> : null;

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
          {process}
          {answer}
        </>
      ) : (
        <>
          {answer}
          {process}
        </>
      )}
    </article>
  );
}
