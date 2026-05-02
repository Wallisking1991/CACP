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
}

export function OrbitLayer({ notes, currentParticipantId, actorNames, onLike, onUnlike, canReact = true }: OrbitLayerProps) {
  const t = useT();

  if (notes.length === 0) {
    return (
      <div className="orbit-layer">
        <div className="orbit-header">
          <span className="section-label">{t("orbit.title")}</span>
        </div>
        <p className="orbit-empty">{t("orbit.empty")}</p>
      </div>
    );
  }

  return (
    <div className="orbit-layer">
      <div className="orbit-header">
        <span className="section-label">{t("orbit.title")}</span>
      </div>
      <div className="orbit-notes">
        {notes.map((note) => {
          const ownNote = note.created_by === currentParticipantId;
          const showReactionControls = canReact && !ownNote;
          return (
            <div key={note.note_id} className={`orbit-note ${note.round_id ? "orbit-note--round" : ""}`}>
              <div className="orbit-note-meta">
                <span>{actorNames.get(note.created_by) || note.created_by}</span>
                <span className="orbit-note-time">{new Date(note.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="orbit-note-text">{note.text}</p>
              <div className="orbit-note-actions">
                {!showReactionControls && (
                  <span className="orbit-like-count">
                    {ownNote ? t("orbit.ownNote") : null}
                    {note.likes > 0 && <span>{note.likes}</span>}
                  </span>
                )}
                {showReactionControls && (note.liked_by_me ? (
                  <button
                    type="button"
                    className="btn btn-ghost orbit-like-btn orbit-like-btn--active"
                    onClick={() => onUnlike(note.note_id)}
                    aria-label={t("orbit.unlike")}
                  >
                    {t("orbit.unlike")} {note.likes > 0 && <span>{note.likes}</span>}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost orbit-like-btn"
                    onClick={() => onLike(note.note_id)}
                    aria-label={t("orbit.like")}
                  >
                    {t("orbit.like")} {note.likes > 0 && <span>{note.likes}</span>}
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
