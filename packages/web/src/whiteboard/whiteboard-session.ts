import {
  WhiteboardClientPresenceMessageSchema,
  WhiteboardClientPresenceLeaveMessageSchema,
  WhiteboardClientUpdateMessageSchema,
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
  WhiteboardServerMessageSchema,
  type WhiteboardHumanRole,
  type WhiteboardCollaborator as WireWhiteboardCollaborator,
  type WhiteboardScene as SharedWhiteboardScene,
} from "@cacp/protocol";

import type {
  WhiteboardCollaborator,
  WhiteboardEditorController,
  WhiteboardPresence,
  WhiteboardScene,
} from "./whiteboard-editor-adapter.js";
import {
  WhiteboardImageAssetError,
  type WhiteboardImageAssetManager,
} from "./whiteboard-image-assets.js";

export type WhiteboardSessionStatus =
  | "connecting"
  | "synchronizing"
  | "connected"
  | "disconnected"
  | "rejected"
  | "conflicted"
  | "forbidden"
  | "ended";

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
  currentRevision?(): number | undefined;
  subscribeStatus(
    listener: (status: WhiteboardSessionStatus) => void
  ): () => void;
  subscribeCollaborators(
    listener: (collaborators: WhiteboardCollaborator[]) => void
  ): () => void;
  subscribeActivity(
    listener: (activity: WhiteboardSessionActivity) => void
  ): () => void;
  subscribeError?(
    listener: (error: WhiteboardSessionError | undefined) => void
  ): () => void;
  focusCollaborator(participantId: string): void;
  loadSharedScene(): void;
  setRole(role: WhiteboardHumanRole): void;
  setPresenceEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface WhiteboardSessionActivity {
  kind: "scene" | "presence";
  participantId: string;
}

export interface WhiteboardSessionError {
  code:
    | "whiteboard_image_upload_failed"
    | "whiteboard_image_download_failed"
    | "whiteboard_image_data_missing";
  attachmentId?: string;
}

