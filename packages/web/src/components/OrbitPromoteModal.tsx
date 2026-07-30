import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";
import type { OrbitNoteView } from "../room-state.js";

export interface OrbitPromoteModalProps {
  open: boolean;
  notes: OrbitNoteView[];
  canPromote: boolean;
  onPromote: (
    noteIds: string[],
    attachmentIds: string[],
    instruction: string
  ) => void;
  onClose: () => void;
}

export function OrbitPromoteModal({
  open,
  notes,
  canPromote,
  onPromote,
  onClose,
}: OrbitPromoteModalProps) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(
    new Set()
  );
  const [instruction, setInstruction] = useState("");

  const noteIdsKey = notes
    .map(
      (note) =>
        `${note.note_id}:${(note.attachments ?? [])
          .map((attachment) => attachment.attachment_id)
          .join("|")}`
    )
    .join(",");
  useEffect(() => {
    if (open) {
      setSelected(new Set(notes.map((note) => note.note_id)));
      setSelectedAttachments(
        new Set(
          notes.flatMap((note) =>
            (note.attachments ?? []).map(
              (attachment) => attachment.attachment_id
            )
          )
        )
      );
      setInstruction("");
    } else {
      setSelected(new Set());
      setSelectedAttachments(new Set());
      setInstruction("");
    }
    // noteIdsKey captures notes identity so user deselections survive parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteIdsKey]);

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

  const sortedNotes = [...notes].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const toggleNote = (noteId: string) => {
    const next = new Set(selected);
    if (next.has(noteId)) {
      next.delete(noteId);
    } else {
      next.add(noteId);
    }
    setSelected(next);
  };

  const toggleAttachment = (attachmentId: string) => {
    const next = new Set(selectedAttachments);
    if (next.has(attachmentId)) next.delete(attachmentId);
    else next.add(attachmentId);
    setSelectedAttachments(next);
  };

  const allSelected = notes.length > 0 && selected.size === notes.length;
  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(notes.map((note) => note.note_id))
    );

  const handlePromote = () => {
    const ids = notes
      .map((note) => note.note_id)
      .filter((id) => selected.has(id));
    const attachments = notes
      .filter((note) => selected.has(note.note_id))
      .flatMap((note) => note.attachments ?? [])
      .map((attachment) => attachment.attachment_id)
      .filter(
        (attachmentId, index, all) =>
          selectedAttachments.has(attachmentId) &&
          all.indexOf(attachmentId) === index
      );
    const instructionRequired =
      ids.length > 0 &&
      notes
        .filter((note) => selected.has(note.note_id))
        .every((note) => note.text.trim().length === 0);
    if (
      ids.length === 0 ||
      !canPromote ||
      attachments.length > 5 ||
      (instructionRequired && instruction.trim().length === 0)
    )
      return;
    onPromote(ids, attachments, instruction.trim());
    onClose();
  };

  const selectedNotes = notes.filter((note) => selected.has(note.note_id));
  const visibleAttachments = selectedNotes.flatMap(
    (note) => note.attachments ?? []
  );
  const selectedVisibleAttachmentCount = visibleAttachments.filter(
    (attachment, index, all) =>
      selectedAttachments.has(attachment.attachment_id) &&
      all.findIndex(
        (candidate) => candidate.attachment_id === attachment.attachment_id
      ) === index
  ).length;
  const instructionRequired =
    selectedNotes.length > 0 &&
    selectedNotes.every((note) => note.text.trim().length === 0);
  const promotionBlocked =
    selected.size === 0 ||
    selectedVisibleAttachmentCount > 5 ||
    (instructionRequired && instruction.trim().length === 0);

  const promoteLabel = String(t("orbitPromote.promote"));
  const cancelLabel = String(t("orbitPromote.cancel"));
  const closeLabel = String(t("orbitPromote.close"));
  const titleLabel = String(t("orbitPromote.title"));
  const toggleAllLabel = String(
    t(allSelected ? "orbitPromote.deselectAll" : "orbitPromote.selectAll")
  );

  return createPortal(
    <div className="orbit-promote-modal-overlay" onClick={onClose}>
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
              {sortedNotes.map((note) => (
                <li key={note.note_id}>
                  <label className="orbit-promote-item">
                    <input
                      type="checkbox"
                      checked={selected.has(note.note_id)}
                      onChange={() => toggleNote(note.note_id)}
                      disabled={!canPromote}
                    />
                    <span className="orbit-promote-text">
                      {note.text ||
                        t("orbit.attachmentSummary", {
                          count: String(note.attachments?.length ?? 0),
                        })}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {visibleAttachments.length > 0 && (
            <fieldset className="orbit-promote-attachments">
              <legend>{t("orbitPromote.attachments")}</legend>
              {visibleAttachments.map((attachment) => (
                <label
                  className="orbit-promote-attachment"
                  key={attachment.attachment_id}
                >
                  <input
                    type="checkbox"
                    aria-label={String(
                      t("orbitPromote.includeAttachment", {
                        name: attachment.name,
                      })
                    )}
                    checked={selectedAttachments.has(attachment.attachment_id)}
                    onChange={() => toggleAttachment(attachment.attachment_id)}
                    disabled={!canPromote}
                  />
                  <span>{attachment.name}</span>
                  <span className="orbit-promote-attachment__meta">
                    {attachment.media_type}
                  </span>
                </label>
              ))}
              {selectedVisibleAttachmentCount > 5 && (
                <p className="orbit-promote-error" role="alert">
                  {t("orbitPromote.tooManyAttachments")}
                </p>
              )}
            </fieldset>
          )}
          <label className="orbit-promote-instruction">
            <span>
              {t("orbitPromote.instruction")}
              {instructionRequired
                ? ` · ${t("orbitPromote.instructionRequired")}`
                : ` · ${t("orbitPromote.instructionOptional")}`}
            </span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value)}
              aria-label={String(t("orbitPromote.instruction"))}
              maxLength={4000}
              rows={3}
              disabled={!canPromote}
            />
          </label>
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
            disabled={!canPromote || promotionBlocked}
            aria-label={promoteLabel}
          >
            {promoteLabel}
            {selected.size > 0 && (
              <span
                className="orbit-promote-modal-promote__badge"
                aria-hidden="true"
              >
                {selected.size}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
