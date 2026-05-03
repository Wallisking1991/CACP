import { useState, useCallback, useRef } from "react";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import MentionDropdown from "./MentionDropdown.js";
import MentionOverlay from "./MentionOverlay.js";
import type { MentionItem } from "./MentionDropdown.js";
import type { MentionRange } from "./MentionOverlay.js";

export interface OrbitComposerProps {
  role: RoomSession["role"];
  members: Array<{ id: string; display_name: string; role: string }>;
  onSendOrbitNote: (text: string) => void;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
}

export default function OrbitComposer({
  role,
  members,
  onSendOrbitNote,
  onTypingInput,
  onStopTyping,
}: OrbitComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const perms = roomPermissionsForRole(role);
  const canInput = perms.canSendOrbitNotes;

  const mentionItems: MentionItem[] = members.map((m) => ({
    id: m.id,
    name: m.display_name,
    type: "member",
  }));

  const mentions: MentionRange[] = [];
  const mentionRegex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    const member = members.find((m) => m.display_name === match![1]);
    if (member) {
      mentions.push({ start: match!.index, end: match!.index + match![0].length, type: "user" });
    }
  }

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendOrbitNote(trimmed);
    setText("");
    setMentionActive(false);
    onStopTyping();
  }, [text, onSendOrbitNote, onStopTyping]);

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

  return (
    <div className="orbit-composer" data-testid="orbit-composer">
      <div className="mention-overlay-wrapper composer-input-wrapper">
        <MentionOverlay text={text} mentions={mentions} />
        <textarea
          ref={textareaRef}
          className="input composer-input composer-input--with-floating-btn"
          placeholder={String(t("orbitComposer.placeholder"))}
          aria-label={t("orbitComposer.placeholder")}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={!canInput}
          rows={2}
        />
        <button
          type="button"
          className="composer-send-floating composer-send-floating--warm"
          onClick={handleSend}
          disabled={!text.trim() || !canInput}
          aria-label={t("orbitComposer.send")}
          title={t("orbitComposer.send")}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>&#10148;</span>
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
