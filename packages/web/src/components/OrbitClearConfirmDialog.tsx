import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";

export interface OrbitClearConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OrbitClearConfirmDialog({ open, onConfirm, onCancel }: OrbitClearConfirmDialogProps) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const titleLabel = String(t("orbit.clear.confirm.title"));
  const bodyLabel = String(t("orbit.clear.confirm.body"));
  const confirmLabel = String(t("orbit.clear.confirm.confirm"));
  const cancelLabel = String(t("orbit.clear.confirm.cancel"));

  return createPortal(
    <div className="orbit-promote-modal-overlay" onClick={onCancel}>
      <div
        className="orbit-promote-modal orbit-clear-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="orbit-promote-modal-header">
          <h2 id={titleId} className="orbit-promote-modal-title">{titleLabel}</h2>
        </div>
        <div className="orbit-promote-modal-body">
          <p id={bodyId} className="orbit-clear-confirm-body">{bodyLabel}</p>
        </div>
        <div className="orbit-promote-modal-footer">
          <button
            type="button"
            className="orbit-promote-modal-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="orbit-clear-confirm-btn"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
