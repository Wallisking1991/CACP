import type { CacpEvent } from "@cacp/protocol";

export function mergeEvent(events: CacpEvent[], next: CacpEvent): CacpEvent[] {
  if (events.some((event) => event.event_id === next.event_id)) return events;
  return [...events, next].sort((left, right) => left.created_at.localeCompare(right.created_at));
}