import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";

export interface RoleChangeConfirmDialogProps {
  open: boolean;
  participantName: string;
  oldRole: string;
  newRole: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RoleChangeConfirmDialog({
  open,
  participantName,
  oldRole,
  newRole,
  onConfirm,
  onCancel,
}: RoleChangeConfirmDialogProps) {
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

  const titleLabel = String(t("role.change.confirm.title"));
  const bodyLabel = String(
    t("role.change.confirm.body", {
      name: participantName,
      oldRole: String(t(`role.${oldRole}` as Parameters<typeof t>[0]) ?? oldRole),
      newRole: String(t(`role.${newRole}` as Parameters<typeof t>[0]) ?? newRole),
    })
  );
  const confirmLabel = String(t("role.change.confirm.confirm"));
  const cancelLabel = String(t("role.change.confirm.cancel"));

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
