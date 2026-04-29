import { useState } from "react";
import { useT } from "../i18n/useT.js";
import type { ClaudeSessionCatalogView, ClaudeSessionSelectionView } from "../room-state.js";

interface Props {
  canManageRoom: boolean;
  agentId: string;
  catalog?: ClaudeSessionCatalogView;
  selection?: ClaudeSessionSelectionView;
  onSelect(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void>;
}

export function ClaudeSessionPicker({ canManageRoom, agentId, catalog, selection, onSelect }: Props) {
  const t = useT();
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!canManageRoom || selection || !catalog || catalog.agent_id !== agentId) return null;
  const latest = catalog.sessions[0];
  const pending = pendingSessionId ? catalog.sessions.find((session) => session.session_id === pendingSessionId) : undefined;

  async function submit(selectionInput: { mode: "fresh" } | { mode: "resume"; sessionId: string }) {
    setBusy(true);
    try {
      await onSelect(selectionInput);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="claude-session-picker" aria-label={t("claude.session.title")}>
      <div>
        <p className="eyebrow">{t("claude.session.eyebrow")}</p>
        <h2>{t("claude.session.headline")}</h2>
        <p>{t("claude.session.workingDir")}: <code>{catalog.working_dir}</code></p>
      </div>
      <div className="claude-session-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit({ mode: "fresh" })}>{t("claude.session.startFreshBtn")}</button>
        {latest ? <button type="button" className="btn btn-ghost" disabled={busy || !latest.importable} onClick={() => setPendingSessionId(latest.session_id)}>{t("claude.session.resumeLatestBtn", { title: latest.title })}</button> : null}
      </div>
      {catalog.sessions.length ? (
        <ul className="claude-session-list">
          {catalog.sessions.map((session) => (
            <li key={session.session_id}>
              <span>{session.title}</span>
              <span>{session.message_count} messages · {Math.round(session.byte_size / 1024)} KB</span>
              <button type="button" className="btn btn-ghost" disabled={busy || !session.importable} onClick={() => setPendingSessionId(session.session_id)}>{t("claude.session.resumeLatestBtn", { title: session.title })}</button>
            </li>
          ))}
        </ul>
      ) : <p>{t("claude.session.noSessions")}</p>}
      {pending ? (
        <div className="claude-session-confirm" role="dialog" aria-modal="true" aria-label={t("claude.session.confirmUpload")}>
          <p>{t("claude.session.confirmUpload")}</p>
          <div className="claude-session-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit({ mode: "resume", sessionId: pending.session_id })}>{t("claude.session.confirmResume")}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPendingSessionId(undefined)}>{t("claude.session.cancel")}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
