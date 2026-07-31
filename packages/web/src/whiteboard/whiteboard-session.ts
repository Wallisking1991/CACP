import {
  WhiteboardClientUpdateMessageSchema,
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
  WhiteboardServerMessageSchema,
  type WhiteboardHumanRole,
  type WhiteboardScene as SharedWhiteboardScene,
} from "@cacp/protocol";

import type {
  WhiteboardEditorController,
  WhiteboardScene,
} from "./whiteboard-editor-adapter.js";

export type WhiteboardSessionStatus =
  | "connecting"
  | "synchronizing"
  | "connected"
  | "disconnected"
  | "rejected"
  | "conflicted"
  | "forbidden";

export interface WhiteboardSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export type WhiteboardSocketEventType = "open" | "message" | "close";

export interface WhiteboardSocketPort {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: WhiteboardSocketEventType,
    listener: (event: WhiteboardSocketEvent) => void
  ): void;
  removeEventListener(
    type: WhiteboardSocketEventType,
    listener: (event: WhiteboardSocketEvent) => void
  ): void;
}

export interface WhiteboardSessionIdentity {
  roomId: string;
  participantId: string;
  token: string;
  role: WhiteboardHumanRole;
}

export interface WhiteboardSessionController {
  subscribeStatus(
    listener: (status: WhiteboardSessionStatus) => void
  ): () => void;
  loadSharedScene(): void;
  setRole(role: WhiteboardHumanRole): void;
  destroy(): void;
}

export interface CreateWhiteboardSessionOptions {
  identity: WhiteboardSessionIdentity;
  editor: WhiteboardEditorController;
  socketFactory?: (url: string) => WhiteboardSocketPort;
  createUpdateId?: () => string;
  origin?: string;
  reconnectDelayMs?: number;
}

export type WhiteboardSessionFactory = (
  options: CreateWhiteboardSessionOptions
) => WhiteboardSessionController;

export type WhiteboardSessionFactoryLoader =
  () => Promise<WhiteboardSessionFactory>;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

function defaultSocketFactory(url: string): WhiteboardSocketPort {
  return new WebSocket(url) as unknown as WhiteboardSocketPort;
}

function defaultUpdateId(): string {
  return `whiteboard_${crypto.randomUUID()}`;
}

