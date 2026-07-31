import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  Collaborator,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { createRoot } from "react-dom/client";
import type {
  ExcalidrawApiPort,
  ExcalidrawComponentProps,
  ExcalidrawRuntime,
} from "./excalidraw-editor-adapter.js";
import type {
  WhiteboardExportFormat,
  WhiteboardCollaborator,
  WhiteboardScene,
  WhiteboardViewport,
} from "./whiteboard-editor-adapter.js";

function toExcalidrawElements(scene: WhiteboardScene) {
  return scene.elements as readonly ExcalidrawElement[];
}

function toExcalidrawAppState(scene: WhiteboardScene) {
  return scene.appState as Partial<AppState>;
}

function toExcalidrawFiles(scene: WhiteboardScene) {
  return scene.files as BinaryFiles;
}

function exportOptions(api: ExcalidrawImperativeAPI) {
  return {
    elements: api.getSceneElements() as readonly NonDeletedExcalidrawElement[],
    appState: api.getAppState(),
    files: api.getFiles(),
  };
}

async function exportScene(
  api: ExcalidrawImperativeAPI,
  format: WhiteboardExportFormat
): Promise<Blob> {
  const scene = exportOptions(api);

  if (format === "png") {
    return exportToBlob({
      ...scene,
      mimeType: "image/png",
    });
  }

  if (format === "svg") {
    const svg = await exportToSvg(scene);
    return new Blob([svg.outerHTML], { type: "image/svg+xml" });
  }

  return new Blob(
    [serializeAsJSON(scene.elements, scene.appState, scene.files, "local")],
    { type: "application/vnd.excalidraw+json" }
  );
}

export function createExcalidrawApiPort(
  api: ExcalidrawImperativeAPI
): ExcalidrawApiPort {
  return {
    getScene() {
      return {
        elements: api.getSceneElements(),
        appState: api.getAppState() as unknown as Record<string, unknown>,
        files: api.getFiles() as unknown as Record<string, unknown>,
      };
    },
    updateScene(scene) {
      api.updateScene({
        elements: toExcalidrawElements(scene),
        appState: toExcalidrawAppState(scene) as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      const files = Object.values(toExcalidrawFiles(scene));
      if (files.length > 0) api.addFiles(files as BinaryFileData[]);
    },
    updateCollaborators(collaborators: readonly WhiteboardCollaborator[]) {
      const vendorCollaborators = new Map<SocketId, Collaborator>();
      for (const collaborator of collaborators) {
        vendorCollaborators.set(collaborator.participantId as SocketId, {
          id: collaborator.participantId,
          socketId: collaborator.participantId as SocketId,
          username: collaborator.displayName,
          color: collaborator.color,
          ...(collaborator.cursor
            ? {
                pointer: {
                  x: collaborator.cursor.x,
                  y: collaborator.cursor.y,
                  tool: "pointer",
                } as const,
                button: collaborator.cursor.button,
              }
            : {}),
          ...(collaborator.selectedElementIds
            ? {
                selectedElementIds: Object.fromEntries(
                  collaborator.selectedElementIds.map((id) => [id, true])
                ),
              }
            : {}),
        });
      }
      api.updateScene({
        collaborators: vendorCollaborators,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    focusViewport(viewport: WhiteboardViewport) {
      api.updateScene({
        appState: {
          scrollX: viewport.scrollX,
          scrollY: viewport.scrollY,
          zoom: { value: viewport.zoom },
        } as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    exportScene(format) {
      return exportScene(api, format);
    },
  };
}

function renderExcalidraw({
  ariaLabel: _ariaLabel,
  excalidrawAPI,
  onPointerUpdate,
  onScrollChange,
  onSceneChange,
  validateEmbeddable: _validateEmbeddable,
  ...props
}: ExcalidrawComponentProps) {
  const vendorProps: ExcalidrawProps = {
    ...props,
    aiEnabled: false,
    excalidrawAPI: (api) => excalidrawAPI(createExcalidrawApiPort(api)),
    onChange: (elements, appState, files) =>
      onSceneChange({
        elements,
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
      }),
    onPointerUpdate: ({ pointer, button }) =>
      onPointerUpdate({
        pointer: { x: pointer.x, y: pointer.y },
        button,
      }),
    onScrollChange: (scrollX, scrollY, zoom) =>
      onScrollChange(scrollX, scrollY, zoom.value),
    UIOptions: {
      canvasActions: {
        changeViewBackgroundColor: true,
        clearCanvas: true,
        export: { saveFileToDisk: true },
        loadScene: true,
        saveAsImage: true,
        saveToActiveFile: true,
        toggleTheme: true,
      },
    },
    validateEmbeddable: () => false,
  };

  return <Excalidraw {...vendorProps} />;
}

export const excalidrawRuntime: ExcalidrawRuntime = {
  Excalidraw: renderExcalidraw,
  MainMenu: MainMenu as unknown as ExcalidrawRuntime["MainMenu"],
  createRoot,
};
