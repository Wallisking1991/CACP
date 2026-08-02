import type { Ref } from "react";

import { useT } from "../i18n/useT.js";
import type {
  WhiteboardExportFormat,
  WhiteboardExportScope,
} from "../whiteboard/whiteboard-editor-adapter.js";

interface WhiteboardActionState {
  exportScope: WhiteboardExportScope;
  insertingImage: boolean;
  preparingPromotion: boolean;
  templateOpen: boolean;
}

interface WhiteboardActionHandlers {
  addImage(): void;
  export(format: WhiteboardExportFormat): void;
  openRecovery(): void;
  preparePromotion(): void;
  setExportScope(scope: WhiteboardExportScope): void;
  toggleTemplates(): void;
}

export interface WhiteboardActionMenuProps {
  canEdit: boolean;
  canManage: boolean;
  editDisabled: boolean;
  mobile: boolean;
  state: WhiteboardActionState;
  actions: WhiteboardActionHandlers;
  promotionTriggerRef: Ref<HTMLButtonElement>;
  recoveryTriggerRef: Ref<HTMLButtonElement>;
  templateTriggerRef: Ref<HTMLButtonElement>;
}

export function WhiteboardActionMenu({
  canEdit,
  canManage,
  editDisabled,
  mobile,
  state,
  actions,
  promotionTriggerRef,
  recoveryTriggerRef,
  templateTriggerRef,
}: WhiteboardActionMenuProps) {
  const t = useT();
  return (
    <>
      {canEdit && (
        <>
          <button
            type="button"
            disabled={state.insertingImage || editDisabled}
            onClick={actions.addImage}
          >
            {t(
              state.insertingImage
                ? "whiteboard.addingImage"
                : "whiteboard.addImage"
            )}
          </button>
          <button
            ref={templateTriggerRef}
            type="button"
            disabled={editDisabled}
            aria-expanded={state.templateOpen}
            onClick={actions.toggleTemplates}
          >
            {t("whiteboard.templates")}
          </button>
        </>
      )}
      {canManage && (
        <>
          <button
            ref={promotionTriggerRef}
            type="button"
            disabled={state.preparingPromotion}
            onClick={actions.preparePromotion}
          >
            {t(
              state.preparingPromotion
                ? "whiteboard.promotionPreparing"
                : "whiteboard.promoteSelection"
            )}
          </button>
          <button
            ref={recoveryTriggerRef}
            type="button"
            onClick={actions.openRecovery}
          >
            {t("whiteboard.manageRecovery")}
          </button>
        </>
      )}
      <label
        className={mobile ? "whiteboard-mobile-actions__scope" : undefined}
      >
        <span className={mobile ? undefined : "sr-only"}>
          {t("whiteboard.exportScope")}
        </span>
        <select
          aria-label={t("whiteboard.exportScope")}
          value={state.exportScope}
          onChange={(event) =>
            actions.setExportScope(
              event.currentTarget.value as WhiteboardExportScope
            )
          }
        >
          <option value="scene">{t("whiteboard.exportScene")}</option>
          <option value="selection">{t("whiteboard.exportSelection")}</option>
        </select>
      </label>
      {(["png", "svg", "excalidraw"] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => actions.export(format)}
          aria-label={t("whiteboard.exportFormat", {
            format:
              format === "excalidraw" ? "Excalidraw" : format.toUpperCase(),
          })}
        >
          {format === "excalidraw" ? ".excalidraw" : format.toUpperCase()}
        </button>
      ))}
    </>
  );
}
