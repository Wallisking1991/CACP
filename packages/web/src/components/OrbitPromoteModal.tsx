import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";
import type { OrbitNoteView } from "./OrbitLayer.js";

export interface OrbitPromoteModalProps {
  open: boolean;
  notes: OrbitNoteView[];
  canPromote: boolean;
  onPromote: (noteIds: string[]) => void;
  onClose: () => void;
}

export function OrbitPromoteModal({ open, notes, canPromote, onPromote, onClose }: OrbitPromoteModalProps) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(notes.map((note) => note.note_id)));
    else setSelected(new Set());
  }, [open, notes]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const toggleNote = (noteId: string) => {
    const next = new Set(selected);
    if (next.has(noteId)) {
      next.delete(noteId);
    } else {
      next.add(noteId);
    }
    setSelected(next);
  };

  const allSelected = notes.length > 0 && selected.size === notes.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(notes.map((note) => note.note_id)));

  const handlePromote = () => {
    const ids = notes.map((note) => note.note_id).filter((id) => selected.has(id));
    if (ids.length === 0 || !canPromote) return;
    onPromote(ids);
    onClose();
  };

  const promoteLabel = String(t("orbitPromote.promote"));
  const cancelLabel = String(t("orbitPromote.cancel"));
  const closeLabel = String(t("orbitPromote.close"));
  const titleLabel = String(t("orbitPromote.title"));
  const toggleAllLabel = String(t(allSelected ? "orbitPromote.deselectAll" : "orbitPromote.selectAll"));

  return createPortal(
    <div
      className="orbit-promote-modal-overlay"
      onClick={onClose}
    >
      <div
        className="orbit-promote-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titleLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="orbit-promote-modal-header">
          <h2 className="orbit-promote-modal-title">{titleLabel}</h2>
          <button
            type="button"
            className="orbit-promote-modal-toggle-all"
            onClick={toggleAll}
            disabled={notes.length === 0 || !canPromote}
          >
            {toggleAllLabel}
          </button>
          <button
            type="button"
            className="orbit-promote-modal-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <span aria-hidden="true">&#10005;</span>
          </button>
        </div>
        <div className="orbit-promote-modal-body">
          {notes.length === 0 ? (
            <p className="orbit-empty">{t("orbitPromote.empty")}</p>
          ) : (
            <ul className="orbit-promote-list" role="list">
              {notes.map((note) => (
                <li key={note.note_id}>
                  <label className="orbit-promote-item">
                    <input
                      type="checkbox"
                      checked={selected.has(note.note_id)}
                      onChange={() => toggleNote(note.note_id)}
                      disabled={!canPromote}
                    />
                    <span className="orbit-promote-text">{note.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="orbit-promote-modal-footer">
          <button
            type="button"
            className="orbit-promote-modal-cancel"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="orbit-promote-modal-promote"
            onClick={handlePromote}
            disabled={!canPromote || selected.size === 0}
            aria-label={promoteLabel}
          >
            {promoteLabel}
            {selected.size > 0 && (
              <span className="orbit-promote-modal-promote__badge" aria-hidden="true">{selected.size}</span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
