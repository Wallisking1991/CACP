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
  return [...events, next].sort((left, right) =>
    left.created_at.localeCompare(right.created_at)
  );
}

export function reconcileAuthoritativeEvents(
  current: CacpEvent[],
  authoritative: CacpEvent[]
): CacpEvent[] {
  const liveOnly = current.filter((event) => event.type.startsWith("orbit."));
  return [...authoritative, ...liveOnly].reduce<CacpEvent[]>(
    (events, event) => mergeEvent(events, event),
    []
  );
}
