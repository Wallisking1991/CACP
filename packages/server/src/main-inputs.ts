import type { CacpEvent } from "@cacp/protocol";

export interface MainInputQueueItem {
  input_id: string;
  author_id: string;
  text: string;
  source: "composer" | "orbit_promote";
  queued_after_turn_id: string;
  created_at: string;
}

export function deriveMainInputQueue(events: CacpEvent[]): MainInputQueueItem[] {
  const accepted = new Map<string, Omit<MainInputQueueItem, "queued_after_turn_id">>();
  const queued = new Map<string, string>();
  const terminal = new Set<string>();

  for (const event of events) {
    if (event.type === "main_input.accepted" && typeof event.payload.input_id === "string" && typeof event.payload.text === "string") {
      accepted.set(event.payload.input_id, {
        input_id: event.payload.input_id,
        author_id: String(event.payload.author_id || event.actor_id),
        text: event.payload.text,
        source: event.payload.source === "orbit_promote" ? "orbit_promote" : "composer",
        created_at: String(event.payload.created_at || event.created_at)
      });
    }
    if (event.type === "main_input.queued" && typeof event.payload.input_id === "string" && typeof event.payload.queued_after_turn_id === "string") {
      queued.set(event.payload.input_id, event.payload.queued_after_turn_id);
    }
    if (
      (event.type === "main_input.triggered" || event.type === "main_input.cancelled" || event.type === "main_input.failed") &&
      typeof event.payload.input_id === "string"
    ) {
      terminal.add(event.payload.input_id);
    }
  }

  return [...accepted.values()]
    .filter((item) => queued.has(item.input_id) && !terminal.has(item.input_id))
    .map((item) => ({ ...item, queued_after_turn_id: queued.get(item.input_id)! }));
}

export function nextQueuedMainInput(events: CacpEvent[]): MainInputQueueItem | undefined {
  return deriveMainInputQueue(events)[0];
}
