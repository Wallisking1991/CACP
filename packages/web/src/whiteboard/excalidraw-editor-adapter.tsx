import type { ComponentType, ReactNode } from "react";
import type {
  WhiteboardEditorAdapter,
  WhiteboardEditorController,
  WhiteboardEditorDisplayOptions,
  WhiteboardEditorMountOptions,
  WhiteboardExportFormat,
  WhiteboardScene,
} from "./whiteboard-editor-adapter.js";

interface ExcalidrawRoot {
  render(children: ReactNode): void;
  unmount(): void;
}

export interface ExcalidrawApiPort {
  getScene(): WhiteboardScene;
  updateScene(scene: WhiteboardScene): void;
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
  return JSON.stringify({
    elements: scene.elements,
    background: scene.appState.viewBackgroundColor,
    files: Object.keys(scene.files).sort(),
  });
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
      const sceneListeners = new Set<(scene: WhiteboardScene) => void>();
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
        const fingerprint = sceneFingerprint(scene);
        if (fingerprint === suppressedSceneFingerprint) {
          suppressedSceneFingerprint = undefined;
          return;
        }
        suppressedSceneFingerprint = undefined;
        for (const listener of sceneListeners) listener(scene);
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
        subscribeSceneChanges(listener) {
          if (destroyed) return () => {};
          sceneListeners.add(listener);
          return () => sceneListeners.delete(listener);
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
          api = undefined;
          root.unmount();
        },
      };

      return controller;
    },
  };
}
