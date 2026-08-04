import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  WhiteboardClientMessageSchema,
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
  type WhiteboardCollaborator,
  type WhiteboardClientPresenceMessage,
  type WhiteboardErrorCode,
  type WhiteboardHumanRole,
  type WhiteboardScene,
  type WhiteboardSnapshot,
} from "@cacp/protocol";
import {
  createWhiteboardSceneState,
  type WhiteboardSceneMutationResult,
} from "./whiteboard-scene-state.js";

interface WhiteboardSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
}

interface WhiteboardConnection {
  participantId: string;
  displayName: string;
  color: WhiteboardCollaborator["color"];
  resolveRole: () => WhiteboardHumanRole | undefined;
  socket: WhiteboardSocket;
  observeOnly: boolean;
  handoffReserved: boolean;
  active: boolean;
  lastSeenAt: number;
  presenceVersion: number;
  lastCanEdit?: boolean;
  presence?: Pick<
    WhiteboardClientPresenceMessage,
    "cursor" | "selected_element_ids" | "viewport"
  >;
}

interface WhiteboardRoomState {
  sceneState: ReturnType<typeof createWhiteboardSceneState>;
  connections: Set<WhiteboardConnection>;
  handoffParticipants: Set<string>;
  presenceSequence: number;
  presenceRateWindows: Map<string, { startedAt: number; updates: number }>;
  inboundMessageRateWindows: Map<
    string,
    { startedAt: number; updates: number }
  >;
  replayLookupRateWindows: Map<string, { startedAt: number; updates: number }>;
  acceptedFrameAcks: Map<string, { updateId: string; revision: number }>;
  ended: boolean;
}

export interface WhiteboardConnectInput {
  roomId: string;
  participantId: string;
  displayName: string;
  role: WhiteboardHumanRole;
  resolveRole: () => WhiteboardHumanRole | undefined;
  socket: WhiteboardSocket;
  observeOnly?: boolean;
}

export interface WhiteboardSessionHub {
  connect(input: WhiteboardConnectInput): () => void;
  reserveObserverHandoff(
    roomId: string,
    participantId: string
  ):
    | {
        complete(): void;
        release(): void;
      }
    | undefined;
  discardRoom(roomId: string): void;
  listSnapshots(roomId: string): {
    currentRevision: number;
    snapshots: WhiteboardSnapshot[];
  };
  snapshot(roomId: string): { revision: number; scene: WhiteboardScene };
  clear(
    roomId: string,
    participantId: string,
    expectedRevision: number
  ): WhiteboardSceneMutationResult;
  restore(
    roomId: string,
    participantId: string,
    snapshotId: string,
    expectedRevision: number
  ): WhiteboardSceneMutationResult;
  close(): void;
}

interface WhiteboardHubOptions {
  maxMessageBytes: number;
  presenceHeartbeatMs: number;
  presenceTtlMs: number;
  presenceSweepMs: number;
  presenceUpdateLimit: number;
  presenceWindowMs: number;
  sceneUpdateLimit: number;
  sceneWindowMs: number;
  inboundMessageLimit: number;
  inboundMessageWindowMs: number;
  maxElements: number;
  maxAttachments: number;
  maxSceneBytes: number;
  deduplicationLimit: number;
  snapshotCadenceMs: number;
  snapshotMaxCount: number;
  snapshotMaxBytes: number;
  onDiagnostic?: (event: WhiteboardHubDiagnostic) => void;
  commitScene?: (input: {
    roomId: string;
    participantId: string;
    scene: WhiteboardScene;
  }) => string | undefined;
  commitSnapshotAttachments?: (input: {
    roomId: string;
    participantId: string;
    attachmentIds: string[];
  }) => string | undefined;
}

export interface WhiteboardHubDiagnostic {
  action:
    | "server_update_accepted"
    | "server_update_rejected"
    | "server_broadcast_completed";
  roomId: string;
  participantId: string;
  updateId: string;
  baseRevision: number;
  revision?: number;
  currentRevision?: number;
  elementCount: number;
  editorPeerCount?: number;
  observerPeerCount?: number;
  deliveredPeerCount?: number;
  failedPeerCount?: number;
  reason?: string;
}

