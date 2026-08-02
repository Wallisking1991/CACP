export interface AttachmentUploadIdentity {
  roomId: string;
  participantId: string;
  idempotencyKey: string;
}

export interface AttachmentUploadRun<TResult> extends AttachmentUploadIdentity {
  fingerprint: string;
  create(): Promise<TResult>;
  canReplay(result: TResult): boolean;
}

export type AttachmentUploadRunResult<TResult> =
  | { status: "created" | "replayed"; result: TResult }
  | { status: "cancelled"; created?: TResult }
  | { status: "capacity_exceeded"; created?: TResult }
  | { status: "conflict" };

export type AttachmentUploadCancelResult<TResult> =
  | { status: "cancelled"; completed?: TResult }
  | { status: "capacity_exceeded" }
  | { status: "room_closed" };

interface AttachmentUploadRegistryOptions {
  maxOperationsPerParticipant?: number;
  maxOperationsPerRoom?: number;
  operationTtlMs?: number;
  maxClosedRooms?: number;
  now?: () => number;
}

type AttachmentUploadState<TResult> =
  | {
      status: "cancelled";
      participantId: string;
      updatedAt: number;
    }
  | {
      status: "completed";
      participantId: string;
      updatedAt: number;
      fingerprint: string;
      result: TResult;
    };

interface ActiveUploadKey {
  participantId: string;
  count: number;
}

const DefaultMaxOperationsPerParticipant = 128;
const DefaultMaxOperationsPerRoom = 1024;
const DefaultOperationTtlMs = 15 * 60 * 1000;
const DefaultMaxClosedRooms = 1024;

function operationKey(identity: AttachmentUploadIdentity): string {
  return JSON.stringify([identity.participantId, identity.idempotencyKey]);
}

/**
 * Owns the bounded, in-memory lifecycle for idempotent room attachment
 * uploads. Operations sharing a room, participant, and key execute one at a
 * time. Active keys are reserved before body I/O so cancellation and room
 * disposal cannot be evicted while an upload is still able to commit.
 */
export class AttachmentUploadRegistry<TResult> {
  private readonly states = new Map<
    string,
    Map<string, AttachmentUploadState<TResult>>
  >();
  private readonly activeKeys = new Map<string, Map<string, ActiveUploadKey>>();
  private readonly locks = new Map<string, Map<string, Promise<void>>>();
  private readonly roomGenerations = new Map<string, number>();
  private readonly activeRuns = new Map<string, number>();
  private readonly closedRooms = new Map<string, number>();
  private readonly maxOperationsPerParticipant: number;
  private readonly maxOperationsPerRoom: number;
  private readonly operationTtlMs: number;
  private readonly maxClosedRooms: number;
  private readonly now: () => number;

  constructor(options: AttachmentUploadRegistryOptions = {}) {
    this.maxOperationsPerParticipant = Math.max(
      1,
      options.maxOperationsPerParticipant ?? DefaultMaxOperationsPerParticipant
    );
    this.maxOperationsPerRoom = Math.max(
      this.maxOperationsPerParticipant,
      options.maxOperationsPerRoom ?? DefaultMaxOperationsPerRoom
    );
    this.operationTtlMs = Math.max(
      1,
      options.operationTtlMs ?? DefaultOperationTtlMs
    );
    this.maxClosedRooms = Math.max(
      1,
      options.maxClosedRooms ?? DefaultMaxClosedRooms
    );
    this.now = options.now ?? Date.now;
  }

  reserve(identity: AttachmentUploadIdentity): (() => void) | undefined {
    this.prune(identity.roomId);
    if (this.closedRooms.has(identity.roomId)) return undefined;
    const key = operationKey(identity);
    const roomKeys = this.activeKeys.get(identity.roomId) ?? new Map();
    const existing = roomKeys.get(key);
    if (existing) {
      existing.count += 1;
      return this.releaseReservation(identity.roomId, key, existing);
    }
    const participantKeys = [...roomKeys.values()].filter(
      (entry) => entry.participantId === identity.participantId
    ).length;
    if (
      participantKeys >= this.maxOperationsPerParticipant ||
      roomKeys.size >= this.maxOperationsPerRoom
    ) {
      return undefined;
    }
    const active = { participantId: identity.participantId, count: 1 };
    roomKeys.set(key, active);
    this.activeKeys.set(identity.roomId, roomKeys);
    return this.releaseReservation(identity.roomId, key, active);
  }

