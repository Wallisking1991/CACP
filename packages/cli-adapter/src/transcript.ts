import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CacpEvent, Participant } from "@cacp/protocol";

export interface TranscriptLogger {
  warn: (message: string) => void;
}

export interface ChatTranscriptWriterOptions {
  roomId: string;
  baseDir: string;
  logger?: TranscriptLogger;
  now?: () => Date;
}

export interface ChatMessageFormatInput {
  actorName: string;
  createdAt: string;
  text: string;
}

function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}

function safeHeadingText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim() || "unknown";
}

export function transcriptPathForRoom(baseDir: string, roomId: string): string {
  return join(baseDir, "rooms", roomId, "chat.md");
}

export function formatChatMessage(input: ChatMessageFormatInput): string {
  return [
    `## ${formatTimestamp(input.createdAt)} - ${safeHeadingText(input.actorName)}`,
    "",
    input.text,
    ""
  ].join("\n");
}

function participantFromPayload(payload: Record<string, unknown>): Participant | undefined {
  const participant = payload.participant;
  if (!participant || typeof participant !== "object") return undefined;
  const candidate = participant as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.display_name !== "string") return undefined;
  return {
    id: candidate.id,
    display_name: candidate.display_name,
    type: candidate.type === "agent" ? "agent" : candidate.type === "observer" ? "observer" : "human",
    role: candidate.role === "agent" ? "agent" : candidate.role === "owner" ? "owner" : candidate.role === "admin" ? "admin" : candidate.role === "observer" ? "observer" : "member"
  };
}

export class ChatTranscriptWriter {
  readonly chatPath: string;

  private readonly roomDir: string;
  private readonly roomId: string;
  private readonly logger: TranscriptLogger;
  private readonly now: () => Date;
  private readonly actorNames = new Map<string, string>();
  private readonly writtenKeys = new Set<string>();
  private lastError?: string;
  private reportedWriteError = false;

  constructor(options: ChatTranscriptWriterOptions) {
    this.roomId = options.roomId;
    this.roomDir = join(options.baseDir, "rooms", options.roomId);
    this.chatPath = join(this.roomDir, "chat.md");
    this.logger = options.logger ?? console;
    this.now = options.now ?? (() => new Date());
    this.ensureReady();
  }

  isAvailable(): boolean {
    return this.ensureReady();
  }

  lastErrorMessage(): string | undefined {
    return this.lastError;
  }

  handleEvent(event: CacpEvent): void {
    if (event.type === "participant.joined") {
      const participant = participantFromPayload(event.payload);
      if (participant) this.actorNames.set(participant.id, participant.display_name);
      return;
    }

    if (event.type !== "message.created") return;
    const text = event.payload.text;
    if (typeof text !== "string" || text.length === 0) return;

    const dedupeKey = typeof event.payload.message_id === "string" ? event.payload.message_id : event.event_id;
    if (this.writtenKeys.has(dedupeKey)) return;
    if (!this.ensureReady()) return;

    try {
      appendFileSync(this.chatPath, `${formatChatMessage({
        actorName: this.actorNames.get(event.actor_id) ?? event.actor_id,
        createdAt: event.created_at,
        text
      })}\n`, "utf8");
      this.writtenKeys.add(dedupeKey);
    } catch (error) {
      this.reportWriteError(error);
    }
  }

  private ensureReady(): boolean {
    try {
      mkdirSync(this.roomDir, { recursive: true });
      if (!existsSync(this.chatPath)) {
        writeFileSync(this.chatPath, [
          "# CACP Room Chat",
          "",
          `Room: ${this.roomId}`,
          `Started: ${formatTimestamp(this.now())}`,
          "",
          "---",
          ""
        ].join("\n"), "utf8");
      }
      this.lastError = undefined;
      return true;
    } catch (error) {
      this.reportWriteError(error);
      return false;
    }
  }

  private reportWriteError(error: unknown): void {
    this.lastError = `Unable to write chat transcript: ${error instanceof Error ? error.message : String(error)}`;
    if (!this.reportedWriteError) {
      this.logger.warn(this.lastError);
      this.reportedWriteError = true;
    }
  }
}
