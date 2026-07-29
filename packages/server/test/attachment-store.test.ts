import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemAttachmentStore } from "../src/attachment-store.js";

describe("filesystem attachment store", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachment-store-"));
    roots.push(root);
    return { root, store: new FileSystemAttachmentStore(root) };
  }

  it("stages, commits, opens, deletes, and purges attachment data", async () => {
    const { root, store } = fixture();
    const staged = await store.stage(Readable.from(["hello"]), 10);
    expect(staged.sizeBytes).toBe(5);
    expect(existsSync(staged.path)).toBe(true);

    await store.commit(staged, "room_1", "att_1");
    const stored = await store.storedFiles();
    expect(stored).toHaveLength(1);
    expect(readFileSync(stored[0], "utf8")).toBe("hello");

    const chunks: Buffer[] = [];
    for await (const chunk of store.open("room_1", "att_1")) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello");

    await store.delete("room_1", "att_1");
    expect(await store.storedFiles()).toEqual([]);

    const stagedAgain = await store.stage(Readable.from(["again"]), 10);
    await store.commit(stagedAgain, "room_1", "att_2");
    await store.deleteRoom("room_1");
    expect(await store.storedFiles()).toEqual([]);

    await store.purgeAll();
    expect(existsSync(join(root, ".tmp"))).toBe(true);
  });

  it("rejects empty and oversized streams and discards staged files", async () => {
    const { store } = fixture();
    await expect(store.stage(Readable.from([]), 10)).rejects.toThrow(
      "attachment_empty"
    );
    await expect(store.stage(Readable.from(["too large"]), 2)).rejects.toThrow(
      "attachment_too_large"
    );

    const staged = await store.stage(Readable.from(["ok"]), 10);
    await store.discard(staged);
    expect(existsSync(staged.path)).toBe(false);
  });

  it("rejects storage IDs that could escape the root", async () => {
    const { store } = fixture();
    const staged = await store.stage(Readable.from(["ok"]), 10);
    await expect(store.commit(staged, "../room", "att_1")).rejects.toThrow(
      "invalid_attachment_storage_id"
    );
    await expect(store.commit(staged, "room_1", "../att")).rejects.toThrow(
      "invalid_attachment_storage_id"
    );
    expect(() => store.open("room_1", "../att")).toThrow(
      "invalid_attachment_storage_id"
    );
    await store.discard(staged);
  });

  it("ignores non-room files and missing room roots while enumerating", async () => {
    const { root, store } = fixture();
    expect(await store.storedFiles()).toEqual([]);
    const roomsRoot = join(root, "rooms");
    mkdirSync(roomsRoot, { recursive: true });
    writeFileSync(join(roomsRoot, "not-a-room"), "ignored");
    expect(await store.storedFiles()).toEqual([]);
  });
});
