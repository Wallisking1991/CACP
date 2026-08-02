import { describe, expect, it, vi } from "vitest";

const exportToBlob = vi.fn(async () => new Blob(["png"]));
const exportToSvg = vi.fn(async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-export", "scene");
  return svg;
});
const serializeAsJSON = vi.fn(() => '{"type":"excalidraw"}');

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "immediately", NEVER: "never" },
  Excalidraw: () => null,
  MainMenu: Object.assign(() => null, { DefaultItems: {} }),
  convertToExcalidrawElements: vi.fn((elements) =>
    elements.map((element: Record<string, unknown>) => ({
      id: "inserted_image",
      version: 1,
      versionNonce: 1,
      ...element,
    }))
  ),
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(),
}));

describe("Excalidraw public API bridge", () => {
  it("maps scenes, files, update capture, and all local export formats", async () => {
    const { createExcalidrawApiPort } =
      await import("../src/whiteboard/excalidraw-runtime.js");
    const elements = [{ id: "image_1", type: "image", fileId: "file_1" }];
    const appState = { viewBackgroundColor: "#ffffff" };
    const files = {
      file_1: { id: "file_1", dataURL: "data:image/png;base64,AA==" },
    };
    const updateScene = vi.fn();
    const addFiles = vi.fn();
    const clearHistory = vi.fn();
    const api = {
      getSceneElements: vi.fn(() => elements),
      getAppState: vi.fn(() => appState),
      getFiles: vi.fn(() => files),
      updateScene,
      addFiles,
      history: { clear: clearHistory },
    };

    const port = createExcalidrawApiPort(
      api as unknown as Parameters<typeof createExcalidrawApiPort>[0]
    );

    expect(port.getScene()).toEqual({ elements, appState, files });

    port.updateScene({ elements, appState, files });
    expect(updateScene).toHaveBeenCalledWith({
      elements,
      appState,
      captureUpdate: "never",
    });
    expect(addFiles).toHaveBeenCalledWith([files.file_1]);

    port.resetHistory();
    expect(clearHistory).toHaveBeenCalledTimes(1);

    const png = await port.exportScene("png");
    expect(await png.text()).toBe("png");
    expect(exportToBlob).toHaveBeenCalledWith({
      elements,
      appState,
      files,
      mimeType: "image/png",
    });

    const svg = await port.exportScene("svg");
    expect(svg.type).toBe("image/svg+xml");
    expect(await svg.text()).toContain('data-export="scene"');
    expect(exportToSvg).toHaveBeenCalledWith({ elements, appState, files });

    const source = await port.exportScene("excalidraw");
    expect(source.type).toBe("application/vnd.excalidraw+json");
    expect(await source.text()).toBe('{"type":"excalidraw"}');
    expect(serializeAsJSON).toHaveBeenCalledWith(
      elements,
      appState,
      files,
      "local"
    );
  });

  it("exports only the current selection and rejects missing image bytes", async () => {
    const { createExcalidrawApiPort } =
      await import("../src/whiteboard/excalidraw-runtime.js");
    const selected = {
      id: "shape_selected",
      type: "rectangle",
      boundElements: [{ id: "label", type: "text" }],
    };
    const label = {
      id: "label",
      type: "text",
      containerId: "shape_selected",
    };
    const frameImage = {
      id: "image_in_frame",
      type: "image",
      frameId: "frame_selected",
      fileId: "att_selected",
    };
    const frame = { id: "frame_selected", type: "frame", frameId: null };
    const missingImage = {
      id: "image_missing",
      type: "image",
      fileId: "att_missing",
    };
    const api = {
      getSceneElements: vi.fn(() => [
        selected,
        label,
        frameImage,
        frame,
        missingImage,
      ]),
      getAppState: vi.fn(() => ({
        selectedElementIds: {
          shape_selected: true,
          frame_selected: true,
        },
      })),
      getFiles: vi.fn(() => ({
        att_selected: {
          id: "att_selected",
          dataURL: "data:image/png;base64,AA==",
        },
        att_private: {
          id: "att_private",
          dataURL: "data:image/png;base64,PRIVATE",
        },
      })),
      updateScene: vi.fn(),
      addFiles: vi.fn(),
      history: { clear: vi.fn() },
    };
    const port = createExcalidrawApiPort(
      api as unknown as Parameters<typeof createExcalidrawApiPort>[0]
    );

    await port.exportScene("png", "selection");
    expect(exportToBlob).toHaveBeenLastCalledWith({
      elements: [selected, label, frameImage, frame],
      appState: {
        selectedElementIds: {
          shape_selected: true,
          frame_selected: true,
        },
      },
      files: {
        att_selected: {
          id: "att_selected",
          dataURL: "data:image/png;base64,AA==",
        },
      },
      mimeType: "image/png",
    });
    await expect(port.exportScene("png", "scene")).rejects.toThrow(
      "whiteboard_export_missing_image:att_missing"
    );
  });

  it("inserts an image through the public scene and file APIs", async () => {
    const { createExcalidrawApiPort } =
      await import("../src/whiteboard/excalidraw-runtime.js");
    const updateScene = vi.fn();
    const addFiles = vi.fn();
    const api = {
      getSceneElements: vi.fn(() => []),
      getAppState: vi.fn(() => ({
        width: 800,
        height: 600,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
        selectedElementIds: {},
      })),
      getFiles: vi.fn(() => ({})),
      updateScene,
      addFiles,
      history: { clear: vi.fn() },
    };
    const port = createExcalidrawApiPort(
      api as unknown as Parameters<typeof createExcalidrawApiPort>[0]
    );

    await port.insertImage(
      new File(["image"], "diagram.png", { type: "image/png" })
    );

    expect(addFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(/^whiteboard_/u),
        dataURL: expect.stringMatching(/^data:image\/png/u),
        mimeType: "image/png",
      }),
    ]);
    expect(updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [expect.objectContaining({ type: "image" })],
        captureUpdate: "immediately",
      })
    );
  });
});
