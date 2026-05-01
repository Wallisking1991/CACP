import { useState } from "react";
import type { AgentSessionSummary } from "@cacp/protocol";
import { useT } from "../i18n/useT.js";

interface Props {
  agentId: string;
  provider?: "claude-code" | "codex-cli";
  catalog: {
    agent_id: string;
    provider?: string;
    working_dir: string;
    sessions: AgentSessionSummary[];
  };
  previews?: Array<{
    agent_id: string;
    session_id: string;
    status: "requested" | "completed" | "failed";
    messages: Array<{
      sequence: number;
      part_index?: number;
      author_role: string;
      text: string;
    }>;
    error?: string;
  }>;
  onRequestPreview?: (sessionId: string) => Promise<void>;
  onSelect(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void>;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function providerDisplayName(provider: "claude-code" | "codex-cli"): string {
  return provider === "codex-cli" ? "Codex CLI" : "Claude Code";
}

export function AgentSessionRequiredModal({ agentId, provider = "claude-code", catalog, previews = [], onRequestPreview, onSelect }: Props) {
  const t = useT();
  const [inspectedSession, setInspectedSession] = useState<AgentSessionSummary | undefined>();
  const [busy, setBusy] = useState(false);
  const [previewLoadingSessionIds, setPreviewLoadingSessionIds] = useState<Set<string>>(() => new Set());
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const providerLabel = providerDisplayName(provider);

  const inspectedPreview = inspectedSession
    ? previews.filter((preview) => preview.agent_id === agentId && preview.session_id === inspectedSession.session_id).at(-1)
    : undefined;
  const previewLoading = inspectedSession ? previewLoadingSessionIds.has(inspectedSession.session_id) : false;
  const previewError = inspectedSession ? previewErrors[inspectedSession.session_id] ?? inspectedPreview?.error : undefined;
  const canResumeInspected = inspectedPreview?.status === "completed";

  async function submit(selectionInput: { mode: "fresh" } | { mode: "resume"; sessionId: string }) {
    setBusy(true);
    try {
      await onSelect(selectionInput);
    } finally {
      setBusy(false);
    }
  }

  async function inspect(session: AgentSessionSummary) {
    setInspectedSession(session);
    if (!onRequestPreview) return;
    setPreviewErrors((current) => {
      const next = { ...current };
      delete next[session.session_id];
      return next;
    });
    setPreviewLoadingSessionIds((current) => new Set(current).add(session.session_id));
    try {
      await onRequestPreview(session.session_id);
    } catch (cause) {
      setPreviewErrors((current) => ({
        ...current,
        [session.session_id]: cause instanceof Error ? cause.message : String(cause)
      }));
    } finally {
      setPreviewLoadingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.session_id);
        return next;
      });
    }
  }

  const latest = catalog.sessions[0];

  const inspectDialog = inspectedSession ? (
    <div className="claude-session-modal-overlay" style={{ zIndex: 100 }}>
      <div className="claude-session-inspect" role="dialog" aria-modal="true" aria-label={t("agent.session.inspectTitle")}>
        <h3>{inspectedSession.title}</h3>
        <dl className="claude-session-details">
          <div>
            <dt>{t("agent.session.projectDir")}</dt>
            <dd><code>{inspectedSession.project_dir}</code></dd>
          </div>
          <div>
            <dt>{t("agent.session.lastModified")}</dt>
            <dd>{formatDate(inspectedSession.updated_at)}</dd>
          </div>
          <div>
            <dt>{t("agent.session.messageCount")}</dt>
            <dd>{inspectedSession.message_count}</dd>
          </div>
          <div>
            <dt>{t("agent.session.byteSize")}</dt>
            <dd>{Math.round(inspectedSession.byte_size / 1024)} KB</dd>
          </div>
        </dl>
        <div className="claude-session-preview">
          <h4>{t("agent.session.transcript")}</h4>
          {!inspectedPreview && !previewError && !previewLoading ? <p>{t("agent.session.previewLoading")}</p> : null}
          {previewError ? <p className="error">{t("agent.session.previewFailed", { error: previewError })}</p> : null}
          {inspectedPreview?.status === "requested" || previewLoading ? <p>{t("agent.session.previewLoading")}</p> : null}
          {inspectedPreview?.status === "completed" && inspectedPreview.messages.length === 0 ? <p>{t("agent.session.previewEmpty")}</p> : null}
          {inspectedPreview?.messages.length ? (
            <ol className="claude-session-preview-messages">
              {inspectedPreview.messages.map((message) => (
                <li key={`${message.sequence}-${message.part_index ?? 0}`}>
                  <strong>{message.author_role}</strong>
                  <p>{message.text}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <p className="claude-session-inspect-hint">{t("agent.session.confirmUpload")}</p>
        <div className="claude-session-inspect-actions">
          <button type="button" className="btn btn-primary" disabled={busy || !canResumeInspected} onClick={() => submit({ mode: "resume", sessionId: inspectedSession.session_id })}>{t("agent.session.confirmResume")}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setInspectedSession(undefined)}>{t("agent.session.cancel")}</button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="agent-session-required-overlay" role="dialog" aria-modal="true" aria-label={t("claude.session.requiredTitle")}>
      <div className="agent-session-required-modal">
        <div className="agent-session-required-header">
          <p className="eyebrow">{providerLabel} {t("agent.session.eyebrow")}</p>
          <h2>{t("agent.session.headline", { provider: providerLabel })}</h2>
          <p>{t("claude.session.requiredSubcopy")}</p>
        </div>

        <div className="agent-session-required-content">
          <p>{t("agent.session.workingDir")}: <code>{catalog.working_dir}</code></p>

          <div className="claude-session-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit({ mode: "fresh" })}>{t("agent.session.startFreshBtn")}</button>
            {latest ? <button type="button" className="btn btn-ghost" disabled={busy || !latest.importable} onClick={() => void inspect(latest)}>{t("agent.session.inspectLatestBtn", { title: latest.title })}</button> : null}
          </div>

          {catalog.sessions.length ? (
            <ul className="claude-session-list">
              {catalog.sessions.map((session) => (
                <li key={session.session_id}>
                  <div className="claude-session-list-main">
                    <span>{session.title}</span>
                    <span>{session.message_count} messages · {Math.round(session.byte_size / 1024)} KB</span>
                  </div>
                  <button type="button" className="btn btn-ghost" disabled={busy || !session.importable} onClick={() => void inspect(session)}>{t("agent.session.inspectBtn")}</button>
                </li>
              ))}
            </ul>
          ) : <p>{t("agent.session.noSessions", { provider: providerLabel })}</p>}
        </div>
      </div>
      {inspectDialog}
    </div>
  );
}
