import type { AttachmentRef } from "@cacp/protocol";
import {
  deleteAttachment,
  fetchAttachmentBlob,
  uploadAttachment,
  type AttachmentSession,
} from "../attachment-api.js";
import type { WhiteboardScene } from "./whiteboard-editor-adapter.js";

type UploadAttachment = (
  session: AttachmentSession,
  file: File
) => Promise<AttachmentRef>;
type RemoveAttachment = (
  session: AttachmentSession,
  attachmentId: string
) => Promise<void>;
type FetchAttachmentBlob = (
  session: AttachmentSession,
  attachmentId: string
) => Promise<Blob>;

export interface WhiteboardImageAssetManager {
  normalizeLocalScene(
    scene: WhiteboardScene
  ): WhiteboardScene | Promise<WhiteboardScene>;
  hydrateRemoteScene(
    scene: WhiteboardScene
  ): WhiteboardScene | Promise<WhiteboardScene>;
}

export class WhiteboardImageAssetError extends Error {
  constructor(
    readonly code:
      | "whiteboard_image_upload_failed"
      | "whiteboard_image_download_failed"
      | "whiteboard_image_data_missing",
    readonly attachmentId?: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "WhiteboardImageAssetError";
  }
}

interface CreateWhiteboardImageAssetManagerOptions {
  session: AttachmentSession;
  upload?: UploadAttachment;
  remove?: RemoveAttachment;
  fetchBlob?: FetchAttachmentBlob;
}

function liveImageFileIds(scene: WhiteboardScene): string[] {
  const ids = new Set<string>();
  for (const element of scene.elements) {
    if (!element || typeof element !== "object") continue;
    const value = element as Record<string, unknown>;
    if (
      value.type === "image" &&
      value.isDeleted !== true &&
      typeof value.fileId === "string"
    ) {
      ids.add(value.fileId);
    }
  }
  return [...ids];
}

function binaryFile(
  scene: WhiteboardScene,
  fileId: string
): Record<string, unknown> | undefined {
  const value = scene.files[fileId];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function dataUrlBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/u.exec(dataUrl);
  if (!match) throw new Error("invalid_data_url");
  const mediaType = match[1] || "application/octet-stream";
  const encoded = match[3] ?? "";
  if (match[2]) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mediaType });
  }
  return new Blob([decodeURIComponent(encoded)], { type: mediaType });
}

function fileExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/gif") return "gif";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("file_read_failed"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("file_read_failed"));
    reader.readAsDataURL(blob);
  });
}

function remapSceneFiles(
  scene: WhiteboardScene,
  replacements: ReadonlyMap<string, string>
): WhiteboardScene {
  if (replacements.size === 0) return scene;
  const elements = scene.elements.map((element) => {
    if (!element || typeof element !== "object") return element;
    const value = element as Record<string, unknown>;
    const nextFileId =
      typeof value.fileId === "string"
        ? replacements.get(value.fileId)
        : undefined;
    return nextFileId
      ? { ...value, fileId: nextFileId, status: "saved" }
      : element;
  });
  const files = { ...scene.files };
  for (const [localId, attachmentId] of replacements) {
    const local = binaryFile(scene, localId);
    delete files[localId];
    if (local) {
      files[attachmentId] = { ...local, id: attachmentId };
    }
  }
  return { elements, appState: scene.appState, files };
}

