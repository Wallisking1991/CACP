import type { WhiteboardEditorAdapterLoader } from "./whiteboard-editor-adapter.js";

export const loadExcalidrawEditorAdapter: WhiteboardEditorAdapterLoader =
  async () => {
    (
      window as Window & {
        EXCALIDRAW_ASSET_PATH?: string;
      }
    ).EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}excalidraw-assets/`;

    const [{ createExcalidrawEditorAdapter }, { excalidrawRuntime }] =
      await Promise.all([
        import("./excalidraw-editor-adapter.js"),
        import("./excalidraw-runtime.js"),
      ]);
    return createExcalidrawEditorAdapter(excalidrawRuntime);
  };
