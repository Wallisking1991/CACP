import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FileSystemAttachmentStore } from "../src/attachment-store.js";
import type { StagedAttachment } from "../src/attachment-store.js";
import { localTestConfig } from "./test-config.js";
import {
  markTestAgentReady,
  testConnectorCompatibility,
} from "./test-compatibility.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

class ConcurrentStageAttachmentStore extends FileSystemAttachmentStore {
  private stagedCount = 0;
  private releaseStages: (() => void) | undefined;
  private readonly bothStaged = new Promise<void>((resolve) => {
    this.releaseStages = resolve;
  });

  override async stage(
    stream: Readable,
    maxBytes: number
  ): Promise<StagedAttachment> {
    const staged = await super.stage(stream, maxBytes);
    this.stagedCount += 1;
    if (this.stagedCount === 2) this.releaseStages?.();
    await this.bothStaged;
    return staged;
  }
}

class PausedCommitAttachmentStore extends FileSystemAttachmentStore {
  private releaseCommit: (() => void) | undefined;
  private markCommitStarted: (() => void) | undefined;
  readonly commitStarted = new Promise<void>((resolve) => {
    this.markCommitStarted = resolve;
  });
  private readonly commitReleased = new Promise<void>((resolve) => {
    this.releaseCommit = resolve;
  });

  override async commit(
    staged: StagedAttachment,
    roomId: string,
    attachmentId: string
  ): Promise<void> {
    this.markCommitStarted?.();
    await this.commitReleased;
    return super.commit(staged, roomId, attachmentId);
  }

  resumeCommit(): void {
    this.releaseCommit?.();
  }
}

function multipartFile(
  name: string,
  mediaType: string,
  bytes: Buffer
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "cacp-attachment-boundary";
  return {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mediaType}\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function createRoom(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Attachment Room", display_name: "Owner" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    room_id: string;
    owner_id: string;
    owner_token: string;
  };
}

