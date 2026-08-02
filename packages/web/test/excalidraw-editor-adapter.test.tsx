import { act } from "@testing-library/react";
import React, { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createExcalidrawEditorAdapter,
  type ExcalidrawApiPort,
  type ExcalidrawComponentProps,
} from "../src/whiteboard/excalidraw-editor-adapter.js";
import type {
  WhiteboardEditorController,
  WhiteboardScene,
} from "../src/whiteboard/whiteboard-editor-adapter.js";

function MenuItem({ children }: { children?: ReactNode }) {
  return <span>{children}</span>;
}

const FakeMainMenu = Object.assign(
  function FakeMainMenuRoot({ children }: { children?: ReactNode }) {
    return <nav aria-label="Editor menu">{children}</nav>;
  },
  {
    DefaultItems: {
      LoadScene: () => <MenuItem>Open</MenuItem>,
      SaveToActiveFile: () => <MenuItem>Save</MenuItem>,
      SaveAsImage: () => <MenuItem>Export image</MenuItem>,
      Export: () => <MenuItem>Export scene</MenuItem>,
      Help: () => <MenuItem>Help</MenuItem>,
      ClearCanvas: () => <MenuItem>Clear</MenuItem>,
      ToggleTheme: () => <MenuItem>Theme</MenuItem>,
      ChangeCanvasBackground: () => <MenuItem>Background</MenuItem>,
    },
  }
);

