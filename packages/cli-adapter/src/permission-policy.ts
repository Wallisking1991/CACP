export function permissionPolicy(level: string, action: string): "allow" | "deny" {
  const normalized = action.toLowerCase();
  const isRead = normalized.includes("read") || normalized.includes("view") || normalized.includes("cat");
  const isUrl = normalized.includes("url");

  switch (level) {
    case "read_only":
      return isRead ? "allow" : "deny";
    case "limited_write":
      return isRead || isUrl ? "allow" : "deny";
    case "full_access":
    case "default":
    default:
      return "allow";
  }
}
