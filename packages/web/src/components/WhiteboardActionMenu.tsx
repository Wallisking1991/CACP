import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { useT } from "../i18n/useT.js";
import type {
  WhiteboardExportFormat,
  WhiteboardExportScope,
} from "../whiteboard/whiteboard-editor-adapter.js";
import {
  ClockIcon,
  EditableFileIcon,
  GlobeIcon,
  ImageFileIcon,
  ImagePlusIcon,
  LayoutTemplateIcon,
  SendIcon,
  VectorFileIcon,
} from "./RoomIcons.js";

interface WhiteboardActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  buttonRef?: Ref<HTMLButtonElement>;
  icon: ReactNode;
  label: string;
  mobile: boolean;
}

function WhiteboardActionButton({
  buttonRef,
  className,
  icon,
  label,
  mobile,
  ...props
}: WhiteboardActionButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`whiteboard-action-button whiteboard-action-button--${
        mobile ? "labeled" : "icon"
      }${className ? ` ${className}` : ""}`}
      aria-label={label}
      data-tooltip={mobile ? undefined : label}
      {...props}
    >
      <span className="whiteboard-action-button__icon" aria-hidden="true">
        {icon}
      </span>
      {mobile && (
        <span className="whiteboard-action-button__label">{label}</span>
      )}
    </button>
  );
}

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
  const addImageLabel = String(
    t(state.insertingImage ? "whiteboard.addingImage" : "whiteboard.addImage")
  );
  const templateLabel = String(t("whiteboard.templates"));
  const promotionLabel = String(
    t(
      state.preparingPromotion
        ? "whiteboard.promotionPreparing"
        : "whiteboard.promoteSelection"
    )
  );
  const recoveryLabel = String(t("whiteboard.manageRecovery"));
  return (
    <>
      {canEdit && (
        <>
          <WhiteboardActionButton
            mobile={mobile}
            label={addImageLabel}
            icon={<ImagePlusIcon />}
            disabled={state.insertingImage || editDisabled}
            onClick={actions.addImage}
          />
          <WhiteboardActionButton
            buttonRef={templateTriggerRef}
            mobile={mobile}
            label={templateLabel}
            icon={<LayoutTemplateIcon />}
            disabled={editDisabled}
            aria-expanded={state.templateOpen}
            onClick={actions.toggleTemplates}
          />
        </>
      )}
      {canManage && (
        <>
          <WhiteboardActionButton
            buttonRef={promotionTriggerRef}
            mobile={mobile}
            label={promotionLabel}
            icon={<SendIcon />}
            disabled={state.preparingPromotion}
            onClick={actions.preparePromotion}
          />
          <WhiteboardActionButton
            buttonRef={recoveryTriggerRef}
            mobile={mobile}
            label={recoveryLabel}
            icon={<ClockIcon />}
            onClick={actions.openRecovery}
          />
        </>
      )}
      <label
        className={`whiteboard-action-scope${
          mobile ? " whiteboard-mobile-actions__scope" : ""
        }`}
      >
        {!mobile && (
          <span className="whiteboard-action-scope__icon" aria-hidden="true">
            <GlobeIcon />
          </span>
        )}
        <span
          className={
            mobile ? undefined : "whiteboard-action-scope__label--hidden"
          }
        >
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
      {(["png", "svg", "excalidraw"] as const).map((format) => {
        const formatName =
          format === "excalidraw" ? "Excalidraw" : format.toUpperCase();
        const label = String(
          t("whiteboard.exportFormat", {
            format: formatName,
          })
        );
        const icon =
          format === "png" ? (
            <ImageFileIcon />
          ) : format === "svg" ? (
            <VectorFileIcon />
          ) : (
            <EditableFileIcon />
          );
        return (
          <WhiteboardActionButton
            key={format}
            mobile={mobile}
            label={label}
            icon={icon}
            onClick={() => actions.export(format)}
          />
        );
      })}
    </>
  );
}
