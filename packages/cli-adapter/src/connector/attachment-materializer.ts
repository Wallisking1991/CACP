import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import type { AttachmentRef } from "@cacp/protocol";

export interface MaterializedAttachment extends AttachmentRef {
  path: string;
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid_attachment_storage_id");
  }
  return value;
}

export function roomAttachmentDirectory(
  workingDir: string,
  roomId: string
): string {
  return resolve(workingDir, ".cacp", "rooms", safeId(roomId), "attachments");
}

export async function materializeAttachment(input: {
  serverUrl: string;
  roomId: string;
  agentToken: string;
  workingDir: string;
  attachment: AttachmentRef;
  fetchImpl?: typeof fetch;
}): Promise<MaterializedAttachment> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const directory = roomAttachmentDirectory(input.workingDir, input.roomId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, safeId(input.attachment.attachment_id));
  const materialized = { ...input.attachment, path };
  if (await verifyExistingAttachment(materialized)) {
    return materialized;
  }
  const temporaryPath = join(
    directory,
    `.${safeId(input.attachment.attachment_id)}-${randomUUID()}.tmp`
  );
  const response = await fetchImpl(
    `${input.serverUrl}/rooms/${encodeURIComponent(input.roomId)}/attachments/${encodeURIComponent(input.attachment.attachment_id)}`,
    {
      headers: { authorization: `Bearer ${input.agentToken}` },
    }
  );
  if (!response.ok || !response.body) {
    throw new Error(`attachment_download_failed:${response.status}`);
  }

  const handle = await open(temporaryPath, "wx", 0o600);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    const stream = Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream<Uint8Array>
    );
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > input.attachment.size_bytes) {
        throw new Error("attachment_size_mismatch");
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }

  if (sizeBytes !== input.attachment.size_bytes) {
    await rm(temporaryPath, { force: true });
    throw new Error("attachment_size_mismatch");
  }
  if (hash.digest("hex") !== input.attachment.sha256) {
    await rm(temporaryPath, { force: true });
    throw new Error("attachment_sha256_mismatch");
  }
  await rm(path, { force: true });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      (code === "EEXIST" || code === "EPERM") &&
      (await verifyExistingAttachment(materialized))
    ) {
      await rm(temporaryPath, { force: true });
      return materialized;
    }
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return materialized;
}

export async function materializeAttachments(input: {
  serverUrl: string;
  roomId: string;
  agentToken: string;
  workingDir: string;
  attachments: AttachmentRef[];
  fetchImpl?: typeof fetch;
}): Promise<MaterializedAttachment[]> {
  const materialized: MaterializedAttachment[] = [];
  try {
    for (const attachment of input.attachments) {
      materialized.push(await materializeAttachment({ ...input, attachment }));
    }
    return materialized;
  } catch (error) {
    await Promise.all(
      materialized.map((attachment) => rm(attachment.path, { force: true }))
    );
    throw error;
  }
}

export async function cleanupRoomAttachments(
  workingDir: string,
  roomId: string
): Promise<void> {
  await rm(roomAttachmentDirectory(workingDir, roomId), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

export async function verifyMaterializedAttachment(
  attachment: MaterializedAttachment
): Promise<boolean> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(attachment.path)) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += value.byteLength;
    hash.update(value);
  }
  return (
    sizeBytes === attachment.size_bytes &&
    hash.digest("hex") === attachment.sha256
  );
}

async function verifyExistingAttachment(
  attachment: MaterializedAttachment
): Promise<boolean> {
  try {
    return await verifyMaterializedAttachment(attachment);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
