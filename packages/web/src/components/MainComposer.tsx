import { useState, useCallback, useRef } from "react";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import MentionDropdown from "./MentionDropdown.js";
import MentionOverlay from "./MentionOverlay.js";
import type { MentionItem } from "./MentionDropdown.js";
import type { MentionRange } from "./MentionOverlay.js";

export interface MainComposerProps {
  role: RoomSession["role"];
  turnInFlight: boolean;
  agents: Array<{ agent_id: string; name: string }>;
  onSendMainInput: (text: string) => void;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
}

export default function MainComposer({
  role,
  turnInFlight,
  agents,
  onSendMainInput,
  onTypingInput,
  onStopTyping,
}: MainComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const perms = roomPermissionsForRole(role);
  const canInput = perms.canSendMainInput;
  const isQueued = turnInFlight;

  const mentionItems: MentionItem[] = agents.map((a) => ({
    id: a.agent_id,
    name: a.name,
    type: "agent",
  }));

  const mentions: MentionRange[] = [];
  const mentionRegex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    const agent = agents.find((a) => a.name === match![1]);
    if (agent) {
      mentions.push({ start: match!.index, end: match!.index + match![0].length, type: "agent" });
    }
  }

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMainInput(trimmed);
    setText("");
    setMentionActive(false);
    onStopTyping();
  }, [text, onSendMainInput, onStopTyping]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionActive) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => i + 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const filtered = mentionItems.filter((item) =>
            item.name.toLowerCase().includes(mentionQuery.toLowerCase())
          );
          const selected = filtered[mentionIndex % filtered.length];
          if (selected && textareaRef.current) {
            const cursorPos = textareaRef.current.selectionStart;
            const before = text.slice(0, cursorPos - mentionQuery.length - 1);
            const after = text.slice(cursorPos);
            const newText = before + "@" + selected.name + " " + after;
            setText(newText);
            setMentionActive(false);
            setMentionIndex(0);
          }
          return;
        }
        if (e.key === "Escape") {
          setMentionActive(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [mentionActive, mentionItems, mentionQuery, mentionIndex, text, handleSend]
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      const cursorPos = e.currentTarget.selectionStart;
      setText(value);
      onTypingInput(value);

      const beforeCursor = value.slice(0, cursorPos);
      const atIndex = beforeCursor.lastIndexOf("@");
      if (atIndex >= 0 && !beforeCursor.slice(atIndex + 1).includes(" ")) {
        const query = beforeCursor.slice(atIndex + 1);
        setMentionQuery(query);
        setMentionActive(true);
        setMentionIndex(0);
      } else {
        setMentionActive(false);
      }
    },
    [onTypingInput]
  );

  const composerClass = ["composer main-composer", isQueued ? "main-composer-queued" : ""].filter(Boolean).join(" ");
  const sendLabel = String(t(isQueued ? "mainComposer.queued" : "mainComposer.send"));
  const queuedHint = String(t("mainComposer.queuedHint"));

  return (
    <div className={composerClass} data-testid="main-composer">
      <div className="mention-overlay-wrapper composer-input-wrapper">
        <MentionOverlay text={text} mentions={mentions} />
        <textarea
          ref={textareaRef}
          className="input composer-input composer-input--with-floating-btn"
          placeholder={String(t("mainComposer.placeholder"))}
          aria-label={t("mainComposer.placeholder")}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={!canInput}
          rows={2}
        />
        <button
          type="button"
          className={`composer-send-floating${isQueued ? "" : " composer-send-floating--warm"}`}
          onClick={handleSend}
          disabled={!text.trim() || !canInput || isQueued}
          aria-label={sendLabel}
          title={isQueued ? queuedHint : sendLabel}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{isQueued ? "\u23F1" : "\u26A1"}</span>
        </button>
      </div>
      {mentionActive && (
        <MentionDropdown
          items={mentionItems}
          query={mentionQuery}
          activeIndex={mentionIndex}
          onSelect={(id, name) => {
            const cursorPos = textareaRef.current?.selectionStart ?? text.length;
            const beforeCursor = text.slice(0, cursorPos);
            const atIndex = beforeCursor.lastIndexOf("@");
            if (atIndex >= 0) {
              const newText = text.slice(0, atIndex) + "@" + name + " " + text.slice(cursorPos);
              setText(newText);
            }
            setMentionActive(false);
            setMentionIndex(0);
            textareaRef.current?.focus();
          }}
          onClose={() => setMentionActive(false)}
        />
      )}
    </div>
  );
}