export function createWhiteboardImageAssetManager({
  session,
  upload = uploadAttachment,
  remove = deleteAttachment,
  fetchBlob = fetchAttachmentBlob,
}: CreateWhiteboardImageAssetManagerOptions): WhiteboardImageAssetManager {
  const localAttachmentIds = new Map<string, string>();
  const confirmedAttachmentIds = new Set<string>();
  const retiredAttachmentIds = new Set<string>();
  return {
    normalizeLocalScene(scene) {
      const liveIds = liveImageFileIds(scene);
      const liveIdSet = new Set(liveIds);
      for (const attachmentId of confirmedAttachmentIds) {
        if (!liveIdSet.has(attachmentId)) {
          confirmedAttachmentIds.delete(attachmentId);
          retiredAttachmentIds.add(attachmentId);
        }
      }
      for (const localId of localAttachmentIds.keys()) {
        if (!liveIdSet.has(localId)) localAttachmentIds.delete(localId);
      }
      const localIds = liveIds.filter(
        (fileId) => !confirmedAttachmentIds.has(fileId)
      );
      if (localIds.length === 0) return scene;
      const replacements = new Map<string, string>();
      const pendingIds: string[] = [];
      for (const localId of localIds) {
        const attachmentId = localAttachmentIds.get(localId);
        if (attachmentId) {
          replacements.set(localId, attachmentId);
          confirmedAttachmentIds.add(attachmentId);
        } else pendingIds.push(localId);
      }
      if (pendingIds.length === 0) return remapSceneFiles(scene, replacements);
      return (async () => {
        const uploaded: string[] = [];
        const completed = new Map<string, string>();
        try {
          for (const localId of pendingIds) {
            const local = binaryFile(scene, localId);
            if (!local || typeof local.dataURL !== "string") {
              throw new WhiteboardImageAssetError(
                "whiteboard_image_data_missing",
                localId
              );
            }
            const dataURL = local.dataURL;
            if (
              localId.startsWith("att_") &&
              !retiredAttachmentIds.has(localId)
            ) {
              try {
                await fetchBlob(session, localId);
                confirmedAttachmentIds.add(localId);
                continue;
              } catch {
                // A deleted or imported attachment id must be uploaded again.
              }
            }
            const blob = dataUrlBlob(dataURL);
            const mediaType =
              typeof local.mimeType === "string" && local.mimeType
                ? local.mimeType
                : blob.type;
            const attachment = await upload(
              session,
              new File(
                [blob],
                `whiteboard-${localId}.${fileExtension(mediaType)}`,
                { type: mediaType }
              )
            );
            uploaded.push(attachment.attachment_id);
            replacements.set(localId, attachment.attachment_id);
            completed.set(localId, attachment.attachment_id);
          }
          for (const [localId, attachmentId] of completed) {
            localAttachmentIds.set(localId, attachmentId);
            confirmedAttachmentIds.add(attachmentId);
            retiredAttachmentIds.delete(attachmentId);
          }
          return remapSceneFiles(scene, replacements);
        } catch (cause) {
          await Promise.allSettled(
            uploaded.map((attachmentId) => remove(session, attachmentId))
          );
          if (cause instanceof WhiteboardImageAssetError) throw cause;
          throw new WhiteboardImageAssetError(
            "whiteboard_image_upload_failed",
            undefined,
            { cause }
          );
        }
      })();
    },

    hydrateRemoteScene(scene) {
      const liveIds = liveImageFileIds(scene);
      const liveIdSet = new Set(liveIds);
      for (const attachmentId of confirmedAttachmentIds) {
        if (!liveIdSet.has(attachmentId)) {
          confirmedAttachmentIds.delete(attachmentId);
          retiredAttachmentIds.add(attachmentId);
        }
      }
      const missingIds = liveIds.filter((fileId) => {
        const file = binaryFile(scene, fileId);
        return typeof file?.dataURL !== "string";
      });
      if (missingIds.length === 0) {
        for (const attachmentId of liveIds) {
          confirmedAttachmentIds.add(attachmentId);
          retiredAttachmentIds.delete(attachmentId);
        }
        return scene;
      }
      return (async () => {
        const files = { ...scene.files };
        for (const attachmentId of missingIds) {
          try {
            const blob = await fetchBlob(session, attachmentId);
            files[attachmentId] = {
              id: attachmentId,
              mimeType: blob.type || "application/octet-stream",
              dataURL: await blobDataUrl(blob),
              created: Date.now(),
              lastRetrieved: Date.now(),
            };
            confirmedAttachmentIds.add(attachmentId);
            retiredAttachmentIds.delete(attachmentId);
          } catch (cause) {
            throw new WhiteboardImageAssetError(
              "whiteboard_image_download_failed",
              attachmentId,
              { cause }
            );
          }
        }
        return { ...scene, files };
      })();
    },
  };
}
