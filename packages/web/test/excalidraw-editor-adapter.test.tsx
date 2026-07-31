import { act } from "@testing-library/react";
import React, { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createExcalidrawEditorAdapter,
  type ExcalidrawApiPort,
  type ExcalidrawComponentProps,
} from "../src/whiteboard/excalidraw-editor-adapter.js";
import type { WhiteboardEditorController } from "../src/whiteboard/whiteboard-editor-adapter.js";

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
    const addFiles = vi.fn();
    const api: ExcalidrawApiPort = {
      getScene: () => ({
        elements: [{ id: "shape_1" }],
        appState: { viewBackgroundColor: "#ffffff" },
        files: { file_1: { id: "file_1" } },
      }),
      updateScene: (scene) => {
        updateScene(scene);
        addFiles(Object.values(scene.files));
      },
      exportScene: async () => new Blob([], { type: "image/png" }),
    };
    let emitSceneChange:
      ((scene: ReturnType<ExcalidrawApiPort["getScene"]>) => void) | undefined;

    function FakeExcalidraw({
      children,
      excalidrawAPI,
      langCode,
      name,
      onSceneChange,
      viewModeEnabled,
    }: ExcalidrawComponentProps) {
      useEffect(() => {
        excalidrawAPI(api);
      }, [excalidrawAPI]);
      useEffect(() => {
        emitSceneChange = onSceneChange;
        return () => {
          emitSceneChange = undefined;
        };
      }, [onSceneChange]);

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
    const localScene = {
      elements: [{ id: "local_shape" }],
      appState: { viewBackgroundColor: "#eeeeee" },
      files: {},
    };
    await act(async () => {
      emitSceneChange?.(localScene);
    });
    expect(onLocalSceneChange).toHaveBeenCalledWith(localScene);

    controller.updateScene(nextScene);
    expect(updateScene).toHaveBeenCalledWith(nextScene);
    expect(addFiles).toHaveBeenCalledWith([{ id: "file_2" }]);
    await act(async () => {
      emitSceneChange?.(nextScene);
    });
    expect(onLocalSceneChange).toHaveBeenCalledTimes(1);
    unsubscribe();

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
    expect(controller.getScene().elements).toEqual([{ id: "shape_1" }]);

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