async function upload(
  app: FastifyInstance,
  roomId: string,
  token: string,
  name = "pixel.png",
  mediaType = "image/png",
  bytes = OnePixelPng,
  idempotencyKey?: string
) {
  const multipart = multipartFile(name, mediaType, bytes);
  return await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/attachments`,
    headers: {
      ...multipart.headers,
      authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload: multipart.payload,
  });
}

describe("ephemeral room attachments", () => {
  const apps: FastifyInstance[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  async function fixture(overrides = {}) {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachments-"));
    roots.push(root);
    const attachmentStore = new FileSystemAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(overrides),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    return { app, room, attachmentStore };
  }

  it("uploads, authenticates, binds, and downloads a verified image", async () => {
    const { app, room } = await fixture();
    const uploaded = await upload(app, room.room_id, room.owner_token);
    expect(uploaded.statusCode).toBe(201);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
      name: string;
      media_type: string;
      size_bytes: number;
      sha256: string;
      kind: string;
      disposition: string;
    };
    expect(attachment).toEqual({
      attachment_id: expect.stringMatching(/^att_/u),
      name: "pixel.png",
      media_type: "image/png",
      size_bytes: OnePixelPng.length,
      sha256: createHash("sha256").update(OnePixelPng).digest("hex"),
      kind: "image",
      disposition: "inline",
    });

    const anonymousDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
    });
    expect(anonymousDownload.statusCode).toBe(401);

    const agentResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        compatibility: testConnectorCompatibility,
        name: "Kimi",
        capabilities: ["kimi-cli"],
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json() as {
      agent_id: string;
      agent_token: string;
    };
    const unboundAgentDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
    });
    expect(unboundAgentDownload.statusCode).toBe(403);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id },
    });
    await markTestAgentReady(
      app,
      room.room_id,
      room.owner_token,
      agent.agent_id,
      agent.agent_token
    );

    const sent = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        text: "Describe this image.",
        attachment_ids: [attachment.attachment_id],
      },
    });
    expect(sent.statusCode).toBe(201);

    const events = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/events`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    const message = (
      events.json().events as Array<{
        type: string;
        payload: Record<string, unknown>;
      }>
    ).find(
      (event) =>
        event.type === "message.created" &&
        event.payload.message_id ===
          (sent.json() as { input_id: string }).input_id
    );
    expect(message?.payload.content as Record<string, unknown>).toMatchObject({
      text: "Describe this image.",
      attachments: [{ attachment_id: attachment.attachment_id }],
    });

    const download = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(OnePixelPng);
    expect(download.headers["cache-control"]).toBe("private, no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("reports room attachment usage and lets the uploader discard an unbound attachment", async () => {
    const { app, room, attachmentStore } = await fixture();
    const uploaded = await upload(app, room.room_id, room.owner_token);
    expect(uploaded.statusCode).toBe(201);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };

    const usage = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toEqual({
      used_bytes: OnePixelPng.length,
      max_bytes: 50 * 1024 * 1024,
      expires_with_room: true,
    });

    const discarded = await app.inject({
      method: "DELETE",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(discarded.statusCode).toBe(204);
    expect(await attachmentStore.storedFiles()).toEqual([]);

    const emptyUsage = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(emptyUsage.json()).toMatchObject({ used_bytes: 0 });
  });

  it("replays an idempotent upload without consuming quota twice and cancels it by participant", async () => {
    const { app, room, attachmentStore } = await fixture();
    const key = "whiteboard-promotion-1-png";

    const first = await upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng,
      key
    );
    const retry = await upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng,
      key
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(await attachmentStore.storedFiles()).toHaveLength(1);
    const usage = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(usage.json()).toMatchObject({ used_bytes: OnePixelPng.length });

    const conflict = await upload(
      app,
      room.room_id,
      room.owner_token,
      "different.txt",
      "text/plain",
      Buffer.from("different"),
      key
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: "attachment_idempotency_conflict",
    });

    const cancelled = await app.inject({
      method: "DELETE",
      url: `/rooms/${room.room_id}/attachment-uploads/${key}`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(cancelled.statusCode).toBe(204);
    expect(await attachmentStore.storedFiles()).toEqual([]);
    const cancelledRetry = await upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng,
      key
    );
    expect(cancelledRetry.statusCode).toBe(409);
    expect(cancelledRetry.json()).toMatchObject({
      error: "attachment_upload_cancelled",
    });
  });

  it("coalesces concurrent uploads that use the same idempotency key", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachments-idempotent-"));
    roots.push(root);
    const attachmentStore = new ConcurrentStageAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    const key = "whiteboard-promotion-concurrent-png";

    const [first, second] = await Promise.all([
      upload(
        app,
        room.room_id,
        room.owner_token,
        "selection.png",
        "image/png",
        OnePixelPng,
        key
      ),
      upload(
        app,
        room.room_id,
        room.owner_token,
        "selection.png",
        "image/png",
        OnePixelPng,
        key
      ),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await attachmentStore.storedFiles()).toHaveLength(1);
  });

  it("removes an idempotent upload when cancellation races its commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachments-cancel-"));
    roots.push(root);
    const attachmentStore = new PausedCommitAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    const key = "whiteboard-promotion-racing-png";

    const pendingUpload = upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng,
      key
    );
    await attachmentStore.commitStarted;
    const cancelled = await app.inject({
      method: "DELETE",
      url: `/rooms/${room.room_id}/attachment-uploads/${key}`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    attachmentStore.resumeCommit();
    const uploaded = await pendingUpload;

    expect(cancelled.statusCode).toBe(204);
    expect(uploaded.statusCode).toBe(409);
    expect(uploaded.json()).toMatchObject({
      error: "attachment_upload_cancelled",
    });
    expect(await attachmentStore.storedFiles()).toEqual([]);
    const usage = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(usage.json()).toMatchObject({ used_bytes: 0 });
  });

  it("removes an upload whose commit completes after the room ends", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachments-room-end-"));
    roots.push(root);
    const attachmentStore = new PausedCommitAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    const pendingUpload = upload(
      app,
      room.room_id,
      room.owner_token,
      "selection.png",
      "image/png",
      OnePixelPng,
      "whiteboard-promotion-room-end"
    );
    await attachmentStore.commitStarted;

    const left = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(left.statusCode).toBe(201);
    attachmentStore.resumeCommit();

    const uploaded = await pendingUpload;
    expect(uploaded.statusCode).toBe(410);
    expect(uploaded.json()).toEqual({ error: "room_ended" });
    expect(await attachmentStore.storedFiles()).toEqual([]);
  });

  it("does not discard an attachment after it is bound to a main input", async () => {
    const { app, room } = await fixture();
    const uploaded = await upload(app, room.room_id, room.owner_token);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };

    const agentResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        compatibility: testConnectorCompatibility,
        name: "Kimi",
        capabilities: ["kimi-cli"],
      },
    });
    const agent = agentResponse.json() as {
      agent_id: string;
      agent_token: string;
    };
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id },
    });
    await markTestAgentReady(
      app,
      room.room_id,
      room.owner_token,
      agent.agent_id,
      agent.agent_token
    );
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        text: "Keep this image.",
        attachment_ids: [attachment.attachment_id],
      },
    });

    const discarded = await app.inject({
      method: "DELETE",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(discarded.statusCode).toBe(409);
    expect(discarded.json()).toMatchObject({
      error: "attachment_already_attached",
    });
  });

  it("deletes attachment bytes before owner leave completes", async () => {
    const { app, room, attachmentStore } = await fixture();
    const uploaded = await upload(app, room.room_id, room.owner_token);
    expect(uploaded.statusCode).toBe(201);
    expect(await attachmentStore.storedFiles()).toHaveLength(1);

    const left = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/leave`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(left.statusCode).toBe(201);
    expect(await attachmentStore.storedFiles()).toEqual([]);
  });

  it("rejects oversized uploads without leaving staged bytes", async () => {
    const { app, room, attachmentStore } = await fixture({
      maxAttachmentBytes: 16,
    });
    const response = await upload(
      app,
      room.room_id,
      room.owner_token,
      "notes.txt",
      "text/plain",
      Buffer.from("This payload is definitely larger than sixteen bytes.")
    );
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: "attachment_too_large" });
    expect(await attachmentStore.storedFiles()).toEqual([]);
  });

  it("reserves room quota atomically across concurrent uploads", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachments-concurrent-"));
    roots.push(root);
    const attachmentStore = new ConcurrentStageAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig({
        maxAttachmentBytes: 16,
        maxRoomAttachmentBytes: 15,
      }),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    const bytes = Buffer.from("0123456789");

    const responses = await Promise.all([
      upload(
        app,
        room.room_id,
        room.owner_token,
        "first.txt",
        "text/plain",
        bytes
      ),
      upload(
        app,
        room.room_id,
        room.owner_token,
        "second.txt",
        "text/plain",
        bytes
      ),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json()
    ).toMatchObject({ error: "room_attachment_quota_exceeded" });
    expect(await attachmentStore.storedFiles()).toHaveLength(1);
  });

  it("keeps active content safe by making SVG download-only", async () => {
    const { app, room } = await fixture();
    const response = await upload(
      app,
      room.room_id,
      room.owner_token,
      "diagram.svg",
      "image/svg+xml",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().attachment).toMatchObject({
      media_type: "image/svg+xml",
      kind: "file",
      disposition: "download",
    });
  });
});
