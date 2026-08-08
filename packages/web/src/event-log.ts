import type { CacpEvent } from "@cacp/protocol";

function orbitNoteId(event: CacpEvent): string | undefined {
  if (event.type !== "orbit.note.created") return undefined;
  return typeof event.payload.note_id === "string"
    ? event.payload.note_id
    : undefined;
}

function isDuplicateEvent(events: CacpEvent[], next: CacpEvent): boolean {
  if (events.some((event) => event.event_id === next.event_id)) return true;
  const noteId = orbitNoteId(next);
  return (
    noteId !== undefined &&
    events.some(
      (event) => event.room_id === next.room_id && orbitNoteId(event) === noteId
    )
  );
}

export function mergeEvent(events: CacpEvent[], next: CacpEvent): CacpEvent[] {
  if (isDuplicateEvent(events, next)) return events;
  const last = events.at(-1);
  if (!last || last.created_at.localeCompare(next.created_at) <= 0) {
    return [...events, next];
  }

  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].created_at.localeCompare(next.created_at) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return [...events.slice(0, low), next, ...events.slice(low)];
}

export function mergeEvents(
  events: CacpEvent[],
  incoming: CacpEvent[]
): CacpEvent[] {
  const eventIds = new Set<string>();
  const orbitNoteIds = new Set<string>();
  const merged: CacpEvent[] = [];

  for (const event of [...events, ...incoming]) {
    const eventId = event.event_id;
    const noteId = orbitNoteId(event);
    if (eventIds.has(eventId) || (noteId && orbitNoteIds.has(noteId))) {
      continue;
    }
    eventIds.add(eventId);
    if (noteId) orbitNoteIds.add(noteId);
    merged.push(event);
  }

  return merged.sort((left, right) =>
    left.created_at.localeCompare(right.created_at)
  );
}

export function reconcileAuthoritativeEvents(
  current: CacpEvent[],
  authoritative: CacpEvent[]
): CacpEvent[] {
  const liveOnly = current.filter((event) => event.type.startsWith("orbit."));
  return mergeEvents(authoritative, liveOnly);
}
