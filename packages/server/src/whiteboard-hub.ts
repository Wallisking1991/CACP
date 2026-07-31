import {
  WhiteboardClientMessageSchema,
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
  type WhiteboardErrorCode,
  type WhiteboardHumanRole,
  type WhiteboardScene,
} from "@cacp/protocol";

interface WhiteboardSocket {
  send(data: string): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
}

interface WhiteboardConnection {
  participantId: string;
  resolveRole: () => WhiteboardHumanRole | undefined;
  socket: WhiteboardSocket;
}

interface WhiteboardRoomState {
  revision: number;
  scene: WhiteboardScene;
  connections: Set<WhiteboardConnection>;
}

export interface WhiteboardConnectInput {
  roomId: string;
  participantId: string;
  role: WhiteboardHumanRole;
  resolveRole: () => WhiteboardHumanRole | undefined;
  socket: WhiteboardSocket;
}

export interface WhiteboardSessionHub {
  connect(input: WhiteboardConnectInput): () => void;
  discardRoom(roomId: string): void;
  close(): void;
}

interface WhiteboardHubOptions {
  maxMessageBytes: number;
}

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

  function roomState(roomId: string): WhiteboardRoomState {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const created: WhiteboardRoomState = {
      revision: 0,
      scene: blankScene(),
      connections: new Set(),
    };
    rooms.set(roomId, created);
    return created;
  }

  function connect(input: WhiteboardConnectInput): () => void {
    const state = roomState(input.roomId);
    const connection: WhiteboardConnection = {
      participantId: input.participantId,
      resolveRole: input.resolveRole,
      socket: input.socket,
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
      })
    );
    input.socket.send(
      JSON.stringify({
        ...base,
        type: "whiteboard.scene",
        revision: state.revision,
        scene: state.scene,
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
      const update = parsed.data;
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
      for (const peer of state.connections) {
        if (peer !== connection) peer.socket.send(broadcast);
      }
    });

    return () => {
      state.connections.delete(connection);
    };
  }

  return {
    connect,
    discardRoom(roomId) {
      rooms.delete(roomId);
    },
    close() {
      rooms.clear();
    },
  };
}
