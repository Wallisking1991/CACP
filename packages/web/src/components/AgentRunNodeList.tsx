import type { AgentRunNodeView } from "../room-state.js";
import { AgentRunInteractionCard } from "./AgentRunInteractionCard.js";
import { combinedChunks, nodeKindLabel, nodeStatusLabel, shouldRenderNodeSummary } from "./agent-run-format.js";

export interface AgentRunNodeListProps {
  runId: string;
  nodes: AgentRunNodeView[];
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

export function AgentRunNodeList({
  runId,
  nodes,
  onResolveApproval,
  onResolveElicitation
}: AgentRunNodeListProps) {
  if (nodes.length === 0) return null;

  return (
    <ol className="agent-run-node-list">
      {nodes.map((node) => {
        const chunks = combinedChunks(node);
        const isWaiting = node.status === "waiting_input";
        return (
          <li key={node.node_id} className={`agent-run-node agent-run-node--${node.status}${isWaiting ? " agent-run-node--waiting" : ""}`}>
            <div className="agent-run-node__main">
              <span className="agent-run-node__kind">{nodeKindLabel(node)}</span>
              <span className="agent-run-node__title">{node.title}</span>
              <span className="agent-run-node__status">{nodeStatusLabel(node)}</span>
            </div>
            {node.text && <div className="agent-run-node__text">{node.text}</div>}
            {chunks && <div className={`agent-run-node__text${node.kind === "reasoning_summary" ? " agent-run-node__text--thinking" : ""}`}>{chunks}</div>}
            {shouldRenderNodeSummary(node) && <div className="agent-run-node__summary">{node.summary}</div>}
            {node.error && <div className="agent-run-node__error">{node.error}</div>}
            {isWaiting && (
              <AgentRunInteractionCard
                runId={runId}
                node={node}
                onResolveApproval={onResolveApproval}
                onResolveElicitation={onResolveElicitation}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
