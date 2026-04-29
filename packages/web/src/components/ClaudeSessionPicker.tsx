import { useState } from "react";
import type { ClaudeSessionCatalogView, ClaudeSessionSelectionView } from "../room-state.js";

interface Props {
  canManageRoom: boolean;
  agentId: string;
  catalog?: ClaudeSessionCatalogView;
  selection?: ClaudeSessionSelectionView;
  onSelect(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void>;
}

export function ClaudeSessionPicker({ canManageRoom, agentId, catalog, selection, onSelect }: Props) {
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
    <section className="claude-session-picker" aria-label="Claude Code session setup">
      <div>
        <p className="eyebrow">Claude Code session</p>
        <h2>Choose how Claude joins this room</h2>
        <p>Connector working directory: <code>{catalog.working_dir}</code></p>
      </div>
      <div className="claude-session-actions">
        <button type="button" disabled={busy} onClick={() => submit({ mode: "fresh" })}>Start fresh</button>
        {latest ? <button type="button" disabled={busy || !latest.importable} onClick={() => setPendingSessionId(latest.session_id)}>Resume latest: {latest.title}</button> : null}
      </div>
      {catalog.sessions.length ? (
        <ul className="claude-session-list">
          {catalog.sessions.map((session) => (
            <li key={session.session_id}>
              <span>{session.title}</span>
              <span>{session.message_count} messages · {Math.round(session.byte_size / 1024)} KB</span>
              <button type="button" disabled={busy || !session.importable} onClick={() => setPendingSessionId(session.session_id)}>Resume {session.title}</button>
            </li>
          ))}
        </ul>
      ) : <p>No existing Claude Code sessions were detected for this project. Start fresh to continue.</p>}
      {pending ? (
        <div className="claude-session-confirm" role="dialog" aria-modal="true" aria-label="Confirm Claude session upload">
          <p>This will upload the complete selected Claude Code session to the CACP room. All room members can view it. Continue?</p>
          <button type="button" disabled={busy} onClick={() => submit({ mode: "resume", sessionId: pending.session_id })}>Confirm upload and resume</button>
          <button type="button" disabled={busy} onClick={() => setPendingSessionId(undefined)}>Cancel</button>
        </div>
      ) : null}
    </section>
  );
}
