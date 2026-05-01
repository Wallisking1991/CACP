import type { AgentView, ClaudeSessionCatalogView, ClaudeSessionSelectionView, ClaudeSessionPreviewView, ClaudeRuntimeStatusView } from "../room-state.js";
import { useT } from "../i18n/useT.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";

export interface AgentAvatarPopoverProps {
  agents: AgentView[];
  activeAgentId?: string;
  canManageRoom: boolean;
  onSelectAgent?: (agentId: string) => void;
  claudeSessionCatalog?: ClaudeSessionCatalogView;
  claudeSessionSelection?: ClaudeSessionSelectionView;
  claudeSessionPreviews: ClaudeSessionPreviewView[];
  claudeRuntimeStatuses: ClaudeRuntimeStatusView[];
  serverUrl: string;
  roomSessionToken: string;
  roomSessionParticipantId: string;
  onRequestClaudeSessionPreview?: (sessionId: string) => Promise<void>;
  onSelectClaudeSession?: (selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }) => Promise<void>;
}

export function AgentAvatarPopover({
  agents,
  activeAgentId,
  canManageRoom,
  onSelectAgent,
  claudeSessionCatalog,
  claudeSessionSelection,
  claudeSessionPreviews,
  claudeRuntimeStatuses,
  onRequestClaudeSessionPreview,
  onSelectClaudeSession,
}: AgentAvatarPopoverProps) {
  const t = useT();
  const activeAgent = agents.find((agent) => agent.agent_id === activeAgentId);

  return (
    <div className="popover-content agent-popover">
      <h3 className="popover-title">{activeAgent?.name ?? t("sidebar.noActiveAgent")}</h3>
      <p className="popover-subtitle">
        {activeAgent
          ? `${activeAgent.status} · ${activeAgent.capabilities.join(" · ") || t("sidebar.noCapabilities")}`
          : t("sidebar.selectAgent")}
      </p>
      {agents.length > 1 && canManageRoom && onSelectAgent ? (
        <select
          className="input"
          value={activeAgentId ?? ""}
          onChange={(event) => onSelectAgent(event.target.value)}
          aria-label={t("sidebar.selectAgent")}
        >
          {agents.map((agent) => (
            <option key={agent.agent_id} value={agent.agent_id}>
              {agent.name}
            </option>
          ))}
        </select>
      ) : null}

      <ClaudeSessionPicker
        canManageRoom={canManageRoom}
        agentId={activeAgentId ?? ""}
        catalog={claudeSessionCatalog}
        selection={claudeSessionSelection}
        previews={claudeSessionPreviews}
        onRequestPreview={onRequestClaudeSessionPreview}
        onSelect={onSelectClaudeSession ?? (async () => {})}
      />
      {claudeRuntimeStatuses.map((status) => (
        <ClaudeStatusCard key={status.status_id} status={status} />
      ))}
    </div>
  );
}
