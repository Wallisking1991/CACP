import { AttachmentRefSchema, type AttachmentRef } from "@cacp/protocol";

export interface AttachmentSession {
  room_id: string;
  token: string;
}

export async function uploadAttachment(
  session: AttachmentSession,
  file: File
): Promise<AttachmentRef> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`/rooms/${session.room_id}/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: form,
  });
  if (!response.ok) throw new Error(await response.text());
  const body = (await response.json()) as { attachment?: unknown };
  return AttachmentRefSchema.parse(body.attachment);
}

export async function fetchAttachmentBlob(
  session: AttachmentSession,
  attachmentId: string
): Promise<Blob> {
  const response = await fetch(
    `/rooms/${session.room_id}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { authorization: `Bearer ${session.token}` } }
  );
  if (!response.ok) throw new Error(await response.text());
  return await response.blob();
}
