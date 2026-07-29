import { AttachmentRefSchema, type AttachmentRef } from "@cacp/protocol";

export interface AttachmentSession {
  room_id: string;
  token: string;
}

export interface AttachmentUploadProgress {
  loaded_bytes: number;
  total_bytes: number;
  percent: number;
}

export interface AttachmentUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AttachmentUploadProgress) => void;
}

export interface AttachmentUsage {
  used_bytes: number;
  max_bytes: number;
  expires_with_room: true;
}

function attachmentCollectionUrl(session: AttachmentSession): string {
  return `/rooms/${encodeURIComponent(session.room_id)}/attachments`;
}

function uploadAttachmentWithProgress(
  session: AttachmentSession,
  file: File,
  options: AttachmentUploadOptions
): Promise<AttachmentRef> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);

    const cleanup = () =>
      options.signal?.removeEventListener("abort", handleSignalAbort);
    const rejectAbort = () => {
      cleanup();
      reject(new DOMException("Attachment upload cancelled", "AbortError"));
    };
    const handleSignalAbort = () => request.abort();

    request.open("POST", attachmentCollectionUrl(session));
    request.setRequestHeader("authorization", `Bearer ${session.token}`);
    request.upload.onprogress = (event) => {
      const total =
        event.lengthComputable && event.total > 0 ? event.total : file.size;
      const loaded = Math.min(event.loaded, total);
      options.onProgress?.({
        loaded_bytes: loaded,
        total_bytes: total,
        percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
      });
    };
    request.onerror = () => {
      cleanup();
      reject(new Error("attachment_upload_network_error"));
    };
    request.onabort = rejectAbort;
    request.onload = () => {
      cleanup();
      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(
            request.responseText || `attachment_upload_failed:${request.status}`
          )
        );
        return;
      }
      try {
        const body = JSON.parse(request.responseText) as {
          attachment?: unknown;
        };
        const attachment = AttachmentRefSchema.parse(body.attachment);
        options.onProgress?.({
          loaded_bytes: file.size,
          total_bytes: file.size,
          percent: 100,
        });
        resolve(attachment);
      } catch (error) {
        reject(error);
      }
    };

    if (options.signal?.aborted) {
      rejectAbort();
      return;
    }
    options.signal?.addEventListener("abort", handleSignalAbort, {
      once: true,
    });
    request.send(form);
  });
}

export async function uploadAttachment(
  session: AttachmentSession,
  file: File,
  options: AttachmentUploadOptions = {}
): Promise<AttachmentRef> {
  if (options.onProgress && typeof XMLHttpRequest !== "undefined") {
    return await uploadAttachmentWithProgress(session, file, options);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(attachmentCollectionUrl(session), {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: form,
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await response.text());
  const body = (await response.json()) as { attachment?: unknown };
  const attachment = AttachmentRefSchema.parse(body.attachment);
  options.onProgress?.({
    loaded_bytes: file.size,
    total_bytes: file.size,
    percent: 100,
  });
  return attachment;
}

export async function fetchAttachmentUsage(
  session: AttachmentSession
): Promise<AttachmentUsage> {
  const response = await fetch(attachmentCollectionUrl(session), {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as AttachmentUsage;
}

export async function deleteAttachment(
  session: AttachmentSession,
  attachmentId: string
): Promise<void> {
  const response = await fetch(
    `${attachmentCollectionUrl(session)}/${encodeURIComponent(attachmentId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.token}` },
    }
  );
  if (!response.ok) throw new Error(await response.text());
}

export async function fetchAttachmentBlob(
  session: AttachmentSession,
  attachmentId: string
): Promise<Blob> {
  const response = await fetch(
    `${attachmentCollectionUrl(session)}/${encodeURIComponent(attachmentId)}`,
    { headers: { authorization: `Bearer ${session.token}` } }
  );
  if (!response.ok) throw new Error(await response.text());
  return await response.blob();
}
