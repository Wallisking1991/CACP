import type {
  AttachmentRef,
  CacpEvent,
  StructuredMessageContent,
} from "@cacp/protocol";

export interface MainInputQueueItem {
  input_id: string;
  author_id: string;
  text: string;
  attachments: AttachmentRef[];
  source: "composer" | "orbit_promote" | "whiteboard_promote";
  queued_after_turn_id: string;
  created_at: string;
}

export function deriveMainInputQueue(
  events: CacpEvent[]
): MainInputQueueItem[] {
  const accepted = new Map<
    string,
    Omit<MainInputQueueItem, "queued_after_turn_id">
  >();
  const queued = new Map<string, string>();
  const terminal = new Set<string>();

  for (const event of events) {
    if (
      event.type === "main_input.accepted" &&
      typeof event.payload.input_id === "string" &&
      event.payload.content &&
      typeof event.payload.content === "object" &&
      typeof (event.payload.content as Record<string, unknown>).text ===
        "string"
    ) {
      const content = event.payload.content as StructuredMessageContent;
      accepted.set(event.payload.input_id, {
        input_id: event.payload.input_id,
        author_id: String(event.payload.author_id || event.actor_id),
        text: content.text,
        attachments: Array.isArray(content.attachments)
          ? content.attachments
          : [],
        source:
          event.payload.source === "orbit_promote" ||
          event.payload.source === "whiteboard_promote"
            ? event.payload.source
            : "composer",
        created_at: String(event.payload.created_at || event.created_at),
      });
    }
    if (
      event.type === "main_input.queued" &&
      typeof event.payload.input_id === "string" &&
      typeof event.payload.queued_after_turn_id === "string"
    ) {
      queued.set(event.payload.input_id, event.payload.queued_after_turn_id);
    }
    if (
      (event.type === "main_input.triggered" ||
        event.type === "main_input.cancelled" ||
        event.type === "main_input.failed") &&
      typeof event.payload.input_id === "string"
    ) {
      terminal.add(event.payload.input_id);
    }
  }

  return [...accepted.values()]
    .filter((item) => queued.has(item.input_id) && !terminal.has(item.input_id))
    .map((item) => ({
      ...item,
      queued_after_turn_id: queued.get(item.input_id)!,
    }));
}

export function nextQueuedMainInput(
  events: CacpEvent[]
): MainInputQueueItem | undefined {
  return deriveMainInputQueue(events)[0];
}
