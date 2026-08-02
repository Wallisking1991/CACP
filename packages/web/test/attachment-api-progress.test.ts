import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelAttachmentUpload,
  deleteAttachment,
  fetchAttachmentUsage,
  uploadAttachment,
} from "../src/attachment-api.js";

const session = {
  room_id: "room_1",
  token: "owner-token",
};

const attachment = {
  attachment_id: "att_1",
  name: "notes.txt",
  media_type: "text/plain",
  size_bytes: 5,
  sha256: "0".repeat(64),
  kind: "text" as const,
  disposition: "inline" as const,
};

class FakeXmlHttpRequest {
  static latest: FakeXmlHttpRequest | undefined;

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
  } = { onprogress: null };
  readonly headers = new Map<string, string>();
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  aborted = false;

  constructor() {
    FakeXmlHttpRequest.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXmlHttpRequest.latest = undefined;
});

describe("attachment browser transport", () => {
  it("reports byte progress while uploading a room attachment", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const onProgress = vi.fn();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const result = uploadAttachment(session, file, {
      idempotencyKey: "whiteboard-promotion-1-png",
      onProgress,
    });
    const request = FakeXmlHttpRequest.latest!;
    request.upload.onprogress?.({
      lengthComputable: true,
      loaded: 2,
      total: 5,
    } as ProgressEvent);
    request.status = 201;
    request.responseText = JSON.stringify({ attachment });
    request.onload?.();

    await expect(result).resolves.toEqual(attachment);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded_bytes: 2,
      total_bytes: 5,
      percent: 40,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded_bytes: 5,
      total_bytes: 5,
      percent: 100,
    });
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/rooms/room_1/attachments");
    expect(request.headers.get("authorization")).toBe("Bearer owner-token");
    expect(request.headers.get("idempotency-key")).toBe(
      "whiteboard-promotion-1-png"
    );
  });

  it("aborts an in-flight room attachment upload", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const controller = new AbortController();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const result = uploadAttachment(session, file, {
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    controller.abort();

    expect(FakeXmlHttpRequest.latest?.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an upload that was cancelled before transport starts", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const controller = new AbortController();
    controller.abort();

    const result = uploadAttachment(
      session,
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      {
        signal: controller.signal,
        onProgress: vi.fn(),
      }
    );

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXmlHttpRequest.latest?.body).toBeNull();
  });

  it("reports XHR network and HTTP upload failures", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const networkFailure = uploadAttachment(session, file, {
      onProgress: vi.fn(),
    });
    FakeXmlHttpRequest.latest?.onerror?.();
    await expect(networkFailure).rejects.toThrow(
      "attachment_upload_network_error"
    );

    const httpFailure = uploadAttachment(session, file, {
      onProgress: vi.fn(),
    });
    const request = FakeXmlHttpRequest.latest!;
    request.status = 413;
    request.responseText = "attachment_too_large";
    request.onload?.();
    await expect(httpFailure).rejects.toThrow("attachment_too_large");
  });

  it("falls back to fetch and reports completion when XHR is unavailable", async () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    const onProgress = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ attachment })));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    await expect(
      uploadAttachment(session, file, {
        idempotencyKey: "whiteboard-promotion-1-source",
        onProgress,
      })
    ).resolves.toEqual(attachment);
    expect(onProgress).toHaveBeenCalledWith({
      loaded_bytes: 5,
      total_bytes: 5,
      percent: 100,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/rooms/room_1/attachments",
      expect.objectContaining({
        headers: {
          authorization: "Bearer owner-token",
          "idempotency-key": "whiteboard-promotion-1-source",
        },
      })
    );
  });

  it("cancels an upload idempotency key through the authenticated room endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cancelAttachmentUpload(session, "whiteboard-promotion-1-png")
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/rooms/room_1/attachment-uploads/whiteboard-promotion-1-png",
      {
        method: "DELETE",
        headers: { authorization: "Bearer owner-token" },
        keepalive: true,
      }
    );
  });

  it("reads usage and discards an unbound room attachment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            used_bytes: 5,
            max_bytes: 50 * 1024 * 1024,
            expires_with_room: true,
          })
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAttachmentUsage(session)).resolves.toMatchObject({
      used_bytes: 5,
      expires_with_room: true,
    });
    await expect(deleteAttachment(session, "att/1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/rooms/room_1/attachments/att%2F1",
      {
        method: "DELETE",
        headers: { authorization: "Bearer owner-token" },
      }
    );
  });

  it("surfaces usage and delete endpoint failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("usage_unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("attachment_already_attached", { status: 409 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAttachmentUsage(session)).rejects.toThrow(
      "usage_unavailable"
    );
    await expect(deleteAttachment(session, "att_1")).rejects.toThrow(
      "attachment_already_attached"
    );
  });
});
