import {
  CollaborationDiagnosticEventSchema,
  type CollaborationDiagnosticBatch,
  type CollaborationDiagnosticEvent,
} from "@cacp/protocol";

export type CollaborationDiagnosticRecord = Omit<
  CollaborationDiagnosticEvent,
  "client_session_id" | "sequence" | "occurred_at"
>;

export interface CollaborationDiagnostics {
  record(record: CollaborationDiagnosticRecord): boolean;
  flush(): Promise<void>;
  destroy(): Promise<void>;
  pendingCount(): number;
}

interface CreateCollaborationDiagnosticsOptions {
  send(batch: CollaborationDiagnosticBatch): Promise<void>;
  clientSessionId?: string;
  flushIntervalMs?: number;
  maxQueuedEvents?: number;
  now?: () => Date;
}

const MAX_BATCH_EVENTS = 25;

function defaultClientSessionId(): string {
  return `client-${crypto.randomUUID()}`;
}

export function createCollaborationDiagnostics({
  send,
  clientSessionId = defaultClientSessionId(),
  flushIntervalMs = 1_000,
  maxQueuedEvents = 100,
  now = () => new Date(),
}: CreateCollaborationDiagnosticsOptions): CollaborationDiagnostics {
  let sequence = 0;
  let droppedCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let destroyed = false;
  const queue: CollaborationDiagnosticEvent[] = [];

  const schedule = (): void => {
    if (destroyed || timer || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, flushIntervalMs);
  };

  const flush = async (): Promise<void> => {
    if (inFlight) {
      await inFlight;
      if (queue.length > 0) return flush();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH_EVENTS);
    inFlight = send({ events: batch }).catch(() => {
      const available = Math.max(0, maxQueuedEvents - queue.length);
      queue.unshift(...batch.slice(-available));
    });
    try {
      await inFlight;
    } finally {
      inFlight = undefined;
      if (queue.length > 0) schedule();
    }
  };

  return {
    record(record) {
      if (destroyed) return false;
      const candidate = {
        ...record,
        ...(droppedCount > 0 ? { dropped_count: droppedCount } : {}),
        client_session_id: clientSessionId,
        sequence,
        occurred_at: now().toISOString(),
      };
      const parsed = CollaborationDiagnosticEventSchema.safeParse(candidate);
      if (!parsed.success) return false;
      sequence += 1;
      droppedCount = 0;
      if (queue.length >= maxQueuedEvents) {
        queue.shift();
        droppedCount += 1;
      }
      queue.push(parsed.data);
      if (queue.length >= MAX_BATCH_EVENTS) void flush();
      else schedule();
      return true;
    },
    flush,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await flush();
      queue.length = 0;
    },
    pendingCount() {
      return queue.length;
    },
  };
}
