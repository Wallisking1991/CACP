import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  CacpEventSchema,
  type AttachmentDisposition,
  type AttachmentKind,
  type AttachmentRef,
  type CacpEvent,
  type Participant,
  type ParticipantRole,
  type ParticipantType,
} from "@cacp/protocol";

export interface StoredParticipant extends Participant {
  room_id: string;
  main_thread_history_access: MainThreadHistoryAccess;
}

function hashParticipantToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export interface StoredRoom {
  room_id: string;
  name: string;
  owner_participant_id: string;
  created_at: string;
  archived_at: string | null;
}

export interface StoredAttachment extends AttachmentRef {
  room_id: string;
  created_by: string;
  created_at: string;
  message_id: string | null;
}

export type AttachmentReferenceType =
  "main_input" | "orbit_note" | "whiteboard";

export interface NewInvite {
  invite_id: string;
  room_id: string;
  token_hash: string;
  role: string;
  main_thread_history_access: "allowed" | "denied";
  created_by: string;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
}

export interface StoredInvite extends NewInvite {
  used_count: number;
  revoked_at: string | null;
}

export type MainThreadHistoryAccess = "allowed" | "denied";

/**
 * Foundation event types that survive {@link EventStore.purgeContentEvents}.
 * Everything else (messages, agent turns, orbit, main-input queue, runtime status,
 * snapshots, imports, previews, etc.) is wiped when a new conversation/session is
 * selected by an owner or admin.
 *
 * Connector-published session catalogs are preserved so the session picker can still
 * render after a New Conversation purge — without the catalog the picker returns null
 * and the user sees only the agent header.
 */
const ESSENTIAL_EVENT_TYPES = [
  "room.created",
  "room.configured",
  "room.agent_selected",
  "participant.joined",
  "participant.left",
  "participant.role_updated",
  "participant.removed",
  "agent.registered",
  "agent.unregistered",
  "agent.disconnected",
  "agent.pairing_created",
  "agent.updated",
  "invite.created",
  "invite.revoked",
  "join_request.created",
  "join_request.approved",
  "join_request.rejected",
  "join_request.expired",
  "claude.session_catalog.updated",
  "agent.session_catalog.updated",
] as const;

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
  participant_id: string | null;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface NewJoinRequest {
  request_id: string;
  room_id: string;
  invite_id: string;
  request_token_hash: string;
  display_name: string;
  role: "member" | "observer";
  main_thread_history_access: MainThreadHistoryAccess;
  status: JoinRequestStatus;
  requested_at: string;
  expires_at: string;
  requester_ip?: string;
  requester_user_agent?: string;
}

export interface StoredJoinRequest extends NewJoinRequest {
  decided_at: string | null;
  decided_by: string | null;
  participant_id: string | null;
  participant_token_sealed: string | null;
}

export interface StoredParticipantRevocation {
  room_id: string;
  participant_id: string;
  removed_by: string;
  removed_at: string;
  reason: string | null;
}

interface ParticipantRow {
  room_id: string;
  participant_id: string;
  token_hash: string;
  display_name: string;
  type: ParticipantType;
  role: ParticipantRole;
  main_thread_history_access: MainThreadHistoryAccess;
}

