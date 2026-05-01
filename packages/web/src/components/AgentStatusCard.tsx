import { useT } from "../i18n/useT.js";
import type { AgentRuntimeStatusView } from "../room-state.js";

const phaseKeys: Record<string, string> = {
  connecting: "Connecting",
  resuming_session: "Resuming session",
  importing_session: "Importing session",
  thinking: "Thinking",
  reading_files: "Reading files",
  searching: "Searching",
  running_command: "Running command",
  waiting_for_approval: "Waiting for approval",
  generating_answer: "Generating answer",
  completed: "Completed",
  failed: "Failed"
};

function formatElapsed(status: AgentRuntimeStatusView): string | undefined {
  if (!status.started_at) return undefined;
  const started = Date.parse(status.started_at);
  const ended = Date.parse(status.completed_at ?? status.failed_at ?? status.updated_at ?? new Date().toISOString());
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return undefined;
  const elapsedSeconds = Math.max(0, Math.round((ended - started) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s elapsed`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const remainingSeconds = elapsedSeconds % 60;
  if (elapsedMinutes < 60) return remainingSeconds ? `${elapsedMinutes}m ${remainingSeconds}s elapsed` : `${elapsedMinutes}m elapsed`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  return remainingMinutes ? `${elapsedHours}h ${remainingMinutes}m elapsed` : `${elapsedHours}h elapsed`;
}

function providerDisplayName(provider: string | undefined): string {
  if (provider === "codex-cli") return "Codex CLI";
  if (provider === "claude-code") return "Claude Code";
  return "Local code agent";
}

export function AgentStatusCard({ status }: { status: AgentRuntimeStatusView }) {
  const t = useT();
  const recent = status.recent.slice(-5);
  const elapsed = formatElapsed(status);
  const metrics = [
    elapsed ?? "",
    status.metrics.files_read ? `read ${status.metrics.files_read} files` : "",
    status.metrics.searches ? `searched ${status.metrics.searches} times` : "",
    status.metrics.commands ? `ran ${status.metrics.commands} commands` : ""
  ].filter(Boolean).join(" · ");
  const providerLabel = providerDisplayName(status.provider);
  return (
    <section className={`agent-status-card agent-status-card--${status.phase}`} aria-label={t("agent.status.title")}>
      <div className="agent-status-card__header">
        <strong>{phaseKeys[status.phase] ?? status.phase}</strong>
        <span>{providerLabel}</span>
        {metrics ? <span>{metrics}</span> : null}
      </div>
      <p>{status.summary ?? status.error ?? status.current}</p>
      {status.phase === "waiting_for_approval" ? (
        <div className="agent-status-card__approval">
          <p>{t("agent.status.approvalHint")}</p>
        </div>
      ) : null}
      {recent.length ? (
        <ol>
          {recent.map((item, index) => <li key={`${status.status_id}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
    </section>
  );
}
