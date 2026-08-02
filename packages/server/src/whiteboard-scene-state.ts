import { Buffer } from "node:buffer";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  WhiteboardMaxAttachments,
  WhiteboardMaxElements,
  type WhiteboardClientUpdateMessage,
  type WhiteboardElement,
  type WhiteboardErrorCode,
  type WhiteboardScene,
  type WhiteboardSnapshot,
} from "@cacp/protocol";

const DEFAULT_UPDATE_LIMIT = 20;
const DEFAULT_UPDATE_WINDOW_MS = 1_000;
const DEFAULT_DEDUPLICATION_LIMIT = 2_000;
const DEFAULT_MAX_SCENE_BYTES = 4 * 1024 * 1024;
const MAX_STRUCTURED_DEPTH = 32;
const DEFAULT_SNAPSHOT_CADENCE_MS = 30_000;
const DEFAULT_SNAPSHOT_COUNT = 20;
const DEFAULT_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface WhiteboardSceneStateOptions {
  maxElements?: number;
  maxAttachments?: number;
  maxSceneBytes?: number;
  updateLimit?: number;
  updateWindowMs?: number;
  deduplicationLimit?: number;
  snapshotCadenceMs?: number;
  maxSnapshotCount?: number;
  maxSnapshotBytes?: number;
  commitScene?: (
    scene: WhiteboardScene,
    participantId: string
  ) => string | undefined;
  commitSnapshotAttachments?: (
    attachmentIds: string[],
    participantId: string
  ) => string | undefined;
}

export type WhiteboardSceneMutationResult =
  | {
      kind: "accepted";
      revision: number;
      previousRevision: number;
      targetRevision?: number;
      scene: WhiteboardScene;
    }
  | {
      kind: "rejected";
      code:
        | "stale_revision"
        | "snapshot_not_found"
        | "snapshot_unavailable"
        | "invalid_message";
      message: string;
      currentRevision: number;
    };

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

