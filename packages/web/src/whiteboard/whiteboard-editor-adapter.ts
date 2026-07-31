export interface WhiteboardScene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export type WhiteboardExportFormat = "png" | "svg" | "excalidraw";

export interface WhiteboardEditorDisplayOptions {
  ariaLabel: string;
  langCode: "en" | "zh";
  name: string;
}

export interface WhiteboardEditorController {
  getScene(): WhiteboardScene;
  updateScene(scene: WhiteboardScene): void;
  setDisplayOptions(options: WhiteboardEditorDisplayOptions): void;
  setReadOnly(readOnly: boolean): void;
  exportScene(format?: WhiteboardExportFormat): Promise<Blob>;
  destroy(): void;
}

export interface WhiteboardEditorMountOptions extends WhiteboardEditorDisplayOptions {
  readOnly: boolean;
}

export interface WhiteboardEditorAdapter {
  mount(
    container: HTMLElement,
    options: WhiteboardEditorMountOptions
  ): WhiteboardEditorController | Promise<WhiteboardEditorController>;
}

export type WhiteboardEditorAdapterLoader =
  () => Promise<WhiteboardEditorAdapter>;