export interface CreateWhiteboardSessionOptions {
  identity: WhiteboardSessionIdentity;
  editor: WhiteboardEditorController;
  socketFactory?: (url: string) => WhiteboardSocketPort;
  createUpdateId?: () => string;
  origin?: string;
  reconnectDelayMs?: number;
  presenceThrottleMs?: number;
  presenceEnabled?: boolean;
  observeOnly?: boolean;
  imageAssets?: WhiteboardImageAssetManager;
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

function whiteboardUrl(
  origin: string,
  identity: WhiteboardSessionIdentity,
  observeOnly: boolean
) {
  const url = new URL(`/rooms/${identity.roomId}/whiteboard`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", identity.token);
  if (observeOnly) url.searchParams.set("mode", "observe");
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

function editorCollaborator(
  collaborator: WireWhiteboardCollaborator
): WhiteboardCollaborator {
  return {
    participantId: collaborator.participant_id,
    displayName: collaborator.display_name,
    color: collaborator.color,
    canEdit: collaborator.can_edit,
    ...("cursor" in collaborator ? { cursor: collaborator.cursor } : {}),
    ...(collaborator.selected_element_ids
      ? { selectedElementIds: collaborator.selected_element_ids }
      : {}),
    ...(collaborator.viewport
      ? {
          viewport: {
            scrollX: collaborator.viewport.scroll_x,
            scrollY: collaborator.viewport.scroll_y,
            zoom: collaborator.viewport.zoom,
          },
        }
      : {}),
  };
}

function initialPresence(
  editor: WhiteboardEditorController
): WhiteboardPresence {
  const appState = editor.getScene().appState;
  const zoom = appState.zoom;
  return {
    cursor: null,
    selectedElementIds: Object.entries(
      (appState.selectedElementIds as Record<string, boolean> | undefined) ?? {}
    )
      .filter(([, selected]) => selected)
      .map(([id]) => id),
    viewport: {
      scrollX: typeof appState.scrollX === "number" ? appState.scrollX : 0,
      scrollY: typeof appState.scrollY === "number" ? appState.scrollY : 0,
      zoom:
        typeof zoom === "number"
          ? zoom
          : zoom &&
              typeof zoom === "object" &&
              typeof (zoom as { value?: unknown }).value === "number"
            ? (zoom as { value: number }).value
            : 1,
    },
  };
}

export function createWhiteboardSession({
  identity,
  editor,
  socketFactory = defaultSocketFactory,
  createUpdateId = defaultUpdateId,
  origin = window.location.origin,
  reconnectDelayMs = 1_000,
  presenceThrottleMs = 50,
  presenceEnabled: initialPresenceEnabled = true,
  observeOnly = false,
  imageAssets,
}: CreateWhiteboardSessionOptions): WhiteboardSessionController {
  let role = identity.role;
  let status: WhiteboardSessionStatus = "connecting";
  let socket: WhiteboardSocketPort | undefined;
  let revision: number | undefined;
  let synchronized = false;
  let connectedHandshake = false;
  let applyingRemote = false;
  let destroyed = false;
  let terminalStatus: "forbidden" | "ended" | undefined;
  let hasInstalledAuthoritativeScene = false;
  let rejectedUpdate = false;
  let rejectedBaseRevision: number | undefined;
  let pendingRemote:
    { revision: number; scene: SharedWhiteboardScene } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlightUpdateId: string | undefined;
  let queuedScene: WhiteboardScene | undefined;
  let presence = initialPresence(editor);
  let presenceEnabled = initialPresenceEnabled;
  let presenceDirty = initialPresenceEnabled;
  let lastPresenceSentAt = Number.NEGATIVE_INFINITY;
  let presenceHeartbeatMs = 3_000;
  let presenceThrottleTimer: ReturnType<typeof setTimeout> | undefined;
  let presenceHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let queuedAssetScene: WhiteboardScene | undefined;
  let processingAssetScene = false;
  let sessionError: WhiteboardSessionError | undefined;
  let remoteApplicationChain = Promise.resolve();
  let remoteApplicationSequence = 0;
  let remoteApplicationPending = false;
  const collaborators = new Map<string, WhiteboardCollaborator>();
  const statusListeners = new Set<
    (nextStatus: WhiteboardSessionStatus) => void
  >();
  const collaboratorListeners = new Set<
    (nextCollaborators: WhiteboardCollaborator[]) => void
  >();
  const activityListeners = new Set<
    (activity: WhiteboardSessionActivity) => void
  >();
  const errorListeners = new Set<
    (error: WhiteboardSessionError | undefined) => void
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

  function collaboratorList() {
    return [...collaborators.values()];
  }

  function notifyCollaborators() {
    const nextCollaborators = collaboratorList();
    editor.setCollaborators(
      nextCollaborators.filter(
        (collaborator) => collaborator.participantId !== identity.participantId
      )
    );
    for (const listener of collaboratorListeners) {
      listener(nextCollaborators);
    }
  }

  function notifyActivity(activity: WhiteboardSessionActivity) {
    if (activity.participantId === identity.participantId) return;
    for (const listener of activityListeners) listener(activity);
  }

  function setSessionError(error: WhiteboardSessionError | undefined) {
    if (
      sessionError?.code === error?.code &&
      sessionError?.attachmentId === error?.attachmentId
    ) {
      return;
    }
    sessionError = error;
    for (const listener of errorListeners) listener(sessionError);
  }

  function reportImageError(cause: unknown, fallback: WhiteboardSessionError) {
    if (cause instanceof WhiteboardImageAssetError) {
      setSessionError({
        code: cause.code,
        ...(cause.attachmentId ? { attachmentId: cause.attachmentId } : {}),
      });
      return;
    }
    setSessionError(fallback);
  }

  function clearPresenceTimers() {
    if (presenceThrottleTimer) clearTimeout(presenceThrottleTimer);
    if (presenceHeartbeatTimer) clearInterval(presenceHeartbeatTimer);
    presenceThrottleTimer = undefined;
    presenceHeartbeatTimer = undefined;
  }

  function sendPresence() {
    if (
      destroyed ||
      !presenceEnabled ||
      !connectedHandshake ||
      socket?.readyState !== SOCKET_OPEN
    ) {
      return;
    }
    const parsed = WhiteboardClientPresenceMessageSchema.safeParse({
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: identity.roomId,
      type: "whiteboard.presence.update",
      cursor: presence.cursor,
      selected_element_ids: presence.selectedElementIds,
      viewport: {
        scroll_x: presence.viewport.scrollX,
        scroll_y: presence.viewport.scrollY,
        zoom: presence.viewport.zoom,
      },
    });
    if (!parsed.success) return;
    socket.send(JSON.stringify(parsed.data));
    lastPresenceSentAt = Date.now();
    presenceDirty = false;
  }

  function schedulePresence(nextPresence: WhiteboardPresence) {
    presence = nextPresence;
    presenceDirty = presenceEnabled;
    if (!presenceEnabled) return;
    if (!connectedHandshake || socket?.readyState !== SOCKET_OPEN) return;
    const remaining = presenceThrottleMs - (Date.now() - lastPresenceSentAt);
    if (remaining <= 0) {
      if (presenceThrottleTimer) clearTimeout(presenceThrottleTimer);
      presenceThrottleTimer = undefined;
      sendPresence();
      return;
    }
    if (presenceThrottleTimer) return;
    presenceThrottleTimer = setTimeout(() => {
      presenceThrottleTimer = undefined;
      if (presenceDirty) sendPresence();
    }, remaining);
  }

  function startPresenceHeartbeat(heartbeatMs: number) {
    presenceHeartbeatMs = heartbeatMs;
    if (presenceHeartbeatTimer) clearInterval(presenceHeartbeatTimer);
    if (!presenceEnabled) {
      presenceHeartbeatTimer = undefined;
      return;
    }
    presenceHeartbeatTimer = setInterval(sendPresence, heartbeatMs);
  }

  function sendPresenceLeave() {
    if (
      destroyed ||
      !connectedHandshake ||
      socket?.readyState !== SOCKET_OPEN
    ) {
      return;
    }
    const parsed = WhiteboardClientPresenceLeaveMessageSchema.safeParse({
      protocol: WhiteboardProtocolName,
      version: WhiteboardProtocolVersion,
      room_id: identity.roomId,
      type: "whiteboard.presence.leave",
    });
    if (parsed.success) socket.send(JSON.stringify(parsed.data));
  }

  function applyEditorScene(
    scene: SharedWhiteboardScene,
    files: WhiteboardScene["files"],
    resetHistory = false
  ) {
    applyingRemote = true;
    try {
      editor.updateScene({ ...remoteScene(editor, scene), files });
      if (resetHistory) editor.resetHistory();
    } finally {
      applyingRemote = false;
    }
  }

  function finishRemoteApplication(sequence: number) {
    if (destroyed || sequence !== remoteApplicationSequence) return;
    remoteApplicationPending = false;
    synchronized = connectedHandshake && socket?.readyState === SOCKET_OPEN;
    setStatus(synchronized ? "connected" : "disconnected");
    setEditorAccess();
    if (!synchronized) scheduleReconnect();
  }

  function applyRemoteScene(
    scene: SharedWhiteboardScene,
    resetHistory = false
  ): boolean {
    const localScene = remoteScene(editor, scene);
    if (!imageAssets) {
      applyEditorScene(scene, localScene.files, resetHistory);
      return false;
    }
    const hydrated = imageAssets.hydrateRemoteScene(localScene);
    if (!(hydrated instanceof Promise)) {
      setSessionError(undefined);
      applyEditorScene(scene, hydrated.files, resetHistory);
      return false;
    }

    const sequence = ++remoteApplicationSequence;
    const applicationSocket = socket;
    remoteApplicationPending = true;
    synchronized = false;
    setStatus("synchronizing");
    setEditorAccess();
    remoteApplicationChain = remoteApplicationChain.then(async () => {
      let nextScene = localScene;
      try {
        nextScene = await hydrated;
        setSessionError(undefined);
      } catch (cause) {
        reportImageError(cause, {
          code: "whiteboard_image_download_failed",
        });
      }
      if (!destroyed && socket === applicationSocket) {
        applyEditorScene(scene, nextScene.files, resetHistory);
      }
    });
    void remoteApplicationChain.then(() => finishRemoteApplication(sequence));
    return true;
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

  async function drainAssetScenes() {
    if (processingAssetScene || !imageAssets) return;
    processingAssetScene = true;
    try {
      while (!destroyed && queuedAssetScene) {
        const scene = queuedAssetScene;
        queuedAssetScene = undefined;
        try {
          const normalized = await imageAssets.normalizeLocalScene(scene);
          if (destroyed) return;
          setSessionError(undefined);
          if (normalized !== scene) {
            applyingRemote = true;
            try {
              editor.updateScene(normalized);
            } finally {
              applyingRemote = false;
            }
          }
          sendScene(normalized);
        } catch (cause) {
          reportImageError(cause, {
            code: "whiteboard_image_upload_failed",
          });
        }
      }
    } finally {
      processingAssetScene = false;
      if (!destroyed && queuedAssetScene) void drainAssetScenes();
    }
  }

  const unsubscribeEditor = editor.subscribeSceneChanges((scene) => {
    if (applyingRemote) return;
    if (!imageAssets) {
      sendScene(scene);
      return;
    }
    queuedAssetScene = scene;
    void drainAssetScenes();
  });
  const unsubscribePresence = editor.subscribePresenceChanges(schedulePresence);

  function scheduleReconnect() {
    if (destroyed || terminalStatus || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelayMs);
  }

  function connect() {
    if (destroyed || terminalStatus) return;
    synchronized = false;
    connectedHandshake = false;
    clearPresenceTimers();
    revision = undefined;
    inFlightUpdateId = undefined;
    queuedScene = undefined;
    remoteApplicationSequence += 1;
    remoteApplicationPending = false;
    remoteApplicationChain = Promise.resolve();
    setStatus("connecting");
    setEditorAccess();

    const nextSocket = socketFactory(
      whiteboardUrl(origin, identity, observeOnly)
    );
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
          terminalStatus = "forbidden";
          setStatus("forbidden");
          setEditorAccess();
          nextSocket.close();
          return;
        }
        connectedHandshake = true;
        role = message.role;
        presenceHeartbeatMs = message.presence_heartbeat_ms ?? 3_000;
        if (presenceEnabled) {
          startPresenceHeartbeat(presenceHeartbeatMs);
          presenceDirty = true;
          sendPresence();
        }
        setEditorAccess();
        return;
      }
      if (message.type === "whiteboard.scene") {
        if (!connectedHandshake) return;
        if (message.replacement_reason) {
          revision = message.revision;
          inFlightUpdateId = undefined;
          queuedScene = undefined;
          rejectedUpdate = false;
          rejectedBaseRevision = undefined;
          pendingRemote = undefined;
          const applyingImages = applyRemoteScene(message.scene, true);
          hasInstalledAuthoritativeScene = true;
          if (!applyingImages) {
            synchronized = true;
            setStatus("connected");
            setEditorAccess();
          }
          return;
        }
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
        const applyingImages = applyRemoteScene(
          message.scene,
          hasInstalledAuthoritativeScene
        );
        hasInstalledAuthoritativeScene = true;
        if (!applyingImages) {
          synchronized = true;
          setStatus("connected");
          setEditorAccess();
        }
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
      if (message.type === "whiteboard.presence.snapshot") {
        collaborators.clear();
        for (const collaborator of message.collaborators) {
          const view = editorCollaborator(collaborator);
          collaborators.set(view.participantId, view);
        }
        notifyCollaborators();
        if (observeOnly && connectedHandshake) {
          synchronized = true;
          setStatus("connected");
          setEditorAccess();
        }
        return;
      }
      if (message.type === "whiteboard.presence.updated") {
        const collaborator = editorCollaborator(message.collaborator);
        collaborators.set(collaborator.participantId, collaborator);
        notifyCollaborators();
        notifyActivity({
          kind: "presence",
          participantId: collaborator.participantId,
        });
        return;
      }
      if (message.type === "whiteboard.presence.left") {
        collaborators.delete(message.participant_id);
        notifyCollaborators();
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
          notifyActivity({
            kind: "scene",
            participantId: message.participant_id,
          });
          return;
        }
        if (
          (!synchronized && !remoteApplicationPending) ||
          revision === undefined
        )
          return;
        if (message.revision <= revision) return;
        revision = message.revision;
        const applyingImages = applyRemoteScene({
          elements: message.elements,
          app_state: message.app_state,
        });
        if (!applyingImages) {
          synchronized = true;
          setStatus("connected");
          setEditorAccess();
        }
        notifyActivity({
          kind: "scene",
          participantId: message.participant_id,
        });
        return;
      }
      if (message.type === "whiteboard.scene.activity") {
        notifyActivity({
          kind: "scene",
          participantId: message.participant_id,
        });
        return;
      }
      if (message.type === "whiteboard.error") {
        if (message.code === "room_ended") {
          terminalStatus = "ended";
          synchronized = false;
          setStatus("ended");
          setEditorAccess();
          nextSocket.close();
          return;
        }
        if (message.update_id && message.update_id !== inFlightUpdateId) return;
        if (
          message.code === "forbidden" ||
          message.code === "invalid_token" ||
          message.code === "origin_not_allowed" ||
          message.code === "room_full"
        ) {
          terminalStatus = "forbidden";
          synchronized = false;
          setStatus("forbidden");
          setEditorAccess();
          nextSocket.close();
          return;
        }
        if (
          (message.code === "invalid_message" ||
            message.code === "rate_limited") &&
          inFlightUpdateId &&
          (!message.update_id || message.update_id === inFlightUpdateId)
        ) {
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
      clearPresenceTimers();
      collaborators.clear();
      notifyCollaborators();
      setStatus(
        terminalStatus
          ? terminalStatus
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
    currentRevision() {
      return revision;
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    subscribeCollaborators(listener) {
      collaboratorListeners.add(listener);
      listener(collaboratorList());
      return () => collaboratorListeners.delete(listener);
    },
    subscribeActivity(listener) {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    subscribeError(listener) {
      errorListeners.add(listener);
      listener(sessionError);
      return () => errorListeners.delete(listener);
    },
    focusCollaborator(participantId) {
      const collaborator = collaborators.get(participantId);
      if (collaborator?.viewport) editor.focusViewport(collaborator.viewport);
    },
    loadSharedScene() {
      if (!pendingRemote) return;
      const remote = pendingRemote;
      revision = remote.revision;
      const applyingImages = applyRemoteScene(remote.scene, true);
      hasInstalledAuthoritativeScene = true;
      pendingRemote = undefined;
      rejectedUpdate = false;
      rejectedBaseRevision = undefined;
      if (!applyingImages) {
        synchronized = connectedHandshake && socket?.readyState === SOCKET_OPEN;
        setStatus(synchronized ? "connected" : "disconnected");
        setEditorAccess();
        if (!synchronized) scheduleReconnect();
      }
    },
    setRole(nextRole) {
      role = nextRole;
      setEditorAccess();
    },
    setPresenceEnabled(enabled) {
      if (observeOnly && enabled) return;
      if (presenceEnabled === enabled) return;
      presenceEnabled = enabled;
      clearPresenceTimers();
      if (enabled) {
        presenceDirty = true;
        if (connectedHandshake && socket?.readyState === SOCKET_OPEN) {
          sendPresence();
          startPresenceHeartbeat(presenceHeartbeatMs);
        }
      } else {
        presenceDirty = false;
        sendPresenceLeave();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      remoteApplicationSequence += 1;
      remoteApplicationPending = false;
      queuedAssetScene = undefined;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      clearPresenceTimers();
      unsubscribeEditor();
      unsubscribePresence();
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
      collaboratorListeners.clear();
      activityListeners.clear();
      errorListeners.clear();
      collaborators.clear();
      editor.setCollaborators([]);
    },
  };
}
