import Database from "better-sqlite3";
import { CacpEventSchema, type CacpEvent, type Participant, type ParticipantRole, type ParticipantType } from "@cacp/protocol";

export interface StoredParticipant extends Participant {
  room_id: string;
  token: string;
}

export interface StoredRoom {
  room_id: string;
  name: string;
  owner_participant_id: string;
  created_at: string;
  archived_at: string | null;
}

export interface NewInvite {
  invite_id: string;
  room_id: string;
  token_hash: string;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
}

export interface StoredInvite extends NewInvite {
  used_count: number;
  revoked_at: string | null;
}

export interface NewAgentPairing {
  pairing_id: string;
  room_id: string;
  token_hash: string;
  created_by: string;
  agent_type: string;
  permission_level: string;
  working_dir: string;
  created_at: string;
  expires_at: string;
}

export interface StoredAgentPairing extends NewAgentPairing {
  claimed_at: string | null;
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
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_participant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invites (
        invite_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER,
        used_count INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invites_room ON invites(room_id);
      CREATE TABLE IF NOT EXISTS agent_pairings (
        pairing_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        permission_level TEXT NOT NULL,
        working_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_pairings_room ON agent_pairings(room_id);
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

  createRoom(room: StoredRoom): StoredRoom {
    this.db.prepare(`
      INSERT INTO rooms (room_id, name, owner_participant_id, created_at, archived_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(room.room_id, room.name, room.owner_participant_id, room.created_at, room.archived_at);
    return room;
  }

  getRoom(roomId: string): StoredRoom | undefined {
    return this.db.prepare(`
      SELECT * FROM rooms WHERE room_id = ?
    `).get(roomId) as StoredRoom | undefined;
  }

  createInvite(invite: NewInvite): StoredInvite {
    this.db.prepare(`
      INSERT INTO invites (invite_id, room_id, token_hash, role, created_by, created_at, expires_at, max_uses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invite.invite_id,
      invite.room_id,
      invite.token_hash,
      invite.role,
      invite.created_by,
      invite.created_at,
      invite.expires_at,
      invite.max_uses
    );
    return this.getInviteById(invite.invite_id) as StoredInvite;
  }

  getInviteById(inviteId: string): StoredInvite | undefined {
    return this.db.prepare(`
      SELECT * FROM invites WHERE invite_id = ?
    `).get(inviteId) as StoredInvite | undefined;
  }

  getInviteByTokenHash(tokenHash: string): StoredInvite | undefined {
    return this.db.prepare(`
      SELECT * FROM invites WHERE token_hash = ?
    `).get(tokenHash) as StoredInvite | undefined;
  }

  consumeInvite(inviteId: string): StoredInvite {
    const result = this.db.prepare(`
      UPDATE invites
      SET used_count = used_count + 1
      WHERE invite_id = ? AND revoked_at IS NULL AND (max_uses IS NULL OR used_count < max_uses)
    `).run(inviteId);

    if (result.changes > 0) {
      return this.getInviteById(inviteId) as StoredInvite;
    }

    const invite = this.getInviteById(inviteId);
    if (!invite) {
      throw new Error("invite_not_found");
    }
    if (invite.revoked_at !== null) {
      throw new Error("invite_revoked");
    }
    throw new Error("invite_use_limit_reached");
  }

  revokeInvite(inviteId: string, revokedAt: string): StoredInvite {
    const invite = this.getInviteById(inviteId);
    if (!invite) {
      throw new Error("invite_not_found");
    }
    this.db.prepare(`
      UPDATE invites SET revoked_at = ? WHERE invite_id = ?
    `).run(revokedAt, inviteId);
    return this.getInviteById(inviteId) as StoredInvite;
  }

  createAgentPairing(pairing: NewAgentPairing): StoredAgentPairing {
    this.db.prepare(`
      INSERT INTO agent_pairings (
        pairing_id,
        room_id,
        token_hash,
        created_by,
        agent_type,
        permission_level,
        working_dir,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pairing.pairing_id,
      pairing.room_id,
      pairing.token_hash,
      pairing.created_by,
      pairing.agent_type,
      pairing.permission_level,
      pairing.working_dir,
      pairing.created_at,
      pairing.expires_at
    );
    return this.getAgentPairingById(pairing.pairing_id) as StoredAgentPairing;
  }

  getAgentPairingById(pairingId: string): StoredAgentPairing | undefined {
    return this.db.prepare(`
      SELECT * FROM agent_pairings WHERE pairing_id = ?
    `).get(pairingId) as StoredAgentPairing | undefined;
  }

  getAgentPairingByTokenHash(tokenHash: string): StoredAgentPairing | undefined {
    return this.db.prepare(`
      SELECT * FROM agent_pairings WHERE token_hash = ?
    `).get(tokenHash) as StoredAgentPairing | undefined;
  }

  claimAgentPairing(pairingId: string, claimedAt: string): StoredAgentPairing {
    const result = this.db.prepare(`
      UPDATE agent_pairings
      SET claimed_at = ?
      WHERE pairing_id = ? AND claimed_at IS NULL
    `).run(claimedAt, pairingId);

    if (result.changes > 0) {
      return this.getAgentPairingById(pairingId) as StoredAgentPairing;
    }

    const pairing = this.getAgentPairingById(pairingId);
    if (!pairing) {
      throw new Error("pairing_not_found");
    }
    throw new Error("pairing_claimed");
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
