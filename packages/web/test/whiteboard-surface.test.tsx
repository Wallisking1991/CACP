import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhiteboardSurface } from "../src/components/WhiteboardSurface.js";
import type { WhiteboardEditorController } from "../src/whiteboard/whiteboard-editor-adapter.js";
import type { WhiteboardSessionController } from "../src/whiteboard/whiteboard-session.js";

function sessionController(): WhiteboardSessionController {
  return {
    subscribeStatus(listener) {
      listener("connected");
      return () => {};
    },
    subscribeCollaborators(listener) {
      listener([]);
      return () => {};
    },
    subscribeActivity: () => () => {},
    subscribeError(listener) {
      listener(undefined);
      return () => {};
    },
    focusCollaborator: () => {},
    loadSharedScene: () => {},
    setRole: () => {},
    setPresenceEnabled: () => {},
    destroy: () => {},
  };
}

describe("WhiteboardSurface exports", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the selected scope and shows missing-image failures", async () => {
    const exportScene = vi
      .fn<WhiteboardEditorController["exportScene"]>()
      .mockResolvedValueOnce(new Blob(["svg"], { type: "image/svg+xml" }))
      .mockRejectedValueOnce(
        new Error("whiteboard_export_missing_image:att_missing")
      );
    const insertImage = vi.fn(async () => {});
    const controller: WhiteboardEditorController = {
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: () => {},
      resetHistory: () => {},
      subscribeSceneChanges: () => () => {},
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
      insertImage,
      setDisplayOptions: () => {},
      setReadOnly: () => {},
      exportScene,
      destroy: () => {},
    };
    const createObjectURL = vi.fn(() => "blob:whiteboard");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <WhiteboardSurface
        active
        identity={{
          roomId: "room_1",
          participantId: "owner_1",
          token: "secret",
          role: "owner",
        }}
        loadEditorAdapter={async () => ({ mount: async () => controller })}
        loadSession={async () => () => sessionController()}
        langCode="en"
        name="Design Room — Whiteboard"
      />
    );

    const scope = await screen.findByLabelText("Export scope");
    const image = new File(["image"], "diagram.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [image] },
    });
    await waitFor(() => expect(insertImage).toHaveBeenCalledWith(image));

    fireEvent.change(scope, { target: { value: "selection" } });
    fireEvent.click(screen.getByRole("button", { name: "Export SVG" }));
    await waitFor(() =>
      expect(exportScene).toHaveBeenCalledWith("svg", "selection")
    );
    expect(createObjectURL).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));
    expect(
      await screen.findByText(
        "Export stopped because a referenced image is missing or inaccessible."
      )
    ).toHaveAttribute("role", "alert");
  });
});
