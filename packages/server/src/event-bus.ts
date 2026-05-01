import type { CacpEvent } from "@cacp/protocol";
import type { RelayEnvelope } from "./relay.js";

type Listener = (envelope: RelayEnvelope) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  subscribe(roomId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(roomId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(roomId);
    };
  }
  publish(envelope: RelayEnvelope): void {
    for (const listener of this.listeners.get(envelope.event.room_id) ?? []) listener(envelope);
  }
}