import { useRef, type CSSProperties } from "react";
import { useT } from "../i18n/useT.js";
import {
  BuiltInWhiteboardTemplates,
  WhiteboardTemplateCategories,
  type WhiteboardTemplateId,
} from "../whiteboard/whiteboard-templates.js";
import { XIcon } from "./RoomIcons.js";
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
          <XIcon />
        </button>
      </header>
      <div className="whiteboard-template-menu__catalog">
        {WhiteboardTemplateCategories.map((category) => {
          const templates = BuiltInWhiteboardTemplates.filter(
            (template) => template.category === category
          );
          const headingId = `whiteboard-template-category-${category}`;
          return (
            <section
              className="whiteboard-template-menu__category"
              aria-labelledby={headingId}
              key={category}
            >
              <header>
                <h3 id={headingId}>
                  {t(`whiteboard.templateCategory.${category}`)}
                </h3>
                <span aria-hidden="true">{templates.length}</span>
              </header>
              <div className="whiteboard-template-menu__list">
                {templates.map((template) => (
                  <button
                    type="button"
                    key={`${template.id}-v${template.version}`}
                    disabled={busy}
                    onClick={() => onInsert(template.id)}
                    style={
                      {
                        "--template-accent": template.accent,
                      } as CSSProperties
                    }
                  >
                    <span
                      className="whiteboard-template-menu__preview"
                      data-preview={template.preview}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="whiteboard-template-menu__copy">
                      <strong>{t(`whiteboard.template.${template.id}`)}</strong>
                      <span>
                        {t(`whiteboard.template.${template.id}Description`)}
                      </span>
                    </span>
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
        })}
      </div>
    </section>
  );
}
