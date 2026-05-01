import type { AgentView, ClaudeSessionCatalogView, ClaudeSessionSelectionView, ClaudeSessionPreviewView, ClaudeRuntimeStatusView, AgentSessionCatalogView, AgentSessionSelectionView, AgentSessionPreviewView, AgentRuntimeStatusView } from "../room-state.js";
import { useT } from "../i18n/useT.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";
import { AgentSessionPicker } from "./AgentSessionPicker.js";
import { AgentStatusCard } from "./AgentStatusCard.js";

export interface AgentAvatarPopoverProps {
  agents: AgentView[];
  activeAgentId?: string;
  canManageRoom: boolean;
  onSelectAgent?: (agentId: string) => void;
  claudeSessionCatalog?: ClaudeSessionCatalogView;
  claudeSessionSelection?: ClaudeSessionSelectionView;
  claudeSessionPreviews: ClaudeSessionPreviewView[];
  claudeRuntimeStatuses: ClaudeRuntimeStatusView[];
  agentSessionCatalog?: AgentSessionCatalogView;
  agentSessionSelection?: AgentSessionSelectionView;
  agentSessionPreviews?: AgentSessionPreviewView[];
  agentRuntimeStatuses?: AgentRuntimeStatusView[];
  serverUrl: string;
  roomSessionToken: string;
  roomSessionParticipantId: string;
  onRequestClaudeSessionPreview?: (sessionId: string) => Promise<void>;
  onSelectClaudeSession?: (selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }) => Promise<void>;
  onRequestAgentSessionPreview?: (sessionId: string) => Promise<void>;
  onSelectAgentSession?: (selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }) => Promise<void>;
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
  agentSessionCatalog,
  agentSessionSelection,
  agentSessionPreviews,
  agentRuntimeStatuses,
  onRequestClaudeSessionPreview,
  onSelectClaudeSession,
  onRequestAgentSessionPreview,
  onSelectAgentSession,
}: AgentAvatarPopoverProps) {
  const t = useT();
  const activeAgent = agents.find((agent) => agent.agent_id === activeAgentId);
  const activeAgentProvider = activeAgent?.capabilities.includes("codex-cli")
    ? "codex-cli"
    : activeAgent?.capabilities.includes("claude-code")
      ? "claude-code"
      : undefined;

  const hasGenericCatalog = activeAgentProvider && agentSessionCatalog && agentSessionCatalog.agent_id === activeAgentId;
  const hasClaudeCatalog = claudeSessionCatalog && claudeSessionCatalog.agent_id === activeAgentId;

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

      {hasGenericCatalog && activeAgentProvider ? (
        <AgentSessionPicker
          canManageRoom={canManageRoom}
          agentId={activeAgentId ?? ""}
          provider={activeAgentProvider}
          catalog={agentSessionCatalog}
          selection={agentSessionSelection}
          previews={agentSessionPreviews ?? []}
          onRequestPreview={onRequestAgentSessionPreview}
          onSelect={onSelectAgentSession ?? (async () => {})}
        />
      ) : (
        <ClaudeSessionPicker
          canManageRoom={canManageRoom}
          agentId={activeAgentId ?? ""}
          catalog={claudeSessionCatalog}
          selection={claudeSessionSelection}
          previews={claudeSessionPreviews}
          onRequestPreview={onRequestClaudeSessionPreview}
          onSelect={onSelectClaudeSession ?? (async () => {})}
        />
      )}
      {agentRuntimeStatuses?.map((status) => (
        <AgentStatusCard key={status.status_id} status={status} />
      ))}
      {claudeRuntimeStatuses.map((status) => (
        <ClaudeStatusCard key={status.status_id} status={status} />
      ))}
    </div>
  );
}
