export function slugifyRoomTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function roomAssetDirectory(input: {
  baseDir: string;
  roomId: string;
  roomName?: string;
  includeExports?: boolean;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugifyRoomTitle(input.roomName ?? "");
  const suffix = slug ? `-${slug}` : "";
  const base = `${input.baseDir}/.cacp/rooms/${date}${suffix}-${input.roomId}`;
  return input.includeExports ? `${base}/exports` : base;
}
