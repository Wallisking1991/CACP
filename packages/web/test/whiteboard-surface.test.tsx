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
    const imageInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(imageInput.accept).not.toContain("image/svg+xml");
    const image = new File(["image"], "diagram.png", { type: "image/png" });
    fireEvent.change(imageInput, {
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

  it("lets an owner review revisions before restoring the whole board", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            current_revision: 2,
            snapshots: [
              {
                snapshot_id: "snapshot_1",
                revision: 1,
                created_at: "2026-08-02T01:02:03.000Z",
                reason: "automatic",
                element_count: 3,
                compressed_bytes: 128,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            operation: "restore",
            previous_revision: 2,
            target_revision: 1,
            revision: 3,
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ current_revision: 3, snapshots: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    const controller: WhiteboardEditorController = {
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: () => {},
      resetHistory: () => {},
      subscribeSceneChanges: () => () => {},
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
      setDisplayOptions: () => {},
      setReadOnly: () => {},
      exportScene: async () => new Blob(),
      destroy: () => {},
    };

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
        name="Recovery room"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Recovery" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore revision 1" })
    );
    expect(screen.getAllByText("Current revision: 2")).toHaveLength(2);
    expect(
      screen.getByText("Target: copy revision 1 into new revision 3.")
    ).toBeVisible();
    expect(
      screen.getByText(/whole shared whiteboard will be replaced/u)
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]).toMatchObject([
      "/rooms/room_1/whiteboard/snapshots/snapshot_1/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_revision: 2 }),
      }),
    ]);
  });
});
