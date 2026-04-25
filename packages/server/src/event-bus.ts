import type { CacpEvent } from "@cacp/protocol";

type Listener = (event: CacpEvent) => void;

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
  publish(event: CacpEvent): void {
    for (const listener of this.listeners.get(event.room_id) ?? []) listener(event);
  }
}