import { useRef, useEffect, useState } from "react";
import { useT } from "../i18n/useT.js";

export interface OrbitNoteView {
  note_id: string;
  text: string;
  created_by: string;
  created_at: string;
  likes: number;
  liked_by_me: boolean;
  round_id?: string;
}

export interface OrbitLayerProps {
  notes: OrbitNoteView[];
  currentParticipantId: string;
  actorNames: Map<string, string>;
  onLike: (noteId: string) => void;
  onUnlike: (noteId: string) => void;
  canReact?: boolean;
  canPromote?: boolean;
  hasPromotable?: boolean;
  onPromoteClick?: () => void;
}

export function OrbitLayer({
  notes,
  currentParticipantId,
  actorNames,
  onLike,
  onUnlike,
  canReact = true,
  canPromote = false,
  hasPromotable = false,
  onPromoteClick,
}: OrbitLayerProps) {
  const t = useT();
  const notesContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
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

  if (notes.length === 0) {
    return (
      <div className="orbit-layer">
        <div className="orbit-header">
          <span className="section-label">{t("orbit.title")}</span>
          {promoteButton}
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
      </div>
      <div
        className="orbit-notes"
        ref={notesContainerRef}
        onScroll={handleScroll}
      >
        {notes.map((note) => {
          const ownNote = note.created_by === currentParticipantId;
          const showReactionControls = canReact && !ownNote;
          return (
            <div key={note.note_id} className={`orbit-note ${note.round_id ? "orbit-note--round" : ""} ${ownNote ? "orbit-note--own" : ""}`}>
              <div className="orbit-note-meta">
                <span>{actorNames.get(note.created_by) || note.created_by}</span>
                <span className="orbit-note-time">{new Date(note.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="orbit-note-text">{note.text}</p>
              <div className="orbit-note-actions">
                <span className="orbit-like-count">
                  {note.likes > 0 && <span className="orbit-like-count__num">{note.likes}</span>}
                </span>
                {showReactionControls && (note.liked_by_me ? (
                  <button
                    type="button"
                    className="orbit-like-btn orbit-like-btn--active"
                    onClick={() => onUnlike(note.note_id)}
                    aria-label={t("orbit.unlike")}
                    title={t("orbit.unlike")}
                  >
                    <span className="orbit-like-icon">&#9829;</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="orbit-like-btn"
                    onClick={() => onLike(note.note_id)}
                    aria-label={t("orbit.like")}
                    title={t("orbit.like")}
                  >
                    <span className="orbit-like-icon">&#9825;</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
