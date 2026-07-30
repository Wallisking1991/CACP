import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FileSystemAttachmentStore } from "../src/attachment-store.js";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";
import {
  markTestAgentReady,
  testConnectorCompatibility,
} from "./test-compatibility.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function multipartFile(name: string, mediaType: string, bytes: Buffer) {
  const boundary = "cacp-orbit-attachment-boundary";
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
    payload: { name: "Orbit attachments", display_name: "Owner" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    room_id: string;
    owner_id: string;
    owner_token: string;
  };
}

async function inviteHuman(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  role: "member" | "observer"
) {
  const invitation = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role },
  });
  const { invite_token } = invitation.json() as { invite_token: string };
  const requested = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests`,
    payload: {
      invite_token,
      display_name: role === "member" ? "Member" : "Observer",
    },
  });
  const request = requested.json() as {
    request_id: string;
    request_token: string;
  };
  await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/join-requests/${request.request_id}/approve`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {},
  });
  const joined = await app.inject({
    method: "GET",
    url: `/rooms/${roomId}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`,
  });
  const body = joined.json() as {
    participant_id: string;
    participant_token: string;
  };
  return { id: body.participant_id, token: body.participant_token };
}

async function upload(app: FastifyInstance, roomId: string, token: string) {
  const multipart = multipartFile("pixel.png", "image/png", OnePixelPng);
  return await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/attachments`,
    headers: {
      ...multipart.headers,
      authorization: `Bearer ${token}`,
    },
    payload: multipart.payload,
  });
}

async function registerAgent(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  name: string
) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agents/register`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      compatibility: testConnectorCompatibility,
      name,
      capabilities: ["kimi-cli"],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { agent_id: string; agent_token: string };
}

describe("Orbit Discussion attachments", () => {
  const apps: FastifyInstance[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), "cacp-orbit-attachments-"));
    roots.push(root);
    const attachmentStore = new FileSystemAttachmentStore(root);
    const app = await buildServer({
      dbPath: ":memory:",
      config: localTestConfig(),
      attachmentStore,
    });
    apps.push(app);
    const room = await createRoom(app);
    return { app, room, attachmentStore };
  }

  it("lets a member upload an attachment-only note that humans, but not agents, can download", async () => {
    const { app, room } = await fixture();
    const member = await inviteHuman(
      app,
      room.room_id,
      room.owner_token,
      "member"
    );
    const observer = await inviteHuman(
      app,
      room.room_id,
      room.owner_token,
      "observer"
    );
    const agent = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Unselected Agent"
    );

    const observerUpload = await upload(app, room.room_id, observer.token);
    expect(observerUpload.statusCode).toBe(403);

    const uploaded = await upload(app, room.room_id, member.token);
    expect(uploaded.statusCode).toBe(201);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };

    const note = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { text: "", attachment_ids: [attachment.attachment_id] },
    });
    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      note_id: expect.stringMatching(/^note_/u),
      attachments: [{ attachment_id: attachment.attachment_id }],
    });

    const humanDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${room.owner_token}` },
    });
    expect(humanDownload.statusCode).toBe(200);

    const observerDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${observer.token}` },
    });
    expect(observerDownload.statusCode).toBe(200);

    const agentDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${agent.agent_token}` },
    });
    expect(agentDownload.statusCode).toBe(403);
  });

  it("deletes attachment bytes when Orbit is cleared and no other content references them", async () => {
    const { app, room, attachmentStore } = await fixture();
    const uploaded = await upload(app, room.room_id, room.owner_token);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        text: "Temporary evidence",
        attachment_ids: [attachment.attachment_id],
      },
    });

    const cleared = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });

    expect(cleared.statusCode).toBe(201);
    expect(await attachmentStore.storedFiles()).toEqual([]);
  });

  it("keeps promoted bytes after clear and grants only the targeted Agent", async () => {
    const { app, room, attachmentStore } = await fixture();
    const target = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Target Agent"
    );
    const other = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Other Agent"
    );
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: target.agent_id },
    });
    await markTestAgentReady(
      app,
      room.room_id,
      room.owner_token,
      target.agent_id,
      target.agent_token
    );

    const uploaded = await upload(app, room.room_id, room.owner_token);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };
    const noteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "", attachment_ids: [attachment.attachment_id] },
    });
    const { note_id } = noteResponse.json() as { note_id: string };

    const missingInstruction = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        note_ids: [note_id],
        attachment_ids: [attachment.attachment_id],
        instruction: "",
      },
    });
    expect(missingInstruction.statusCode).toBe(400);

    const promoted = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        note_ids: [note_id],
        attachment_ids: [attachment.attachment_id],
        instruction: "Inspect this image.",
      },
    });
    expect(promoted.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(await attachmentStore.storedFiles()).toHaveLength(1);

    const targetDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${target.agent_token}` },
    });
    expect(targetDownload.statusCode).toBe(200);

    const otherDownload = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/attachments/${attachment.attachment_id}`,
      headers: { authorization: `Bearer ${other.agent_token}` },
    });
    expect(otherDownload.statusCode).toBe(403);
  });

  it("keeps an excluded attachment out of the promoted input and deletes it on clear", async () => {
    const { app, room, attachmentStore } = await fixture();
    const target = await registerAgent(
      app,
      room.room_id,
      room.owner_token,
      "Target Agent"
    );
    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: target.agent_id },
    });
    await markTestAgentReady(
      app,
      room.room_id,
      room.owner_token,
      target.agent_id,
      target.agent_token
    );

    const uploaded = await upload(app, room.room_id, room.owner_token);
    const attachment = uploaded.json().attachment as {
      attachment_id: string;
    };
    const noteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/notes`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        text: "Text survives without forwarding the image.",
        attachment_ids: [attachment.attachment_id],
      },
    });
    const { note_id } = noteResponse.json() as { note_id: string };

    const promoted = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {
        note_ids: [note_id],
        attachment_ids: [],
        instruction: "",
      },
    });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json()).toMatchObject({ attachment_count: 0 });

    const promotedAgain = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/promote`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { note_ids: [note_id], attachment_ids: [] },
    });
    expect(promotedAgain.statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/orbit/clear`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {},
    });
    expect(await attachmentStore.storedFiles()).toEqual([]);
  });
});
