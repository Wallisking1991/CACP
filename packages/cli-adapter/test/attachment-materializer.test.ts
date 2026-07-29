import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupRoomAttachments,
  materializeAttachment,
  materializeAttachments,
  roomAttachmentDirectory,
  verifyMaterializedAttachment,
} from "../src/connector/attachment-materializer.js";

describe("connector attachment materialization", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  function attachmentRef(
    attachmentId: string,
    bytes: Buffer,
    overrides: Partial<{
      size_bytes: number;
      sha256: string;
    }> = {}
  ) {
    return {
      attachment_id: attachmentId,
      name: `${attachmentId}.txt`,
      media_type: "text/plain",
      size_bytes: overrides.size_bytes ?? bytes.length,
      sha256:
        overrides.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
      kind: "text" as const,
      disposition: "inline" as const,
    };
  }

  it("downloads into the room-scoped directory and verifies size and SHA-256", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const bytes = Buffer.from("verified attachment");
    const fetchImpl = vi.fn(async () => new Response(bytes));
    const attachment = await materializeAttachment({
      serverUrl: "https://cacp.example.com",
      roomId: "room_1",
      agentToken: "agent-secret",
      workingDir,
      attachment: attachmentRef("att_1", bytes),
      fetchImpl,
    });

    expect(isAbsolute(attachment.path)).toBe(true);
    expect(attachment.path).toBe(
      join(
        roomAttachmentDirectory(workingDir, "room_1"),
        attachment.attachment_id
      )
    );
    expect(readFileSync(attachment.path)).toEqual(bytes);
    await expect(verifyMaterializedAttachment(attachment)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cacp.example.com/rooms/room_1/attachments/att_1",
      { headers: { authorization: "Bearer agent-secret" } }
    );
  });

  it("reuses an already verified room-scoped attachment", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const bytes = Buffer.from("verified attachment");
    const fetchImpl = vi.fn(async () => new Response(bytes));
    const input = {
      serverUrl: "https://cacp.example.com",
      roomId: "room_1",
      agentToken: "agent-secret",
      workingDir,
      attachment: attachmentRef("att_1", bytes),
      fetchImpl,
    };

    const first = await materializeAttachment(input);
    const second = await materializeAttachment(input);

    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects digest mismatches before an Agent turn can start", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const bytes = Buffer.from("tampered attachment");
    await expect(
      materializeAttachment({
        serverUrl: "https://cacp.example.com",
        roomId: "room_1",
        agentToken: "agent-secret",
        workingDir,
        attachment: attachmentRef("att_1", bytes, {
          sha256: "0".repeat(64),
        }),
        fetchImpl: async () => new Response(bytes),
      })
    ).rejects.toThrow("attachment_sha256_mismatch");
  });

  it("rejects room and attachment IDs that could escape the storage root", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    expect(() => roomAttachmentDirectory(workingDir, "../outside")).toThrow(
      "invalid_attachment_storage_id"
    );
    await expect(
      materializeAttachment({
        serverUrl: "https://cacp.example.com",
        roomId: "room_1",
        agentToken: "agent-secret",
        workingDir,
        attachment: attachmentRef("../outside", Buffer.from("x")),
        fetchImpl: async () => new Response("x"),
      })
    ).rejects.toThrow("invalid_attachment_storage_id");
  });

  it("rejects failed, empty, oversized, and truncated downloads", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const bytes = Buffer.from("payload");
    const base = {
      serverUrl: "https://cacp.example.com",
      roomId: "room_1",
      agentToken: "agent-secret",
      workingDir,
    };

    await expect(
      materializeAttachment({
        ...base,
        attachment: attachmentRef("att_failed", bytes),
        fetchImpl: async () => new Response(null, { status: 503 }),
      })
    ).rejects.toThrow("attachment_download_failed:503");

    await expect(
      materializeAttachment({
        ...base,
        attachment: attachmentRef("att_empty", bytes),
        fetchImpl: async () => new Response(null, { status: 200 }),
      })
    ).rejects.toThrow("attachment_download_failed:200");

    await expect(
      materializeAttachment({
        ...base,
        attachment: attachmentRef("att_large", bytes, { size_bytes: 2 }),
        fetchImpl: async () => new Response(bytes),
      })
    ).rejects.toThrow("attachment_size_mismatch");

    await expect(
      materializeAttachment({
        ...base,
        attachment: attachmentRef("att_short", bytes, { size_bytes: 20 }),
        fetchImpl: async () => new Response(bytes),
      })
    ).rejects.toThrow("attachment_size_mismatch");
  });

  it("materializes batches, cleans partial batches on failure, and removes room data", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const first = Buffer.from("first");
    const second = Buffer.from("second");
    const responses = new Map([
      ["att_1", first],
      ["att_2", second],
    ]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const attachmentId = String(url).split("/").at(-1)!;
      const bytes = responses.get(attachmentId);
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    });

    const materialized = await materializeAttachments({
      serverUrl: "https://cacp.example.com",
      roomId: "room_1",
      agentToken: "agent-secret",
      workingDir,
      attachments: [
        attachmentRef("att_1", first),
        attachmentRef("att_2", second),
      ],
      fetchImpl,
    });
    expect(materialized).toHaveLength(2);
    await cleanupRoomAttachments(workingDir, "room_1");
    expect(existsSync(roomAttachmentDirectory(workingDir, "room_1"))).toBe(
      false
    );

    await expect(
      materializeAttachments({
        serverUrl: "https://cacp.example.com",
        roomId: "room_2",
        agentToken: "agent-secret",
        workingDir,
        attachments: [
          attachmentRef("att_1", first),
          attachmentRef("att_missing", second),
        ],
        fetchImpl,
      })
    ).rejects.toThrow("attachment_download_failed:404");
    expect(
      existsSync(join(roomAttachmentDirectory(workingDir, "room_2"), "att_1"))
    ).toBe(false);
  });

  it("detects a materialized file changed after verification", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "cacp-materialize-"));
    roots.push(workingDir);
    const bytes = Buffer.from("original");
    const attachment = await materializeAttachment({
      serverUrl: "https://cacp.example.com",
      roomId: "room_1",
      agentToken: "agent-secret",
      workingDir,
      attachment: attachmentRef("att_1", bytes),
      fetchImpl: async () => new Response(bytes),
    });
    writeFileSync(attachment.path, "changed");
    await expect(verifyMaterializedAttachment(attachment)).resolves.toBe(false);
  });
});
