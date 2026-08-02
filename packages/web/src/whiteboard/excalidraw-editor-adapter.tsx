import type { ComponentType, ReactNode } from "react";
import type {
  WhiteboardEditorAdapter,
  WhiteboardEditorController,
  WhiteboardEditorDisplayOptions,
  WhiteboardEditorMountOptions,
  WhiteboardExportFormat,
  WhiteboardCollaborator,
  WhiteboardPresence,
  WhiteboardScene,
  WhiteboardViewport,
} from "./whiteboard-editor-adapter.js";

interface ExcalidrawRoot {
  render(children: ReactNode): void;
  unmount(): void;
}

export interface ExcalidrawApiPort {
  getScene(): WhiteboardScene;
  updateScene(scene: WhiteboardScene): void;
  resetHistory(): void;
  updateCollaborators(collaborators: readonly WhiteboardCollaborator[]): void;
  focusViewport(viewport: WhiteboardViewport): void;
  exportScene(format: WhiteboardExportFormat): Promise<Blob>;
}

export interface ExcalidrawComponentProps {
  ariaLabel: string;
  autoFocus: boolean;
  children?: ReactNode;
  excalidrawAPI: (api: ExcalidrawApiPort) => void;
  handleKeyboardGlobally: boolean;
  langCode: "en" | "zh-CN";
  name: string;
  onPointerUpdate: (payload: {
    pointer: { x: number; y: number };
    button: "up" | "down";
  }) => void;
  onScrollChange: (scrollX: number, scrollY: number, zoom: number) => void;
  onSceneChange: (scene: WhiteboardScene) => void;
  validateEmbeddable: () => false;
  viewModeEnabled: boolean;
}

type ExcalidrawMenuComponent = ComponentType<{
  children?: ReactNode;
}> & {
  DefaultItems: {
    LoadScene: ComponentType;
    SaveToActiveFile: ComponentType;
    SaveAsImage: ComponentType;
    Export: ComponentType;
    Help: ComponentType;
    ClearCanvas: ComponentType;
    ToggleTheme: ComponentType<{ allowSystemTheme: false }>;
    ChangeCanvasBackground: ComponentType;
  };
};

export interface ExcalidrawRuntime {
  Excalidraw: ComponentType<ExcalidrawComponentProps>;
  MainMenu: ExcalidrawMenuComponent;
  createRoot(container: Element | DocumentFragment): ExcalidrawRoot;
}

function editorLanguage(langCode: WhiteboardEditorMountOptions["langCode"]) {
  return langCode === "zh" ? ("zh-CN" as const) : ("en" as const);
}

function sceneFingerprint(scene: WhiteboardScene): string {
  const elements = scene.elements.map((element) => {
    if (!element || typeof element !== "object") return element;
    const value = element as Record<string, unknown>;
    return [value.id, value.version, value.versionNonce, value.isDeleted];
  });
  return JSON.stringify({
    elements,
    background: scene.appState.viewBackgroundColor,
    files: Object.keys(scene.files).sort(),
  });
}

function presenceFingerprint(presence: WhiteboardPresence): string {
  return JSON.stringify(presence);
}

function collaboratorFingerprint(
  collaborators: readonly WhiteboardCollaborator[]
): string {
  return JSON.stringify(
    collaborators.map((collaborator) => ({
      ...collaborator,
      selectedElementIds: collaborator.selectedElementIds
        ? [...collaborator.selectedElementIds].sort()
        : undefined,
    }))
  );
}