  isCancelled(identity: AttachmentUploadIdentity): boolean {
    this.prune(identity.roomId);
    return (
      this.states.get(identity.roomId)?.get(operationKey(identity))?.status ===
      "cancelled"
    );
  }

  async run(
    operation: AttachmentUploadRun<TResult>
  ): Promise<AttachmentUploadRunResult<TResult>> {
    const releaseReservation = this.reserve(operation);
    if (!releaseReservation) {
      return this.closedRooms.has(operation.roomId)
        ? { status: "cancelled" }
        : { status: "capacity_exceeded" };
    }
    const generation = this.roomGenerations.get(operation.roomId) ?? 0;
    this.activeRuns.set(
      operation.roomId,
      (this.activeRuns.get(operation.roomId) ?? 0) + 1
    );
    const key = operationKey(operation);
    const releaseLock = await this.acquire(operation.roomId, key);
    try {
      if (!this.isCurrentRoom(operation.roomId, generation)) {
        return { status: "cancelled" };
      }
      const roomStates = this.states.get(operation.roomId) ?? new Map();
      this.states.set(operation.roomId, roomStates);
      const existing = roomStates.get(key);
      if (existing?.status === "cancelled") return { status: "cancelled" };
      if (existing?.status === "completed") {
        if (existing.fingerprint !== operation.fingerprint) {
          return { status: "conflict" };
        }
        if (operation.canReplay(existing.result)) {
          existing.updatedAt = this.now();
          return { status: "replayed", result: existing.result };
        }
        roomStates.delete(key);
      }

      const result = await operation.create();
      if (
        !this.isCurrentRoom(operation.roomId, generation) ||
        roomStates.get(key)?.status === "cancelled"
      ) {
        return { status: "cancelled", created: result };
      }
      if (
        !this.makeCapacity(
          operation.roomId,
          operation.participantId,
          roomStates,
          key
        )
      ) {
        return { status: "capacity_exceeded", created: result };
      }
      roomStates.set(key, {
        status: "completed",
        participantId: operation.participantId,
        updatedAt: this.now(),
        fingerprint: operation.fingerprint,
        result,
      });
      this.states.set(operation.roomId, roomStates);
      return { status: "created", result };
    } finally {
      releaseLock();
      const remaining = (this.activeRuns.get(operation.roomId) ?? 1) - 1;
      if (remaining > 0) this.activeRuns.set(operation.roomId, remaining);
      else {
        this.activeRuns.delete(operation.roomId);
        if (this.states.get(operation.roomId)?.size === 0) {
          this.states.delete(operation.roomId);
        }
        if (this.closedRooms.has(operation.roomId)) {
          this.roomGenerations.delete(operation.roomId);
        }
      }
      releaseReservation();
    }
  }

  cancel(
    identity: AttachmentUploadIdentity
  ): AttachmentUploadCancelResult<TResult> {
    this.prune(identity.roomId);
    if (this.closedRooms.has(identity.roomId)) {
      return { status: "room_closed" };
    }
    const key = operationKey(identity);
    const roomStates = this.states.get(identity.roomId) ?? new Map();
    const existing = roomStates.get(key);
    if (
      !this.makeCapacity(
        identity.roomId,
        identity.participantId,
        roomStates,
        key
      )
    ) {
      return { status: "capacity_exceeded" };
    }
    roomStates.set(key, {
      status: "cancelled",
      participantId: identity.participantId,
      updatedAt: this.now(),
    });
    this.states.set(identity.roomId, roomStates);
    return {
      status: "cancelled",
      ...(existing?.status === "completed"
        ? { completed: existing.result }
        : {}),
    };
  }