interface StoredWhiteboardSnapshot {
  metadata: WhiteboardSnapshot;
  compressedScene: Buffer;
  attachmentIds: string[];
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

function inspectStructuredValue(value: unknown): {
  embeddedData: boolean;
  invalidStructure: boolean;
} {
  const stack = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();
  let embeddedData = false;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === "string") {
      if (/^data:/i.test(current.value.trim())) embeddedData = true;
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (current.depth > MAX_STRUCTURED_DEPTH || visited.has(current.value)) {
      return { embeddedData, invalidStructure: true };
    }
    visited.add(current.value);
    for (const child of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return { embeddedData, invalidStructure: false };
}

export function whiteboardAttachmentIds(
  elements: readonly WhiteboardElement[]
): string[] {
  const attachmentIds = new Set<string>();
  for (const element of elements) {
    const fileId = element.fileId;
    if (
      element.type === "image" &&
      element.isDeleted !== true &&
      typeof fileId === "string"
    ) {
      attachmentIds.add(fileId);
    }
  }
  return [...attachmentIds];
}

export function createWhiteboardSceneState(
  options: WhiteboardSceneStateOptions = {}
) {
  const maxElements = Math.min(
    options.maxElements ?? WhiteboardMaxElements,
    WhiteboardMaxElements
  );
  const maxAttachments = options.maxAttachments ?? WhiteboardMaxAttachments;
  const maxSceneBytes = options.maxSceneBytes ?? DEFAULT_MAX_SCENE_BYTES;
  const updateLimit = options.updateLimit ?? DEFAULT_UPDATE_LIMIT;
  const updateWindowMs = options.updateWindowMs ?? DEFAULT_UPDATE_WINDOW_MS;
  const deduplicationLimit =
    options.deduplicationLimit ?? DEFAULT_DEDUPLICATION_LIMIT;
  const snapshotCadenceMs =
    options.snapshotCadenceMs ?? DEFAULT_SNAPSHOT_CADENCE_MS;
  const maxSnapshotCount = Math.max(
    1,
    options.maxSnapshotCount ?? DEFAULT_SNAPSHOT_COUNT
  );
  const maxSnapshotBytes = Math.max(
    1,
    options.maxSnapshotBytes ?? DEFAULT_SNAPSHOT_BYTES
  );
  let revision = 0;
  let scene: WhiteboardScene = { elements: [], app_state: {} };
  let snapshotSequence = 0;
  let lastAutomaticSnapshotAt: number | undefined;
  let snapshots: StoredWhiteboardSnapshot[] = [];
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

  function consumeRateAttempt(
    participantId: string,
    now: number
  ): WhiteboardSceneApplyResult | undefined {
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
    return undefined;
  }

  function snapshotAttachmentIds(): string[] {
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      for (const attachmentId of snapshot.attachmentIds) ids.add(attachmentId);
    }
    return [...ids];
  }

  function captureSnapshot(
    reason: WhiteboardSnapshot["reason"],
    participantId: string,
    now: number,
    protectedAttachmentIds: readonly string[] = []
  ): boolean {
    const compressedScene = gzipSync(Buffer.from(stableSerialize(scene)));
    if (compressedScene.byteLength > maxSnapshotBytes) return false;
    const previousSnapshots = snapshots;
    const next: StoredWhiteboardSnapshot = {
      metadata: {
        snapshot_id: `snapshot_${++snapshotSequence}`,
        revision,
        created_at: new Date(now).toISOString(),
        reason,
        element_count: scene.elements.filter(
          (element) => element.isDeleted !== true
        ).length,
        compressed_bytes: compressedScene.byteLength,
      },
      compressedScene,
      attachmentIds: whiteboardAttachmentIds(scene.elements),
    };
    snapshots = [...snapshots, next];
    let totalBytes = snapshots.reduce(
      (total, snapshot) => total + snapshot.compressedScene.byteLength,
      0
    );
    while (
      snapshots.length > maxSnapshotCount ||
      totalBytes > maxSnapshotBytes
    ) {
      const removed = snapshots.shift();
      if (!removed) break;
      totalBytes -= removed.compressedScene.byteLength;
    }
    try {
      const rejection = options.commitSnapshotAttachments?.(
        [...new Set([...snapshotAttachmentIds(), ...protectedAttachmentIds])],
        participantId
      );
      if (rejection) throw new Error(rejection);
    } catch {
      snapshots = previousSnapshots;
      snapshotSequence -= 1;
      try {
        options.commitSnapshotAttachments?.(
          snapshotAttachmentIds(),
          participantId
        );
      } catch {
        // The authoritative scene remains valid even if recovery retention fails.
      }
      return false;
    }
    if (reason === "automatic") lastAutomaticSnapshotAt = now;
    return true;
  }

  function mutationRejection(
    code: Extract<WhiteboardSceneMutationResult, { kind: "rejected" }>["code"],
    message: string
  ): WhiteboardSceneMutationResult {
    return { kind: "rejected", code, message, currentRevision: revision };
  }

  function commitMutation(
    participantId: string,
    nextScene: WhiteboardScene,
    expectedRevision: number,
    now: number,
    targetRevision?: number
  ): WhiteboardSceneMutationResult {
    if (expectedRevision !== revision) {
      return mutationRejection(
        "stale_revision",
        "The whiteboard changed after this operation was confirmed."
      );
    }
    const protectedAttachmentIds = whiteboardAttachmentIds(nextScene.elements);
    if (
      !captureSnapshot(
        "pre_operation",
        participantId,
        now,
        protectedAttachmentIds
      )
    ) {
      return mutationRejection(
        "snapshot_unavailable",
        "The current whiteboard could not be retained within the recovery budget."
      );
    }
    try {
      const commitRejection = options.commitScene?.(nextScene, participantId);
      if (commitRejection) {
        return mutationRejection("invalid_message", commitRejection);
      }
    } catch {
      return mutationRejection(
        "invalid_message",
        "The whiteboard scene references could not be committed."
      );
    }
    const previousRevision = revision;
    revision += 1;
    scene = nextScene;
    try {
      options.commitSnapshotAttachments?.(
        snapshotAttachmentIds(),
        participantId
      );
    } catch {
      // Extra recovery references are safe and are retried on the next capture.
    }
    deduplicationRecords.clear();
    rateWindows.clear();
    return {
      kind: "accepted",
      revision,
      previousRevision,
      ...(targetRevision !== undefined ? { targetRevision } : {}),
      scene,
    };
  }

  return {
    snapshot() {
      return { revision, scene };
    },
    listSnapshots(): WhiteboardSnapshot[] {
      return snapshots.map((snapshot) => snapshot.metadata).reverse();
    },
    clear(
      participantId: string,
      expectedRevision: number,
      now = Date.now()
    ): WhiteboardSceneMutationResult {
      return commitMutation(
        participantId,
        { elements: [], app_state: {} },
        expectedRevision,
        now
      );
    },
    restore(
      participantId: string,
      snapshotId: string,
      expectedRevision: number,
      now = Date.now()
    ): WhiteboardSceneMutationResult {
      if (expectedRevision !== revision) {
        return mutationRejection(
          "stale_revision",
          "The whiteboard changed after this operation was confirmed."
        );
      }
      const target = snapshots.find(
        (snapshot) => snapshot.metadata.snapshot_id === snapshotId
      );
      if (!target) {
        return mutationRejection(
          "snapshot_not_found",
          "This temporary whiteboard snapshot is no longer available."
        );
      }
      const restoredScene = JSON.parse(
        gunzipSync(target.compressedScene).toString("utf8")
      ) as WhiteboardScene;
      return commitMutation(
        participantId,
        restoredScene,
        expectedRevision,
        now,
        target.metadata.revision
      );
    },
    consumeInvalidAttempt(participantId: string, now = Date.now()) {
      return consumeRateAttempt(participantId, now);
    },
    apply(
      participantId: string,
      update: WhiteboardClientUpdateMessage,
      now = Date.now()
    ): WhiteboardSceneApplyResult {
      const structure = inspectStructuredValue(update);
      if (structure.invalidStructure) {
        return (
          consumeRateAttempt(participantId, now) ??
          reject(
            "invalid_message",
            "The whiteboard update is nested too deeply or contains a cycle."
          )
        );
      }

      const deduplicationKey = stableSerialize([
        participantId,
        update.update_id,
      ]);
      const fingerprint = stableSerialize(update);
      const previous = deduplicationRecords.get(deduplicationKey);
      if (previous?.fingerprint === fingerprint) {
        return {
          kind: "accepted",
          replayed: true,
          revision: previous.revision,
          scene,
        };
      }

      const rateRejection = consumeRateAttempt(participantId, now);
      if (rateRejection) return rateRejection;

      if (previous) {
        return reject(
          "invalid_message",
          "This whiteboard update identifier was already used for different content."
        );
      }

      if (update.base_revision > revision) {
        return reject(
          "not_synchronized",
          "The whiteboard update is based on an unknown future revision."
        );
      }

      if (hasDuplicateElementIds(update.elements)) {
        return reject(
          "invalid_message",
          "A whiteboard update cannot contain duplicate element identifiers."
        );
      }
      if (structure.embeddedData) {
        return reject(
          "invalid_message",
          "Whiteboard updates cannot embed binary data URLs."
        );
      }

      const previousSceneFingerprint = stableSerialize(scene);
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
      if (whiteboardAttachmentIds(elements).length > maxAttachments) {
        return reject(
          "invalid_message",
          "The whiteboard contains too many attachment references."
        );
      }

      const updatesCurrentRevision = update.base_revision === revision;
      const nextScene: WhiteboardScene = {
        elements,
        app_state: updatesCurrentRevision ? update.app_state : scene.app_state,
      };
      if (
        new TextEncoder().encode(stableSerialize(nextScene)).byteLength >
        maxSceneBytes
      ) {
        return reject("invalid_message", "The whiteboard scene is too large.");
      }
      try {
        const commitRejection = options.commitScene?.(nextScene, participantId);
        if (commitRejection) {
          return reject("invalid_message", commitRejection);
        }
      } catch {
        return reject(
          "invalid_message",
          "The whiteboard scene references could not be committed."
        );
      }
      revision += 1;
      scene = nextScene;
      deduplicationRecords.set(deduplicationKey, { fingerprint, revision });
      if (deduplicationRecords.size > deduplicationLimit) {
        const oldestKey = deduplicationRecords.keys().next().value;
        if (oldestKey !== undefined) deduplicationRecords.delete(oldestKey);
      }

      if (
        stableSerialize(scene) !== previousSceneFingerprint &&
        (lastAutomaticSnapshotAt === undefined ||
          now - lastAutomaticSnapshotAt >= snapshotCadenceMs)
      ) {
        captureSnapshot("automatic", participantId, now);
      }

      return { kind: "accepted", replayed: false, revision, scene };
    },
  };
}
