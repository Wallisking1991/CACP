import {
  WhiteboardMaxAttachments,
  WhiteboardMaxElements,
  type WhiteboardClientUpdateMessage,
  type WhiteboardElement,
  type WhiteboardErrorCode,
  type WhiteboardScene,
} from "@cacp/protocol";

const DEFAULT_UPDATE_LIMIT = 20;
const DEFAULT_UPDATE_WINDOW_MS = 1_000;
const DEFAULT_DEDUPLICATION_LIMIT = 2_000;

export interface WhiteboardSceneStateOptions {
  maxElements?: number;
  maxAttachments?: number;
  updateLimit?: number;
  updateWindowMs?: number;
  deduplicationLimit?: number;
}

export type WhiteboardSceneApplyResult =
  | {
      kind: "accepted";
      replayed: boolean;
      revision: number;
      scene: WhiteboardScene;
    }
  | {
      kind: "rejected";
      code: Extract<
        WhiteboardErrorCode,
        "invalid_message" | "not_synchronized" | "rate_limited"
      >;
      message: string;
      currentRevision: number;
    };

interface DeduplicationRecord {
  fingerprint: string;
  revision: number;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function preferredElement(
  current: WhiteboardElement,
  incoming: WhiteboardElement
): WhiteboardElement {
  if (incoming.version !== current.version) {
    return incoming.version > current.version ? incoming : current;
  }
  if (incoming.versionNonce !== current.versionNonce) {
    return incoming.versionNonce < current.versionNonce ? incoming : current;
  }
  return stableSerialize(incoming) < stableSerialize(current)
    ? incoming
    : current;
}

export function reconcileWhiteboardElements(
  current: readonly WhiteboardElement[],
  incoming: readonly WhiteboardElement[]
): WhiteboardElement[] {
  const merged = [...current];
  const indexes = new Map(
    merged.map((element, index) => [element.id, index] as const)
  );
  for (const element of incoming) {
    const index = indexes.get(element.id);
    if (index === undefined) {
      indexes.set(element.id, merged.length);
      merged.push(element);
      continue;
    }
    merged[index] = preferredElement(merged[index]!, element);
  }
  return merged;
}

function hasDuplicateElementIds(elements: readonly WhiteboardElement[]) {
  return (
    new Set(elements.map((element) => element.id)).size !== elements.length
  );
}

function containsEmbeddedData(value: unknown): boolean {
  if (typeof value === "string") {
    return /^data:/i.test(value.trim());
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsEmbeddedData);
  return Object.values(value as Record<string, unknown>).some(
    containsEmbeddedData
  );
}

function attachmentCount(elements: readonly WhiteboardElement[]) {
  const attachmentIds = new Set<string>();
  for (const element of elements) {
    const fileId = element.fileId;
    if (element.type === "image" && typeof fileId === "string") {
      attachmentIds.add(fileId);
    }
  }
  return attachmentIds.size;
}

export function createWhiteboardSceneState(
  options: WhiteboardSceneStateOptions = {}
) {
  const maxElements = options.maxElements ?? WhiteboardMaxElements;
  const maxAttachments = options.maxAttachments ?? WhiteboardMaxAttachments;
  const updateLimit = options.updateLimit ?? DEFAULT_UPDATE_LIMIT;
  const updateWindowMs = options.updateWindowMs ?? DEFAULT_UPDATE_WINDOW_MS;
  const deduplicationLimit =
    options.deduplicationLimit ?? DEFAULT_DEDUPLICATION_LIMIT;
  let revision = 0;
  let scene: WhiteboardScene = { elements: [], app_state: {} };
  const deduplicationRecords = new Map<string, DeduplicationRecord>();
  const rateWindows = new Map<string, { startedAt: number; updates: number }>();

  function reject(
    code: Extract<
      WhiteboardErrorCode,
      "invalid_message" | "not_synchronized" | "rate_limited"
    >,
    message: string
  ): WhiteboardSceneApplyResult {
    return { kind: "rejected", code, message, currentRevision: revision };
  }

  return {
    snapshot() {
      return { revision, scene };
    },
    apply(
      participantId: string,
      update: WhiteboardClientUpdateMessage,
      now = Date.now()
    ): WhiteboardSceneApplyResult {
      const deduplicationKey = stableSerialize([
        participantId,
        update.update_id,
      ]);
      const fingerprint = stableSerialize(update);
      const previous = deduplicationRecords.get(deduplicationKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          return reject(
            "invalid_message",
            "This whiteboard update identifier was already used for different content."
          );
        }
        return {
          kind: "accepted",
          replayed: true,
          revision: previous.revision,
          scene,
        };
      }

      if (update.base_revision > revision) {
        return reject(
          "not_synchronized",
          "The whiteboard update is based on an unknown future revision."
        );
      }

      const previousWindow = rateWindows.get(participantId);
      const rateWindow =
        !previousWindow || now - previousWindow.startedAt >= updateWindowMs
          ? { startedAt: now, updates: 0 }
          : previousWindow;
      rateWindows.set(participantId, rateWindow);
      if (rateWindow.updates >= updateLimit) {
        return reject(
          "rate_limited",
          "Whiteboard scene updates are arriving too quickly."
        );
      }
      rateWindow.updates += 1;

      if (hasDuplicateElementIds(update.elements)) {
        return reject(
          "invalid_message",
          "A whiteboard update cannot contain duplicate element identifiers."
        );
      }
      if (containsEmbeddedData(update.elements)) {
        return reject(
          "invalid_message",
          "Whiteboard updates cannot embed binary data URLs."
        );
      }

      const elements = reconcileWhiteboardElements(
        scene.elements,
        update.elements
      );
      if (elements.length > maxElements) {
        return reject(
          "invalid_message",
          "The whiteboard contains too many elements."
        );
      }
      if (attachmentCount(elements) > maxAttachments) {
        return reject(
          "invalid_message",
          "The whiteboard contains too many attachment references."
        );
      }

      const updatesCurrentRevision = update.base_revision === revision;
      revision += 1;
      scene = {
        elements,
        app_state: updatesCurrentRevision ? update.app_state : scene.app_state,
      };
      deduplicationRecords.set(deduplicationKey, { fingerprint, revision });
      if (deduplicationRecords.size > deduplicationLimit) {
        const oldestKey = deduplicationRecords.keys().next().value;
        if (oldestKey !== undefined) deduplicationRecords.delete(oldestKey);
      }

      return { kind: "accepted", replayed: false, revision, scene };
    },
  };
}
