import { describe, expect, it } from "vitest";

import {
  createWhiteboardSessionHub,
  type WhiteboardHubDiagnostic,
} from "../src/whiteboard-hub.js";

class FakeWhiteboardSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  failSends = false;
  private messageListener?: (data: unknown) => void;

  send(data: string): void {
    if (this.failSends) throw new Error("socket is no longer open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {}

  on(event: "message", listener: (data: unknown) => void): void {
    if (event === "message") this.messageListener = listener;
  }

  receive(message: Record<string, unknown>): void {
    this.messageListener?.(JSON.stringify(message));
  }
}

function createHub(onDiagnostic?: (event: WhiteboardHubDiagnostic) => void) {
  return createWhiteboardSessionHub({
    onDiagnostic,
    maxMessageBytes: 64 * 1024,
    presenceHeartbeatMs: 10_000,
    presenceTtlMs: 30_000,
    presenceSweepMs: 10_000,
    presenceUpdateLimit: 20,
    presenceWindowMs: 1_000,
    sceneUpdateLimit: 20,
    sceneWindowMs: 1_000,
    inboundMessageLimit: 40,
    inboundMessageWindowMs: 1_000,
    maxElements: 100,
    maxAttachments: 10,
    maxSceneBytes: 64 * 1024,
    deduplicationLimit: 100,
    snapshotCadenceMs: 1,
    snapshotMaxCount: 10,
    snapshotMaxBytes: 64 * 1024,
  });
}

describe("whiteboard Live Room lifecycle", () => {
  it("continues broadcasting when one stale peer rejects a send", () => {
    const diagnostics: WhiteboardHubDiagnostic[] = [];
    const hub = createHub((event) => diagnostics.push(event));
    const stale = new FakeWhiteboardSocket();
    const healthy = new FakeWhiteboardSocket();
    const sender = new FakeWhiteboardSocket();
    const connect = (participantId: string, socket: FakeWhiteboardSocket) =>
      hub.connect({
        roomId: "room_resilient",
        participantId,
        displayName: participantId,
        role: "member",
        resolveRole: () => "member",
        socket,
      });

    connect("stale_1", stale);
    connect("healthy_1", healthy);
    connect("sender_1", sender);
    stale.failSends = true;

    expect(() =>
      sender.receive({
        protocol: "cacp-whiteboard",
        version: "1.0.0",
        room_id: "room_resilient",
        type: "whiteboard.elements.update",
        update_id: "update_1",
        base_revision: 0,
        elements: [
          {
            id: "shape_1",
            type: "rectangle",
            version: 1,
            versionNonce: 101,
          },
        ],
        app_state: {},
      })
    ).not.toThrow();
    expect(healthy.sent).toContainEqual(
      expect.objectContaining({
        type: "whiteboard.elements.updated",
        update_id: "update_1",
        revision: 1,
      })
    );
    expect(sender.sent).toContainEqual(
      expect.objectContaining({
        type: "whiteboard.ack",
        update_id: "update_1",
        revision: 1,
      })
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        action: "server_broadcast_completed",
        updateId: "update_1",
        editorPeerCount: 3,
        deliveredPeerCount: 2,
        failedPeerCount: 1,
      })
    );
    hub.close();
  });

  it("drops scene, snapshots, presence, and deduplication when a room ends", () => {
    const hub = createHub();
    const first = new FakeWhiteboardSocket();
    hub.connect({
      roomId: "room_1",
      participantId: "owner_1",
      displayName: "Owner",
      role: "owner",
      resolveRole: () => "owner",
      socket: first,
    });
    first.receive({
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: "room_1",
      type: "whiteboard.presence.update",
      cursor: { x: 10, y: 20 },
      selected_element_ids: ["shape_1"],
      viewport: { scroll_x: 0, scroll_y: 0, zoom: 1 },
    });
    const update = {
      protocol: "cacp-whiteboard",
      version: "1.0.0",
      room_id: "room_1",
      type: "whiteboard.elements.update",
      update_id: "reusable-after-room-end",
      base_revision: 0,
      elements: [
        {
          id: "shape_1",
          type: "rectangle",
          version: 1,
          versionNonce: 101,
        },
      ],
      app_state: {},
    };
    first.receive(update);
    expect(hub.snapshot("room_1")).toMatchObject({
      revision: 1,
      scene: { elements: [{ id: "shape_1" }] },
    });
    expect(hub.listSnapshots("room_1").snapshots).toHaveLength(1);

    hub.discardRoom("room_1");
    expect(first.sent).toContainEqual(
      expect.objectContaining({ type: "whiteboard.error", code: "room_ended" })
    );
    expect(hub.snapshot("room_1")).toEqual({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });
    expect(hub.listSnapshots("room_1").snapshots).toEqual([]);

    const second = new FakeWhiteboardSocket();
    hub.connect({
      roomId: "room_1",
      participantId: "owner_1",
      displayName: "Owner",
      role: "owner",
      resolveRole: () => "owner",
      socket: second,
    });
    expect(
      second.sent.find(
        (message) => message.type === "whiteboard.presence.snapshot"
      )
    ).toMatchObject({ collaborators: [] });

    second.receive(update);
    expect(second.sent).toContainEqual(
      expect.objectContaining({
        type: "whiteboard.ack",
        update_id: "reusable-after-room-end",
        revision: 1,
      })
    );
    expect(hub.snapshot("room_1").revision).toBe(1);
    hub.close();
  });
});
