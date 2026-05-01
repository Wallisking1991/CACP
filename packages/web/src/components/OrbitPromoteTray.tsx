import { useState } from "react";
import { useT } from "../i18n/useT.js";
import type { OrbitNoteView } from "./OrbitLayer.js";

export interface OrbitPromoteTrayProps {
  notes: OrbitNoteView[];
  onPromote: (noteIds: string[]) => void;
  canPromote: boolean;
}

export function OrbitPromoteTray({ notes, onPromote, canPromote }: OrbitPromoteTrayProps) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleNote = (noteId: string) => {
    const next = new Set(selected);
    if (next.has(noteId)) {
      next.delete(noteId);
    } else {
      next.add(noteId);
    }
    setSelected(next);
  };

  const handlePromote = () => {
    const noteIds = [...selected];
    if (noteIds.length === 0) return;
    onPromote(noteIds);
    setSelected(new Set());
  };

  if (notes.length === 0) {
    return (
      <div className="orbit-promote-tray">
        <p className="orbit-empty">{t("orbitPromote.empty")}</p>
      </div>
    );
  }

  return (
    <div className="orbit-promote-tray">
      <div className="orbit-promote-header">
        <span className="section-label">{t("orbitPromote.title")}</span>
      </div>
      <div className="orbit-promote-list">
        {notes.map((note) => (
          <label key={note.note_id} className="orbit-promote-item">
            <input
              type="checkbox"
              checked={selected.has(note.note_id)}
              onChange={() => toggleNote(note.note_id)}
              disabled={!canPromote}
            />
            <span className="orbit-promote-text">{note.text}</span>
          </label>
        ))}
      </div>
      <div className="orbit-promote-actions">
        <button
          type="button"
          className="btn btn-warm"
          onClick={handlePromote}
          disabled={!canPromote || selected.size === 0}
          aria-label={t("orbitPromote.promote")}
        >
          {t("orbitPromote.promote")} {selected.size > 0 && `(${selected.size})`}
        </button>
      </div>
    </div>
  );
}
