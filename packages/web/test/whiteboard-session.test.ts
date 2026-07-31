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
  const setReadOnly = vi.fn();
  const updateScene = vi.fn((nextScene: WhiteboardScene) => {
    scene = nextScene;
  });
  const editor: WhiteboardEditorController = {
    getScene: () => scene,
    updateScene,
    subscribeSceneChanges(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDisplayOptions: () => {},
    setReadOnly,
    exportScene: async () => new Blob(),
    destroy: () => {},
  };
  return {
    editor,
    setReadOnly,
    updateScene,
    change(nextScene: WhiteboardScene) {
      scene = nextScene;
      for (const listener of listeners) listener(nextScene);
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

describe("WhiteboardSession", () => {
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
    expect(JSON.parse(socket.sent[0]!)).toEqual({
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
    expect(socket.sent).toEqual([]);
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
    expect(socket.sent).toHaveLength(1);

    socket.receive(
      serverMessage("room_queue", {
        type: "whiteboard.ack",
        update_id: "update_1",
        revision: 1,
      })
    );
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({
      update_id: "update_2",
      base_revision: 1,
      elements: [{ id: "shape_1", version: 2 }],
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
    session.destroy();
  });
});
