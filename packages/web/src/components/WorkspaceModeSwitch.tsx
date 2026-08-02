import { useEffect, useRef, type KeyboardEvent } from "react";
import { useT } from "../i18n/useT.js";

export type WorkspaceMode = "conversation" | "whiteboard";

export interface WorkspaceModeSwitchProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  activeEditorCount?: number;
  hasWhiteboardActivity?: boolean;
  hasConversationActivity?: boolean;
}

export function WorkspaceModeSwitch({
  mode,
  onChange,
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
        aria-controls="conversation-workspace-panel"
        aria-selected={mode === "conversation"}
        tabIndex={mode === "conversation" ? 0 : -1}
        className={mode === "conversation" ? "is-active" : undefined}
        onClick={() => activate("conversation")}
        onKeyDown={(event) => handleKeyDown(event, "conversation")}
      >
        {t("workspace.conversation")}
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
        aria-controls="whiteboard-workspace-panel"
        aria-selected={mode === "whiteboard"}
        tabIndex={mode === "whiteboard" ? 0 : -1}
        className={mode === "whiteboard" ? "is-active" : undefined}
        onClick={() => activate("whiteboard")}
        onKeyDown={(event) => handleKeyDown(event, "whiteboard")}
      >
        {t("workspace.whiteboard")}
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
