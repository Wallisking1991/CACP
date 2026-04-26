import { useState, useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";

export type ComposerMode = "live" | "collect";
export type ComposerRole = RoomSession["role"];

export interface ComposerProps {
  role: ComposerRole;
  mode: ComposerMode;
  turnInFlight: boolean;
  collectCount: number;
  canSendMessages: boolean;
  onSend: (text: string) => void;
  onToggleMode: () => void;
  onSubmitCollection: () => void;
  onCancelCollection: () => void;
}

export default function Composer({
  role,
  mode,
  turnInFlight,
  collectCount,
  canSendMessages,
  onSend,
  onToggleMode,
  onSubmitCollection,
  onCancelCollection,
}: ComposerProps) {
  const t = useT();
  const [text, setText] = useState("");

  const perms = roomPermissionsForRole(role);
  const isOwner = role === "owner";
  const isLive = mode === "live";

  const effectiveCanSend = perms.canSendMessages;
  const canToggleMode = isOwner && !turnInFlight;
  const canInput = effectiveCanSend && !(!isLive && turnInFlight);
  const isQueued = isLive && turnInFlight;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const composerClass = [
    "composer",
    isQueued ? "composer-queued" : "",
    !isLive ? "composer-collect" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={composerClass} data-testid="composer">
      {isQueued && (
        <div className="status-strip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 8, borderRadius: 'var(--radius-chip)', padding: '6px 10px' }}>
          <span className="status-dot pulse" />
          {t("composer.queuedHint")}
        </div>
      )}

      <div className="composer-top">
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-toggle-btn ${isLive ? "active" : ""}`}
            disabled={!canToggleMode}
            onClick={isLive ? undefined : onToggleMode}
            aria-pressed={isLive}
          >
            {t("composer.live")}
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${!isLive ? "active" : ""}`}
            disabled={!canToggleMode}
            onClick={!isLive ? undefined : onToggleMode}
            aria-pressed={!isLive}
          >
            {t("composer.collect")}
          </button>
        </div>

        {isLive && !isQueued && (
          <span className="composer-hint">{t("composer.liveHint")}</span>
        )}
        {isLive && isQueued && (
          <span className="composer-hint">{t("composer.modeLocked")}</span>
        )}
        {!isLive && isOwner && (
          <span className="composer-hint">
            <span className="collect-badge">{collectCount}</span>
            {t("composer.collectingHint")}
          </span>
        )}
        {!isLive && !isOwner && (
          <span className="composer-hint">{t("composer.memberCollectHint")}</span>
        )}
      </div>

      <div className="composer-bottom">
        <textarea
          className="input"
          placeholder={String(t("chat.placeholder"))}
          aria-label={t("composer.messageLabel")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!canInput}
          rows={2}
        />
        <div className="composer-actions">
          {isLive && !isQueued && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!text.trim()}
            >
              {t("chat.send")}
            </button>
          )}
          {isLive && isQueued && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!text.trim()}
            >
              {t("composer.queue")}
            </button>
          )}
          {!isLive && (
            <button
              type="button"
              className="btn btn-warm"
              onClick={handleSend}
              disabled={!canInput || !text.trim()}
            >
              {t("composer.add")}
            </button>
          )}
        </div>
      </div>

      {!isLive && isOwner && (
        <div className="composer-actions" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)', justifyContent: 'space-between' }}>
          <span className="composer-hint">{t("composer.ownerOnlyHint")}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-warm-ghost"
              onClick={onCancelCollection}
            >
              {t("composer.cancelCollection")}
            </button>
            <button
              type="button"
              className="btn btn-warm"
              onClick={onSubmitCollection}
              disabled={collectCount === 0}
            >
              {t("composer.submit", { count: collectCount })}
            </button>
          </div>
        </div>
      )}

      {!isLive && !isOwner && (
        <div className="status-strip">
          <span className="composer-hint">{t("composer.lockedHint")}</span>
        </div>
      )}
    </div>
  );
}
