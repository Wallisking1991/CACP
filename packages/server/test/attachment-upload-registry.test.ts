import { describe, expect, it } from "vitest";
import { AttachmentUploadRegistry } from "../src/attachment-upload-registry.js";

const Identity = {
  roomId: "room_1",
  participantId: "participant_1",
  idempotencyKey: "upload_1",
};

describe("AttachmentUploadRegistry", () => {
  it("coalesces matching work and rejects a conflicting fingerprint", async () => {
    const registry = new AttachmentUploadRegistry<{ id: string }>();
    let releaseCreate = () => {};
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let createCount = 0;
    const run = (fingerprint: string) =>
      registry.run({
        ...Identity,
        fingerprint,
        canReplay: () => true,
        create: async () => {
          createCount += 1;
          await createGate;
          return { id: "attachment_1" };
        },
      });

    const first = run("same");
    const second = run("same");
    releaseCreate();

    await expect(first).resolves.toEqual({
      status: "created",
      result: { id: "attachment_1" },
    });
    await expect(second).resolves.toEqual({
      status: "replayed",
      result: { id: "attachment_1" },
    });
    await expect(run("different")).resolves.toEqual({ status: "conflict" });
    expect(createCount).toBe(1);
  });

  it("lets cancellation win while creation is awaiting I/O", async () => {
    const registry = new AttachmentUploadRegistry<{ id: string }>();
    let releaseCreate = () => {};
    let markCreateStarted = () => {};
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const pending = registry.run({
      ...Identity,
      fingerprint: "same",
      canReplay: () => true,
      create: async () => {
        markCreateStarted();
        await createGate;
        return { id: "attachment_1" };
      },
    });

    await createStarted;
    registry.cancel(Identity);
    releaseCreate();

    await expect(pending).resolves.toEqual({
      status: "cancelled",
      created: { id: "attachment_1" },
    });
    expect(registry.isCancelled(Identity)).toBe(true);
  });

  it("cancels in-flight work and refuses replay when its room is discarded", async () => {
    const registry = new AttachmentUploadRegistry<{ id: string }>();
    let markStarted = () => {};
    let releaseCreate = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const pending = registry.run({
      ...Identity,
      fingerprint: "same",
      canReplay: () => true,
      create: async () => {
        markStarted();
        await gate;
        return { id: "attachment_2" };
      },
    });

    await started;
    registry.discardRoom(Identity.roomId);
    releaseCreate();

    expect(registry.isCancelled(Identity)).toBe(false);
    await expect(pending).resolves.toEqual({
      status: "cancelled",
      created: { id: "attachment_2" },
    });
    await expect(
      registry.run({
        ...Identity,
        fingerprint: "same",
        canReplay: () => true,
        create: async () => ({ id: "attachment_2" }),
      })
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("bounds cancellation records per participant and expires old keys", () => {
    let now = 1_000;
    const registry = new AttachmentUploadRegistry<{ id: string }>({
      maxOperationsPerParticipant: 2,
      maxOperationsPerRoom: 3,
      operationTtlMs: 100,
      now: () => now,
    });
    const identity = (idempotencyKey: string) => ({
      ...Identity,
      idempotencyKey,
    });

    registry.cancel(identity("first"));
    now += 1;
    registry.cancel(identity("second"));
    now += 1;
    registry.cancel(identity("third"));

    expect(registry.isCancelled(identity("first"))).toBe(false);
    expect(registry.isCancelled(identity("second"))).toBe(true);
    expect(registry.isCancelled(identity("third"))).toBe(true);

    now += 101;
    expect(registry.isCancelled(identity("second"))).toBe(false);
    expect(registry.isCancelled(identity("third"))).toBe(false);
  });

  it("never evicts an active cancellation when another key reaches capacity", async () => {
    let now = 1_000;
    const registry = new AttachmentUploadRegistry<{ id: string }>({
      maxOperationsPerParticipant: 1,
      maxOperationsPerRoom: 1,
      operationTtlMs: 10,
      now: () => now,
    });
    let markStarted = () => {};
    let releaseCreate = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const pending = registry.run({
      ...Identity,
      fingerprint: "same",
      canReplay: () => true,
      create: async () => {
        markStarted();
        await gate;
        return { id: "attachment_active" };
      },
    });
    await started;
    expect(registry.cancel(Identity)).toMatchObject({ status: "cancelled" });

    now += 100;
    expect(
      registry.cancel({ ...Identity, idempotencyKey: "upload_2" })
    ).toEqual({ status: "capacity_exceeded" });
    expect(registry.isCancelled(Identity)).toBe(true);
    releaseCreate();

    await expect(pending).resolves.toEqual({
      status: "cancelled",
      created: { id: "attachment_active" },
    });
  });
});
