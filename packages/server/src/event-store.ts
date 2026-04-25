import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CacpEventSchema, type CacpEvent, type Participant, type ParticipantRole, type ParticipantType } from "@cacp/protocol";

export interface StoredParticipant extends Participant {
  room_id: string;
  token: string;
}

interface PersistedState {
  events: CacpEvent[];
  participants: StoredParticipant[];
}

export class EventStore {
  private readonly dbPath: string;
  private events: CacpEvent[] = [];
  private participants: StoredParticipant[] = [];

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") this.load();
  }

  close(): void {
    this.persist();
  }

  appendEvent(input: CacpEvent): CacpEvent {
    const event = CacpEventSchema.parse(input);
    this.events.push(event);
    this.persist();
    return event;
  }

  listEvents(roomId: string): CacpEvent[] {
    return this.events
      .filter((event) => event.room_id === roomId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.event_id.localeCompare(right.event_id))
      .map((event) => CacpEventSchema.parse(event));
  }

  addParticipant(participant: StoredParticipant): StoredParticipant {
    this.participants.push(participant);
    this.persist();
    return participant;
  }

  getParticipantByToken(roomId: string, participantToken: string): StoredParticipant | undefined {
    return this.participants.find((participant) => participant.room_id === roomId && participant.token === participantToken);
  }

  getParticipants(roomId: string): StoredParticipant[] {
    return this.participants
      .filter((participant) => participant.room_id === roomId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private load(): void {
    try {
      if (!existsSync(this.dbPath)) return;
      const state = JSON.parse(readFileSync(this.dbPath, "utf8")) as PersistedState;
      this.events = state.events.map((event) => CacpEventSchema.parse(event));
      this.participants = state.participants.map((participant) => ({
        room_id: participant.room_id,
        id: participant.id,
        token: participant.token,
        display_name: participant.display_name,
        type: participant.type as ParticipantType,
        role: participant.role as ParticipantRole
      }));
    } catch {
      this.events = [];
      this.participants = [];
    }
  }

  private persist(): void {
    if (this.dbPath === ":memory:") return;
    writeFileSync(this.dbPath, JSON.stringify({ events: this.events, participants: this.participants }, null, 2));
  }
}