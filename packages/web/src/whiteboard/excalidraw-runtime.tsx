import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
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
  WhiteboardExportScope,
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

function exportOptions(
  api: ExcalidrawImperativeAPI,
  scope: WhiteboardExportScope
) {
  const appState = api.getAppState();
  const allElements =
    api.getSceneElements() as readonly NonDeletedExcalidrawElement[];
  const elements =
    scope === "selection"
      ? selectedExportElements(allElements, appState.selectedElementIds)
      : allElements;
  if (scope === "selection" && elements.length === 0) {
    throw new Error("whiteboard_export_empty_selection");
  }
  return {
    elements,
    appState,
    files: referencedFiles(elements, api.getFiles()),
  };
}

function selectedExportElements(
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>
): NonDeletedExcalidrawElement[] {
  const included = new Set(
    Object.entries(selectedElementIds)
      .filter(([, selected]) => selected)
      .map(([id]) => id)
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      const containerId = "containerId" in element ? element.containerId : null;
      if (
        !included.has(element.id) &&
        ((element.frameId && included.has(element.frameId)) ||
          (containerId && included.has(containerId)))
      ) {
        included.add(element.id);
        changed = true;
      }
    }
  }
  return elements.filter((element) => included.has(element.id));
}

function referencedFiles(
  elements: readonly NonDeletedExcalidrawElement[],
  files: BinaryFiles
): BinaryFiles {
  const referenced = new Set<string>(
    elements.flatMap((element) =>
      element.type === "image" && element.fileId ? [element.fileId] : []
    )
  );
  return Object.fromEntries(
    Object.entries(files).filter(([fileId]) => referenced.has(fileId))
  ) as BinaryFiles;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("whiteboard_image_read_failed"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("whiteboard_image_read_failed"));
    reader.readAsDataURL(file);
  });
}

async function imageSize(
  file: File
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") {
    return { width: 240, height: 180 };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const size = {
      width: Math.max(1, bitmap.width * scale),
      height: Math.max(1, bitmap.height * scale),
    };
    bitmap.close();
    return size;
  } catch {
    return { width: 240, height: 180 };
  }
}

function assertExportImagesAvailable(
  scene: ReturnType<typeof exportOptions>
): void {
  for (const element of scene.elements) {
    if (element.type !== "image" || !element.fileId) continue;
    const file = scene.files[element.fileId];
    if (!file || typeof file.dataURL !== "string") {
      throw new Error(`whiteboard_export_missing_image:${element.fileId}`);
    }
  }
}

async function exportScene(
  api: ExcalidrawImperativeAPI,
  format: WhiteboardExportFormat,
  scope: WhiteboardExportScope
): Promise<Blob> {
  const scene = exportOptions(api, scope);
  assertExportImagesAvailable(scene);

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
    resetHistory() {
      api.history.clear();
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
    async insertImage(file) {
      if (
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.type
        )
      ) {
        throw new Error("whiteboard_image_type_invalid");
      }
      const [dataURL, size] = await Promise.all([
        fileDataUrl(file),
        imageSize(file),
      ]);
      const fileId = `whiteboard_${crypto.randomUUID()}`;
      const appState = api.getAppState();
      const zoom = appState.zoom.value || 1;
      const x =
        -appState.scrollX + appState.width / (2 * zoom) - size.width / 2;
      const y =
        -appState.scrollY + appState.height / (2 * zoom) - size.height / 2;
      const [image] = convertToExcalidrawElements([
        {
          type: "image",
          x,
          y,
          width: size.width,
          height: size.height,
          fileId: fileId as BinaryFileData["id"],
        },
      ]);
      if (!image) throw new Error("whiteboard_image_insert_failed");
      const binaryFile = {
        id: fileId,
        dataURL,
        mimeType: file.type,
        created: Date.now(),
        lastRetrieved: Date.now(),
      } as BinaryFileData;
      api.addFiles([binaryFile]);
      api.updateScene({
        elements: [...api.getSceneElements(), image],
        appState: {
          selectedElementIds: { [image.id]: true },
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    exportScene(format, scope = "scene") {
      return exportScene(api, format, scope);
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