  discardRoom(roomId: string): void {
    this.roomGenerations.set(
      roomId,
      (this.roomGenerations.get(roomId) ?? 0) + 1
    );
    this.closedRooms.delete(roomId);
    this.closedRooms.set(roomId, this.now());
    this.states.delete(roomId);
    this.locks.delete(roomId);
    this.pruneClosedRooms();
  }

  private releaseReservation(
    roomId: string,
    key: string,
    active: ActiveUploadKey
  ): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active.count -= 1;
      if (active.count > 0) return;
      const roomKeys = this.activeKeys.get(roomId);
      if (roomKeys?.get(key) !== active) return;
      roomKeys.delete(key);
      if (roomKeys.size === 0) this.activeKeys.delete(roomId);
      this.pruneClosedRooms();
    };
  }

  private isCurrentRoom(roomId: string, generation: number): boolean {
    return (
      !this.closedRooms.has(roomId) &&
      (this.roomGenerations.get(roomId) ?? 0) === generation
    );
  }

  private isActiveKey(roomId: string, key: string): boolean {
    return this.activeKeys.get(roomId)?.has(key) ?? false;
  }

  private hasRoomActivity(roomId: string): boolean {
    return (
      this.activeRuns.has(roomId) ||
      (this.activeKeys.get(roomId)?.size ?? 0) > 0
    );
  }

  private prune(roomId: string): void {
    this.pruneClosedRooms();
    const roomStates = this.states.get(roomId);
    if (!roomStates) return;
    const expiresBefore = this.now() - this.operationTtlMs;
    for (const [key, state] of roomStates) {
      if (state.updatedAt <= expiresBefore && !this.isActiveKey(roomId, key)) {
        roomStates.delete(key);
      }
    }
    if (roomStates.size === 0 && !this.hasRoomActivity(roomId)) {
      this.states.delete(roomId);
    }
  }

  private pruneClosedRooms(): void {
    const expiresBefore = this.now() - this.operationTtlMs;
    for (const [roomId, closedAt] of this.closedRooms) {
      if (closedAt <= expiresBefore && !this.hasRoomActivity(roomId)) {
        this.closedRooms.delete(roomId);
        this.roomGenerations.delete(roomId);
      }
    }
    while (this.closedRooms.size > this.maxClosedRooms) {
      const removable = [...this.closedRooms].find(
        ([roomId]) => !this.hasRoomActivity(roomId)
      );
      if (!removable) break;
      this.closedRooms.delete(removable[0]);
      this.roomGenerations.delete(removable[0]);
    }
  }

  private makeCapacity(
    roomId: string,
    participantId: string,
    roomStates: Map<string, AttachmentUploadState<TResult>>,
    preservedKey: string
  ): boolean {
    if (roomStates.has(preservedKey)) return true;
    const evictOldest = (
      predicate: (state: AttachmentUploadState<TResult>) => boolean
    ) => {
      const candidate = [...roomStates.entries()]
        .filter(
          ([key, state]) =>
            key !== preservedKey &&
            !this.isActiveKey(roomId, key) &&
            predicate(state)
        )
        .sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0];
      if (candidate) roomStates.delete(candidate[0]);
      return Boolean(candidate);
    };
    const participantCount = () =>
      [...roomStates.values()].filter(
        (state) => state.participantId === participantId
      ).length;
    while (participantCount() >= this.maxOperationsPerParticipant) {
      if (!evictOldest((state) => state.participantId === participantId)) {
        return false;
      }
    }
    while (roomStates.size >= this.maxOperationsPerRoom) {
      if (!evictOldest(() => true)) return false;
    }
    return true;
  }

  private async acquire(roomId: string, key: string): Promise<() => void> {
    const roomLocks = this.locks.get(roomId) ?? new Map();
    const previous = roomLocks.get(key) ?? Promise.resolve();
    let releaseCurrent = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    roomLocks.set(key, tail);
    this.locks.set(roomId, roomLocks);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (roomLocks.get(key) !== tail) return;
      roomLocks.delete(key);
      if (roomLocks.size === 0 && this.locks.get(roomId) === roomLocks) {
        this.locks.delete(roomId);
      }
    };
  }
}
