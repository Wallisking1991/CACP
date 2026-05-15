import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";

export type ParticipantRole = "owner" | "admin" | "member" | "observer";

export interface RoleChangeConfirmDialogProps {
  open: boolean;
  participantName: string;
  oldRole: ParticipantRole;
  newRole: ParticipantRole;
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

  function roleLabel(role: ParticipantRole): string {
    return String(t(`role.${role}` as Parameters<typeof t>[0]) ?? role);
  }

  const titleLabel = String(t("role.change.confirm.title"));
  const bodyLabel = String(
    t("role.change.confirm.body", {
      name: participantName,
      oldRole: roleLabel(oldRole),
      newRole: roleLabel(newRole),
    })
  );
  const confirmLabel = String(t("role.change.confirm.confirm"));
  const cancelLabel = String(t("role.change.confirm.cancel"));

  return createPortal(
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div
        className="confirm-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal-header">
          <h2 id={titleId} className="confirm-modal-title">{titleLabel}</h2>
        </div>
        <div className="confirm-modal-body">
          <p id={bodyId}>{bodyLabel}</p>
        </div>
        <div className="confirm-modal-footer">
          <button
            type="button"
            className="confirm-modal-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-modal-confirm"
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
