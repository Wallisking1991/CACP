import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";

export interface StagedAttachment {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface AttachmentStore {
  stage(stream: Readable, maxBytes: number): Promise<StagedAttachment>;
  commit(
    staged: StagedAttachment,
    roomId: string,
    attachmentId: string
  ): Promise<void>;
  discard(staged: StagedAttachment): Promise<void>;
  open(roomId: string, attachmentId: string): Readable;
  delete(roomId: string, attachmentId: string): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  purgeAll(): Promise<void>;
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid_attachment_storage_id");
  }
  return value;
}

export class FileSystemAttachmentStore implements AttachmentStore {
  readonly root: string;
  private readonly tempRoot: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.tempRoot = join(this.root, ".tmp");
  }

  async stage(stream: Readable, maxBytes: number): Promise<StagedAttachment> {
    await mkdir(this.tempRoot, { recursive: true });
    const path = join(this.tempRoot, `upload-${randomUUID()}.tmp`);
    const handle = await open(path, "wx", 0o600);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    try {
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        sizeBytes += chunk.byteLength;
        if (sizeBytes > maxBytes) throw new Error("attachment_too_large");
        hash.update(chunk);
        await handle.write(chunk);
      }
      if (sizeBytes === 0) throw new Error("attachment_empty");
      await handle.sync();
      return { path, sha256: hash.digest("hex"), sizeBytes };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
  }

  async commit(
    staged: StagedAttachment,
    roomId: string,
    attachmentId: string
  ): Promise<void> {
    const roomRoot = join(this.root, "rooms", safeId(roomId));
    await mkdir(roomRoot, { recursive: true });
    await rename(staged.path, join(roomRoot, safeId(attachmentId)));
  }

  async discard(staged: StagedAttachment): Promise<void> {
    await rm(staged.path, { force: true });
  }

  open(roomId: string, attachmentId: string): Readable {
    return createReadStream(
      join(this.root, "rooms", safeId(roomId), safeId(attachmentId))
    );
  }

  async delete(roomId: string, attachmentId: string): Promise<void> {
    await rm(join(this.root, "rooms", safeId(roomId), safeId(attachmentId)), {
      force: true,
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    await rm(join(this.root, "rooms", safeId(roomId)), {
      recursive: true,
      force: true,
    });
  }

  async purgeAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.tempRoot, { recursive: true });
  }

  async storedFiles(): Promise<string[]> {
    const roomsRoot = join(this.root, "rooms");
    try {
      const rooms = await readdir(roomsRoot);
      const files: string[] = [];
      for (const room of rooms) {
        const roomPath = join(roomsRoot, room);
        if (!(await stat(roomPath)).isDirectory()) continue;
        for (const attachment of await readdir(roomPath)) {
          files.push(join(roomPath, attachment));
        }
      }
      return files;
    } catch {
      return [];
    }
  }
}