describe("Excalidraw whiteboard editor adapter", () => {
  it("controls scene, read-only state, local export menu, and cleanup through the public API", async () => {
    const updateScene = vi.fn();
    const updateCollaborators = vi.fn();
    const focusViewport = vi.fn();
    const resetHistory = vi.fn();
    const addFiles = vi.fn();
    let apiScene: WhiteboardScene = {
      elements: [{ id: "shape_1" }],
      appState: { viewBackgroundColor: "#ffffff" },
      files: { file_1: { id: "file_1" } },
    };
    const api: ExcalidrawApiPort = {
      getScene: () => apiScene,
      updateScene: (scene) => {
        apiScene = scene;
        updateScene(scene);
        addFiles(Object.values(scene.files));
      },
      resetHistory,
      updateCollaborators,
      focusViewport,
      insertImage: vi.fn(async () => {}),
      exportScene: async () => new Blob([], { type: "image/png" }),
    };
    let emitSceneChange:
      ((scene: ReturnType<ExcalidrawApiPort["getScene"]>) => void) | undefined;
    let emitPointerUpdate:
      ExcalidrawComponentProps["onPointerUpdate"] | undefined;
    let emitScrollChange:
      ExcalidrawComponentProps["onScrollChange"] | undefined;

    function FakeExcalidraw({
      children,
      excalidrawAPI,
      langCode,
      name,
      onPointerUpdate,
      onScrollChange,
      onSceneChange,
      viewModeEnabled,
    }: ExcalidrawComponentProps) {
      useEffect(() => {
        excalidrawAPI(api);
      }, [excalidrawAPI]);
      useEffect(() => {
        emitSceneChange = onSceneChange;
        emitPointerUpdate = onPointerUpdate;
        emitScrollChange = onScrollChange;
        return () => {
          emitSceneChange = undefined;
          emitPointerUpdate = undefined;
          emitScrollChange = undefined;
        };
      }, [onPointerUpdate, onSceneChange, onScrollChange]);

      return (
        <div
          data-testid="vendor-editor"
          data-lang={langCode}
          data-name={name}
          data-read-only={String(viewModeEnabled)}
        >
          {children}
        </div>
      );
    }

    const adapter = createExcalidrawEditorAdapter({
      Excalidraw: FakeExcalidraw,
      MainMenu: FakeMainMenu,
      createRoot,
    });
    const container = document.createElement("div");
    document.body.append(container);

    let controllerPromise: Promise<WhiteboardEditorController> | undefined;
    await act(() => {
      controllerPromise = Promise.resolve(
        adapter.mount(container, {
          ariaLabel: "Collaborative Whiteboard",
          langCode: "en",
          name: "Design Room — Whiteboard",
          readOnly: false,
        })
      );
    });
    if (!controllerPromise) throw new Error("Adapter did not start mounting.");
    const controller = await controllerPromise;

    expect(
      container.querySelector("[data-testid='vendor-editor']")
    ).toHaveAttribute("data-lang", "en");
    expect(container.textContent).toContain("Export image");
    expect(container.textContent).toContain("Export scene");
    expect(container.textContent).not.toContain("Social");
    expect(controller.getScene()).toEqual({
      elements: [{ id: "shape_1" }],
      appState: { viewBackgroundColor: "#ffffff" },
      files: { file_1: { id: "file_1" } },
    });

    const nextScene = {
      elements: [{ id: "shape_2" }],
      appState: { viewBackgroundColor: "#f8f8f7" },
      files: { file_2: { id: "file_2" } },
    };
    const onLocalSceneChange = vi.fn();
    const unsubscribe = controller.subscribeSceneChanges(onLocalSceneChange);
    const localElement = { id: "local_shape" };
    Object.defineProperty(localElement, "expensiveVendorState", {
      enumerable: true,
      get() {
        throw new Error("Local changes must not serialize whole elements.");
      },
    });
    const localScene = {
      elements: [localElement],
      appState: { viewBackgroundColor: "#eeeeee" },
      files: {},
    };
    await act(async () => {
      emitSceneChange?.(localScene);
    });
    expect(onLocalSceneChange.mock.calls[0]?.[0]).toBe(localScene);

    controller.updateScene(nextScene);
    expect(updateScene).toHaveBeenCalledWith(nextScene);
    expect(addFiles).toHaveBeenCalledWith([{ id: "file_2" }]);
    controller.resetHistory();
    expect(resetHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      emitSceneChange?.(nextScene);
    });
    expect(onLocalSceneChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitSceneChange?.(localScene);
    });
    expect(onLocalSceneChange).toHaveBeenCalledTimes(1);

    const localAfterRemote = {
      elements: [{ id: "shape_3" }],
      appState: { viewBackgroundColor: "#f8f8f7" },
      files: { file_2: { id: "file_2" } },
    };
    apiScene = localAfterRemote;
    await act(async () => {
      emitSceneChange?.(localAfterRemote);
    });
    expect(onLocalSceneChange).toHaveBeenLastCalledWith(localAfterRemote);
    expect(onLocalSceneChange).toHaveBeenCalledTimes(2);
    unsubscribe();

    const onPresenceChange = vi.fn();
    const onPresenceOnlySceneChange = vi.fn();
    const unsubscribePresenceOnlyScene = controller.subscribeSceneChanges(
      onPresenceOnlySceneChange
    );
    const unsubscribePresence =
      controller.subscribePresenceChanges(onPresenceChange);
    await act(async () => {
      emitPointerUpdate?.({
        pointer: { x: 140, y: 90 },
        button: "down",
      });
      emitScrollChange?.(-50, 25, 1.5);
      emitSceneChange?.({
        ...localAfterRemote,
        appState: {
          ...localAfterRemote.appState,
          selectedElementIds: { shape_3: true },
          scrollX: -50,
          scrollY: 25,
          zoom: { value: 1.5 },
        },
      });
    });
    expect(onPresenceChange).toHaveBeenLastCalledWith({
      cursor: { x: 140, y: 90, button: "down" },
      selectedElementIds: ["shape_3"],
      viewport: { scrollX: -50, scrollY: 25, zoom: 1.5 },
    });
    expect(onPresenceOnlySceneChange).not.toHaveBeenCalled();
    const presenceCallCount = onPresenceChange.mock.calls.length;
    await act(async () => {
      emitSceneChange?.({
        ...localAfterRemote,
        appState: {
          ...localAfterRemote.appState,
          selectedElementIds: { shape_3: true },
          scrollX: -50,
          scrollY: 25,
          zoom: { value: 1.5 },
        },
      });
    });
    expect(onPresenceChange).toHaveBeenCalledTimes(presenceCallCount);
    unsubscribePresenceOnlyScene();
    unsubscribePresence();

    const collaborator = {
      participantId: "user_2",
      displayName: "Alice",
      color: { background: "#dbeafe", stroke: "#2563eb" },
      canEdit: true,
      cursor: { x: 320, y: 180, button: "up" as const },
      selectedElementIds: ["shape_2"],
      viewport: { scrollX: -100, scrollY: 40, zoom: 1.25 },
    };
    controller.setCollaborators([collaborator]);
    controller.setCollaborators([collaborator]);
    expect(updateCollaborators).toHaveBeenCalledWith([collaborator]);
    expect(updateCollaborators).toHaveBeenCalledTimes(1);
    controller.focusViewport(collaborator.viewport);
    expect(focusViewport).toHaveBeenCalledWith(collaborator.viewport);

    await act(async () => {
      controller.setReadOnly(true);
    });
    expect(
      container.querySelector("[data-testid='vendor-editor']")
    ).toHaveAttribute("data-read-only", "true");

    await act(async () => {
      controller.setDisplayOptions({
        ariaLabel: "协作白板",
        langCode: "zh",
        name: "设计房间 — 白板",
      });
    });
    expect(
      container.querySelector("[data-testid='vendor-editor']")
    ).toHaveAttribute("data-lang", "zh-CN");
    expect(
      container.querySelector("[data-testid='vendor-editor']")
    ).toHaveAttribute("data-name", "设计房间 — 白板");
    expect(controller.getScene().elements).toEqual([{ id: "shape_3" }]);

    await expect(controller.exportScene("png")).resolves.toHaveProperty(
      "type",
      "image/png"
    );

    await act(async () => {
      controller.destroy();
    });
    expect(container).toBeEmptyDOMElement();
    container.remove();
  });
});