const collaboratorColors: readonly WhiteboardCollaborator["color"][] = [
  { background: "#dbeafe", stroke: "#2563eb" },
  { background: "#dcfce7", stroke: "#16a34a" },
  { background: "#fef3c7", stroke: "#d97706" },
  { background: "#fce7f3", stroke: "#db2777" },
  { background: "#ede9fe", stroke: "#7c3aed" },
  { background: "#cffafe", stroke: "#0891b2" },
  { background: "#fee2e2", stroke: "#dc2626" },
  { background: "#e0e7ff", stroke: "#4f46e5" },
];

function messageText(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  return undefined;
}

function messageByteLength(data: unknown): number | undefined {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return undefined;
}

function messageFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("base64url");
}

function acceptedFrameKey(participantId: string, fingerprint: string): string {
  return JSON.stringify([participantId, fingerprint]);
}

function stableCollaboratorColor(
  participantId: string
): WhiteboardCollaborator["color"] {
  let hash = 0;
  for (const character of participantId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return collaboratorColors[hash % collaboratorColors.length]!;
}

export function whiteboardErrorMessage(
  roomId: string,
  code: WhiteboardErrorCode,
  message: string,
  recoverable: boolean,
  details: {
    updateId?: string;
    currentRevision?: number;
  } = {}
) {
  return {
    protocol: WhiteboardProtocolName,
    version: WhiteboardProtocolVersion,
    room_id: roomId,
    type: "whiteboard.error" as const,
    code,
    message,
    recoverable,
    ...(details.updateId ? { update_id: details.updateId } : {}),
    ...(details.currentRevision !== undefined
      ? { current_revision: details.currentRevision }
      : {}),
  };
}

export function createWhiteboardSessionHub(
  options: WhiteboardHubOptions
): WhiteboardSessionHub {
  const rooms = new Map<string, WhiteboardRoomState>();

  function sendSafely(
    state: WhiteboardRoomState,
    connection: WhiteboardConnection,
    data: string
  ): boolean {
    try {
      connection.socket.send(data);
      return true;
    } catch {
      connection.active = false;
      connection.presence = undefined;
      state.connections.delete(connection);
      return false;
    }
  }

  function collaboratorFor(
    connection: WhiteboardConnection
  ): WhiteboardCollaborator {
    const role = connection.resolveRole();
    return {
      participant_id: connection.participantId,
      display_name: connection.displayName,
      color: connection.color,
      can_edit: role !== undefined && role !== "observer",
      ...(connection.presence ?? {}),
    };
  }

  function activeCollaborators(
    state: WhiteboardRoomState
  ): WhiteboardCollaborator[] {
    const latest = new Map<string, WhiteboardConnection>();
    for (const connection of state.connections) {
      if (!connection.active) continue;
      const existing = latest.get(connection.participantId);
      if (!existing || existing.presenceVersion <= connection.presenceVersion) {
        latest.set(connection.participantId, connection);
      }
    }
    return [...latest.values()].map(collaboratorFor);
  }

  function authoritativePresence(
    state: WhiteboardRoomState,
    participantId: string
  ): WhiteboardConnection | undefined {
    let authoritative: WhiteboardConnection | undefined;
    for (const candidate of state.connections) {
      if (!candidate.active || candidate.participantId !== participantId) {
        continue;
      }
      if (
        !authoritative ||
        authoritative.presenceVersion <= candidate.presenceVersion
      ) {
        authoritative = candidate;
      }
    }
    return authoritative;
  }

  function sendPresenceUpdated(
    roomId: string,
    state: WhiteboardRoomState,
    connection: WhiteboardConnection
  ) {
    const message = JSON.stringify({
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: roomId,
      type: "whiteboard.presence.updated",
      collaborator: collaboratorFor(connection),
    });
    for (const peer of state.connections) {
      sendSafely(state, peer, message);
    }
  }

  function sendPresenceLeft(
    roomId: string,
    state: WhiteboardRoomState,
    participantId: string
  ) {
    const replacement = authoritativePresence(state, participantId);
    if (replacement) {
      sendPresenceUpdated(roomId, state, replacement);
      return;
    }
    const message = JSON.stringify({
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: roomId,
      type: "whiteboard.presence.left",
      participant_id: participantId,
    });
    for (const peer of state.connections) sendSafely(state, peer, message);
  }

  function deactivatePresence(
    roomId: string,
    state: WhiteboardRoomState,
    connection: WhiteboardConnection
  ) {
    if (!connection.active) return;
    connection.active = false;
    connection.presence = undefined;
    sendPresenceLeft(roomId, state, connection.participantId);
  }

  function roomState(roomId: string): WhiteboardRoomState {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const created: WhiteboardRoomState = {
      sceneState: createWhiteboardSceneState({
        updateLimit: options.sceneUpdateLimit,
        updateWindowMs: options.sceneWindowMs,
        maxElements: options.maxElements,
        maxAttachments: options.maxAttachments,
        maxSceneBytes: options.maxSceneBytes,
        deduplicationLimit: options.deduplicationLimit,
        snapshotCadenceMs: options.snapshotCadenceMs,
        maxSnapshotCount: options.snapshotMaxCount,
        maxSnapshotBytes: options.snapshotMaxBytes,
        commitScene: (scene, participantId) =>
          options.commitScene?.({ roomId, participantId, scene }),
        commitSnapshotAttachments: (attachmentIds, participantId) =>
          options.commitSnapshotAttachments?.({
            roomId,
            participantId,
            attachmentIds,
          }),
      }),
      connections: new Set(),
      handoffParticipants: new Set(),
      presenceSequence: 0,
      presenceRateWindows: new Map(),
      inboundMessageRateWindows: new Map(),
      replayLookupRateWindows: new Map(),
      acceptedFrameAcks: new Map(),
      ended: false,
    };
    rooms.set(roomId, created);
    return created;
  }

  function broadcastAuthoritativeScene(
    roomId: string,
    state: WhiteboardRoomState,
    participantId: string,
    result: Extract<WhiteboardSceneMutationResult, { kind: "accepted" }>,
    replacementReason: "clear" | "restore"
  ) {
    const base = {
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: roomId,
    };
    const sceneMessage = JSON.stringify({
      ...base,
      type: "whiteboard.scene",
      revision: result.revision,
      scene: result.scene,
      replacement_reason: replacementReason,
    });
    const activityMessage = JSON.stringify({
      ...base,
      type: "whiteboard.scene.activity",
      participant_id: participantId,
      revision: result.revision,
    });
    for (const connection of state.connections) {
      sendSafely(
        state,
        connection,
        connection.observeOnly ? activityMessage : sceneMessage
      );
    }
  }

  function connect(input: WhiteboardConnectInput): () => void {
    const state = roomState(input.roomId);
    const connection: WhiteboardConnection = {
      participantId: input.participantId,
      displayName: input.displayName,
      color: stableCollaboratorColor(input.participantId),
      resolveRole: input.resolveRole,
      socket: input.socket,
      observeOnly: input.observeOnly ?? false,
      handoffReserved: false,
      active: false,
      lastSeenAt: Date.now(),
      presenceVersion: 0,
    };
    state.connections.add(connection);
    const base = {
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: input.roomId,
    };

    input.socket.send(
      JSON.stringify({
        ...base,
        type: "whiteboard.connected",
        participant_id: input.participantId,
        role: input.role,
        can_edit: input.role !== "observer",
        observe_only: connection.observeOnly,
        presence_heartbeat_ms: options.presenceHeartbeatMs,
      })
    );
    if (!connection.observeOnly) {
      const snapshot = state.sceneState.snapshot();
      input.socket.send(
        JSON.stringify({
          ...base,
          type: "whiteboard.scene",
          revision: snapshot.revision,
          scene: snapshot.scene,
        })
      );
    }
    input.socket.send(
      JSON.stringify({
        ...base,
        type: "whiteboard.presence.snapshot",
        collaborators: activeCollaborators(state),
      })
    );
    const sendInvalidAttempt = (message: string) => {
      const rateResult = state.sceneState.consumeInvalidAttempt(
        input.participantId
      );
      const rejection =
        rateResult?.kind === "rejected" ? rateResult : undefined;
      input.socket.send(
        JSON.stringify(
          whiteboardErrorMessage(
            input.roomId,
            rejection?.code ?? "invalid_message",
            rejection?.message ?? message,
            true,
            rejection
              ? { currentRevision: rejection.currentRevision }
              : undefined
          )
        )
      );
    };
    input.socket.on("message", (data) => {
      if (state.ended) {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "room_ended",
              "This Live Room has ended.",
              false
            )
          )
        );
        return;
      }
      const now = Date.now();
      const byteLength = messageByteLength(data);
      const validEnvelope =
        byteLength !== undefined && byteLength <= options.maxMessageBytes;
      const previousEnvelope = state.inboundMessageRateWindows.get(
        input.participantId
      );
      const envelope =
        !previousEnvelope ||
        now - previousEnvelope.startedAt >= options.inboundMessageWindowMs
          ? { startedAt: now, updates: 0 }
          : previousEnvelope;
      state.inboundMessageRateWindows.set(input.participantId, envelope);
      if (envelope.updates >= options.inboundMessageLimit) {
        const previousReplayWindow = state.replayLookupRateWindows.get(
          input.participantId
        );
        const replayWindow =
          !previousReplayWindow ||
          now - previousReplayWindow.startedAt >= options.inboundMessageWindowMs
            ? { startedAt: now, updates: 0 }
            : previousReplayWindow;
        state.replayLookupRateWindows.set(input.participantId, replayWindow);
        if (
          validEnvelope &&
          replayWindow.updates < options.inboundMessageLimit
        ) {
          replayWindow.updates += 1;
          const replayText = messageText(data);
          const replayFingerprint = replayText
            ? messageFingerprint(replayText)
            : undefined;
          const acceptedReplay = replayFingerprint
            ? state.acceptedFrameAcks.get(
                acceptedFrameKey(input.participantId, replayFingerprint)
              )
            : undefined;
          const replayRole = connection.resolveRole();
          if (
            acceptedReplay &&
            !connection.observeOnly &&
            replayRole !== undefined &&
            replayRole !== "observer"
          ) {
            input.socket.send(
              JSON.stringify({
                ...base,
                type: "whiteboard.ack",
                update_id: acceptedReplay.updateId,
                revision: acceptedReplay.revision,
              })
            );
            return;
          }
        }
        const snapshot = state.sceneState.snapshot();
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "rate_limited",
              "Whiteboard messages are arriving too quickly.",
              true,
              { currentRevision: snapshot.revision }
            )
          )
        );
        return;
      }
      envelope.updates += 1;
      if (!validEnvelope) {
        sendInvalidAttempt("The whiteboard message is invalid or too large.");
        return;
      }
      const text = messageText(data);
      if (text === undefined) {
        sendInvalidAttempt("The whiteboard message is invalid or too large.");
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        sendInvalidAttempt("The whiteboard message is not valid JSON.");
        return;
      }
      const parsed = WhiteboardClientMessageSchema.safeParse(json);
      if (!parsed.success || parsed.data.room_id !== input.roomId) {
        sendInvalidAttempt(
          "The whiteboard message does not match this session."
        );
        return;
      }
      const message = parsed.data;
      if (message.type === "whiteboard.presence.leave") {
        deactivatePresence(input.roomId, state, connection);
        return;
      }
      if (message.type === "whiteboard.presence.update") {
        if (!connection.resolveRole()) {
          input.socket.send(
            JSON.stringify(
              whiteboardErrorMessage(
                input.roomId,
                "forbidden",
                "This participant cannot publish whiteboard presence.",
                false
              )
            )
          );
          return;
        }
        const now = Date.now();
        const canEdit = connection.resolveRole() !== "observer";
        const wasActive = connection.active;
        const nextPresence = {
          cursor: message.cursor,
          selected_element_ids: message.selected_element_ids,
          viewport: message.viewport,
        };
        const presenceChanged =
          JSON.stringify(connection.presence) !== JSON.stringify(nextPresence);
        const metadataChanged = wasActive && connection.lastCanEdit !== canEdit;
        if (wasActive && !presenceChanged && !metadataChanged) {
          connection.lastSeenAt = now;
          return;
        }
        if (wasActive && !presenceChanged && metadataChanged) {
          for (const candidate of state.connections) {
            if (
              candidate.active &&
              candidate.participantId === connection.participantId
            ) {
              candidate.lastCanEdit = canEdit;
            }
          }
          connection.lastSeenAt = now;
          sendPresenceUpdated(
            input.roomId,
            state,
            authoritativePresence(state, connection.participantId) ?? connection
          );
          return;
        }
        const rateWindow = state.presenceRateWindows.get(
          connection.participantId
        );
        const currentWindow =
          !rateWindow || now - rateWindow.startedAt >= options.presenceWindowMs
            ? { startedAt: now, updates: 0 }
            : rateWindow;
        state.presenceRateWindows.set(connection.participantId, currentWindow);
        if (currentWindow.updates >= options.presenceUpdateLimit) {
          input.socket.send(
            JSON.stringify(
              whiteboardErrorMessage(
                input.roomId,
                "rate_limited",
                "Whiteboard presence is updating too quickly.",
                true
              )
            )
          );
          return;
        }
        currentWindow.updates += 1;
        connection.active = true;
        connection.lastCanEdit = canEdit;
        connection.lastSeenAt = now;
        connection.presenceVersion = ++state.presenceSequence;
        connection.presence = nextPresence;
        sendPresenceUpdated(input.roomId, state, connection);
        return;
      }

      const update = message;
      if (connection.observeOnly) {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "forbidden",
              "This connection only observes whiteboard activity.",
              false,
              { updateId: update.update_id }
            )
          )
        );
        return;
      }
      const currentRole = connection.resolveRole();
      if (!currentRole || currentRole === "observer") {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "forbidden",
              "This participant cannot edit the whiteboard.",
              false,
              { updateId: update.update_id }
            )
          )
        );
        return;
      }
      const applied = state.sceneState.apply(input.participantId, update);
      if (applied.kind === "rejected") {
        options.onDiagnostic?.({
          action: "server_update_rejected",
          roomId: input.roomId,
          participantId: input.participantId,
          updateId: update.update_id,
          baseRevision: update.base_revision,
          currentRevision: applied.currentRevision,
          elementCount: update.elements.length,
          reason: applied.code,
        });
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              applied.code,
              applied.message,
              true,
              {
                updateId: update.update_id,
                currentRevision: applied.currentRevision,
              }
            )
          )
        );
        return;
      }
      if (!applied.replayed) {
        state.acceptedFrameAcks.set(
          acceptedFrameKey(input.participantId, messageFingerprint(text)),
          {
            updateId: update.update_id,
            revision: applied.revision,
          }
        );
        while (state.acceptedFrameAcks.size > options.deduplicationLimit) {
          const oldest = state.acceptedFrameAcks.keys().next().value;
          if (oldest === undefined) break;
          state.acceptedFrameAcks.delete(oldest);
        }
      }
      if (applied.replayed) {
        input.socket.send(
          JSON.stringify({
            ...base,
            type: "whiteboard.ack",
            update_id: update.update_id,
            revision: applied.revision,
          })
        );
        return;
      }

      options.onDiagnostic?.({
        action: "server_update_accepted",
        roomId: input.roomId,
        participantId: input.participantId,
        updateId: update.update_id,
        baseRevision: update.base_revision,
        revision: applied.revision,
        elementCount: applied.scene.elements.length,
      });

      const broadcast = JSON.stringify({
        ...base,
        type: "whiteboard.elements.updated",
        update_id: update.update_id,
        participant_id: input.participantId,
        revision: applied.revision,
        elements: applied.scene.elements,
        app_state: applied.scene.app_state,
      });
      const activity = JSON.stringify({
        ...base,
        type: "whiteboard.scene.activity",
        participant_id: input.participantId,
        revision: applied.revision,
      });
      let editorPeerCount = 0;
      let observerPeerCount = 0;
      let deliveredPeerCount = 0;
      let failedPeerCount = 0;
      for (const peer of state.connections) {
        if (peer.observeOnly) observerPeerCount += 1;
        else editorPeerCount += 1;
        if (sendSafely(state, peer, peer.observeOnly ? activity : broadcast)) {
          deliveredPeerCount += 1;
        } else {
          failedPeerCount += 1;
        }
      }
      options.onDiagnostic?.({
        action: "server_broadcast_completed",
        roomId: input.roomId,
        participantId: input.participantId,
        updateId: update.update_id,
        baseRevision: update.base_revision,
        revision: applied.revision,
        elementCount: applied.scene.elements.length,
        editorPeerCount,
        observerPeerCount,
        deliveredPeerCount,
        failedPeerCount,
      });
      sendSafely(
        state,
        connection,
        JSON.stringify({
          ...base,
          type: "whiteboard.ack",
          update_id: update.update_id,
          revision: applied.revision,
        })
      );
    });

    return () => {
      state.connections.delete(connection);
      if (connection.handoffReserved) {
        connection.handoffReserved = false;
        state.handoffParticipants.delete(connection.participantId);
      }
      if (connection.active) {
        connection.active = false;
        connection.presence = undefined;
        sendPresenceLeft(input.roomId, state, connection.participantId);
      }
    };
  }

  const presenceSweep = setInterval(() => {
    const now = Date.now();
    for (const [roomId, state] of rooms) {
      for (const connection of state.connections) {
        if (
          connection.active &&
          now - connection.lastSeenAt >= options.presenceTtlMs
        ) {
          deactivatePresence(roomId, state, connection);
        }
      }
    }
  }, options.presenceSweepMs);
  presenceSweep.unref?.();

  return {
    connect,
    reserveObserverHandoff(roomId, participantId) {
      const state = rooms.get(roomId);
      if (!state || state.handoffParticipants.has(participantId)) {
        return undefined;
      }
      const observer = [...state.connections].find(
        (connection) =>
          connection.participantId === participantId &&
          connection.observeOnly &&
          !connection.handoffReserved
      );
      if (!observer) return undefined;
      observer.handoffReserved = true;
      state.handoffParticipants.add(participantId);
      let settled = false;
      return {
        complete() {
          if (settled) return;
          settled = true;
          observer.socket.close(1000, "whiteboard_handoff");
        },
        release() {
          if (settled) return;
          settled = true;
          observer.handoffReserved = false;
          state.handoffParticipants.delete(participantId);
        },
      };
    },
    discardRoom(roomId) {
      const state = rooms.get(roomId);
      if (!state) return;
      state.ended = true;
      const message = JSON.stringify(
        whiteboardErrorMessage(
          roomId,
          "room_ended",
          "This Live Room has ended.",
          false
        )
      );
      for (const connection of state.connections) {
        sendSafely(state, connection, message);
      }
      rooms.delete(roomId);
    },
    listSnapshots(roomId) {
      const state = roomState(roomId);
      return {
        currentRevision: state.sceneState.snapshot().revision,
        snapshots: state.sceneState.listSnapshots(),
      };
    },
    snapshot(roomId) {
      return roomState(roomId).sceneState.snapshot();
    },
    clear(roomId, participantId, expectedRevision) {
      const state = roomState(roomId);
      const result = state.sceneState.clear(participantId, expectedRevision);
      if (result.kind === "accepted") {
        state.acceptedFrameAcks.clear();
        broadcastAuthoritativeScene(
          roomId,
          state,
          participantId,
          result,
          "clear"
        );
      }
      return result;
    },
    restore(roomId, participantId, snapshotId, expectedRevision) {
      const state = roomState(roomId);
      const result = state.sceneState.restore(
        participantId,
        snapshotId,
        expectedRevision
      );
      if (result.kind === "accepted") {
        state.acceptedFrameAcks.clear();
        broadcastAuthoritativeScene(
          roomId,
          state,
          participantId,
          result,
          "restore"
        );
      }
      return result;
    },
    close() {
      clearInterval(presenceSweep);
      rooms.clear();
    },
  };
}
