import { useRef } from "react";
import { useT } from "../i18n/useT.js";
import {
  BuiltInWhiteboardTemplates,
  type WhiteboardTemplateId,
} from "../whiteboard/whiteboard-templates.js";
import { useDialogKeyboard } from "./useDialogKeyboard.js";

export interface WhiteboardTemplateMenuProps {
  busy: boolean;
  onClose(): void;
  onInsert(templateId: WhiteboardTemplateId): void;
}

export function WhiteboardTemplateMenu({
  busy,
  onClose,
  onInsert,
}: WhiteboardTemplateMenuProps) {
  const t = useT();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogKeyboard(
    dialogRef,
    true,
    () => {
      if (!busy) onClose();
    },
    closeButtonRef
  );
  return (
    <section
      ref={dialogRef}
      className="whiteboard-template-menu"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-labelledby="whiteboard-template-title"
    >
      <header>
        <div>
          <h2 id="whiteboard-template-title">
            {t("whiteboard.templatesTitle")}
          </h2>
          <p>{t("whiteboard.templatesDescription")}</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label={t("common.close")}
        >
          ×
        </button>
      </header>
      <div className="whiteboard-template-menu__list">
        {BuiltInWhiteboardTemplates.map((template) => (
          <button
            type="button"
            key={`${template.id}-v${template.version}`}
            disabled={busy}
            onClick={() => onInsert(template.id)}
          >
            <strong>{t(`whiteboard.template.${template.id}`)}</strong>
            <span>{t(`whiteboard.template.${template.id}Description`)}</span>
            <small>
              {t("whiteboard.templateVersion", {
                version: template.version,
              })}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