export function createExcalidrawEditorAdapter(
  runtime: ExcalidrawRuntime
): WhiteboardEditorAdapter {
  return {
    async mount(container, options) {
      const root = runtime.createRoot(container);
      let api: ExcalidrawApiPort | undefined;
      let displayOptions: WhiteboardEditorDisplayOptions = options;
      let readOnly = options.readOnly;
      let destroyed = false;
      let suppressedSceneFingerprint: string | undefined;
      let lastSceneFingerprint: string | undefined;
      let lastCollaboratorFingerprint: string | undefined;
      const sceneListeners = new Set<(scene: WhiteboardScene) => void>();
      const presenceListeners = new Set<
        (presence: WhiteboardPresence) => void
      >();
      let presence: WhiteboardPresence = {
        cursor: null,
        selectedElementIds: [],
        viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
      };
      let lastPresenceFingerprint = presenceFingerprint(presence);
      let resolveApi: (value: ExcalidrawApiPort) => void = () => {};
      const apiReady = new Promise<ExcalidrawApiPort>((resolve) => {
        resolveApi = resolve;
      });

      const handleApi = (nextApi: ExcalidrawApiPort) => {
        if (destroyed) return;
        if (!api) {
          api = nextApi;
          resolveApi(nextApi);
        }
      };

      const handleSceneChange = (scene: WhiteboardScene) => {
        const selectedElementIds = Object.entries(
          (scene.appState.selectedElementIds as
            Record<string, boolean> | undefined) ?? {}
        )
          .filter(([, selected]) => selected)
          .map(([id]) => id);
        const zoom = scene.appState.zoom;
        const nextPresence: WhiteboardPresence = {
          ...presence,
          selectedElementIds,
          viewport: {
            scrollX:
              typeof scene.appState.scrollX === "number"
                ? scene.appState.scrollX
                : presence.viewport.scrollX,
            scrollY:
              typeof scene.appState.scrollY === "number"
                ? scene.appState.scrollY
                : presence.viewport.scrollY,
            zoom:
              typeof zoom === "number"
                ? zoom
                : zoom &&
                    typeof zoom === "object" &&
                    typeof (zoom as { value?: unknown }).value === "number"
                  ? (zoom as { value: number }).value
                  : presence.viewport.zoom,
          },
        };
        const nextPresenceFingerprint = presenceFingerprint(nextPresence);
        presence = nextPresence;
        if (nextPresenceFingerprint !== lastPresenceFingerprint) {
          lastPresenceFingerprint = nextPresenceFingerprint;
          for (const listener of presenceListeners) listener(presence);
        }

        const fingerprint = sceneFingerprint(scene);
        if (suppressedSceneFingerprint !== undefined) {
          if (fingerprint === suppressedSceneFingerprint) {
            lastSceneFingerprint = fingerprint;
            return;
          }
          if (api && fingerprint !== sceneFingerprint(api.getScene())) return;
          suppressedSceneFingerprint = undefined;
        }
        if (fingerprint === lastSceneFingerprint) return;
        lastSceneFingerprint = fingerprint;
        for (const listener of sceneListeners) listener(scene);
      };

      const handlePointerUpdate: ExcalidrawComponentProps["onPointerUpdate"] =
        ({ pointer, button }) => {
          const nextPresence = {
            ...presence,
            cursor: { x: pointer.x, y: pointer.y, button },
          };
          const nextPresenceFingerprint = presenceFingerprint(nextPresence);
          presence = nextPresence;
          if (nextPresenceFingerprint !== lastPresenceFingerprint) {
            lastPresenceFingerprint = nextPresenceFingerprint;
            for (const listener of presenceListeners) listener(presence);
          }
        };

      const handleScrollChange: ExcalidrawComponentProps["onScrollChange"] = (
        scrollX,
        scrollY,
        zoom
      ) => {
        const nextPresence = {
          ...presence,
          viewport: { scrollX, scrollY, zoom },
        };
        const nextPresenceFingerprint = presenceFingerprint(nextPresence);
        presence = nextPresence;
        if (nextPresenceFingerprint !== lastPresenceFingerprint) {
          lastPresenceFingerprint = nextPresenceFingerprint;
          for (const listener of presenceListeners) listener(presence);
        }
      };

      const renderEditor = () => {
        const DefaultItems = runtime.MainMenu.DefaultItems;
        root.render(
          <div
            className="whiteboard-excalidraw"
            role="application"
            aria-label={displayOptions.ariaLabel}
          >
            <runtime.Excalidraw
              ariaLabel={displayOptions.ariaLabel}
              autoFocus
              excalidrawAPI={handleApi}
              handleKeyboardGlobally={false}
              langCode={editorLanguage(displayOptions.langCode)}
              name={displayOptions.name}
              onPointerUpdate={handlePointerUpdate}
              onScrollChange={handleScrollChange}
              onSceneChange={handleSceneChange}
              validateEmbeddable={() => false}
              viewModeEnabled={readOnly}
            >
              <runtime.MainMenu>
                <DefaultItems.LoadScene />
                <DefaultItems.SaveToActiveFile />
                <DefaultItems.SaveAsImage />
                <DefaultItems.Export />
                <DefaultItems.ChangeCanvasBackground />
                <DefaultItems.ToggleTheme allowSystemTheme={false} />
                <DefaultItems.ClearCanvas />
                <DefaultItems.Help />
              </runtime.MainMenu>
            </runtime.Excalidraw>
          </div>
        );
      };

      try {
        renderEditor();
        api = await apiReady;
        lastSceneFingerprint = sceneFingerprint(api.getScene());
      } catch (cause) {
        destroyed = true;
        root.unmount();
        throw cause;
      }

      const controller: WhiteboardEditorController = {
        getScene() {
          return (
            api?.getScene() ?? {
              elements: [],
              appState: {},
              files: {},
            }
          );
        },
        updateScene(scene) {
          if (!api || destroyed) return;
          suppressedSceneFingerprint = sceneFingerprint(scene);
          api.updateScene(scene);
        },
        resetHistory() {
          if (!api || destroyed) return;
          api.resetHistory();
        },
        subscribeSceneChanges(listener) {
          if (destroyed) return () => {};
          sceneListeners.add(listener);
          return () => sceneListeners.delete(listener);
        },
        subscribePresenceChanges(listener) {
          if (destroyed) return () => {};
          presenceListeners.add(listener);
          return () => presenceListeners.delete(listener);
        },
        setCollaborators(collaborators) {
          if (!api || destroyed) return;
          const fingerprint = collaboratorFingerprint(collaborators);
          if (fingerprint === lastCollaboratorFingerprint) return;
          lastCollaboratorFingerprint = fingerprint;
          api.updateCollaborators(collaborators);
        },
        focusViewport(viewport) {
          if (!api || destroyed) return;
          api.focusViewport(viewport);
        },
        setDisplayOptions(nextDisplayOptions) {
          if (destroyed) return;
          displayOptions = nextDisplayOptions;
          renderEditor();
        },
        setReadOnly(nextReadOnly) {
          if (destroyed || readOnly === nextReadOnly) return;
          readOnly = nextReadOnly;
          renderEditor();
        },
        exportScene(format = "excalidraw") {
          if (!api || destroyed) {
            return Promise.reject(
              new Error("Whiteboard editor is unavailable.")
            );
          }
          return api.exportScene(format);
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          sceneListeners.clear();
          presenceListeners.clear();
          api = undefined;
          root.unmount();
        },
      };

      return controller;
    },
  };
}
