const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

export function slugifyRoomTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (WINDOWS_RESERVED_NAMES.has(slug)) {
    return `${slug}-room`;
  }
  return slug;
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
