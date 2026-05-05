import type { AgentRunNodeView } from "../room-state.js";

export interface AgentRunInteractionCardProps {
  runId: string;
  node: AgentRunNodeView;
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

export function AgentRunInteractionCard({
  runId,
  node,
  onResolveApproval,
  onResolveElicitation
}: AgentRunInteractionCardProps) {
  if (node.kind === "approval") {
    return (
      <div className="agent-run-interaction">
        <button type="button" onClick={() => onResolveApproval?.(runId, node.node_id, "allow")}>Allow</button>
        <button type="button" onClick={() => onResolveApproval?.(runId, node.node_id, "deny")}>Deny</button>
      </div>
    );
  }

  if (node.kind === "elicitation") {
    return (
      <div className="agent-run-interaction">
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "accept", {})}>Accept</button>
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "decline")}>Decline</button>
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "cancel")}>Cancel</button>
      </div>
    );
  }

  return null;
}
