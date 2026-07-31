import { useRef, type KeyboardEvent } from "react";
import { useT } from "../i18n/useT.js";

export type WorkspaceMode = "conversation" | "whiteboard";

export interface WorkspaceModeSwitchProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
}

export function WorkspaceModeSwitch({
  mode,
  onChange,
}: WorkspaceModeSwitchProps) {
  const t = useT();
  const conversationRef = useRef<HTMLButtonElement>(null);
  const whiteboardRef = useRef<HTMLButtonElement>(null);

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
      </button>
    </div>
  );
}
