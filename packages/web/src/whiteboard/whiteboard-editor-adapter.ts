export interface WhiteboardScene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface WhiteboardCursor {
  x: number;
  y: number;
  button: "up" | "down";
}

export interface WhiteboardViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface WhiteboardPresence {
  cursor: WhiteboardCursor | null;
  selectedElementIds: readonly string[];
  viewport: WhiteboardViewport;
}

export interface WhiteboardCollaborator {
  participantId: string;
  displayName: string;
  color: {
    background: string;
    stroke: string;
  };
  canEdit: boolean;
  cursor?: WhiteboardCursor | null;
  selectedElementIds?: readonly string[];
  viewport?: WhiteboardViewport;
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
  resetHistory?(): void;
  subscribeSceneChanges(listener: (scene: WhiteboardScene) => void): () => void;
  subscribePresenceChanges(
    listener: (presence: WhiteboardPresence) => void
  ): () => void;
  setCollaborators(collaborators: readonly WhiteboardCollaborator[]): void;
  focusViewport(viewport: WhiteboardViewport): void;
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
