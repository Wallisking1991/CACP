import type { WhiteboardElement } from "./schemas.js";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function preferredElement(
  current: WhiteboardElement,
  incoming: WhiteboardElement
): WhiteboardElement {
  if (incoming.version !== current.version) {
    return incoming.version > current.version ? incoming : current;
  }
  if (incoming.versionNonce !== current.versionNonce) {
    return incoming.versionNonce < current.versionNonce ? incoming : current;
  }
  return stableSerialize(incoming) < stableSerialize(current)
    ? incoming
    : current;
}

export function reconcileWhiteboardElements(
  current: readonly WhiteboardElement[],
  incoming: readonly WhiteboardElement[]
): WhiteboardElement[] {
  const merged = [...current];
  const indexes = new Map(
    merged.map((element, index) => [element.id, index] as const)
  );
  for (const element of incoming) {
    const index = indexes.get(element.id);
    if (index === undefined) {
      indexes.set(element.id, merged.length);
      merged.push(element);
      continue;
    }
    merged[index] = preferredElement(merged[index]!, element);
  }
  return merged;
}
