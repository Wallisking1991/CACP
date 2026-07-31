import { describe, expect, it } from "vitest";
import {
  CacpEventSchema,
  WhiteboardClientMessageSchema,
  WhiteboardProtocolVersion,
  WhiteboardServerMessageSchema,
} from "../src/index.js";

const element = {
  id: "shape_1",
  type: "rectangle",
  version: 1,
  versionNonce: 101,
  x: 40,
  y: 60,
  width: 120,
  height: 80,
};

describe("Collaborative Whiteboard wire protocol", () => {
  it("parses the versioned handshake, scene, update, acknowledgement, and typed error contracts", () => {
    const connected = WhiteboardServerMessageSchema.parse({
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.connected",
      room_id: "room_1",
      participant_id: "user_1",
      role: "owner",
      can_edit: true,
    });
    expect(connected.type).toBe("whiteboard.connected");

    const scene = WhiteboardServerMessageSchema.parse({
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.scene",
      room_id: "room_1",
      revision: 0,
      scene: {
        elements: [],
        app_state: { viewBackgroundColor: "#ffffff" },
      },
    });
    expect(scene.type).toBe("whiteboard.scene");

    const update = WhiteboardClientMessageSchema.parse({
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.elements.update",
      room_id: "room_1",
      update_id: "update_1",
      base_revision: 0,
      elements: [element],
      app_state: { viewBackgroundColor: "#ffffff" },
    });
    expect(update.type).toBe("whiteboard.elements.update");
    expect(CacpEventSchema.safeParse(update).success).toBe(false);

    const acknowledgement = WhiteboardServerMessageSchema.parse({
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.ack",
      room_id: "room_1",
      update_id: "update_1",
      revision: 1,
    });
    expect(acknowledgement.type).toBe("whiteboard.ack");

    const error = WhiteboardServerMessageSchema.parse({
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.error",
      room_id: "room_1",
      code: "forbidden",
      message: "This participant cannot edit the whiteboard.",
      recoverable: false,
      update_id: "update_1",
      current_revision: 1,
    });
    expect(error.type).toBe("whiteboard.error");
  });

  it("rejects invalid revisions and unknown wire fields", () => {
    const invalid = {
      protocol: "cacp-whiteboard",
      version: WhiteboardProtocolVersion,
      type: "whiteboard.elements.update",
      room_id: "room_1",
      update_id: "update_1",
      base_revision: -1,
      elements: [element],
      app_state: {},
      unexpected: true,
    };

    expect(WhiteboardClientMessageSchema.safeParse(invalid).success).toBe(
      false
    );
  });
});
