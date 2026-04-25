import Database from "better-sqlite3";
import { CacpEventSchema, type CacpEvent, type Participant, type ParticipantRole, type ParticipantType } from "@cacp/protocol";

export interface StoredParticipant extends Participant {
  room_id: string;
  token: string;
}

interface ParticipantRow {
  room_id: string;
  participant_id: string;
  token: string;
  display_name: string;
  type: ParticipantType;
  role: ParticipantRole;
}

export class EventStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_room_sequence ON events(room_id, sequence);
      CREATE TABLE IF NOT EXISTS participants (
        room_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY(room_id, participant_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  appendEvent(input: CacpEvent): CacpEvent {
    const event = CacpEventSchema.parse(input);
    this.db.prepare(`
      INSERT INTO events (event_id, room_id, type, actor_id, created_at, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.event_id, event.room_id, event.type, event.actor_id, event.created_at, JSON.stringify(event));
    return event;
  }

  listEvents(roomId: string): CacpEvent[] {
    return (this.db.prepare(`
      SELECT event_json FROM events WHERE room_id = ? ORDER BY sequence ASC
    `).all(roomId) as Array<{ event_json: string }>).map((row) => CacpEventSchema.parse(JSON.parse(row.event_json)));
  }

  addParticipant(participant: StoredParticipant): StoredParticipant {
    this.db.prepare(`
      INSERT INTO participants (room_id, participant_id, token, display_name, type, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(participant.room_id, participant.id, participant.token, participant.display_name, participant.type, participant.role);
    return participant;
  }

  getParticipantByToken(roomId: string, participantToken: string): StoredParticipant | undefined {
    const row = this.db.prepare(`
      SELECT * FROM participants WHERE room_id = ? AND token = ?
    `).get(roomId, participantToken) as ParticipantRow | undefined;
    return row ? participantFromRow(row) : undefined;
  }

  getParticipants(roomId: string): StoredParticipant[] {
    return (this.db.prepare(`
      SELECT * FROM participants WHERE room_id = ? ORDER BY participant_id ASC
    `).all(roomId) as ParticipantRow[]).map(participantFromRow);
  }
}

function participantFromRow(row: ParticipantRow): StoredParticipant {
  return {
    room_id: row.room_id,
    id: row.participant_id,
    token: row.token,
    display_name: row.display_name,
    type: row.type,
    role: row.role
  };
}