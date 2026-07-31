import type {
  WhiteboardEditorController,
  WhiteboardScene,
} from "./whiteboard-editor-adapter.js";

const emptyScene = (): WhiteboardScene => ({
  elements: [],
  appState: {},
  files: {},
});

export function createWhiteboardObserverEditor(): WhiteboardEditorController {
  let scene = emptyScene();

  return {
    getScene() {
      return scene;
    },
    updateScene(nextScene) {
      scene = nextScene;
    },
    subscribeSceneChanges() {
      return () => {};
    },
    subscribePresenceChanges() {
      return () => {};
    },
    setCollaborators() {},
    focusViewport() {},
    setDisplayOptions() {},
    setReadOnly() {},
    exportScene() {
      return Promise.resolve(
        new Blob([JSON.stringify(scene)], {
          type: "application/vnd.excalidraw+json",
        })
      );
    },
    destroy() {
      scene = emptyScene();
    },
  };
}
