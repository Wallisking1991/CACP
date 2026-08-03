import {
  WhiteboardProtocolName,
  WhiteboardProtocolVersion,
} from "@cacp/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  createWhiteboardSession,
  type WhiteboardSocketEvent,
  type WhiteboardSocketPort,
} from "../src/whiteboard/whiteboard-session.js";
import type {
  WhiteboardEditorController,
  WhiteboardScene,
} from "../src/whiteboard/whiteboard-editor-adapter.js";

type SocketEvent = "open" | "message" | "close";
type SocketListener = (event: WhiteboardSocketEvent) => void;

class FakeSocket implements WhiteboardSocketPort {
  readyState = 0;
  readonly sent: string[] = [];
  readonly listeners = new Map<SocketEvent, Set<SocketListener>>();
  close = vi.fn(() => {
    this.readyState = 3;
  });

  addEventListener(type: SocketEvent, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: SocketEvent, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  private emit(type: SocketEvent, event: WhiteboardSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function createEditor() {
  let scene: WhiteboardScene = {
    elements: [],
    appState: {},
    files: {},
  };
  const listeners = new Set<(nextScene: WhiteboardScene) => void>();
  const presenceListeners = new Set<
    (
      presence: import("../src/whiteboard/whiteboard-editor-adapter.js").WhiteboardPresence
    ) => void
  >();
  const setReadOnly = vi.fn();
  const setCollaborators = vi.fn();
  const focusViewport = vi.fn();
  const resetHistory = vi.fn();
  const updateScene = vi.fn((nextScene: WhiteboardScene) => {
    scene = nextScene;
  });
  const editor: WhiteboardEditorController = {
    getScene: () => scene,
    updateScene,
    resetHistory,
    subscribeSceneChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribePresenceChanges(listener) {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },
    setCollaborators,
    focusViewport,
    insertImage: async () => {},
    setDisplayOptions: () => {},
    setReadOnly,
    exportScene: async () => new Blob(),
    destroy: () => {},
  };
  return {
    editor,
    setReadOnly,
    updateScene,
    setCollaborators,
    focusViewport,
    resetHistory,
    change(nextScene: WhiteboardScene) {
      scene = nextScene;
      for (const listener of listeners) listener(nextScene);
    },
    changePresence(
      presence: import("../src/whiteboard/whiteboard-editor-adapter.js").WhiteboardPresence
    ) {
      for (const listener of presenceListeners) listener(presence);
    },
  };
}

function serverMessage(roomId: string, message: Record<string, unknown>) {
  return {
    protocol: WhiteboardProtocolName,
    version: WhiteboardProtocolVersion,
    room_id: roomId,
    ...message,
  };
}

function sentFrames(socket: FakeSocket, type: string) {
  return socket.sent
    .map((frame) => JSON.parse(frame) as Record<string, unknown>)
    .filter((frame) => frame.type === type);
}

describe("WhiteboardSession", () => {
  it("keeps observation passive and publishes presence only while enabled", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const editor = createEditor();
      const session = createWhiteboardSession({
        identity: {
          roomId: "room_passive",
          participantId: "user_1",
          token: "owner-token",
          role: "owner",
        },
        editor: editor.editor,
        socketFactory: () => socket,
        origin: "http://localhost:5173",
        presenceEnabled: false,
      });

      socket.open();
      socket.receive(
        serverMessage("room_passive", {
          type: "whiteboard.connected",
          participant_id: "user_1",
          role: "owner",
          can_edit: true,
          presence_heartbeat_ms: 100,
        })
      );
      socket.receive(
        serverMessage("room_passive", {
          type: "whiteboard.scene",
          revision: 0,
          scene: { elements: [], app_state: {} },
        })
      );
      vi.advanceTimersByTime(300);
      expect(
        socket.sent.filter(
          (frame) => JSON.parse(frame).type === "whiteboard.presence.update"
        )
      ).toHaveLength(0);

      session.setPresenceEnabled(true);
      expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
        type: "whiteboard.presence.update",
        cursor: null,
        selected_element_ids: [],
      });

      session.setPresenceEnabled(false);
      expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
        type: "whiteboard.presence.leave",
      });
      const sentAfterLeave = socket.sent.length;
      vi.advanceTimersByTime(300);
      expect(socket.sent).toHaveLength(sentAfterLeave);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a compact observe-only stream and stops retrying when the room is full", () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeSocket[] = [];
      const urls: string[] = [];
      const editor = createEditor();
      const activities: string[] = [];
      const statuses: string[] = [];
      const session = createWhiteboardSession({
        identity: {
          roomId: "room_observe",
          participantId: "user_1",
          token: "owner-token",
          role: "owner",
        },
        editor: editor.editor,
        socketFactory: (url) => {
          urls.push(url);
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        origin: "http://localhost:5173",
        observeOnly: true,
        presenceEnabled: false,
        reconnectDelayMs: 10,
      });
      session.subscribeActivity((activity) => activities.push(activity.kind));
      session.subscribeStatus((status) => statuses.push(status));

      expect(new URL(urls[0]!).searchParams.get("mode")).toBe("observe");
      sockets[0]!.open();
      sockets[0]!.receive(
        serverMessage("room_observe", {
          type: "whiteboard.connected",
          participant_id: "user_1",
          role: "owner",
          can_edit: true,
          observe_only: true,
        })
      );
      sockets[0]!.receive(
        serverMessage("room_observe", {
          type: "whiteboard.presence.snapshot",
          collaborators: [],
        })
      );
      expect(statuses.at(-1)).toBe("connected");
      sockets[0]!.receive(
        serverMessage("room_observe", {
          type: "whiteboard.scene.activity",
          participant_id: "user_2",
          revision: 1,
        })
      );
      expect(activities).toEqual(["scene"]);
      expect(editor.updateScene).not.toHaveBeenCalled();

      sockets[0]!.receive(
        serverMessage("room_observe", {
          type: "whiteboard.error",
          code: "room_full",
          message: "This room has too many open sockets.",
          recoverable: false,
        })
      );
      sockets[0]!.serverClose(1008);
      vi.advanceTimersByTime(100);
      expect(statuses.at(-1)).toBe("forbidden");
      expect(sockets).toHaveLength(1);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttles ephemeral presence, renders collaborators, and follows their viewport", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const editor = createEditor();
      const collaboratorSnapshots: Array<
        import("../src/whiteboard/whiteboard-editor-adapter.js").WhiteboardCollaborator[]
      > = [];
      const activities: string[] = [];
      const session = createWhiteboardSession({
        identity: {
          roomId: "room_presence",
          participantId: "user_1",
          token: "owner-token",
          role: "owner",
        },
        editor: editor.editor,
        socketFactory: () => socket,
        origin: "http://localhost:5173",
        presenceThrottleMs: 50,
      });
      session.subscribeCollaborators((collaborators) =>
        collaboratorSnapshots.push(collaborators)
      );
      session.subscribeActivity((activity) => activities.push(activity.kind));

      socket.open();
      socket.receive(
        serverMessage("room_presence", {
          type: "whiteboard.connected",
          participant_id: "user_1",
          role: "owner",
          can_edit: true,
          presence_heartbeat_ms: 1_000,
        })
      );
      socket.receive(
        serverMessage("room_presence", {
          type: "whiteboard.scene",
          revision: 0,
          scene: { elements: [], app_state: {} },
        })
      );
      const alice = {
        participant_id: "user_2",
        display_name: "Alice",
        color: { background: "#dbeafe", stroke: "#2563eb" },
        can_edit: true,
        cursor: { x: 100, y: 80, button: "up" },
        selected_element_ids: ["shape_1"],
        viewport: { scroll_x: -20, scroll_y: 10, zoom: 1.25 },
      };
      socket.receive(
        serverMessage("room_presence", {
          type: "whiteboard.presence.snapshot",
          collaborators: [
            {
              participant_id: "user_1",
              display_name: "Owner",
              color: { background: "#dcfce7", stroke: "#16a34a" },
              can_edit: true,
            },
            alice,
          ],
        })
      );

      expect(collaboratorSnapshots.at(-1)).toHaveLength(2);
      expect(editor.setCollaborators).toHaveBeenLastCalledWith([
        {
          participantId: "user_2",
          displayName: "Alice",
          color: { background: "#dbeafe", stroke: "#2563eb" },
          canEdit: true,
          cursor: { x: 100, y: 80, button: "up" },
          selectedElementIds: ["shape_1"],
          viewport: { scrollX: -20, scrollY: 10, zoom: 1.25 },
        },
      ]);
      session.focusCollaborator("user_2");
      expect(editor.focusViewport).toHaveBeenCalledWith({
        scrollX: -20,
        scrollY: 10,
        zoom: 1.25,
      });

      editor.changePresence({
        cursor: { x: 10, y: 20, button: "up" },
        selectedElementIds: [],
        viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
      });
      editor.changePresence({
        cursor: { x: 30, y: 40, button: "down" },
        selectedElementIds: ["shape_2"],
        viewport: { scrollX: -40, scrollY: 15, zoom: 1.5 },
      });
      expect(
        socket.sent
          .map((item) => JSON.parse(item) as { type: string })
          .filter((item) => item.type === "whiteboard.presence.update")
      ).toHaveLength(1);
      vi.advanceTimersByTime(50);
      const presenceFrames = socket.sent
        .map((item) => JSON.parse(item) as Record<string, unknown>)
        .filter((item) => item.type === "whiteboard.presence.update");
      expect(presenceFrames).toHaveLength(2);
      expect(presenceFrames[1]).toMatchObject({
        cursor: { x: 30, y: 40, button: "down" },
        selected_element_ids: ["shape_2"],
        viewport: { scroll_x: -40, scroll_y: 15, zoom: 1.5 },
      });

      socket.receive(
        serverMessage("room_presence", {
          type: "whiteboard.presence.updated",
          collaborator: {
            ...alice,
            cursor: { x: 200, y: 120, button: "down" },
          },
        })
      );
      expect(activities).toContain("presence");
      socket.receive(
        serverMessage("room_presence", {
          type: "whiteboard.presence.left",
          participant_id: "user_2",
        })
      );
      expect(collaboratorSnapshots.at(-1)).toHaveLength(1);
      expect(editor.setCollaborators).toHaveBeenLastCalledWith([]);

      vi.advanceTimersByTime(950);
      expect(
        socket.sent
          .map((item) => JSON.parse(item) as { type: string })
          .filter((item) => item.type === "whiteboard.presence.update")
      ).toHaveLength(3);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the authoritative scene before sending local edits", () => {
    const socket = new FakeSocket();
    const socketFactory = vi.fn(() => socket);
    const editor = createEditor();
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_1",
        participantId: "user_1",
        token: "owner secret",
        role: "owner",
      },
      editor: editor.editor,
      socketFactory,
      createUpdateId: () => "update_1",
      origin: "https://room.example",
    });
    session.subscribeStatus((status) => statuses.push(status));

    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(socketFactory).toHaveBeenCalledWith(
      "wss://room.example/rooms/room_1/whiteboard?token=owner+secret"
    );
    editor.change({
      elements: [
        {
          id: "too-early",
          type: "rectangle",
          version: 1,
          versionNonce: 10,
        },
      ],
      appState: {},
      files: {},
    });
    expect(socket.sent).toEqual([]);

    socket.open();
    socket.receive(
      serverMessage("room_1", {
        type: "whiteboard.connected",
        participant_id: "user_1",
        role: "owner",
        can_edit: true,
      })
    );
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    socket.receive(
      serverMessage("room_1", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );

    expect(editor.updateScene).toHaveBeenLastCalledWith({
      elements: [],
      appState: {},
      files: {},
    });
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(statuses).toContain("connected");

    const rectangle = {
      id: "shape_1",
      type: "rectangle",
      version: 1,
      versionNonce: 11,
      x: 20,
      y: 30,
    };
    editor.change({
      elements: [rectangle],
      appState: {
        viewBackgroundColor: "#ffffff",
        scrollX: 100,
      },
      files: {},
    });
    expect(sentFrames(socket, "whiteboard.elements.update")[0]).toEqual({
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: "room_1",
      type: "whiteboard.elements.update",
      update_id: "update_1",
      base_revision: 0,
      elements: [rectangle],
      app_state: { viewBackgroundColor: "#ffffff" },
    });

    socket.receive(
      serverMessage("room_1", {
        type: "whiteboard.elements.updated",
        update_id: "update_1",
        participant_id: "user_1",
        revision: 1,
        elements: [rectangle],
        app_state: { viewBackgroundColor: "#ffffff" },
      })
    );
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(1);
    socket.receive(
      serverMessage("room_1", {
        type: "whiteboard.ack",
        update_id: "update_1",
        revision: 1,
      })
    );
    const text = {
      id: "text_1",
      type: "text",
      version: 1,
      versionNonce: 12,
      text: "Remote thought",
    };
    socket.receive(
      serverMessage("room_1", {
        type: "whiteboard.elements.updated",
        update_id: "update_2",
        participant_id: "user_2",
        revision: 2,
        elements: [rectangle, text],
        app_state: { viewBackgroundColor: "#f5f5f5" },
      })
    );
    expect(editor.updateScene).toHaveBeenLastCalledWith({
      elements: [rectangle, text],
      appState: {
        scrollX: 100,
        viewBackgroundColor: "#f5f5f5",
      },
      files: {},
    });

    session.destroy();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("keeps an observer read-only after synchronization", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_observer",
        participantId: "viewer_1",
        token: "viewer-token",
        role: "observer",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      origin: "http://localhost:5173",
    });
    socket.open();
    socket.receive(
      serverMessage("room_observer", {
        type: "whiteboard.connected",
        participant_id: "viewer_1",
        role: "observer",
        can_edit: false,
      })
    );
    socket.receive(
      serverMessage("room_observer", {
        type: "whiteboard.scene",
        revision: 4,
        scene: {
          elements: [
            {
              id: "shared-shape",
              type: "ellipse",
              version: 1,
              versionNonce: 21,
            },
          ],
          app_state: {},
        },
      })
    );

    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    editor.change({
      elements: [],
      appState: {},
      files: {},
    });
    expect(sentFrames(socket, "whiteboard.elements.update")).toEqual([]);
    session.destroy();
  });

  it("serializes edits and rebases the latest queued scene after an ack", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const updateIds = ["update_1", "update_2"];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_queue",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => updateIds.shift()!,
      origin: "http://localhost:5173",
      sceneThrottleMs: 0,
    });
    socket.open();
    socket.receive(
      serverMessage("room_queue", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_queue", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );

    editor.change({
      elements: [
        {
          id: "shape_1",
          type: "rectangle",
          version: 1,
          versionNonce: 31,
        },
      ],
      appState: {},
      files: {},
    });
    editor.change({
      elements: [
        {
          id: "shape_1",
          type: "rectangle",
          version: 2,
          versionNonce: 32,
        },
      ],
      appState: {},
      files: {},
    });
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(1);

    socket.receive(
      serverMessage("room_queue", {
        type: "whiteboard.ack",
        update_id: "update_1",
        revision: 1,
      })
    );
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(2);
    expect(sentFrames(socket, "whiteboard.elements.update")[1]).toMatchObject({
      update_id: "update_2",
      base_revision: 1,
      elements: [{ id: "shape_1", version: 2 }],
    });
    session.destroy();
  });

  it("coalesces ack-speed gesture frames below the server rate limit", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const editor = createEditor();
      const updateIds = ["gesture-1", "gesture-final"];
      const session = createWhiteboardSession({
        identity: {
          roomId: "room_throttle",
          participantId: "member_1",
          token: "member-token",
          role: "member",
        },
        editor: editor.editor,
        socketFactory: () => socket,
        createUpdateId: () => updateIds.shift()!,
        origin: "http://localhost:5173",
      });
      socket.open();
      socket.receive(
        serverMessage("room_throttle", {
          type: "whiteboard.connected",
          participant_id: "member_1",
          role: "member",
          can_edit: true,
        })
      );
      socket.receive(
        serverMessage("room_throttle", {
          type: "whiteboard.scene",
          revision: 0,
          scene: { elements: [], app_state: {} },
        })
      );
      editor.change({
        elements: [
          { id: "shape", type: "rectangle", version: 1, versionNonce: 1 },
        ],
        appState: {},
        files: {},
      });
      editor.change({
        elements: [
          { id: "shape", type: "rectangle", version: 2, versionNonce: 2 },
        ],
        appState: {},
        files: {},
      });
      socket.receive(
        serverMessage("room_throttle", {
          type: "whiteboard.ack",
          update_id: "gesture-1",
          revision: 1,
        })
      );
      expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(50);
      editor.change({
        elements: [
          { id: "shape", type: "rectangle", version: 3, versionNonce: 3 },
        ],
        appState: {},
        files: {},
      });
      await vi.advanceTimersByTimeAsync(25);

      expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(2);
      expect(sentFrames(socket, "whiteboard.elements.update")[1]).toMatchObject(
        {
          update_id: "gesture-final",
          base_revision: 1,
          elements: [{ id: "shape", version: 3 }],
        }
      );
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an authoritative self echo interrupt an active gesture", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const updateIds = ["update_1", "update_2"];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_active_gesture",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => updateIds.shift()!,
      origin: "http://localhost:5173",
      sceneThrottleMs: 0,
    });
    socket.open();
    socket.receive(
      serverMessage("room_active_gesture", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_active_gesture", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );

    const initialRectangle = {
      id: "shape_1",
      type: "rectangle",
      version: 1,
      versionNonce: 31,
      width: 0,
      height: 0,
    };
    const finishedRectangle = {
      ...initialRectangle,
      version: 2,
      versionNonce: 32,
      width: 180,
      height: 120,
    };
    editor.change({
      elements: [initialRectangle],
      appState: {},
      files: {},
    });
    editor.change({
      elements: [finishedRectangle],
      appState: {},
      files: {},
    });
    const sceneApplicationsBeforeEcho = editor.updateScene.mock.calls.length;

    socket.receive(
      serverMessage("room_active_gesture", {
        type: "whiteboard.elements.updated",
        update_id: "update_1",
        participant_id: "member_1",
        revision: 1,
        elements: [initialRectangle],
        app_state: {},
      })
    );

    expect(editor.updateScene).toHaveBeenCalledTimes(
      sceneApplicationsBeforeEcho
    );
    socket.receive(
      serverMessage("room_active_gesture", {
        type: "whiteboard.ack",
        update_id: "update_1",
        revision: 1,
      })
    );
    expect(sentFrames(socket, "whiteboard.elements.update")[1]).toMatchObject({
      update_id: "update_2",
      base_revision: 1,
      elements: [{ id: "shape_1", width: 180, height: 120 }],
    });
    session.destroy();
  });

  it("locks the editor on disconnect and resynchronizes a replacement socket", async () => {
    const sockets: FakeSocket[] = [];
    const editor = createEditor();
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_reconnect",
        participantId: "owner_1",
        token: "owner-token",
        role: "owner",
      },
      editor: editor.editor,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      origin: "http://localhost:5173",
      reconnectDelayMs: 0,
    });
    session.subscribeStatus((status) => statuses.push(status));
    sockets[0]!.open();
    sockets[0]!.receive(
      serverMessage("room_reconnect", {
        type: "whiteboard.connected",
        participant_id: "owner_1",
        role: "owner",
        can_edit: true,
      })
    );
    sockets[0]!.receive(
      serverMessage("room_reconnect", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);

    sockets[0]!.serverClose();
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(statuses).toContain("disconnected");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(2);

    sockets[1]!.open();
    sockets[1]!.receive(
      serverMessage("room_reconnect", {
        type: "whiteboard.connected",
        participant_id: "owner_1",
        role: "owner",
        can_edit: true,
      })
    );
    sockets[1]!.receive(
      serverMessage("room_reconnect", {
        type: "whiteboard.scene",
        revision: 3,
        scene: {
          elements: [
            {
              id: "restored",
              type: "text",
              version: 1,
              versionNonce: 41,
            },
          ],
          app_state: {},
        },
      })
    );
    expect(editor.updateScene).toHaveBeenLastCalledWith({
      elements: [
        {
          id: "restored",
          type: "text",
          version: 1,
          versionNonce: 41,
        },
      ],
      appState: {},
      files: {},
    });
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(editor.resetHistory).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it("recovers from a scene rate limit without leaving the update queue stuck", async () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const statuses: string[] = [];
    const updateIds = ["limited-update", "retry-update"];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_rate",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => updateIds.shift()!,
      origin: "http://localhost:5173",
      rateLimitRetryMs: 0,
      sceneThrottleMs: 0,
    });
    session.subscribeStatus((status) => statuses.push(status));
    socket.open();
    socket.receive(
      serverMessage("room_rate", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_rate", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    editor.change({
      elements: [
        {
          id: "first-shape",
          type: "rectangle",
          version: 1,
          versionNonce: 71,
        },
      ],
      appState: {},
      files: {},
    });
    socket.receive(
      serverMessage("room_rate", {
        type: "whiteboard.error",
        code: "rate_limited",
        message: "Whiteboard scene updates are arriving too quickly.",
        recoverable: true,
        update_id: "limited-update",
        current_revision: 0,
      })
    );
    expect(statuses.at(-1)).toBe("rejected");
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);

    editor.change({
      elements: [
        {
          id: "retry-shape",
          type: "ellipse",
          version: 1,
          versionNonce: 72,
        },
      ],
      appState: {},
      files: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(2);
    expect(sentFrames(socket, "whiteboard.elements.update")[1]).toMatchObject({
      update_id: "retry-update",
      base_revision: 0,
    });
    session.destroy();
  });

  it("retries the final scene after rate limiting without another edit", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const editor = createEditor();
      const updateIds = ["limited-final", "automatic-retry"];
      const statuses: string[] = [];
      const session = createWhiteboardSession({
        identity: {
          roomId: "room_rate_final",
          participantId: "member_1",
          token: "member-token",
          role: "member",
        },
        editor: editor.editor,
        socketFactory: () => socket,
        createUpdateId: () => updateIds.shift()!,
        origin: "http://localhost:5173",
      });
      session.subscribeStatus((status) => statuses.push(status));
      socket.open();
      socket.receive(
        serverMessage("room_rate_final", {
          type: "whiteboard.connected",
          participant_id: "member_1",
          role: "member",
          can_edit: true,
        })
      );
      socket.receive(
        serverMessage("room_rate_final", {
          type: "whiteboard.scene",
          revision: 4,
          scene: { elements: [], app_state: {} },
        })
      );
      editor.change({
        elements: [
          {
            id: "final-shape",
            type: "rectangle",
            version: 24,
            versionNonce: 73,
            width: 360,
            height: 240,
          },
        ],
        appState: {},
        files: {},
      });
      socket.receive(
        serverMessage("room_rate_final", {
          type: "whiteboard.error",
          code: "rate_limited",
          message: "Whiteboard scene updates are arriving too quickly.",
          recoverable: true,
          update_id: "limited-final",
          current_revision: 4,
        })
      );

      await vi.advanceTimersByTimeAsync(1_100);

      expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(2);
      expect(sentFrames(socket, "whiteboard.elements.update")[1]).toMatchObject(
        {
          update_id: "automatic-retry",
          base_revision: 4,
          elements: [
            {
              id: "final-shape",
              width: 360,
              height: 240,
            },
          ],
        }
      );
      socket.receive(
        serverMessage("room_rate_final", {
          type: "whiteboard.elements.updated",
          update_id: "automatic-retry",
          participant_id: "member_1",
          revision: 5,
          elements: [
            {
              id: "final-shape",
              type: "rectangle",
              version: 24,
              versionNonce: 73,
              width: 360,
              height: 240,
            },
          ],
          app_state: {},
        })
      );
      socket.receive(
        serverMessage("room_rate_final", {
          type: "whiteboard.ack",
          update_id: "automatic-retry",
          revision: 5,
        })
      );
      expect(statuses.at(-1)).toBe("connected");
      expect(session.currentRevision?.()).toBe(5);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not confuse a presence rate limit with a scene rejection", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_presence_limit",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => "scene-update",
      origin: "http://localhost:5173",
      sceneThrottleMs: 0,
    });
    session.subscribeStatus((status) => statuses.push(status));
    socket.open();
    socket.receive(
      serverMessage("room_presence_limit", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_presence_limit", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    editor.change({
      elements: [
        { id: "shape", type: "rectangle", version: 1, versionNonce: 1 },
      ],
      appState: {},
      files: {},
    });

    socket.receive(
      serverMessage("room_presence_limit", {
        type: "whiteboard.error",
        code: "rate_limited",
        message: "Whiteboard presence is updating too quickly.",
        recoverable: true,
      })
    );
    expect(statuses.at(-1)).toBe("connected");
    expect(socket.close).not.toHaveBeenCalled();

    socket.receive(
      serverMessage("room_presence_limit", {
        type: "whiteboard.ack",
        update_id: "scene-update",
        revision: 1,
      })
    );
    expect(session.currentRevision?.()).toBe(1);
    session.destroy();
  });

  it("keeps the final scene available read-only after the Live Room ends", async () => {
    const sockets: FakeSocket[] = [];
    const editor = createEditor();
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_ended",
        participantId: "owner_1",
        token: "owner-token",
        role: "owner",
      },
      editor: editor.editor,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      origin: "http://localhost:5173",
      reconnectDelayMs: 0,
    });
    session.subscribeStatus((status) => statuses.push(status));
    sockets[0]!.open();
    sockets[0]!.receive(
      serverMessage("room_ended", {
        type: "whiteboard.connected",
        participant_id: "owner_1",
        role: "owner",
        can_edit: true,
      })
    );
    sockets[0]!.receive(
      serverMessage("room_ended", {
        type: "whiteboard.scene",
        revision: 2,
        scene: {
          elements: [
            {
              id: "final-shape",
              type: "diamond",
              version: 1,
              versionNonce: 73,
            },
          ],
          app_state: {},
        },
      })
    );
    sockets[0]!.receive(
      serverMessage("room_ended", {
        type: "whiteboard.error",
        code: "room_ended",
        message: "This Live Room has ended.",
        recoverable: false,
      })
    );

    expect(statuses.at(-1)).toBe("ended");
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(editor.editor.getScene().elements).toEqual([
      expect.objectContaining({ id: "final-shape" }),
    ]);
    await expect(editor.editor.exportScene()).resolves.toBeInstanceOf(Blob);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(1);
    session.destroy();
  });

  it("preserves local work and retries after a rejected update", async () => {
    const sockets: FakeSocket[] = [];
    const editor = createEditor();
    const statuses: string[] = [];
    const updateIds = ["rejected-update", "recovered-update"];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_rejected",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createUpdateId: () => updateIds.shift()!,
      origin: "http://localhost:5173",
      reconnectDelayMs: 0,
    });
    session.subscribeStatus((status) => statuses.push(status));
    sockets[0]!.open();
    sockets[0]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    sockets[0]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    editor.change({
      elements: [
        {
          id: "shape_1",
          type: "rectangle",
          version: 1,
          versionNonce: 51,
        },
      ],
      appState: {},
      files: {},
    });
    expect(sentFrames(sockets[0]!, "whiteboard.elements.update")).toHaveLength(
      1
    );

    sockets[0]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.error",
        code: "invalid_message",
        message: "The update is too large.",
        recoverable: true,
        update_id: "rejected-update",
      })
    );
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(statuses).toContain("rejected");
    expect(sockets).toHaveLength(1);
    const remoteApplications = editor.updateScene.mock.calls.length;
    sockets[0]!.serverClose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(2);
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    sockets[1]!.open();
    sockets[1]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    sockets[1]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    expect(editor.updateScene).toHaveBeenCalledTimes(remoteApplications);
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(statuses.at(-1)).toBe("rejected");
    editor.change({
      elements: [
        {
          id: "shape_2",
          type: "ellipse",
          version: 1,
          versionNonce: 52,
        },
      ],
      appState: {},
      files: {},
    });
    expect(
      sentFrames(sockets[1]!, "whiteboard.elements.update")[0]
    ).toMatchObject({
      update_id: "recovered-update",
      base_revision: 0,
      elements: [{ id: "shape_2" }],
    });
    sockets[1]!.receive(
      serverMessage("room_rejected", {
        type: "whiteboard.ack",
        update_id: "recovered-update",
        revision: 1,
      })
    );
    expect(statuses.at(-1)).toBe("connected");
    session.destroy();
  });

  it("requires an explicit choice when remote work arrives after rejection", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const statuses: string[] = [];
    const activities: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_conflict",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => "oversized-update",
      origin: "http://localhost:5173",
    });
    session.subscribeStatus((status) => statuses.push(status));
    session.subscribeActivity((activity) => activities.push(activity.kind));
    socket.open();
    socket.receive(
      serverMessage("room_conflict", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_conflict", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    editor.change({
      elements: [
        {
          id: "local-shape",
          type: "rectangle",
          version: 1,
          versionNonce: 61,
        },
      ],
      appState: {},
      files: {},
    });
    socket.receive(
      serverMessage("room_conflict", {
        type: "whiteboard.error",
        code: "invalid_message",
        message: "The update is too large.",
        recoverable: true,
        update_id: "oversized-update",
      })
    );
    const remoteApplications = editor.updateScene.mock.calls.length;
    socket.receive(
      serverMessage("room_conflict", {
        type: "whiteboard.elements.updated",
        update_id: "other-update",
        participant_id: "member_2",
        revision: 1,
        elements: [
          {
            id: "other-shape",
            type: "diamond",
            version: 1,
            versionNonce: 62,
          },
        ],
        app_state: {},
      })
    );

    expect(statuses.at(-1)).toBe("conflicted");
    expect(activities).toContain("scene");
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(editor.updateScene).toHaveBeenCalledTimes(remoteApplications);
    editor.change({
      elements: [
        {
          id: "local-shape",
          type: "rectangle",
          version: 2,
          versionNonce: 63,
        },
      ],
      appState: {},
      files: {},
    });
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(1);

    session.loadSharedScene();

    expect(editor.updateScene).toHaveBeenLastCalledWith({
      elements: [
        {
          id: "other-shape",
          type: "diamond",
          version: 1,
          versionNonce: 62,
        },
      ],
      appState: {},
      files: {},
    });
    expect(statuses.at(-1)).toBe("connected");
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(editor.resetHistory).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it("force-applies a clear replacement across rejected and in-flight work", () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_reset",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      socketFactory: () => socket,
      createUpdateId: () => "old-update",
      origin: "http://localhost:5173",
    });
    session.subscribeStatus((status) => statuses.push(status));
    socket.open();
    socket.receive(
      serverMessage("room_reset", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_reset", {
        type: "whiteboard.scene",
        revision: 1,
        scene: {
          elements: [
            { id: "shared", type: "rectangle", version: 1, versionNonce: 1 },
          ],
          app_state: {},
        },
      })
    );
    editor.change({
      elements: [{ id: "local", type: "ellipse", version: 1, versionNonce: 2 }],
      appState: {},
      files: {},
    });
    socket.receive(
      serverMessage("room_reset", {
        type: "whiteboard.error",
        code: "invalid_message",
        message: "Rejected.",
        recoverable: true,
        update_id: "old-update",
      })
    );
    expect(statuses.at(-1)).toBe("rejected");

    socket.receive(
      serverMessage("room_reset", {
        type: "whiteboard.scene",
        revision: 2,
        scene: { elements: [], app_state: {} },
        replacement_reason: "clear",
      })
    );
    socket.receive(
      serverMessage("room_reset", {
        type: "whiteboard.error",
        code: "not_synchronized",
        message: "Old frame.",
        recoverable: true,
        update_id: "old-update",
        current_revision: 2,
      })
    );

    expect(editor.editor.getScene().elements).toEqual([]);
    expect(editor.resetHistory).toHaveBeenCalledTimes(1);
    expect(editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(statuses.at(-1)).toBe("connected");
    expect(socket.close).not.toHaveBeenCalled();
    session.destroy();
  });

  it("uploads local image files before sending attachment-only scene data", async () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const normalizeLocalScene = vi.fn(async (scene: WhiteboardScene) => ({
      ...scene,
      elements: scene.elements.map((element) => ({
        ...(element as Record<string, unknown>),
        fileId: "att_uploaded",
      })),
      files: {
        att_uploaded: {
          id: "att_uploaded",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,cGl4ZWxz",
          created: 1,
        },
      },
    }));
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_images",
        participantId: "owner_1",
        token: "owner-token",
        role: "owner",
      },
      editor: editor.editor,
      imageAssets: {
        normalizeLocalScene,
        hydrateRemoteScene: (scene) => scene,
      },
      socketFactory: () => socket,
      createUpdateId: () => "image-update",
      origin: "http://localhost:5173",
    });
    socket.open();
    socket.receive(
      serverMessage("room_images", {
        type: "whiteboard.connected",
        participant_id: "owner_1",
        role: "owner",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_images", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );

    editor.change({
      elements: [
        {
          id: "image_1",
          type: "image",
          version: 1,
          versionNonce: 1,
          fileId: "file_local",
        },
      ],
      appState: {},
      files: {
        file_local: {
          id: "file_local",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,cGl4ZWxz",
          created: 1,
        },
      },
    });
    expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(0);
    await vi.waitFor(() =>
      expect(sentFrames(socket, "whiteboard.elements.update")).toHaveLength(1)
    );
    const sent = sentFrames(socket, "whiteboard.elements.update")[0]!;
    expect(sent).toMatchObject({
      update_id: "image-update",
      elements: [expect.objectContaining({ fileId: "att_uploaded" })],
    });
    expect(JSON.stringify(sent)).not.toContain("data:image");
    expect(editor.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        files: { att_uploaded: expect.any(Object) },
      })
    );
    session.destroy();
  });

  it("hydrates protected remote images before applying the scene", async () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    const hydrateRemoteScene = vi.fn((scene: WhiteboardScene) => {
      if (scene.elements.length === 0) return scene;
      return Promise.resolve({
        ...scene,
        files: {
          att_shared: {
            id: "att_shared",
            mimeType: "image/png",
            dataURL: "data:image/png;base64,cGl4ZWxz",
            created: 1,
          },
        },
      });
    });
    const statuses: string[] = [];
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_remote_images",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      imageAssets: {
        normalizeLocalScene: (scene) => scene,
        hydrateRemoteScene,
      },
      socketFactory: () => socket,
      origin: "http://localhost:5173",
    });
    session.subscribeStatus((status) => statuses.push(status));
    socket.open();
    socket.receive(
      serverMessage("room_remote_images", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_remote_images", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    socket.receive(
      serverMessage("room_remote_images", {
        type: "whiteboard.elements.updated",
        update_id: "remote-image",
        participant_id: "owner_1",
        revision: 1,
        elements: [
          {
            id: "image_1",
            type: "image",
            version: 1,
            versionNonce: 1,
            fileId: "att_shared",
          },
        ],
        app_state: {},
      })
    );

    await vi.waitFor(() =>
      expect(editor.updateScene).toHaveBeenLastCalledWith(
        expect.objectContaining({
          files: { att_shared: expect.any(Object) },
        })
      )
    );
    expect(statuses.at(-1)).toBe("connected");
    session.destroy();
  });

  it("does not let delayed hydration overwrite a newer remote revision", async () => {
    const socket = new FakeSocket();
    const editor = createEditor();
    let resolveDelayed: ((scene: WhiteboardScene) => void) | undefined;
    const delayed = new Promise<WhiteboardScene>((resolve) => {
      resolveDelayed = resolve;
    });
    const hydrateRemoteScene = vi.fn((scene: WhiteboardScene) => {
      const version = Number(
        (scene.elements[0] as Record<string, unknown> | undefined)?.version
      );
      return version === 1 ? delayed : scene;
    });
    const session = createWhiteboardSession({
      identity: {
        roomId: "room_hydration_order",
        participantId: "member_1",
        token: "member-token",
        role: "member",
      },
      editor: editor.editor,
      imageAssets: {
        normalizeLocalScene: (scene) => scene,
        hydrateRemoteScene,
      },
      socketFactory: () => socket,
      origin: "http://localhost:5173",
    });
    socket.open();
    socket.receive(
      serverMessage("room_hydration_order", {
        type: "whiteboard.connected",
        participant_id: "member_1",
        role: "member",
        can_edit: true,
      })
    );
    socket.receive(
      serverMessage("room_hydration_order", {
        type: "whiteboard.scene",
        revision: 0,
        scene: { elements: [], app_state: {} },
      })
    );
    socket.receive(
      serverMessage("room_hydration_order", {
        type: "whiteboard.elements.updated",
        update_id: "remote-image-v1",
        participant_id: "owner_1",
        revision: 1,
        elements: [
          {
            id: "shared-image",
            type: "image",
            version: 1,
            versionNonce: 81,
            fileId: "att_shared",
          },
        ],
        app_state: { viewBackgroundColor: "#fff7ed" },
      })
    );
    socket.receive(
      serverMessage("room_hydration_order", {
        type: "whiteboard.elements.updated",
        update_id: "remote-image-v2",
        participant_id: "owner_1",
        revision: 2,
        elements: [
          {
            id: "shared-image",
            type: "image",
            version: 2,
            versionNonce: 82,
            fileId: "att_shared",
          },
        ],
        app_state: { viewBackgroundColor: "#eff6ff" },
      })
    );
    resolveDelayed?.({
      elements: [
        {
          id: "shared-image",
          type: "image",
          version: 1,
          versionNonce: 81,
          fileId: "att_shared",
        },
      ],
      appState: { viewBackgroundColor: "#fff7ed" },
      files: {
        att_shared: {
          id: "att_shared",
          dataURL: "data:image/png;base64,cGl4ZWxz",
        },
      },
    });
    await vi.waitFor(() =>
      expect(
        (editor.editor.getScene().elements[0] as Record<string, unknown>)
          .version
      ).toBe(2)
    );
    expect(editor.editor.getScene().appState.viewBackgroundColor).toBe(
      "#eff6ff"
    );
    session.destroy();
  });
});
