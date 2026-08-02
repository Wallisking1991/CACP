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
    expect(screen.getByRole("button", { name: "Close" })).toHaveTextContent(
      "×"
    );
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

  it("closes recovery immediately when the manager role is removed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ current_revision: 1, snapshots: [] }), {
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
    const view = render(
      <WhiteboardSurface
        active
        identity={{
          roomId: "room_1",
          participantId: "admin_1",
          token: "secret",
          role: "admin",
        }}
        loadEditorAdapter={async () => ({ mount: async () => controller })}
        loadSession={async () => () => sessionController()}
        langCode="en"
        name="Recovery room"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Recovery" }));
    expect(await screen.findByRole("dialog")).toBeVisible();

    view.rerender(
      <WhiteboardSurface
        active
        identity={{
          roomId: "room_1",
          participantId: "admin_1",
          token: "secret",
          role: "member",
        }}
        loadEditorAdapter={async () => ({ mount: async () => controller })}
        loadSession={async () => () => sessionController()}
        langCode="en"
        name="Recovery room"
      />
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole("button", { name: "Recovery" })
    ).not.toBeInTheDocument();
  });

  it("previews a Frame and safely retries one promotion without reuploading", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:promotion-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const attachment = (
      attachmentId: string,
      name: string,
      mediaType: string,
      kind: "image" | "text"
    ) => ({
      attachment: {
        attachment_id: attachmentId,
        name,
        media_type: mediaType,
        size_bytes: 12,
        sha256: "a".repeat(64),
        kind,
        disposition: "inline",
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            attachment("att_png", "selection.png", "image/png", "image")
          ),
          { status: 201, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            attachment(
              "att_source",
              "selection.excalidraw",
              "application/vnd.excalidraw+json",
              "text"
            )
          ),
          { status: 201, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporary_failure" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            input_id: "input_1",
            status: "triggered",
            attachment_count: 2,
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        )
      );
    const createPromotionArtifacts = vi.fn(async () => ({
      selectedElementIds: ["frame_1", "shape_1"],
      frameId: "frame_1",
      png: new Blob(["png"], { type: "image/png" }),
      source: new Blob(['{"type":"excalidraw"}'], {
        type: "application/vnd.excalidraw+json",
      }),
    }));
    const controller: WhiteboardEditorController = {
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: () => {},
      resetHistory: () => {},
      subscribeSceneChanges: () => () => {},
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
      createPromotionArtifacts,
      setDisplayOptions: () => {},
      setReadOnly: () => {},
      exportScene: async () => new Blob(),
      destroy: () => {},
    };
    const promoted = vi.fn();
    render(
      <WhiteboardSurface
        active
        identity={{
          roomId: "room_1",
          participantId: "owner_1",
          token: "secret",
          role: "owner",
        }}
        activeAgent={{
          agent_id: "agent_1",
          name: "Codex",
          capabilities: ["codex-cli"],
          status: "online",
          input_capabilities: {
            image: "native",
            pdf: "file_path",
            text: "file_path",
            office: "file_path",
            file: "file_path",
            max_attachments: 5,
          },
        }}
        loadEditorAdapter={async () => ({ mount: async () => controller })}
        loadSession={async () => () => ({
          ...sessionController(),
          currentRevision: () => 7,
        })}
        langCode="en"
        name="Promotion room"
        onAttachmentUsageChanged={promoted}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send selection to main conversation",
      })
    );
    expect(
      await screen.findByAltText(
        "PNG preview of the selected whiteboard content"
      )
    ).toHaveAttribute("src", "blob:promotion-preview");
    expect(screen.getAllByText(".excalidraw")).toHaveLength(2);
    expect(screen.getByText("Codex")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    const submit = screen.getByRole("button", { name: "Create Main Input" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Instruction for the Agent"), {
      target: { value: "Implement this architecture." },
    });
    fireEvent.click(submit);
    expect(
      await screen.findByText(/uploaded snapshot is retained for a safe retry/u)
    ).toHaveAttribute("role", "alert");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Create Main Input" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(promoted).toHaveBeenCalledTimes(1);
    const firstRequest = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    const retryRequest = JSON.parse(
      String((fetchMock.mock.calls[3]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(retryRequest).toEqual(firstRequest);
    expect(firstRequest).toMatchObject({
      expected_revision: 7,
      selected_element_ids: ["frame_1", "shape_1"],
      frame_id: "frame_1",
      png_attachment_id: "att_png",
      source_attachment_id: "att_source",
      agent_id: "agent_1",
      instruction: "Implement this architecture.",
    });
  });

  it("refuses a promotion preview when the authoritative revision changes during export", async () => {
    let revision = 4;
    let finishExport: (() => void) | undefined;
    const createPromotionArtifacts = vi.fn(
      () =>
        new Promise<{
          selectedElementIds: string[];
          png: Blob;
          source: Blob;
        }>((resolve) => {
          finishExport = () =>
            resolve({
              selectedElementIds: ["shape_1"],
              png: new Blob(["png"], { type: "image/png" }),
              source: new Blob(["source"], {
                type: "application/vnd.excalidraw+json",
              }),
            });
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
      createPromotionArtifacts,
      setDisplayOptions: () => {},
      setReadOnly: () => {},
      exportScene: async () => new Blob(),
      destroy: () => {},
    };

    render(
      <WhiteboardSurface
        active
        identity={{
          roomId: "room_race",
          participantId: "owner_1",
          token: "secret",
          role: "owner",
        }}
        loadEditorAdapter={async () => ({ mount: async () => controller })}
        loadSession={async () => () => ({
          ...sessionController(),
          currentRevision: () => revision,
        })}
        langCode="en"
        name="Revision race"
      />
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send selection to main conversation",
      })
    );
    revision = 5;
    finishExport?.();

    expect(
      await screen.findByText(
        "The selected whiteboard content could not be prepared."
      )
    ).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
