import { useState, useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import { SendIcon, SweepIcon } from "./RoomIcons.js";

export type ComposerRole = RoomSession["role"];

export interface ComposerProps {
  role: ComposerRole;
  turnInFlight: boolean;
  onSend: (text: string) => void;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  onClearConversation: () => void;
  onSendOrbitNote?: (text: string) => void;
  onSendMainInput?: (text: string) => void;
}

export default function Composer({
  role,
  turnInFlight,
  onSend,
  onTypingInput,
  onStopTyping,
  onClearConversation,
  onSendOrbitNote,
  onSendMainInput,
}: ComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const perms = roomPermissionsForRole(role);
  const isOwner = role === "owner";

  const canInput = perms.canSendMessages;
  const isQueued = turnInFlight;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    onStopTyping();
  }, [text, onSend, onStopTyping]);

  const handleSendOrbit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendOrbitNote?.(trimmed);
    setText("");
    onStopTyping();
  }, [text, onSendOrbitNote, onStopTyping]);

  const handleSendMainInput = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMainInput?.(trimmed);
    setText("");
    onStopTyping();
  }, [text, onSendMainInput, onStopTyping]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const composerClass = ["composer", isQueued ? "composer-queued" : ""].filter(Boolean).join(" ");

  return (
    <div className={composerClass} data-testid="composer">
      {isQueued && (
        <div className="status-strip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 8, borderRadius: 'var(--radius-chip)', padding: '6px 10px' }}>
          <span className="status-dot pulse" />
          {t("composer.queuedHint")}
        </div>
      )}

      {isOwner && (
        <div className="composer-utility-row">
          <button
            type="button"
            className="room-icon-button composer-clear-button"
            onClick={() => setConfirmingClear(true)}
            aria-label={t("composer.clearConversation")}
            title={t("composer.clearConversation")}
          >
            <SweepIcon />
          </button>
        </div>
      )}

      <div className="composer-bottom">
        <textarea
          className="input"
          placeholder={String(t("chat.placeholder"))}
          aria-label={t("composer.messageLabel")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTypingInput(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          disabled={!canInput}
          rows={2}
        />
        <div className="composer-actions">
          {!isQueued && onSendOrbitNote && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleSendOrbit}
                disabled={!text.trim()}
                aria-label={t("composer.sendToPeople")}
              >
                {t("composer.sendToPeople")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onSendMainInput ? handleSendMainInput : handleSend}
                disabled={!text.trim()}
                aria-label={t("composer.sendToAgent")}
              >
                <SendIcon /> {t("composer.sendToAgent")}
              </button>
            </>
          )}
          {!isQueued && !onSendOrbitNote && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!text.trim()}
            >
              <SendIcon /> {t("chat.send")}
            </button>
          )}
          {isQueued && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSendMainInput ? handleSendMainInput : handleSend}
              disabled={!text.trim()}
            >
              <SendIcon /> {t("composer.queue")}
            </button>
          )}
        </div>
      </div>

      {confirmingClear && (
        <div className="composer-confirm-clear" role="dialog" aria-label={t("composer.clearConversation")}>
          <p>{t("composer.clearConversationConfirm")}</p>
          <button type="button" className="btn btn-warm-ghost" onClick={() => setConfirmingClear(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-warm"
            onClick={() => {
              setConfirmingClear(false);
              onClearConversation();
            }}
          >
            {t("composer.clearConversationConfirmAction")}
          </button>
        </div>
      )}
    </div>
  );
}
