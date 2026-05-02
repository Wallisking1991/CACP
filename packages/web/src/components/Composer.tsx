import { useState, useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import { SendIcon, SweepIcon, BubbleIcon, ClockIcon, XIcon, CheckIcon } from "./RoomIcons.js";

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
  const sendToAgentLabel = String(t(onSendOrbitNote ? "composer.sendToAgent" : "chat.send"));
  const queuedLabel = String(t("composer.queue"));
  const queuedTitle = String(t("composer.queuedHint"));
  const clearLabel = String(t("composer.clearConversation"));
  const sendToPeopleLabel = String(t("composer.sendToPeople"));
  const cancelLabel = String(t("common.cancel"));
  const confirmClearLabel = String(t("composer.clearConversationConfirmAction"));

  return (
    <div className={composerClass} data-testid="composer">
      <textarea
        className="input composer-input"
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

      <div className="composer-action-bar">
        <div className="composer-action-bar__left">
          {isOwner && (
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => setConfirmingClear(true)}
              aria-label={clearLabel}
              title={clearLabel}
            >
              <SweepIcon />
            </button>
          )}
        </div>
        <div className="composer-action-bar__right">
          {!isQueued && onSendOrbitNote && (
            <button
              type="button"
              className="composer-icon-btn"
              onClick={handleSendOrbit}
              disabled={!text.trim() || !canInput}
              aria-label={sendToPeopleLabel}
              title={sendToPeopleLabel}
            >
              <BubbleIcon />
            </button>
          )}
          {!isQueued && (
            <button
              type="button"
              className="composer-icon-btn"
              onClick={onSendMainInput ? handleSendMainInput : handleSend}
              disabled={!text.trim() || !canInput}
              aria-label={sendToAgentLabel}
              title={sendToAgentLabel}
            >
              <SendIcon />
            </button>
          )}
          {isQueued && (
            <button
              type="button"
              className="composer-icon-btn"
              onClick={onSendMainInput ? handleSendMainInput : handleSend}
              disabled={!text.trim() || !canInput}
              aria-label={queuedLabel}
              title={queuedTitle}
            >
              <span className="composer-icon-stack">
                <SendIcon />
                <ClockIcon className="composer-icon-stack__badge" width={10} height={10} />
              </span>
            </button>
          )}
        </div>
      </div>

      {confirmingClear && (
        <div className="composer-confirm-clear" role="dialog" aria-label={clearLabel}>
          <p>{String(t("composer.clearConversationConfirm"))}</p>
          <button
            type="button"
            className="composer-icon-btn"
            onClick={() => setConfirmingClear(false)}
            aria-label={cancelLabel}
            title={cancelLabel}
          >
            <XIcon />
          </button>
          <button
            type="button"
            className="composer-icon-btn composer-icon-btn--warm"
            onClick={() => {
              setConfirmingClear(false);
              onClearConversation();
            }}
            aria-label={confirmClearLabel}
            title={confirmClearLabel}
          >
            <CheckIcon />
          </button>
        </div>
      )}
    </div>
  );
}
