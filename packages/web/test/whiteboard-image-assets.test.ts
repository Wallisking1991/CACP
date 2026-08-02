import { describe, expect, it, vi } from "vitest";
import {
  createWhiteboardImageAssetManager,
  WhiteboardImageAssetError,
} from "../src/whiteboard/whiteboard-image-assets.js";
import type { WhiteboardScene } from "../src/whiteboard/whiteboard-editor-adapter.js";

const PixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function localImageScene(fileId = "file_local"): WhiteboardScene {
  return {
    elements: [
      {
        id: "image_1",
        type: "image",
        version: 1,
        versionNonce: 1,
        fileId,
        status: "saved",
      },
    ],
    appState: {},
    files: {
      [fileId]: {
        id: fileId,
        mimeType: "image/png",
        dataURL: PixelDataUrl,
        created: 1,
      },
    },
  };
}

describe("whiteboard image assets", () => {
  it("uploads local Excalidraw files and rewrites the scene to room attachment ids", async () => {
    const upload = vi.fn(async (_session, file: File) => {
      expect(file.type).toBe("image/png");
      expect(file.size).toBeGreaterThan(0);
      return {
        attachment_id: "att_uploaded",
        name: file.name,
        media_type: file.type,
        size_bytes: file.size,
        sha256: "a".repeat(64),
        kind: "image" as const,
        disposition: "inline" as const,
      };
    });
    const manager = createWhiteboardImageAssetManager({
      session: { room_id: "room_1", token: "secret" },
      upload,
      remove: vi.fn(),
      fetchBlob: vi.fn(),
    });
    const source = localImageScene();

    const normalized = await manager.normalizeLocalScene(source);

    expect(upload).toHaveBeenCalledOnce();
    expect(normalized.elements).toEqual([
      expect.objectContaining({
        id: "image_1",
        fileId: "att_uploaded",
        status: "saved",
      }),
    ]);
    expect(normalized.files).toEqual({
      att_uploaded: expect.objectContaining({
        id: "att_uploaded",
        dataURL: PixelDataUrl,
      }),
    });
    expect(source).toEqual(localImageScene());
  });

  it("cleans successful partial uploads when a later local image fails", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att_first",
        name: "first.png",
        media_type: "image/png",
        size_bytes: 1,
        sha256: "a".repeat(64),
        kind: "image",
        disposition: "inline",
      })
      .mockRejectedValueOnce(new Error("upload failed"));
    const remove = vi.fn(async () => {});
    const manager = createWhiteboardImageAssetManager({
      session: { room_id: "room_1", token: "secret" },
      upload,
      remove,
      fetchBlob: vi.fn(),
    });
    const first = localImageScene("file_first");
    const second = localImageScene("file_second");
    const scene: WhiteboardScene = {
      elements: [...first.elements, ...second.elements],
      appState: {},
      files: { ...first.files, ...second.files },
    };

    await expect(manager.normalizeLocalScene(scene)).rejects.toBeInstanceOf(
      WhiteboardImageAssetError
    );
    expect(remove).toHaveBeenCalledWith(
      { room_id: "room_1", token: "secret" },
      "att_first"
    );
  });

  it("hydrates protected room attachments into self-contained Excalidraw files", async () => {
    const fetchBlob = vi.fn(async () =>
      Promise.resolve(new Blob(["pixels"], { type: "image/png" }))
    );
    const manager = createWhiteboardImageAssetManager({
      session: { room_id: "room_1", token: "secret" },
      upload: vi.fn(),
      remove: vi.fn(),
      fetchBlob,
    });
    const scene: WhiteboardScene = {
      elements: [
        {
          id: "image_1",
          type: "image",
          version: 1,
          versionNonce: 1,
          fileId: "att_shared",
        },
      ],
      appState: {},
      files: {},
    };

    const hydrated = await manager.hydrateRemoteScene(scene);

    expect(fetchBlob).toHaveBeenCalledWith(
      { room_id: "room_1", token: "secret" },
      "att_shared"
    );
    expect(hydrated.files).toEqual({
      att_shared: expect.objectContaining({
        id: "att_shared",
        mimeType: "image/png",
        dataURL: expect.stringMatching(/^data:image\/png;base64,/u),
      }),
    });
  });

  it("reuploads a deleted attachment when local undo restores its image", async () => {
    const upload = vi
      .fn()
      .mockImplementationOnce(async (_session, file: File) => ({
        attachment_id: "att_first",
        name: file.name,
        media_type: file.type,
        size_bytes: file.size,
        sha256: "a".repeat(64),
        kind: "image" as const,
        disposition: "inline" as const,
      }))
      .mockImplementationOnce(async (_session, file: File) => ({
        attachment_id: "att_restored",
        name: file.name,
        media_type: file.type,
        size_bytes: file.size,
        sha256: "b".repeat(64),
        kind: "image" as const,
        disposition: "inline" as const,
      }));
    const fetchBlob = vi.fn(async () => {
      throw new Error("attachment_not_found");
    });
    const manager = createWhiteboardImageAssetManager({
      session: { room_id: "room_1", token: "secret" },
      upload,
      remove: vi.fn(),
      fetchBlob,
    });

    const first = await manager.normalizeLocalScene(localImageScene());
    expect((first.elements[0] as { fileId: string }).fileId).toBe("att_first");
    await manager.normalizeLocalScene({
      elements: [],
      appState: {},
      files: first.files,
    });
    const restored = await manager.normalizeLocalScene(
      localImageScene("att_first")
    );

    expect(fetchBlob).toHaveBeenCalledWith(
      { room_id: "room_1", token: "secret" },
      "att_first"
    );
    expect(upload).toHaveBeenCalledTimes(2);
    expect((restored.elements[0] as { fileId: string }).fileId).toBe(
      "att_restored"
    );
  });

  it("remaps an imported self-contained attachment id to this room", async () => {
    const upload = vi.fn(async (_session, file: File) => ({
      attachment_id: "att_imported_copy",
      name: file.name,
      media_type: file.type,
      size_bytes: file.size,
      sha256: "c".repeat(64),
      kind: "image" as const,
      disposition: "inline" as const,
    }));
    const manager = createWhiteboardImageAssetManager({
      session: { room_id: "room_1", token: "secret" },
      upload,
      remove: vi.fn(),
      fetchBlob: vi.fn(async () => {
        throw new Error("attachment_not_found");
      }),
    });

    const imported = await manager.normalizeLocalScene(
      localImageScene("att_from_another_room")
    );

    expect(upload).toHaveBeenCalledOnce();
    expect((imported.elements[0] as { fileId: string }).fileId).toBe(
      "att_imported_copy"
    );
  });
});
