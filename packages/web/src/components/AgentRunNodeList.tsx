import { useState } from "react";
import type { AgentRunNodeView } from "../room-state.js";
import { AgentRunInteractionCard } from "./AgentRunInteractionCard.js";
import { combinedChunks, nodeKindLabel, nodeStatusLabel, shouldRenderNodeSummary } from "./agent-run-format.js";

export interface AgentRunNodeListProps {
  runId: string;
  nodes: AgentRunNodeView[];
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

const LongNodeOutputThreshold = 1000;

export function AgentRunNodeList({
  runId,
  nodes,
  onResolveApproval,
  onResolveElicitation
}: AgentRunNodeListProps) {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());

  if (nodes.length === 0) return null;

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <ol className="agent-run-node-list">
      {nodes.map((node) => {
        const chunks = combinedChunks(node);
        const isWaiting = node.status === "waiting_input";
        const isLongOutput = chunks.length > LongNodeOutputThreshold;
        const isExpanded = expandedNodeIds.has(node.node_id);
        const outputClassName = [
          "agent-run-node__text",
          "agent-run-node__text-preview",
          isExpanded ? "agent-run-node__text-preview--expanded" : "agent-run-node__text-preview--collapsed",
          node.kind === "reasoning_summary" ? "agent-run-node__text--thinking" : ""
        ].filter(Boolean).join(" ");
        return (
          <li key={node.node_id} className={`agent-run-node agent-run-node--${node.status}${isWaiting ? " agent-run-node--waiting" : ""}`}>
            <div className="agent-run-node__main">
              <span className="agent-run-node__kind">{nodeKindLabel(node)}</span>
              <span className="agent-run-node__title">{node.title}</span>
              {(() => {
                const label = nodeStatusLabel(node);
                return label ? <span className="agent-run-node__status">{label}</span> : null;
              })()}
            </div>
            {node.text && <div className="agent-run-node__text">{node.text}</div>}
            {chunks && (
              <>
                <div className={outputClassName}>{chunks}</div>
                {isLongOutput && (
                  <button
                    type="button"
                    className="agent-run-node__expand-output"
                    onClick={() => toggleExpanded(node.node_id)}
                  >
                    {isExpanded ? "Collapse output" : "Show full output"}
                  </button>
                )}
              </>
            )}
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
