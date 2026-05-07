import { useRef, useEffect, useState } from "react";
import { useT } from "../i18n/useT.js";
import { humanColors, agentColors } from "../avatar-colors.js";
import type { OrbitNoteView } from "../room-state.js";

export interface OrbitLayerProps {
  notes: OrbitNoteView[];
  currentParticipantId: string;
  currentDisplayName?: string;
  actorNames: Map<string, string>;
  actorKinds?: Map<string, "human" | "agent">;
  onLike: (noteId: string) => void;
  onUnlike: (noteId: string) => void;
  onReply?: (noteId: string) => void;
  canReact?: boolean;
  canPromote?: boolean;
  hasPromotable?: boolean;
  onPromoteClick?: () => void;
  canClear?: boolean;
  onClearClick?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function OrbitLayer({
  notes,
  currentParticipantId,
  currentDisplayName,
  actorNames,
  actorKinds,
  onLike,
  onUnlike,
  onReply,
  canReact = true,
  canPromote = false,
  hasPromotable = false,
  onPromoteClick,
  canClear = false,
  onClearClick,
}: OrbitLayerProps) {
  const t = useT();
  const notesContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const prevNotesLen = useRef(notes.length);

  useEffect(() => {
    const container = notesContainerRef.current;
    if (!container) return;
    if (isNearBottom || notes.length > prevNotesLen.current) {
      container.scrollTop = container.scrollHeight;
    }
    prevNotesLen.current = notes.length;
  }, [notes, isNearBottom]);

  const handleScroll = () => {
    const container = notesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsNearBottom(scrollHeight - scrollTop - clientHeight < 40);
  };

  const promoteLabel = String(t("orbitPromote.openTitle"));
  const clearLabel = String(t("orbit.clear"));
  const promoteButton = canPromote ? (
    <button
      type="button"
      className="orbit-promote-open-btn"
      onClick={onPromoteClick}
      disabled={!hasPromotable}
      aria-label={promoteLabel}
      title={promoteLabel}
    >
      <span className="orbit-promote-open-btn__icon">&#11014;</span>
    </button>
  ) : null;
  const clearButton = canClear ? (
    <button
      type="button"
      className="orbit-clear-btn"
      onClick={onClearClick}
      aria-label={clearLabel}
      title={clearLabel}
    >
      <span className="orbit-clear-btn__icon" aria-hidden="true">&#128465;</span>
    </button>
  ) : null;

  if (notes.length === 0) {
    return (
      <div className="orbit-layer">
        <div className="orbit-header">
          <span className="section-label">{t("orbit.title")}</span>
          {promoteButton}
          {clearButton}
        </div>
        <p className="orbit-empty">{t("orbit.empty")}</p>
      </div>
    );
  }

  return (
    <div className="orbit-layer">
      <div className="orbit-header">
        <span className="section-label">{t("orbit.title")}</span>
        {promoteButton}
        {clearButton}
      </div>
      <div
        className="orbit-notes"
        ref={notesContainerRef}
        onScroll={handleScroll}
      >
        {notes.map((note, index) => {
          const ownNote = note.created_by === currentParticipantId;
          const showReactionControls = canReact && !ownNote;
          const isHovered = hoveredNoteId === note.note_id;
          const hasLikes = note.likes > 0;
          const showLikeButton = showReactionControls && (hasLikes || isHovered || note.liked_by_me);
          const showLikeCount = hasLikes;
          const showReplyButton = canReact && isHovered && onReply;

          const prevAuthor = index > 0 ? notes[index - 1].created_by : null;
          const isConsecutive = prevAuthor === note.created_by;

          const kind = actorKinds?.get(note.created_by) ?? "human";
          const colors = kind === "agent" ? agentColors(note.created_by) : humanColors(note.created_by);
          const authorName = actorNames.get(note.created_by) || note.created_by;

          const replyParent = note.reply_to ? notes.find((n) => n.note_id === note.reply_to) : undefined;
          const replyParentName = replyParent ? (actorNames.get(replyParent.created_by) || replyParent.created_by) : undefined;

          const isReplyToMe = replyParent ? replyParent.created_by === currentParticipantId : false;
          const isMentioned = currentDisplayName ? new RegExp("@" + currentDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(note.text) : false;
          const isHighlighted = isMentioned || isReplyToMe;

          return (
            <div
              key={note.note_id}
              className={[
                "orbit-note",
                note.quoted && "orbit-note--quoted",
                ownNote && "orbit-note--own",
                isConsecutive && "orbit-note--consecutive",
                isHighlighted && "orbit-note--highlighted",
              ].filter(Boolean).join(" ")}
              style={{ "--orbit-author-bar": colors.bar } as React.CSSProperties}
              onMouseEnter={() => setHoveredNoteId(note.note_id)}
              onMouseLeave={() => setHoveredNoteId(null)}
            >
              <div className="orbit-note-meta">
                {!isConsecutive && (
                  <span className="orbit-note-author-wrap">
                    <span
                      className="orbit-note-avatar"
                      style={{ background: kind === "agent" ? colors.gradient : colors.bg, color: colors.text }}
                    >
                      {initials(authorName)}
                    </span>
                    <span className="orbit-note-author" style={{ color: colors.bar }}>{authorName}</span>
                    {isMentioned && <span className="orbit-note-mention-icon" aria-hidden="true">@</span>}
                    {isReplyToMe && !isMentioned && <span className="orbit-note-reply-icon" aria-hidden="true">↩</span>}
                  </span>
                )}
                <span className="orbit-note-meta-right">
                  <span className="orbit-note-time">{new Date(note.created_at).toLocaleTimeString()}</span>
                  {note.quoted && <span className="orbit-note-quoted-mark">{t("orbit.note.quoted")}</span>}
                  {showLikeCount && <span className="orbit-note-likes">{note.likes}</span>}
                  {showLikeButton && (note.liked_by_me ? (
                    <button
                      type="button"
                      className="orbit-like-btn-inline orbit-like-btn-inline--active"
                      onClick={() => onUnlike(note.note_id)}
                      aria-label={t("orbit.unlike")}
                      title={t("orbit.unlike")}
                    >
                      👍
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="orbit-like-btn-inline"
                      onClick={() => onLike(note.note_id)}
                      aria-label={t("orbit.like")}
                      title={t("orbit.like")}
                    >
                      👍
                    </button>
                  ))}
                  {showReplyButton && (
                    <button
                      type="button"
                      className="orbit-reply-btn-inline"
                      onClick={() => onReply?.(note.note_id)}
                      aria-label={t("orbit.reply")}
                      title={t("orbit.reply")}
                    >
                      ↩
                    </button>
                  )}
                </span>
              </div>
              {replyParent && (
                <div className="orbit-note-reply-preview">
                  <span className="orbit-note-reply-preview__name">{replyParentName}</span>
                  <span className="orbit-note-reply-preview__text">{replyParent.text}</span>
                </div>
              )}
              <p className="orbit-note-text">{note.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