function whiteboardUrl(origin: string, identity: WhiteboardSessionIdentity) {
  const url = new URL(`/rooms/${identity.roomId}/whiteboard`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", identity.token);
  return url.toString();
}

function sharedAppState(scene: WhiteboardScene) {
  const background = scene.appState.viewBackgroundColor;
  return typeof background === "string"
    ? { viewBackgroundColor: background }
    : {};
}

function remoteScene(
  editor: WhiteboardEditorController,
  scene: SharedWhiteboardScene
): WhiteboardScene {
  const current = editor.getScene();
  return {
    elements: scene.elements,
    appState: {
      ...current.appState,
      ...("viewBackgroundColor" in scene.app_state
        ? { viewBackgroundColor: scene.app_state.viewBackgroundColor }
        : {}),
    },
    files: current.files,
  };
}

export function createWhiteboardSession({
  identity,
  editor,
  socketFactory = defaultSocketFactory,
  createUpdateId = defaultUpdateId,
  origin = window.location.origin,
  reconnectDelayMs = 1_000,
}: CreateWhiteboardSessionOptions): WhiteboardSessionController {
  let role = identity.role;
  let status: WhiteboardSessionStatus = "connecting";
  let socket: WhiteboardSocketPort | undefined;
  let revision: number | undefined;
  let synchronized = false;
  let connectedHandshake = false;
  let applyingRemote = false;
  let destroyed = false;
  let terminal = false;
  let rejectedUpdate = false;
  let rejectedBaseRevision: number | undefined;
  let pendingRemote:
    { revision: number; scene: SharedWhiteboardScene } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlightUpdateId: string | undefined;
  let queuedScene: WhiteboardScene | undefined;
  const statusListeners = new Set<
    (nextStatus: WhiteboardSessionStatus) => void
  >();

  function setStatus(nextStatus: WhiteboardSessionStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    for (const listener of statusListeners) listener(status);
  }

  function setEditorAccess() {
    editor.setReadOnly(
      !synchronized ||
        (status !== "connected" && status !== "rejected") ||
        role === "observer"
    );
  }

  function applyRemoteScene(scene: SharedWhiteboardScene) {
    applyingRemote = true;
    try {
      editor.updateScene(remoteScene(editor, scene));
    } finally {
      applyingRemote = false;
    }
  }

  function sendScene(scene: WhiteboardScene) {
    if (
      destroyed ||
      !synchronized ||
      role === "observer" ||
      revision === undefined ||
      socket?.readyState !== SOCKET_OPEN
    ) {
      return;
    }
    if (inFlightUpdateId) {
      queuedScene = scene;
      return;
    }
    const updateId = createUpdateId();
    const parsed = WhiteboardClientUpdateMessageSchema.safeParse({
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: identity.roomId,
      type: "whiteboard.elements.update",
      update_id: updateId,
      base_revision: revision,
      elements: scene.elements,
      app_state: sharedAppState(scene),
    });
    if (!parsed.success) return;
    inFlightUpdateId = updateId;
    socket.send(JSON.stringify(parsed.data));
  }

  const unsubscribeEditor = editor.subscribeSceneChanges((scene) => {
    if (!applyingRemote) sendScene(scene);
  });

  function scheduleReconnect() {
    if (destroyed || terminal || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelayMs);
  }

  function connect() {
    if (destroyed || terminal) return;
    synchronized = false;
    connectedHandshake = false;
    revision = undefined;
    inFlightUpdateId = undefined;
    queuedScene = undefined;
    setStatus("connecting");
    setEditorAccess();

    const nextSocket = socketFactory(whiteboardUrl(origin, identity));
    socket = nextSocket;
    const onOpen = () => {
      if (socket !== nextSocket || destroyed) return;
      setStatus("synchronizing");
      setEditorAccess();
    };
    const onMessage = (event: WhiteboardSocketEvent) => {
      if (
        socket !== nextSocket ||
        destroyed ||
        typeof event.data !== "string"
      ) {
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = WhiteboardServerMessageSchema.safeParse(json);
      if (!parsed.success || parsed.data.room_id !== identity.roomId) return;
      const message = parsed.data;

      if (message.type === "whiteboard.connected") {
        if (message.participant_id !== identity.participantId) {
          terminal = true;
          setStatus("forbidden");
          setEditorAccess();
          nextSocket.close();
          return;
        }
        connectedHandshake = true;
        role = message.role;
        setEditorAccess();
        return;
      }
      if (message.type === "whiteboard.scene") {
        if (!connectedHandshake) return;
        if (rejectedUpdate) {
          revision = message.revision;
          if (pendingRemote || message.revision !== rejectedBaseRevision) {
            pendingRemote = {
              revision: message.revision,
              scene: message.scene,
            };
            synchronized = false;
            setStatus("conflicted");
          } else {
            synchronized = true;
            setStatus("rejected");
          }
          setEditorAccess();
          return;
        }
        revision = message.revision;
        applyRemoteScene(message.scene);
        synchronized = true;
        setStatus("connected");
        setEditorAccess();
        return;
      }
      if (message.type === "whiteboard.ack") {
        if (message.update_id !== inFlightUpdateId) return;
        revision = message.revision;
        inFlightUpdateId = undefined;
        rejectedUpdate = false;
        rejectedBaseRevision = undefined;
        pendingRemote = undefined;
        if (status === "rejected") {
          setStatus("connected");
          setEditorAccess();
        }
        const nextScene = queuedScene;
        queuedScene = undefined;
        if (nextScene) sendScene(nextScene);
        return;
      }
      if (message.type === "whiteboard.elements.updated") {
        if (rejectedUpdate) {
          if (!pendingRemote || message.revision > pendingRemote.revision) {
            pendingRemote = {
              revision: message.revision,
              scene: {
                elements: message.elements,
                app_state: message.app_state,
              },
            };
          }
          synchronized = false;
          setStatus("conflicted");
          setEditorAccess();
          return;
        }
        if (!synchronized || revision === undefined) return;
        if (message.revision <= revision) return;
        revision = message.revision;
        applyRemoteScene({
          elements: message.elements,
          app_state: message.app_state,
        });
        return;
      }
      if (message.type === "whiteboard.error") {
        if (
          message.code === "forbidden" ||
          message.code === "invalid_token" ||
          message.code === "origin_not_allowed" ||
          message.code === "room_ended"
        ) {
          terminal = true;
          synchronized = false;
          setStatus("forbidden");
          setEditorAccess();
          return;
        }
        if (message.code === "invalid_message" && inFlightUpdateId) {
          inFlightUpdateId = undefined;
          queuedScene = undefined;
          rejectedUpdate = true;
          rejectedBaseRevision = revision;
          pendingRemote = undefined;
          setStatus("rejected");
          setEditorAccess();
          return;
        }
        if (
          message.code === "stale_revision" ||
          message.code === "not_synchronized" ||
          message.code === "invalid_message"
        ) {
          synchronized = false;
          inFlightUpdateId = undefined;
          queuedScene = undefined;
          setStatus("disconnected");
          setEditorAccess();
          nextSocket.close();
        }
      }
    };
    const onClose = () => {
      if (socket !== nextSocket || destroyed) return;
      nextSocket.removeEventListener("open", onOpen);
      nextSocket.removeEventListener("message", onMessage);
      nextSocket.removeEventListener("close", onClose);
      socket = undefined;
      synchronized = false;
      setStatus(
        terminal
          ? "forbidden"
          : pendingRemote
            ? "conflicted"
            : rejectedUpdate
              ? "rejected"
              : "disconnected"
      );
      setEditorAccess();
      scheduleReconnect();
    };
    nextSocket.addEventListener("open", onOpen);
    nextSocket.addEventListener("message", onMessage);
    nextSocket.addEventListener("close", onClose);
  }

  editor.setReadOnly(true);
  connect();

  return {
    subscribeStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    loadSharedScene() {
      if (!pendingRemote) return;
      const remote = pendingRemote;
      revision = remote.revision;
      applyRemoteScene(remote.scene);
      pendingRemote = undefined;
      rejectedUpdate = false;
      rejectedBaseRevision = undefined;
      synchronized = connectedHandshake && socket?.readyState === SOCKET_OPEN;
      setStatus(synchronized ? "connected" : "disconnected");
      setEditorAccess();
      if (!synchronized) scheduleReconnect();
    },
    setRole(nextRole) {
      role = nextRole;
      setEditorAccess();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      unsubscribeEditor();
      const activeSocket = socket;
      socket = undefined;
      if (
        activeSocket &&
        (activeSocket.readyState === SOCKET_CONNECTING ||
          activeSocket.readyState === SOCKET_OPEN)
      ) {
        activeSocket.close();
      }
      statusListeners.clear();
    },
  };
}
