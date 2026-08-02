import { describe, expect, it, vi } from "vitest";

const exportToBlob = vi.fn(async () => new Blob(["png"]));
const exportToSvg = vi.fn(async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-export", "scene");
  return svg;
});
const serializeAsJSON = vi.fn(() => '{"type":"excalidraw"}');

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  Excalidraw: () => null,
  MainMenu: Object.assign(() => null, { DefaultItems: {} }),
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
    const elements = [{ id: "shape_1", type: "rectangle" }];
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
});
