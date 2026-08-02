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
  it("keeps a throttled snapshot ring bounded by count and compressed bytes", () => {
    const state = createWhiteboardSceneState({
      snapshotCadenceMs: 1_000,
      maxSnapshotCount: 2,
      maxSnapshotBytes: 2_000,
    });

    state.apply("owner_1", update({ elements: [rectangle] }), 0);
    state.apply(
      "owner_1",
      update({
        update_id: "update_2",
        base_revision: 1,
        elements: [{ ...rectangle, version: 2, versionNonce: 101, x: 30 }],
      }),
      500
    );
    expect(state.listSnapshots()).toMatchObject([
      { revision: 1, reason: "automatic", element_count: 1 },
    ]);

    state.apply(
      "owner_1",
      update({
        update_id: "update_3",
        base_revision: 2,
        elements: [{ ...rectangle, version: 3, versionNonce: 102, x: 40 }],
      }),
      1_000
    );
    state.apply(
      "owner_1",
      update({
        update_id: "update_4",
        base_revision: 3,
        elements: [{ ...rectangle, version: 4, versionNonce: 103, x: 50 }],
      }),
      2_000
    );

    const snapshots = state.listSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.revision)).toEqual([4, 3]);
    expect(
      snapshots.reduce(
        (total, snapshot) => total + snapshot.compressed_bytes,
        0
      )
    ).toBeLessThanOrEqual(2_000);
  });

  it("captures pre-operation state and clears or restores into monotonic revisions", () => {
    const committed: unknown[] = [];
    const state = createWhiteboardSceneState({
      snapshotCadenceMs: 10_000,
      commitScene(scene) {
        committed.push(scene);
        return undefined;
      },
    });
    state.apply("owner_1", update({ elements: [rectangle] }), 0);
    const target = state.listSnapshots()[0]!;

    expect(state.clear("owner_1", 0, 1)).toMatchObject({
      kind: "rejected",
      code: "stale_revision",
      currentRevision: 1,
    });
    expect(state.clear("owner_1", 1, 2)).toMatchObject({
      kind: "accepted",
      revision: 2,
      scene: { elements: [], app_state: {} },
    });
    expect(state.listSnapshots()).toContainEqual(
      expect.objectContaining({ revision: 1, reason: "pre_operation" })
    );

    expect(state.restore("owner_1", target.snapshot_id, 1, 3)).toMatchObject({
      kind: "rejected",
      code: "stale_revision",
      currentRevision: 2,
    });
    expect(state.restore("owner_1", "missing", 2, 4)).toMatchObject({
      kind: "rejected",
      code: "snapshot_not_found",
      currentRevision: 2,
    });
    expect(state.restore("owner_1", target.snapshot_id, 2, 5)).toMatchObject({
      kind: "accepted",
      revision: 3,
      scene: { elements: [rectangle] },
      targetRevision: 1,
    });
    expect(state.snapshot()).toMatchObject({
      revision: 3,
      scene: { elements: [rectangle] },
    });
    expect(committed).toHaveLength(3);
  });

  it("rejects pre-operation in-flight and replayed frames after a reset", () => {
    const state = createWhiteboardSceneState();
    const first = update({ elements: [rectangle] });
    expect(state.apply("owner_1", first, 0)).toMatchObject({ revision: 1 });
    expect(state.clear("owner_1", 1, 1)).toMatchObject({
      kind: "accepted",
      revision: 2,
    });

    expect(
      state.apply(
        "owner_1",
        update({
          update_id: "in-flight-before-clear",
          base_revision: 1,
          elements: [rectangle],
        }),
        2
      )
    ).toMatchObject({
      kind: "rejected",
      code: "not_synchronized",
      currentRevision: 2,
    });
    expect(state.apply("owner_1", first, 3)).toMatchObject({
      kind: "rejected",
      code: "not_synchronized",
      currentRevision: 2,
    });
    expect(state.snapshot()).toMatchObject({
      revision: 2,
      scene: { elements: [] },
    });
  });

  it("enforces compressed snapshot bytes and throttles failed captures", () => {
    const state = createWhiteboardSceneState({
      snapshotCadenceMs: 1_000,
      maxSnapshotCount: 20,
      maxSnapshotBytes: 100,
    });
    const noisy = {
      ...rectangle,
      customData: {
        noise: "q7m#P1v!x9K@r4T$z8N%a2C^d6F&h0J*s3L(y5B)u1W_e7R+i9O=p4G",
      },
    };

    expect(
      state.apply("owner_1", update({ elements: [noisy] }), 0)
    ).toMatchObject({ kind: "accepted", revision: 1 });
    expect(state.listSnapshots()).toHaveLength(0);
    expect(
      state.apply(
        "owner_1",
        update({
          update_id: "within-cadence",
          base_revision: 1,
          elements: [{ ...noisy, version: 2, versionNonce: 102 }],
        }),
        10
      )
    ).toMatchObject({ kind: "accepted", revision: 2 });
    expect(state.listSnapshots()).toHaveLength(0);
    expect(state.clear("owner_1", 2, 20)).toMatchObject({
      kind: "rejected",
      code: "snapshot_unavailable",
      currentRevision: 2,
    });
  });

  it("pins restored image attachments while the target snapshot is evicted", () => {
    const snapshotAttachmentCommits: string[][] = [];
    const state = createWhiteboardSceneState({
      maxSnapshotCount: 1,
      snapshotCadenceMs: 10_000,
      commitScene: () => undefined,
      commitSnapshotAttachments(attachmentIds) {
        snapshotAttachmentCommits.push(attachmentIds);
        return undefined;
      },
    });
    const image = {
      id: "image_1",
      type: "image",
      version: 1,
      versionNonce: 1,
      fileId: "att_image",
    };
    state.apply("owner_1", update({ elements: [image] }), 0);
    const target = state.listSnapshots()[0]!;
    state.apply(
      "owner_1",
      update({
        update_id: "delete_image",
        base_revision: 1,
        elements: [{ ...image, version: 2, isDeleted: true }],
      }),
      1
    );

    expect(state.restore("owner_1", target.snapshot_id, 2, 2)).toMatchObject({
      kind: "accepted",
      revision: 3,
    });
    expect(snapshotAttachmentCommits).toEqual([
      ["att_image"],
      ["att_image"],
      [],
    ]);
  });

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
    const state = createWhiteboardSceneState({ updateLimit: 1 });
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
        1_001
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
      state.apply("future_member", update({ base_revision: 1 }), 0)
    ).toMatchObject({
      kind: "rejected",
      code: "not_synchronized",
      currentRevision: 0,
    });
    expect(
      state.apply(
        "future_member",
        update({ update_id: "future-again", base_revision: 1 }),
        1
      )
    ).toMatchObject({ kind: "rejected", code: "rate_limited" });

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

  it("rejects deeply nested and oversized canonical scenes without mutation", () => {
    const state = createWhiteboardSceneState({
      maxSceneBytes: 300,
      updateLimit: 10,
    });
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 40; depth += 1) {
      nested = { child: nested };
    }

    let deeplyNestedResult: ReturnType<typeof state.apply> | undefined;
    expect(() => {
      deeplyNestedResult = state.apply(
        "owner_1",
        update({ elements: [{ ...rectangle, customData: nested }] }),
        0
      );
    }).not.toThrow();
    expect(deeplyNestedResult).toMatchObject({
      kind: "rejected",
      code: "invalid_message",
    });
    expect(
      state.apply(
        "owner_1",
        update({
          update_id: "too-large-scene",
          elements: [
            {
              ...rectangle,
              id: "large-text",
              type: "text",
              text: "x".repeat(500),
            },
          ],
        }),
        1
      )
    ).toMatchObject({ kind: "rejected", code: "invalid_message" });
    expect(state.snapshot()).toEqual({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });
  });

  it("commits external scene references before advancing the revision", () => {
    let rejection = "The referenced image is unavailable." as
      string | undefined;
    const committedScenes: unknown[] = [];
    const state = createWhiteboardSceneState({
      commitScene(scene) {
        committedScenes.push(scene);
        return rejection;
      },
    });
    const imageUpdate = update({
      elements: [
        {
          id: "image_1",
          type: "image",
          version: 1,
          versionNonce: 1,
          fileId: "att_image",
        },
      ],
    });

    expect(state.apply("owner_1", imageUpdate, 0)).toMatchObject({
      kind: "rejected",
      code: "invalid_message",
      currentRevision: 0,
      message: "The referenced image is unavailable.",
    });
    expect(state.snapshot()).toEqual({
      revision: 0,
      scene: { elements: [], app_state: {} },
    });

    rejection = undefined;
    expect(state.apply("owner_1", imageUpdate, 1)).toMatchObject({
      kind: "accepted",
      revision: 1,
    });
    expect(committedScenes).toHaveLength(2);
  });
});