export class EventStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Migration: rename old token column to token_hash
    const participantColumns = this.db
      .prepare(`PRAGMA table_info(participants)`)
      .all() as Array<{ name: string }>;
    if (
      participantColumns.some((col) => col.name === "token") &&
      !participantColumns.some((col) => col.name === "token_hash")
    ) {
      this.db.exec(
        `ALTER TABLE participants RENAME COLUMN token TO token_hash;`
      );
    }
    // Migration: remove UNIQUE constraint from join_requests.invite_id (needed for multi-use invites)
    const joinRequestIndexes = this.db
      .prepare(`PRAGMA index_list(join_requests)`)
      .all() as Array<{ name: string; unique: number }>;
    const inviteIdUniqueIndex = joinRequestIndexes.find((idx) => {
      if (idx.unique !== 1) return false;
      const cols = this.db
        .prepare(`PRAGMA index_info(${idx.name})`)
        .all() as Array<{ name: string }>;
      return cols.length === 1 && cols[0].name === "invite_id";
    });
    if (inviteIdUniqueIndex) {
      this.db.exec(`
        ALTER TABLE join_requests RENAME TO join_requests_old;
        CREATE TABLE join_requests (
          request_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          invite_id TEXT NOT NULL,
          request_token_hash TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL CHECK(length(display_name) <= 100),
          role TEXT NOT NULL CHECK(role IN ('member', 'observer')),
          status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
          requested_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          decided_at TEXT,
          decided_by TEXT,
          participant_id TEXT,
          participant_token_sealed TEXT,
          requester_ip TEXT,
          requester_user_agent TEXT
        );
        INSERT INTO join_requests SELECT * FROM join_requests_old;
        DROP TABLE join_requests_old;
        CREATE INDEX IF NOT EXISTS idx_join_requests_room_status ON join_requests(room_id, status);
      `);
    }
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
        token_hash TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL CHECK(length(display_name) <= 100),
        type TEXT NOT NULL CHECK(type IN ('human', 'observer', 'agent')),
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'observer', 'agent')),
        main_thread_history_access TEXT NOT NULL DEFAULT 'allowed' CHECK(main_thread_history_access IN ('allowed', 'denied')),
        PRIMARY KEY(room_id, participant_id)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(name) <= 200),
        owner_participant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invites (
        invite_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('member', 'observer')),
        main_thread_history_access TEXT NOT NULL CHECK(main_thread_history_access IN ('allowed', 'denied')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER CHECK(max_uses IS NULL OR max_uses > 0),
        used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invites_room ON invites(room_id);
      CREATE TABLE IF NOT EXISTS agent_pairings (
        pairing_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex-cli', 'github-copilot', 'kimi-cli')),
        permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
        working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        participant_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_pairings_room ON agent_pairings(room_id);
      CREATE TABLE IF NOT EXISTS attachments (
        attachment_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
        kind TEXT NOT NULL CHECK(kind IN ('image', 'pdf', 'text', 'office', 'file')),
        disposition TEXT NOT NULL CHECK(disposition IN ('inline', 'download')),
        created_at TEXT NOT NULL,
        message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_room ON attachments(room_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_abandoned ON attachments(message_id, created_at);
      CREATE TABLE IF NOT EXISTS attachment_references (
        room_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        reference_type TEXT NOT NULL CHECK(reference_type IN ('main_input', 'orbit_note', 'whiteboard')),
        reference_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, attachment_id, reference_type, reference_id)
      );
      CREATE INDEX IF NOT EXISTS idx_attachment_references_content
        ON attachment_references(room_id, reference_type, reference_id);
      CREATE TABLE IF NOT EXISTS attachment_agent_grants (
        room_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        input_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, attachment_id, agent_id, input_id)
      );
      CREATE INDEX IF NOT EXISTS idx_attachment_agent_grants_lookup
        ON attachment_agent_grants(room_id, attachment_id, agent_id);
      CREATE TABLE IF NOT EXISTS join_requests (
        request_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        invite_id TEXT NOT NULL,
        request_token_hash TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL CHECK(length(display_name) <= 100),
        role TEXT NOT NULL CHECK(role IN ('member', 'observer')),
        main_thread_history_access TEXT NOT NULL CHECK(main_thread_history_access IN ('allowed', 'denied')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
        requested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        participant_id TEXT,
        participant_token_sealed TEXT,
        requester_ip TEXT,
        requester_user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_join_requests_room_status ON join_requests(room_id, status);
      CREATE TABLE IF NOT EXISTS participant_revocations (
        room_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        removed_by TEXT NOT NULL,
        removed_at TEXT NOT NULL,
        reason TEXT,
        PRIMARY KEY(room_id, participant_id)
      );
      CREATE TABLE IF NOT EXISTS orbit_notes (
        room_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL DEFAULT 'member',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reply_to TEXT,
        PRIMARY KEY (room_id, note_id)
      );
      CREATE INDEX IF NOT EXISTS idx_orbit_notes_room ON orbit_notes(room_id);
      INSERT OR IGNORE INTO attachment_references (
        room_id, attachment_id, reference_type, reference_id, created_at
      )
      SELECT room_id, attachment_id, 'main_input', message_id, created_at
      FROM attachments
      WHERE message_id IS NOT NULL;
    `);
    this.migrateAttachmentReferenceTypes();
    this.migrateInviteHistoryAccess();
    this.migrateJoinRequestHistoryAccess();
    this.migrateParticipantHistoryAccess();
    this.migrateAgentPairingAgentTypes();
    this.migrateAgentPairingParticipantId();
    this.migrateOrbitNotesReplyTo();
    this.migrateOrbitNotesAuthorRole();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  appendEvent(input: CacpEvent): CacpEvent {
    const event = CacpEventSchema.parse(input);
    this.db
      .prepare(
        `
      INSERT INTO events (event_id, room_id, type, actor_id, created_at, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        event.event_id,
        event.room_id,
        event.type,
        event.actor_id,
        event.created_at,
        JSON.stringify(event)
      );
    return event;
  }

  listEvents(roomId: string): CacpEvent[] {
    return (
      this.db
        .prepare(
          `
      SELECT event_json FROM events WHERE room_id = ? ORDER BY sequence ASC
    `
        )
        .all(roomId) as Array<{ event_json: string }>
    ).map((row) => CacpEventSchema.parse(JSON.parse(row.event_json)));
  }

  /**
   * Physically delete every event in the room whose type is not in {@link ESSENTIAL_EVENT_TYPES}.
   * Used by the "New conversation" flow: when an owner/admin selects a new (or re-resumes a)
   * Claude / agent session, all prior content (messages, agent turns, orbit notes, main-input
   * queue, snapshots, runtime status, imports, previews, etc.) is wiped from SQLite so the
   * picked session starts on a clean slate. Only foundation events that the room needs to
   * function (creation, participants, agent registration, invites, join-requests) survive.
   *
   * Returns the number of rows deleted.
   */
  purgeContentEvents(roomId: string): number {
    const placeholders = ESSENTIAL_EVENT_TYPES.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `DELETE FROM events WHERE room_id = ? AND type NOT IN (${placeholders})`
      )
      .run(roomId, ...ESSENTIAL_EVENT_TYPES);
    return result.changes;
  }

  addParticipant(
    participant: StoredParticipant & { token: string }
  ): StoredParticipant {
    const tokenHash = hashParticipantToken(participant.token);
    this.db
      .prepare(
        `
      INSERT INTO participants (room_id, participant_id, token_hash, display_name, type, role, main_thread_history_access)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        participant.room_id,
        participant.id,
        tokenHash,
        participant.display_name,
        participant.type,
        participant.role,
        participant.main_thread_history_access
      );
    return {
      room_id: participant.room_id,
      id: participant.id,
      display_name: participant.display_name,
      type: participant.type,
      role: participant.role,
      main_thread_history_access: participant.main_thread_history_access,
    };
  }

  updateParticipantRole(
    roomId: string,
    participantId: string,
    role: ParticipantRole
  ): void {
    this.db
      .prepare(
        `
      UPDATE participants SET role = ? WHERE room_id = ? AND participant_id = ?
    `
      )
      .run(role, roomId, participantId);
  }

  getParticipantByToken(
    roomId: string,
    participantToken: string
  ): StoredParticipant | undefined {
    const tokenHash = hashParticipantToken(participantToken);
    const row = this.db
      .prepare(
        `
      SELECT * FROM participants WHERE room_id = ? AND token_hash = ?
    `
      )
      .get(roomId, tokenHash) as ParticipantRow | undefined;
    if (!row) return undefined;
    if (this.isParticipantRevoked(row.room_id, row.participant_id))
      return undefined;
    return participantFromRow(row);
  }

  getRevokedParticipantByToken(
    roomId: string,
    participantToken: string
  ): StoredParticipant | undefined {
    const tokenHash = hashParticipantToken(participantToken);
    const row = this.db
      .prepare(
        `
      SELECT * FROM participants WHERE room_id = ? AND token_hash = ?
    `
      )
      .get(roomId, tokenHash) as ParticipantRow | undefined;
    if (!row) return undefined;
    if (!this.isParticipantRevoked(row.room_id, row.participant_id))
      return undefined;
    return participantFromRow(row);
  }

  getParticipants(roomId: string): StoredParticipant[] {
    return (
      this.db
        .prepare(
          `
      SELECT * FROM participants WHERE room_id = ? ORDER BY participant_id ASC
    `
        )
        .all(roomId) as ParticipantRow[]
    )
      .map(participantFromRow)
      .filter((p) => !this.isParticipantRevoked(roomId, p.id));
  }

  createRoom(room: StoredRoom): StoredRoom {
    this.db
      .prepare(
        `
      INSERT INTO rooms (room_id, name, owner_participant_id, created_at, archived_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        room.room_id,
        room.name,
        room.owner_participant_id,
        room.created_at,
        room.archived_at
      );
    return room;
  }

  getRoom(roomId: string): StoredRoom | undefined {
    return this.db
      .prepare(
        `
      SELECT * FROM rooms WHERE room_id = ?
    `
      )
      .get(roomId) as StoredRoom | undefined;
  }

  deleteRoom(roomId: string): void {
    this.db.prepare(`DELETE FROM events WHERE room_id = ?`).run(roomId);
    this.db.prepare(`DELETE FROM participants WHERE room_id = ?`).run(roomId);
    this.db.prepare(`DELETE FROM rooms WHERE room_id = ?`).run(roomId);
    this.db.prepare(`DELETE FROM invites WHERE room_id = ?`).run(roomId);
    this.db.prepare(`DELETE FROM agent_pairings WHERE room_id = ?`).run(roomId);
    this.db
      .prepare(`DELETE FROM attachment_agent_grants WHERE room_id = ?`)
      .run(roomId);
    this.db
      .prepare(`DELETE FROM attachment_references WHERE room_id = ?`)
      .run(roomId);
    this.db.prepare(`DELETE FROM attachments WHERE room_id = ?`).run(roomId);
    this.db.prepare(`DELETE FROM join_requests WHERE room_id = ?`).run(roomId);
    this.db
      .prepare(`DELETE FROM participant_revocations WHERE room_id = ?`)
      .run(roomId);
    this.db.prepare(`DELETE FROM orbit_notes WHERE room_id = ?`).run(roomId);
  }

  createAttachment(attachment: {
    attachment_id: string;
    room_id: string;
    created_by: string;
    name: string;
    media_type: string;
    size_bytes: number;
    sha256: string;
    kind: AttachmentKind;
    disposition: AttachmentDisposition;
    created_at: string;
  }): StoredAttachment {
    this.db
      .prepare(
        `
      INSERT INTO attachments (
        attachment_id, room_id, created_by, name, media_type, size_bytes,
        sha256, kind, disposition, created_at, message_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `
      )
      .run(
        attachment.attachment_id,
        attachment.room_id,
        attachment.created_by,
        attachment.name,
        attachment.media_type,
        attachment.size_bytes,
        attachment.sha256,
        attachment.kind,
        attachment.disposition,
        attachment.created_at
      );
    return { ...attachment, message_id: null };
  }

  getAttachment(
    roomId: string,
    attachmentId: string
  ): StoredAttachment | undefined {
    return this.db
      .prepare(
        `
      SELECT * FROM attachments
      WHERE room_id = ? AND attachment_id = ?
    `
      )
      .get(roomId, attachmentId) as StoredAttachment | undefined;
  }

  getAttachments(roomId: string, attachmentIds: string[]): StoredAttachment[] {
    if (attachmentIds.length === 0) return [];
    const placeholders = attachmentIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `
      SELECT * FROM attachments
      WHERE room_id = ? AND attachment_id IN (${placeholders})
    `
      )
      .all(roomId, ...attachmentIds) as StoredAttachment[];
  }

  roomAttachmentBytes(roomId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM attachments WHERE room_id = ?`
      )
      .get(roomId) as { total: number };
    return row.total;
  }

  attachAttachments(
    roomId: string,
    attachmentIds: string[],
    messageId: string,
    referenceType: AttachmentReferenceType = "main_input"
  ): void {
    const update = this.db.prepare(
      `
      UPDATE attachments
      SET message_id = ?
      WHERE room_id = ? AND attachment_id = ? AND message_id IS NULL
    `
    );
    for (const attachmentId of attachmentIds) {
      const result = update.run(messageId, roomId, attachmentId);
      if (result.changes !== 1) throw new Error("attachment_not_attachable");
    }
    this.referenceAttachments(roomId, attachmentIds, referenceType, messageId);
  }

  referenceAttachments(
    roomId: string,
    attachmentIds: string[],
    referenceType: AttachmentReferenceType,
    referenceId: string
  ): void {
    const insert = this.db.prepare(
      `
      INSERT INTO attachment_references (
        room_id, attachment_id, reference_type, reference_id, created_at
      )
      SELECT ?, attachment_id, ?, ?, ?
      FROM attachments
      WHERE room_id = ? AND attachment_id = ?
      ON CONFLICT DO NOTHING
    `
    );
    const createdAt = new Date().toISOString();
    for (const attachmentId of attachmentIds) {
      const result = insert.run(
        roomId,
        referenceType,
        referenceId,
        createdAt,
        roomId,
        attachmentId
      );
      if (result.changes !== 1) {
        const existing = this.db
          .prepare(
            `
            SELECT 1 FROM attachment_references
            WHERE room_id = ? AND attachment_id = ?
              AND reference_type = ? AND reference_id = ?
          `
          )
          .get(roomId, attachmentId, referenceType, referenceId);
        if (!existing) throw new Error("attachment_not_found");
      }
    }
  }

  getAttachmentsForReferences(
    roomId: string,
    referenceType: AttachmentReferenceType,
    referenceIds: string[]
  ): StoredAttachment[] {
    if (referenceIds.length === 0) return [];
    const placeholders = referenceIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `
        SELECT DISTINCT a.*
        FROM attachments a
        JOIN attachment_references r
          ON r.room_id = a.room_id AND r.attachment_id = a.attachment_id
        WHERE r.room_id = ? AND r.reference_type = ?
          AND r.reference_id IN (${placeholders})
        ORDER BY a.created_at ASC
      `
      )
      .all(roomId, referenceType, ...referenceIds) as StoredAttachment[];
  }

  removeAttachmentReferences(
    roomId: string,
    referenceType: AttachmentReferenceType,
    referenceIds: string[]
  ): StoredAttachment[] {
    if (referenceIds.length === 0) return [];
    const affected = this.getAttachmentsForReferences(
      roomId,
      referenceType,
      referenceIds
    );
    const placeholders = referenceIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `
        DELETE FROM attachment_references
        WHERE room_id = ? AND reference_type = ?
          AND reference_id IN (${placeholders})
      `
      )
      .run(roomId, referenceType, ...referenceIds);
    if (referenceType === "main_input") {
      this.db
        .prepare(
          `
          DELETE FROM attachment_agent_grants
          WHERE room_id = ? AND input_id IN (${placeholders})
        `
        )
        .run(roomId, ...referenceIds);
    }

    const nextReference = this.db.prepare(
      `
      SELECT reference_id
      FROM attachment_references
      WHERE room_id = ? AND attachment_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `
    );
    const updateMarker = this.db.prepare(
      `
      UPDATE attachments
      SET message_id = ?
      WHERE room_id = ? AND attachment_id = ?
    `
    );
    const orphans: StoredAttachment[] = [];
    for (const attachment of affected) {
      const remaining = nextReference.get(roomId, attachment.attachment_id) as
        { reference_id: string } | undefined;
      updateMarker.run(
        remaining?.reference_id ?? null,
        roomId,
        attachment.attachment_id
      );
      if (!remaining) orphans.push({ ...attachment, message_id: null });
    }
    return orphans;
  }

  replaceWhiteboardAttachmentReferences(
    roomId: string,
    attachmentIds: string[],
    actor: { participantId: string; isOwner: boolean }
  ): { orphaned: StoredAttachment[] } {
    const desiredIds = [...new Set(attachmentIds)];
    return this.transaction(() => {
      const desired = this.getAttachments(roomId, desiredIds);
      if (desired.length !== desiredIds.length) {
        throw new Error("whiteboard_attachment_not_found");
      }
      const desiredById = new Map(
        desired.map((attachment) => [attachment.attachment_id, attachment])
      );
      for (const attachmentId of desiredIds) {
        const attachment = desiredById.get(attachmentId)!;
        if (attachment.kind !== "image") {
          throw new Error("whiteboard_attachment_not_image");
        }
        if (
          !actor.isOwner &&
          attachment.created_by !== actor.participantId &&
          attachment.message_id === null
        ) {
          throw new Error("whiteboard_attachment_forbidden");
        }
      }

      const referenceId = "scene";
      const current = this.getAttachmentsForReferences(roomId, "whiteboard", [
        referenceId,
      ]);
      const desiredSet = new Set(desiredIds);
      const currentSet = new Set(
        current.map((attachment) => attachment.attachment_id)
      );
      const insertReference = this.db.prepare(`
        INSERT OR IGNORE INTO attachment_references (
          room_id, attachment_id, reference_type, reference_id, created_at
        ) VALUES (?, ?, 'whiteboard', ?, ?)
      `);
      const markBound = this.db.prepare(`
        UPDATE attachments
        SET message_id = COALESCE(message_id, ?)
        WHERE room_id = ? AND attachment_id = ?
      `);
      const createdAt = new Date().toISOString();
      for (const attachmentId of desiredIds) {
        if (!currentSet.has(attachmentId)) {
          insertReference.run(roomId, attachmentId, referenceId, createdAt);
        }
        markBound.run(referenceId, roomId, attachmentId);
      }

      const deleteReference = this.db.prepare(`
        DELETE FROM attachment_references
        WHERE room_id = ? AND attachment_id = ?
          AND reference_type = 'whiteboard' AND reference_id = ?
      `);
      const nextReference = this.db.prepare(`
        SELECT reference_id
        FROM attachment_references
        WHERE room_id = ? AND attachment_id = ?
        ORDER BY created_at ASC
        LIMIT 1
      `);
      const updateMarker = this.db.prepare(`
        UPDATE attachments
        SET message_id = ?
        WHERE room_id = ? AND attachment_id = ?
      `);
      const orphaned: StoredAttachment[] = [];
      for (const attachment of current) {
        if (desiredSet.has(attachment.attachment_id)) continue;
        deleteReference.run(roomId, attachment.attachment_id, referenceId);
        const remaining = nextReference.get(
          roomId,
          attachment.attachment_id
        ) as { reference_id: string } | undefined;
        if (remaining) {
          updateMarker.run(
            remaining.reference_id,
            roomId,
            attachment.attachment_id
          );
          continue;
        }
        orphaned.push({ ...attachment, message_id: null });
        this.deleteAttachment(roomId, attachment.attachment_id);
      }
      return { orphaned };
    });
  }

  grantAttachmentsToAgent(
    roomId: string,
    attachmentIds: string[],
    agentId: string,
    inputId: string
  ): void {
    const insert = this.db.prepare(
      `
      INSERT OR IGNORE INTO attachment_agent_grants (
        room_id, attachment_id, agent_id, input_id, created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `
    );
    const createdAt = new Date().toISOString();
    for (const attachmentId of attachmentIds) {
      insert.run(roomId, attachmentId, agentId, inputId, createdAt);
    }
  }

  canAgentReadAttachment(
    roomId: string,
    attachmentId: string,
    agentId: string
  ): boolean {
    return Boolean(
      this.db
        .prepare(
          `
          SELECT 1 FROM attachment_agent_grants
          WHERE room_id = ? AND attachment_id = ? AND agent_id = ?
          LIMIT 1
        `
        )
        .get(roomId, attachmentId, agentId)
    );
  }

  listAbandonedAttachments(before: string): StoredAttachment[] {
    return this.db
      .prepare(
        `
      SELECT * FROM attachments
      WHERE message_id IS NULL AND created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM attachment_references r
          WHERE r.room_id = attachments.room_id
            AND r.attachment_id = attachments.attachment_id
        )
    `
      )
      .all(before) as StoredAttachment[];
  }

  deleteAbandonedAttachment(
    roomId: string,
    attachmentId: string,
    before: string
  ): boolean {
    const result = this.db
      .prepare(
        `
      DELETE FROM attachments
      WHERE room_id = ? AND attachment_id = ?
        AND message_id IS NULL AND created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM attachment_references r
          WHERE r.room_id = attachments.room_id
            AND r.attachment_id = attachments.attachment_id
        )
    `
      )
      .run(roomId, attachmentId, before);
    return result.changes === 1;
  }

  deleteUnboundAttachment(roomId: string, attachmentId: string): boolean {
    const result = this.db
      .prepare(
        `
      DELETE FROM attachments
      WHERE room_id = ? AND attachment_id = ? AND message_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM attachment_references r
          WHERE r.room_id = attachments.room_id
            AND r.attachment_id = attachments.attachment_id
        )
    `
      )
      .run(roomId, attachmentId);
    return result.changes === 1;
  }

  deleteAttachment(roomId: string, attachmentId: string): void {
    this.db
      .prepare(
        `DELETE FROM attachment_agent_grants WHERE room_id = ? AND attachment_id = ?`
      )
      .run(roomId, attachmentId);
    this.db
      .prepare(
        `DELETE FROM attachment_references WHERE room_id = ? AND attachment_id = ?`
      )
      .run(roomId, attachmentId);
    this.db
      .prepare(
        `DELETE FROM attachments WHERE room_id = ? AND attachment_id = ?`
      )
      .run(roomId, attachmentId);
  }

  deleteAllAttachments(): void {
    this.db.prepare(`DELETE FROM attachment_agent_grants`).run();
    this.db.prepare(`DELETE FROM attachment_references`).run();
    this.db.prepare(`DELETE FROM attachments`).run();
  }

  addOrbitNote(note: {
    room_id: string;
    note_id: string;
    author_id: string;
    author_name: string;
    author_role: string;
    text: string;
    created_at: string;
    reply_to?: string;
  }): void {
    this.db
      .prepare(
        `
      INSERT INTO orbit_notes (room_id, note_id, author_id, author_name, author_role, text, created_at, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        note.room_id,
        note.note_id,
        note.author_id,
        note.author_name,
        note.author_role,
        note.text,
        note.created_at,
        note.reply_to ?? null
      );
  }

  getOrbitNotes(roomId: string): Array<{
    note_id: string;
    author_id: string;
    author_name: string;
    author_role: string;
    text: string;
    created_at: string;
    reply_to?: string;
  }> {
    return this.db
      .prepare(
        `
      SELECT note_id, author_id, author_name, author_role, text, created_at, reply_to FROM orbit_notes WHERE room_id = ? ORDER BY created_at ASC
    `
      )
      .all(roomId) as Array<{
      note_id: string;
      author_id: string;
      author_name: string;
      author_role: string;
      text: string;
      created_at: string;
      reply_to?: string;
    }>;
  }

  clearOrbitNotes(roomId: string): void {
    this.db.prepare(`DELETE FROM orbit_notes WHERE room_id = ?`).run(roomId);
  }

  createInvite(invite: NewInvite): StoredInvite {
    this.db
      .prepare(
        `
      INSERT INTO invites (invite_id, room_id, token_hash, role, main_thread_history_access, created_by, created_at, expires_at, max_uses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        invite.invite_id,
        invite.room_id,
        invite.token_hash,
        invite.role,
        invite.main_thread_history_access,
        invite.created_by,
        invite.created_at,
        invite.expires_at,
        invite.max_uses
      );
    return this.getInviteById(invite.invite_id) as StoredInvite;
  }

  getInviteById(inviteId: string): StoredInvite | undefined {
    return this.db
      .prepare(
        `
      SELECT * FROM invites WHERE invite_id = ?
    `
      )
      .get(inviteId) as StoredInvite | undefined;
  }

  getInviteByTokenHash(tokenHash: string): StoredInvite | undefined {
    return this.db
      .prepare(
        `
      SELECT * FROM invites WHERE token_hash = ?
    `
      )
      .get(tokenHash) as StoredInvite | undefined;
  }

  countPendingJoinRequestsByInvite(inviteId: string): number {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM join_requests WHERE invite_id = ? AND status = 'pending'
    `
      )
      .get(inviteId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  consumeInvite(inviteId: string): StoredInvite {
    const result = this.db
      .prepare(
        `
      UPDATE invites
      SET used_count = used_count + 1
      WHERE invite_id = ? AND revoked_at IS NULL AND (max_uses IS NULL OR used_count < max_uses)
    `
      )
      .run(inviteId);

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
    this.db
      .prepare(
        `
      UPDATE invites SET revoked_at = ? WHERE invite_id = ?
    `
      )
      .run(revokedAt, inviteId);
    return this.getInviteById(inviteId) as StoredInvite;
  }

  createAgentPairing(pairing: NewAgentPairing): StoredAgentPairing {
    this.db
      .prepare(
        `
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
    `
      )
      .run(
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
    return this.db
      .prepare(
        `
      SELECT * FROM agent_pairings WHERE pairing_id = ?
    `
      )
      .get(pairingId) as StoredAgentPairing | undefined;
  }

  getAgentPairingByTokenHash(
    tokenHash: string
  ): StoredAgentPairing | undefined {
    return this.db
      .prepare(
        `
      SELECT * FROM agent_pairings WHERE token_hash = ?
    `
      )
      .get(tokenHash) as StoredAgentPairing | undefined;
  }

  claimAgentPairing(
    pairingId: string,
    claimedAt: string,
    participantId?: string
  ): StoredAgentPairing {
    const result = this.db
      .prepare(
        `
      UPDATE agent_pairings
      SET claimed_at = ?, participant_id = ?
      WHERE pairing_id = ? AND claimed_at IS NULL
    `
      )
      .run(claimedAt, participantId ?? null, pairingId);

    if (result.changes > 0) {
      return this.getAgentPairingById(pairingId) as StoredAgentPairing;
    }

    const pairing = this.getAgentPairingById(pairingId);
    if (!pairing) {
      throw new Error("pairing_not_found");
    }
    throw new Error("pairing_claimed");
  }

  deleteAgentPairingByParticipantId(
    roomId: string,
    participantId: string
  ): void {
    this.db
      .prepare(
        `
      DELETE FROM agent_pairings WHERE room_id = ? AND participant_id = ?
    `
      )
      .run(roomId, participantId);
  }

  createJoinRequest(input: NewJoinRequest): StoredJoinRequest {
    this.db
      .prepare(
        `
      INSERT INTO join_requests (
        request_id, room_id, invite_id, request_token_hash, display_name, role, main_thread_history_access, status,
        requested_at, expires_at, requester_ip, requester_user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.request_id,
        input.room_id,
        input.invite_id,
        input.request_token_hash,
        input.display_name,
        input.role,
        input.main_thread_history_access,
        input.status,
        input.requested_at,
        input.expires_at,
        input.requester_ip ?? null,
        input.requester_user_agent ?? null
      );
    return this.getJoinRequest(input.request_id) as StoredJoinRequest;
  }

  getJoinRequest(requestId: string): StoredJoinRequest | undefined {
    return this.db
      .prepare(`SELECT * FROM join_requests WHERE request_id = ?`)
      .get(requestId) as StoredJoinRequest | undefined;
  }

  getJoinRequestByTokenHash(tokenHash: string): StoredJoinRequest | undefined {
    return this.db
      .prepare(`SELECT * FROM join_requests WHERE request_token_hash = ?`)
      .get(tokenHash) as StoredJoinRequest | undefined;
  }

  listJoinRequests(
    roomId: string,
    status?: JoinRequestStatus
  ): StoredJoinRequest[] {
    if (status) {
      return this.db
        .prepare(
          `SELECT * FROM join_requests WHERE room_id = ? AND status = ? ORDER BY requested_at ASC`
        )
        .all(roomId, status) as StoredJoinRequest[];
    }
    return this.db
      .prepare(
        `SELECT * FROM join_requests WHERE room_id = ? ORDER BY requested_at ASC`
      )
      .all(roomId) as StoredJoinRequest[];
  }

  getExpiredPendingJoinRequests(nowIso: string): StoredJoinRequest[] {
    return this.db
      .prepare(
        `SELECT * FROM join_requests WHERE status = 'pending' AND expires_at <= ? ORDER BY requested_at ASC`
      )
      .all(nowIso) as StoredJoinRequest[];
  }

  approveJoinRequest(
    requestId: string,
    input: {
      decided_at: string;
      decided_by: string;
      participant_id: string;
      participant_token_sealed: string;
    }
  ): StoredJoinRequest {
    const result = this.db
      .prepare(
        `
      UPDATE join_requests
      SET status = 'approved', decided_at = ?, decided_by = ?, participant_id = ?, participant_token_sealed = ?
      WHERE request_id = ? AND status = 'pending'
    `
      )
      .run(
        input.decided_at,
        input.decided_by,
        input.participant_id,
        input.participant_token_sealed,
        requestId
      );
    if (result.changes === 0) {
      const req = this.getJoinRequest(requestId);
      if (!req) throw new Error("join_request_not_found");
      throw new Error("join_request_not_pending");
    }
    return this.getJoinRequest(requestId) as StoredJoinRequest;
  }

  rejectJoinRequest(
    requestId: string,
    decidedAt: string,
    decidedBy: string
  ): StoredJoinRequest {
    const result = this.db
      .prepare(
        `
      UPDATE join_requests
      SET status = 'rejected', decided_at = ?, decided_by = ?
      WHERE request_id = ? AND status = 'pending'
    `
      )
      .run(decidedAt, decidedBy, requestId);
    if (result.changes === 0) {
      const req = this.getJoinRequest(requestId);
      if (!req) throw new Error("join_request_not_found");
      throw new Error("join_request_not_pending");
    }
    return this.getJoinRequest(requestId) as StoredJoinRequest;
  }

  expireJoinRequest(requestId: string, decidedAt: string): StoredJoinRequest {
    const result = this.db
      .prepare(
        `
      UPDATE join_requests
      SET status = 'expired', decided_at = ?
      WHERE request_id = ? AND status = 'pending'
    `
      )
      .run(decidedAt, requestId);
    if (result.changes === 0) {
      const req = this.getJoinRequest(requestId);
      if (!req) throw new Error("join_request_not_found");
      throw new Error("join_request_not_pending");
    }
    return this.getJoinRequest(requestId) as StoredJoinRequest;
  }

  revokeParticipant(
    roomId: string,
    participantId: string,
    removedBy: string,
    removedAt: string,
    reason?: string
  ): StoredParticipantRevocation {
    this.db
      .prepare(
        `
      INSERT INTO participant_revocations (room_id, participant_id, removed_by, removed_at, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(room_id, participant_id) DO UPDATE SET removed_by = excluded.removed_by, removed_at = excluded.removed_at, reason = excluded.reason
    `
      )
      .run(roomId, participantId, removedBy, removedAt, reason ?? null);
    return {
      room_id: roomId,
      participant_id: participantId,
      removed_by: removedBy,
      removed_at: removedAt,
      reason: reason ?? null,
    };
  }

  isParticipantRevoked(roomId: string, participantId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM participant_revocations WHERE room_id = ? AND participant_id = ?`
      )
      .get(roomId, participantId) as { 1: number } | undefined;
    return row !== undefined;
  }

  private migrateAgentPairingAgentTypes(): void {
    const table = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_pairings'`
      )
      .get() as { sql: string } | undefined;
    if (!table) return;
    const hasNewConstraint =
      table.sql.includes("'github-copilot'") &&
      table.sql.includes("'kimi-cli'") &&
      table.sql.includes("'codex-cli'") &&
      !table.sql.includes("'llm-api'") &&
      !table.sql.includes("'codex'") &&
      !table.sql.includes("'opencode'") &&
      !table.sql.includes("'echo'");
    if (hasNewConstraint) return;
    const columns = this.db
      .prepare(`PRAGMA table_info(agent_pairings)`)
      .all() as Array<{ name: string }>;
    const participantIdSelect = columns.some(
      (column) => column.name === "participant_id"
    )
      ? "participant_id"
      : "NULL";
    this.db.exec(`
      CREATE TABLE agent_pairings_next (
        pairing_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex-cli', 'github-copilot', 'kimi-cli')),
        permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
        working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        participant_id TEXT
      );
      INSERT INTO agent_pairings_next
        SELECT pairing_id, room_id, token_hash, created_by, agent_type, permission_level, working_dir, created_at, expires_at, claimed_at, ${participantIdSelect}
        FROM agent_pairings
        WHERE agent_type IN ('claude-code', 'codex-cli', 'github-copilot', 'kimi-cli');
      DROP TABLE agent_pairings;
      ALTER TABLE agent_pairings_next RENAME TO agent_pairings;
      CREATE INDEX IF NOT EXISTS idx_agent_pairings_room ON agent_pairings(room_id);
      CREATE INDEX IF NOT EXISTS idx_agent_pairings_token_hash ON agent_pairings(token_hash);
    `);
  }

  private migrateAttachmentReferenceTypes(): void {
    const table = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attachment_references'`
      )
      .get() as { sql: string } | undefined;
    if (!table || table.sql.includes("'whiteboard'")) return;
    this.db.exec(`
      CREATE TABLE attachment_references_next (
        room_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        reference_type TEXT NOT NULL CHECK(reference_type IN ('main_input', 'orbit_note', 'whiteboard')),
        reference_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, attachment_id, reference_type, reference_id)
      );
      INSERT INTO attachment_references_next
        SELECT room_id, attachment_id, reference_type, reference_id, created_at
        FROM attachment_references;
      DROP TABLE attachment_references;
      ALTER TABLE attachment_references_next RENAME TO attachment_references;
      CREATE INDEX IF NOT EXISTS idx_attachment_references_content
        ON attachment_references(room_id, reference_type, reference_id);
    `);
  }

  private migrateInviteHistoryAccess(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(invites)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "main_thread_history_access")) {
      this.db.exec(
        `ALTER TABLE invites ADD COLUMN main_thread_history_access TEXT NOT NULL DEFAULT 'allowed' CHECK(main_thread_history_access IN ('allowed', 'denied'));`
      );
      this.db.exec(
        `UPDATE invites SET main_thread_history_access = 'denied' WHERE role = 'observer';`
      );
    }
  }

  private migrateJoinRequestHistoryAccess(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(join_requests)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "main_thread_history_access")) {
      this.db.exec(
        `ALTER TABLE join_requests ADD COLUMN main_thread_history_access TEXT NOT NULL DEFAULT 'allowed' CHECK(main_thread_history_access IN ('allowed', 'denied'));`
      );
      this.db.exec(
        `UPDATE join_requests SET main_thread_history_access = 'denied' WHERE role = 'observer';`
      );
    }
  }

  private migrateParticipantHistoryAccess(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(participants)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "main_thread_history_access")) {
      this.db.exec(
        `ALTER TABLE participants ADD COLUMN main_thread_history_access TEXT NOT NULL DEFAULT 'allowed' CHECK(main_thread_history_access IN ('allowed', 'denied'));`
      );
    }
  }

  private migrateAgentPairingParticipantId(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(agent_pairings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "participant_id")) {
      this.db.exec(
        `ALTER TABLE agent_pairings ADD COLUMN participant_id TEXT;`
      );
    }
  }

  private migrateOrbitNotesReplyTo(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(orbit_notes)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "reply_to")) {
      this.db.exec(`ALTER TABLE orbit_notes ADD COLUMN reply_to TEXT;`);
    }
  }

  private migrateOrbitNotesAuthorRole(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(orbit_notes)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "author_role")) {
      this.db.exec(
        `ALTER TABLE orbit_notes ADD COLUMN author_role TEXT NOT NULL DEFAULT 'member';`
      );
    }
  }
}

function participantFromRow(row: ParticipantRow): StoredParticipant {
  return {
    room_id: row.room_id,
    id: row.participant_id,
    display_name: row.display_name,
    type: row.type,
    role: row.role,
    main_thread_history_access: row.main_thread_history_access,
  };
}
