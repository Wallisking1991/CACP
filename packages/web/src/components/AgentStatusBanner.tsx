import { useT } from "../i18n/useT.js";
import type { AgentReadinessStatus } from "../room-state.js";

interface AgentStatusBannerProps {
  status: AgentReadinessStatus;
  isOwner: boolean;
  providerLabel?: string;
}

export function AgentStatusBanner({
  status,
  isOwner,
  providerLabel,
}: AgentStatusBannerProps) {
  const t = useT();

  if (status === "ready") return null;

  let message: string;
  if (status === "no_agent") {
    message = t("agentStatusBanner.noAgent");
  } else if (status === "selecting_session") {
    message = isOwner
      ? t("agentStatusBanner.selectingSessionOwner")
      : t("agentStatusBanner.selectingSessionNonOwner");
  } else {
    return null;
  }

  return (
    <div
      className="agent-status-banner"
      data-testid="agent-status-banner"
      data-status={status}
    >
      <span className="agent-status-banner__spinner" aria-hidden="true" />
      <span className="agent-status-banner__text">{message}</span>
      {providerLabel ? (
        <span className="agent-status-banner__provider">{providerLabel}</span>
      ) : null}
    </div>
  );
}
