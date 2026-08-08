import { useEffect, useRef, type KeyboardEvent } from "react";
import { useT } from "../i18n/useT.js";
import { BubbleIcon, WhiteboardIcon } from "./RoomIcons.js";

export type WorkspaceMode = "conversation" | "whiteboard";

export interface WorkspaceModeSwitchProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  onWhiteboardIntent?: () => void;
  activeEditorCount?: number;
  hasWhiteboardActivity?: boolean;
  hasConversationActivity?: boolean;
}

export function WorkspaceModeSwitch({
  mode,
  onChange,
  onWhiteboardIntent,
  activeEditorCount = 0,
  hasWhiteboardActivity = false,
  hasConversationActivity = false,
}: WorkspaceModeSwitchProps) {
  const t = useT();
  const conversationRef = useRef<HTMLButtonElement>(null);
  const whiteboardRef = useRef<HTMLButtonElement>(null);
  const previousModeRef = useRef(mode);

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    const selectedTab =
      mode === "conversation" ? conversationRef : whiteboardRef;
    selectedTab.current?.focus();
  }, [mode]);

  const activate = (nextMode: WorkspaceMode) => {
    onChange(nextMode);
    const nextTab =
      nextMode === "conversation" ? conversationRef : whiteboardRef;
    nextTab.current?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: WorkspaceMode
  ) => {
    let nextMode: WorkspaceMode | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextMode = currentMode === "conversation" ? "whiteboard" : "conversation";
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextMode = currentMode === "conversation" ? "whiteboard" : "conversation";
    } else if (event.key === "Home") {
      nextMode = "conversation";
    } else if (event.key === "End") {
      nextMode = "whiteboard";
    }

    if (!nextMode) return;
    event.preventDefault();
    activate(nextMode);
  };

  return (
    <div
      className="workspace-mode-switch"
      role="tablist"
      aria-label={String(t("workspace.modeLabel"))}
    >
      <button
        ref={conversationRef}
        id="conversation-workspace-tab"
        type="button"
        role="tab"
        aria-label={t("workspace.conversation")}
        aria-controls="conversation-workspace-panel"
        aria-selected={mode === "conversation"}
        data-tooltip={t("workspace.conversation")}
        tabIndex={mode === "conversation" ? 0 : -1}
        className={mode === "conversation" ? "is-active" : undefined}
        onClick={() => activate("conversation")}
        onKeyDown={(event) => handleKeyDown(event, "conversation")}
      >
        <BubbleIcon className="workspace-mode-switch__icon" />
        {hasConversationActivity && (
          <span
            className="workspace-mode-switch__activity"
            aria-label={t("workspace.conversationActivity")}
            aria-live="polite"
          />
        )}
      </button>
      <button
        ref={whiteboardRef}
        id="whiteboard-workspace-tab"
        type="button"
        role="tab"
        aria-label={t("workspace.whiteboard")}
        aria-controls="whiteboard-workspace-panel"
        aria-selected={mode === "whiteboard"}
        data-tooltip={t("workspace.whiteboard")}
        tabIndex={mode === "whiteboard" ? 0 : -1}
        className={mode === "whiteboard" ? "is-active" : undefined}
        onFocus={onWhiteboardIntent}
        onPointerEnter={onWhiteboardIntent}
        onClick={() => activate("whiteboard")}
        onKeyDown={(event) => handleKeyDown(event, "whiteboard")}
      >
        <WhiteboardIcon className="workspace-mode-switch__icon" />
        {activeEditorCount > 0 && (
          <span
            className="workspace-mode-switch__count"
            aria-label={t("workspace.activeEditors", {
              count: activeEditorCount,
            })}
            aria-live="polite"
          >
            {activeEditorCount}
          </span>
        )}
        {hasWhiteboardActivity && (
          <span
            className="workspace-mode-switch__activity"
            aria-label={t("workspace.whiteboardActivity")}
            aria-live="polite"
          />
        )}
      </button>
    </div>
  );
}
