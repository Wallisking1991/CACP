import {
  WhiteboardClientMessageSchema,
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
  type WhiteboardCollaborator,
  type WhiteboardClientPresenceMessage,
  type WhiteboardErrorCode,
  type WhiteboardHumanRole,
  type WhiteboardScene,
} from "@cacp/protocol";

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
  revision: number;
  scene: WhiteboardScene;
  connections: Set<WhiteboardConnection>;
  handoffParticipants: Set<string>;
  presenceSequence: number;
  presenceRateWindows: Map<string, { startedAt: number; updates: number }>;
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
  close(): void;
}

interface WhiteboardHubOptions {
  maxMessageBytes: number;
  presenceHeartbeatMs: number;
  presenceTtlMs: number;
  presenceSweepMs: number;
  presenceUpdateLimit: number;
  presenceWindowMs: number;
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

const blankScene = (): WhiteboardScene => ({
  elements: [],
  app_state: {},
});

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
      peer.socket.send(message);
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
    for (const peer of state.connections) peer.socket.send(message);
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
      revision: 0,
      scene: blankScene(),
      connections: new Set(),
      handoffParticipants: new Set(),
      presenceSequence: 0,
      presenceRateWindows: new Map(),
    };
    rooms.set(roomId, created);
    return created;
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
      input.socket.send(
        JSON.stringify({
          ...base,
          type: "whiteboard.scene",
          revision: state.revision,
          scene: state.scene,
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
    input.socket.on("message", (data) => {
      const text = messageText(data);
      if (
        text === undefined ||
        new TextEncoder().encode(text).byteLength > options.maxMessageBytes
      ) {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "invalid_message",
              "The whiteboard message is invalid or too large.",
              true
            )
          )
        );
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "invalid_message",
              "The whiteboard message is not valid JSON.",
              true
            )
          )
        );
        return;
      }
      const parsed = WhiteboardClientMessageSchema.safeParse(json);
      if (!parsed.success || parsed.data.room_id !== input.roomId) {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "invalid_message",
              "The whiteboard message does not match this session.",
              true
            )
          )
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
      if (update.base_revision !== state.revision) {
        input.socket.send(
          JSON.stringify(
            whiteboardErrorMessage(
              input.roomId,
              "stale_revision",
              "The whiteboard scene changed before this update arrived.",
              true,
              {
                updateId: update.update_id,
                currentRevision: state.revision,
              }
            )
          )
        );
        return;
      }

      state.revision += 1;
      state.scene = {
        elements: update.elements,
        app_state: update.app_state,
      };
      input.socket.send(
        JSON.stringify({
          ...base,
          type: "whiteboard.ack",
          update_id: update.update_id,
          revision: state.revision,
        })
      );
      const broadcast = JSON.stringify({
        ...base,
        type: "whiteboard.elements.updated",
        update_id: update.update_id,
        participant_id: input.participantId,
        revision: state.revision,
        elements: state.scene.elements,
        app_state: state.scene.app_state,
      });
      const activity = JSON.stringify({
        ...base,
        type: "whiteboard.scene.activity",
        participant_id: input.participantId,
        revision: state.revision,
      });
      for (const peer of state.connections) {
        if (peer !== connection) {
          peer.socket.send(peer.observeOnly ? activity : broadcast);
        }
      }
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
      rooms.delete(roomId);
    },
    close() {
      clearInterval(presenceSweep);
      rooms.clear();
    },
  };
}
