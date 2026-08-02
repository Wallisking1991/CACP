import type { WhiteboardClientUpdateMessage } from "@cacp/protocol";
import { describe, expect, it } from "vitest";
import { createWhiteboardSceneState } from "../src/whiteboard-scene-state.js";

function update(
  overrides: Partial<WhiteboardClientUpdateMessage> = {}
): WhiteboardClientUpdateMessage {
  return {
    protocol: "cacp-whiteboard",
    version: "1.0.0",
    room_id: "room_1",
    type: "whiteboard.elements.update",
    update_id: "update_1",
    base_revision: 0,
    elements: [],
    app_state: {},
    ...overrides,
  };
}

const rectangle = {
  id: "shape_a",
  type: "rectangle",
  version: 1,
  versionNonce: 100,
  x: 20,
};

describe("whiteboard scene state", () => {
  it("merges independent stale-base elements without losing either edit", () => {
    const state = createWhiteboardSceneState();

    expect(
      state.apply(
        "owner_1",
        update({
          elements: [rectangle],
          app_state: { viewBackgroundColor: "#ffffff" },
        }),
        0
      )
    ).toMatchObject({ kind: "accepted", revision: 1, replayed: false });

    const result = state.apply(
      "member_1",
      update({
        update_id: "update_2",
        base_revision: 0,
        elements: [
          {
            id: "shape_b",
            type: "ellipse",
            version: 1,
            versionNonce: 200,
            y: 40,
          },
        ],
        app_state: { viewBackgroundColor: "#000000" },
      }),
      1
    );

    expect(result).toMatchObject({
      kind: "accepted",
      revision: 2,
      replayed: false,
      scene: {
        elements: [rectangle, expect.objectContaining({ id: "shape_b" })],
        app_state: { viewBackgroundColor: "#ffffff" },
      },
    });
  });

  it("uses Excalidraw-compatible version and nonce ordering for one element", () => {
    const state = createWhiteboardSceneState();
    state.apply(
      "owner_1",
      update({
        elements: [{ ...rectangle, version: 2, versionNonce: 500, x: 50 }],
      }),
      0
    );

    const lowerNonce = state.apply(
      "member_1",
      update({
        update_id: "update_2",
        base_revision: 0,
        elements: [{ ...rectangle, version: 2, versionNonce: 100, x: 100 }],
      }),
      1
    );
    expect(lowerNonce).toMatchObject({
      kind: "accepted",
      scene: {
        elements: [expect.objectContaining({ x: 100, versionNonce: 100 })],
      },
    });

    const lowerVersion = state.apply(
      "member_2",
      update({
        update_id: "update_3",
        base_revision: 1,
        elements: [{ ...rectangle, version: 1, versionNonce: 1, x: 999 }],
      }),
      2
    );
    expect(lowerVersion).toMatchObject({
      kind: "accepted",
      scene: {
        elements: [expect.objectContaining({ x: 100, version: 2 })],
      },
    });
  });

  it("deduplicates a retried update and rejects identifier reuse", () => {
    const state = createWhiteboardSceneState();
    const message = update({ elements: [rectangle] });

    expect(state.apply("owner_1", message, 0)).toMatchObject({
      kind: "accepted",
      revision: 1,
      replayed: false,
    });
    expect(state.apply("owner_1", message, 1)).toMatchObject({
      kind: "accepted",
      revision: 1,
      replayed: true,
    });
    expect(
      state.apply(
        "owner_1",
        update({
          elements: [{ ...rectangle, version: 2, versionNonce: 101 }],
        }),
        2
      )
    ).toMatchObject({
      kind: "rejected",
      code: "invalid_message",
      currentRevision: 1,
    });
    expect(state.snapshot()).toMatchObject({
      revision: 1,
      scene: { elements: [rectangle] },
    });
  });

  it("rejects future revisions, over-rate updates, and unsafe scene data atomically", () => {
    const state = createWhiteboardSceneState({
      maxElements: 2,
      maxAttachments: 1,
      updateLimit: 1,
      updateWindowMs: 1_000,
    });

    expect(
      state.apply("owner_1", update({ base_revision: 1 }), 0)
    ).toMatchObject({
      kind: "rejected",
      code: "not_synchronized",
      currentRevision: 0,
    });

    expect(
      state.apply(
        "owner_1",
        update({
          elements: [
            {
              id: "image_1",
              type: "image",
              version: 1,
              versionNonce: 1,
              fileId: "attachment_1",
            },
          ],
        }),
        1
      )
    ).toMatchObject({ kind: "accepted", revision: 1 });

    expect(
      state.apply(
        "owner_1",
        update({ update_id: "too-fast", base_revision: 1 }),
        2
      )
    ).toMatchObject({ kind: "rejected", code: "rate_limited" });

    expect(
      state.apply(
        "member_1",
        update({
          update_id: "duplicate-elements",
          base_revision: 1,
          elements: [rectangle, { ...rectangle, versionNonce: 101 }],
        }),
        3
      )
    ).toMatchObject({ kind: "rejected", code: "invalid_message" });

    expect(
      state.apply(
        "member_2",
        update({
          update_id: "embedded-data",
          base_revision: 1,
          elements: [
            {
              ...rectangle,
              id: "unsafe",
              link: "data:image/png;base64,AAAA",
            },
          ],
        }),
        4
      )
    ).toMatchObject({ kind: "rejected", code: "invalid_message" });

    expect(
      state.apply(
        "member_3",
        update({
          update_id: "too-many-elements",
          base_revision: 1,
          elements: [
            rectangle,
            {
              id: "shape_b",
              type: "ellipse",
              version: 1,
              versionNonce: 102,
            },
          ],
        }),
        5
      )
    ).toMatchObject({ kind: "rejected", code: "invalid_message" });

    expect(
      state.apply(
        "member_4",
        update({
          update_id: "too-many-attachments",
          base_revision: 1,
          elements: [
            {
              id: "image_2",
              type: "image",
              version: 1,
              versionNonce: 2,
              fileId: "attachment_2",
            },
          ],
        }),
        6
      )
    ).toMatchObject({ kind: "rejected", code: "invalid_message" });

    expect(state.snapshot()).toMatchObject({
      revision: 1,
      scene: { elements: [expect.objectContaining({ id: "image_1" })] },
    });
  });
});
