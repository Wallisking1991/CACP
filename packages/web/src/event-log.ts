import type { CacpEvent } from "@cacp/protocol";

export interface EventCursor {
  takeNew(events: readonly CacpEvent[]): CacpEvent[];
}

export function createEventCursor(): EventCursor {
  let previousEvents: readonly CacpEvent[] = [];
  const knownEventIds = new Set<string>();

  return {
    takeNew(events) {
      if (events === previousEvents) return [];

      const previousTail = previousEvents.at(-1);
      const isStrictAppend =
        events.length > previousEvents.length &&
        (!previousTail || events[previousEvents.length - 1] === previousTail);
      const candidates = isStrictAppend
        ? events.slice(previousEvents.length)
        : events;
      const appended = candidates.filter(
        (event) => !knownEventIds.has(event.event_id)
      );
      for (const event of appended) knownEventIds.add(event.event_id);
      previousEvents = events;
      return appended;
    },
  };
}

function orbitNoteId(event: CacpEvent): string | undefined {
  if (event.type !== "orbit.note.created") return undefined;
  return typeof event.payload.note_id === "string"
    ? event.payload.note_id
    : undefined;
}

interface EventIdentityIndex {
  owner: readonly CacpEvent[];
  eventIds: Set<string>;
  orbitNoteKeys: Set<string>;
}

const eventIdentityIndexes = new WeakMap<
  readonly CacpEvent[],
  EventIdentityIndex
>();

function orbitNoteKey(event: CacpEvent): string | undefined {
  const noteId = orbitNoteId(event);
  return noteId === undefined ? undefined : `${event.room_id}\u0000${noteId}`;
}

function indexEvents(events: readonly CacpEvent[]): EventIdentityIndex {
  const cached = eventIdentityIndexes.get(events);
  if (cached?.owner === events) return cached;

  const index: EventIdentityIndex = {
    owner: events,
    eventIds: new Set(events.map((event) => event.event_id)),
    orbitNoteKeys: new Set(
      events.map(orbitNoteKey).filter((key): key is string => key !== undefined)
    ),
  };
  eventIdentityIndexes.set(events, index);
  return index;
}

function isDuplicateEvent(index: EventIdentityIndex, next: CacpEvent): boolean {
  const noteKey = orbitNoteKey(next);
  return (
    index.eventIds.has(next.event_id) ||
    (noteKey !== undefined && index.orbitNoteKeys.has(noteKey))
  );
}

function transferIndex(
  index: EventIdentityIndex,
  events: CacpEvent[],
  next: CacpEvent
): void {
  index.owner = events;
  index.eventIds.add(next.event_id);
  const noteKey = orbitNoteKey(next);
  if (noteKey !== undefined) index.orbitNoteKeys.add(noteKey);
  eventIdentityIndexes.set(events, index);
}

export function mergeEvent(events: CacpEvent[], next: CacpEvent): CacpEvent[] {
  const index = indexEvents(events);
  if (isDuplicateEvent(index, next)) return events;
  const last = events.at(-1);
  if (!last || last.created_at.localeCompare(next.created_at) <= 0) {
    const merged = [...events, next];
    transferIndex(index, merged, next);
    return merged;
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
  const merged = [...events.slice(0, low), next, ...events.slice(low)];
  transferIndex(index, merged, next);
  return merged;
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
