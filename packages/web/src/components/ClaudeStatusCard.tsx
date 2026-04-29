import { useT } from "../i18n/useT.js";
import type { ClaudeRuntimeStatusView } from "../room-state.js";

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

export function ClaudeStatusCard({ status }: { status: ClaudeRuntimeStatusView }) {
  const t = useT();
  const recent = status.recent.slice(-5);
  const metrics = [
    status.metrics.files_read ? `read ${status.metrics.files_read} files` : "",
    status.metrics.searches ? `searched ${status.metrics.searches} times` : "",
    status.metrics.commands ? `ran ${status.metrics.commands} commands` : ""
  ].filter(Boolean).join(" · ");
  return (
    <section className={`claude-status-card claude-status-card--${status.phase}`} aria-label={t("claude.status.title")}>
      <div className="claude-status-card__header">
        <strong>{phaseKeys[status.phase] ?? status.phase}</strong>
        {metrics ? <span>{metrics}</span> : null}
      </div>
      <p>{status.summary ?? status.error ?? status.current}</p>
      {recent.length ? (
        <ol>
          {recent.map((item, index) => <li key={`${status.status_id}-${index}`}>{item}</li>)}
        </ol>
      ) : null}
    </section>
  );
}
