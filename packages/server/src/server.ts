import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Fastify, { type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { buildConnectionCode, evaluatePolicy, ConnectorLedgerEntrySchema, PolicySchema, VoteRecordSchema, ParticipantPresenceSchema, type CacpEvent, type Participant, type ParticipantRole, type Policy, type VoteRecord } from "@cacp/protocol";
import { bearerToken, requireParticipant, hasAnyRole, hasHumanRole } from "./auth.js";
import { buildAgentContextPrompt, findActiveAgentId, findAgentCapabilities, findAnyOpenTurn, findOpenTurn, findQueuedFollowupMessage, findQueuedFollowupMessages, hasQueuedFollowup, recentConversationMessages, type ConversationMessage, type OpenTurn } from "./conversation.js";
import { EventBus } from "./event-bus.js";
import { EventStore, type StoredParticipant } from "./event-store.js";
import { roomDelivery, targetedDelivery, roleDelivery, canDeliverEnvelope, HUMAN_ROLES, type RelayEnvelope } from "./relay.js";
import { hasAllowedOrigin, loadServerConfig, type ServerConfig } from "./config.js";
import { event, hashToken, openSecret, prefixedId, sealSecret, token } from "./ids.js";
import { OrbitRoomState } from "./orbit-state.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { AgentTypeValues, PermissionLevelValues, buildAgentProfile, isLlmAgentType, type AgentType, type PermissionLevel } from "./pairing.js";
import {
  AgentRuntimeStatusChangedPayloadSchema,
  AgentRuntimeStatusCompletedPayloadSchema,
  AgentRuntimeStatusFailedPayloadSchema,
  AgentSessionCatalogUpdatedPayloadSchema,
  AgentSessionImportCompletedPayloadSchema,
  AgentSessionImportFailedPayloadSchema,
  AgentSessionImportMessagePayloadSchema,
  AgentSessionImportStartedPayloadSchema,
  AgentSessionPreviewCompletedPayloadSchema,
  AgentSessionPreviewFailedPayloadSchema,
  AgentSessionPreviewMessagePayloadSchema,
  AgentSessionPreviewRequestedPayloadSchema,
  AgentSessionReadyPayloadSchema,
  AgentSessionSelectedPayloadSchema
} from "@cacp/protocol";
import {
  ClaudeRuntimeStatusBodySchema,
  ClaudeThinkingDeltaBodySchema,
  ClaudeSessionCatalogBodySchema,
  ClaudeSessionImportCompleteBodySchema,
  ClaudeSessionImportFailBodySchema,
  ClaudeSessionImportMessagesBodySchema,
  ClaudeSessionImportStartBodySchema,
  ClaudeSessionPreviewCompleteBodySchema,
  ClaudeSessionPreviewFailBodySchema,
  ClaudeSessionPreviewMessagesBodySchema,
  ClaudeSessionPreviewRequestBodySchema,
  ClaudeSessionReadyBodySchema,
  ClaudeSessionSelectionBodySchema,
  assertAgentOwnsPayload
} from "./claude-events.js";
import { providerForCapabilities } from "./local-agent-events.js";

const CreateRoomSchema = z.object({ name: z.string().min(1).max(200), display_name: z.string().min(1).max(100).default("Owner") });
const CreateInviteSchema = z.object({
  role: z.enum(["member", "observer"]).default("member"),
  main_thread_history_access: z.enum(["allowed", "denied"]).optional(),
  expires_in_seconds: z.number().int().positive().max(60 * 60 * 24 * 7).default(60 * 60 * 24),
  max_uses: z.number().int().positive().max(20).default(1)
});
const JoinSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1).max(100) });
const MessageSchema = z.object({ text: z.string().min(1) });
const ProposalSchema = z.object({ title: z.string().min(1).max(200), proposal_type: z.string().min(1).max(50), policy: PolicySchema });
const AgentRegisterSchema = z.object({ name: z.string().min(1).max(100), capabilities: z.array(z.string().max(50)).default([]) });
const AgentPairingCreateSchema = z.object({
  agent_type: z.enum(AgentTypeValues).default("claude-code"),
  permission_level: z.enum(PermissionLevelValues).default("read_only"),
  working_dir: z.string().trim().min(1).max(500).default("."),
  server_url: z.string().url().optional()
});
const AgentPairingStartLocalSchema = AgentPairingCreateSchema.extend({
  command: z.string().optional()
});
const AgentPairingClaimSchema = z.object({
  adapter_name: z.string().min(1).max(100).optional(),
  working_dir: z.string().trim().min(1).max(500).optional()
});
const JoinRequestCreateSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1).max(100) });
const JoinRequestStatusQuerySchema = z.object({ request_token: z.string().min(1) });
const JoinRequestListQuerySchema = z.object({ status: z.enum(["pending", "approved", "rejected", "expired"]).optional() });
const JoinDecisionSchema = z.object({ reason: z.string().max(300).optional() });
const UpdateRoleSchema = z.object({ role: z.enum(["admin", "member", "observer"]) });
const AgentActionApprovalSchema = z.object({ tool_name: z.string().min(1).max(100), tool_input: z.unknown().optional(), description: z.string().max(500).optional() });
const AgentActionApprovalQuerySchema = z.object({ token: z.string().optional(), wait_ms: z.coerce.number().int().min(0).max(5 * 60 * 1000).default(0) });
const SelectAgentSchema = z.object({ agent_id: z.string().min(1) });
const TaskCreateSchema = z.object({ target_agent_id: z.string().min(1), prompt: z.string().min(1).max(4000), mode: z.literal("oneshot").default("oneshot"), requires_approval: z.boolean().default(false) });
const TaskOutputSchema = z.object({ stream: z.enum(["stdout", "stderr"]), chunk: z.string().max(10000) });
const TaskCompleteSchema = z.object({ exit_code: z.number().int() });
const TaskFailedSchema = z.object({ error: z.string().min(1).max(2000), exit_code: z.number().int().optional() });
const TurnOutputSchema = z.object({ chunk: z.string().max(10000) });
const TurnCompleteSchema = z.object({ final_text: z.string(), exit_code: z.number().int().default(0) });
const TurnFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });
const PresenceBodySchema = z.object({ presence: ParticipantPresenceSchema });
const EmptyObjectBodySchema = z.object({});

const AgentSessionCatalogBodySchema = AgentSessionCatalogUpdatedPayloadSchema;
const AgentSessionSelectionBodySchema = z.discriminatedUnion("mode", [
  z.object({
    agent_id: z.string().min(1),
    provider: z.enum(["claude-code", "codex-cli"]),
    mode: z.literal("fresh")
  }),
  z.object({
    agent_id: z.string().min(1),
    provider: z.enum(["claude-code", "codex-cli"]),
    mode: z.literal("resume"),
    session_id: z.string().min(1)
  })
]);
const AgentSessionReadyBodySchema = AgentSessionReadyPayloadSchema;
const AgentSessionPreviewRequestBodySchema = AgentSessionPreviewRequestedPayloadSchema.pick({
  agent_id: true,
  provider: true,
  session_id: true
});
const AgentSessionPreviewMessagesBodySchema = z.array(AgentSessionPreviewMessagePayloadSchema).min(1).max(50);
const AgentSessionPreviewCompleteBodySchema = AgentSessionPreviewCompletedPayloadSchema;
const AgentSessionPreviewFailBodySchema = AgentSessionPreviewFailedPayloadSchema;
const AgentSessionImportStartBodySchema = AgentSessionImportStartedPayloadSchema;
const AgentSessionImportMessagesBodySchema = z.array(AgentSessionImportMessagePayloadSchema).min(1).max(50);
const AgentSessionImportCompleteBodySchema = AgentSessionImportCompletedPayloadSchema;
const AgentSessionImportFailBodySchema = AgentSessionImportFailedPayloadSchema;
const AgentRuntimeStatusBodySchema = {
  changed: AgentRuntimeStatusChangedPayloadSchema,
  completed: AgentRuntimeStatusCompletedPayloadSchema,
  failed: AgentRuntimeStatusFailedPayloadSchema
} as const;

export interface LocalAgentLaunchInput {
  launchId: string;
  command: string;
  args: string[];
  cwd: string;
  outLog: string;
  errLog: string;
  showConsole?: boolean;
  consoleTitle?: string;
}

export interface LocalAgentLaunchResult { pid?: number }

export type LocalAgentLauncher = (input: LocalAgentLaunchInput) => Promise<LocalAgentLaunchResult> | LocalAgentLaunchResult;

export interface BuildServerOptions { dbPath?: string; localAgentLauncher?: LocalAgentLauncher; repoRoot?: string; config?: ServerConfig; removalGraceMs?: number }
type ProposalTerminalStatus = "approved" | "rejected" | "expired";
type ProposalState = { policy: Policy; votes: VoteRecord[]; terminal_status?: ProposalTerminalStatus };
type TaskTerminalStatus = "completed" | "failed" | "cancelled";
type TaskState = { target_agent_id: string; started: boolean; terminal_status?: TaskTerminalStatus };
type TurnTerminalStatus = "completed" | "failed";
type TurnState = { agent_id: string; started: boolean; terminal_status?: TurnTerminalStatus };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function deny(reply: FastifyReply, error: string, status = 401) {
  return reply.code(status).send({ error });
}

function tooMany(reply: FastifyReply) {
  return reply.code(429).send({ error: "rate_limited" });
}

function isLocalHost(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

function pairingCommand(connectionCode: string): string {
  return `npx @cacp/cli-adapter --connect ${connectionCode}`;
}

function pairingLaunchArgs(connectionCode: string): string[] {
  return ["pnpm", "--filter", "@cacp/cli-adapter", "dev", "--", "--connect", connectionCode];
}

function resolveLaunchCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (command !== "corepack") return { command, args };
  const corepackScript = resolve(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
  if (!existsSync(corepackScript)) return { command, args };
  return { command: process.execPath, args: [corepackScript, ...args] };
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psArray(values: string[]): string {
  return `@(${values.map(psString).join(", ")})`;
}

export function buildLocalAgentConsoleScript(input: LocalAgentLaunchInput): string {
  const launch = resolveLaunchCommand(input.command, input.args);
  return [
    "$ErrorActionPreference = 'Continue'",
    `$Host.UI.RawUI.WindowTitle = ${psString(input.consoleTitle ?? "CACP Local Agent Bridge - DO NOT CLOSE")}`,
    "Clear-Host",
    "Write-Host ''",
    "Write-Host '============================================================' -ForegroundColor Red",
    "Write-Host 'WARNING: CACP LOCAL CONNECTOR IS RUNNING' -ForegroundColor Red",
    "Write-Host '============================================================' -ForegroundColor Red",
    "Write-Host 'This console was opened by the AI Collaboration Platform Demo.' -ForegroundColor Cyan",
    "Write-Host 'It runs the trusted Local Connector for your Claude Code or LLM API room.' -ForegroundColor Cyan",
    "Write-Host 'Do not close or delete this window while using the web room.' -ForegroundColor Yellow",
    "Write-Host 'Closing it will disconnect the local connector from the shared room.' -ForegroundColor Yellow",
    "Write-Host 'You may close it only after you are done with the room.' -ForegroundColor Yellow",
    "Write-Host '============================================================' -ForegroundColor Red",
    "Write-Host ''",
    `$command = ${psString(launch.command)}`,
    `$arguments = ${psArray(launch.args)}`,
    `$workingDir = ${psString(input.cwd)}`,
    `$outLog = ${psString(input.outLog)}`,
    `$errLog = ${psString(input.errLog)}`,
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outLog) | Out-Null",
    "New-Item -ItemType File -Force -Path $outLog | Out-Null",
    "New-Item -ItemType File -Force -Path $errLog | Out-Null",
    "Write-Host ('stdout log: ' + $outLog) -ForegroundColor DarkGray",
    "Write-Host ('stderr log: ' + $errLog) -ForegroundColor DarkGray",
    "Write-Host ''",
    "Set-Location -LiteralPath $workingDir",
    "try {",
    "  & $command @arguments 2>&1 | Tee-Object -FilePath $outLog -Append",
    "  $adapterExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "} catch {",
    "  $adapterExitCode = 1",
    "  $_ | Tee-Object -FilePath $errLog -Append",
    "  Write-Host $_ -ForegroundColor Red",
    "}",
    "Write-Host ''",
    "if ($adapterExitCode -ne 0) {",
    "  Write-Host ('Local agent bridge stopped with exit code ' + $adapterExitCode + '.') -ForegroundColor Red",
    "} else {",
    "  Write-Host 'Local agent bridge stopped.' -ForegroundColor Yellow",
    "}",
    "Write-Host 'You may close this window only after you are done with the web room.' -ForegroundColor Yellow"
  ].join("\r\n");
}

export function buildLocalAgentConsoleSpawnCommand(scriptPath: string): { command: string; args: string[] } {
  return {
    command: "cmd.exe",
    args: [
      "/d",
      "/c",
      "start",
      "CACP Local Agent Bridge - DO NOT CLOSE",
      "powershell.exe",
      "-NoLogo",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath
    ]
  };
}

export function defaultLocalAgentLauncher(input: LocalAgentLaunchInput): LocalAgentLaunchResult {
  mkdirSync(dirname(input.outLog), { recursive: true });
  if (input.showConsole && process.platform === "win32") {
    const scriptPath = resolve(dirname(input.outLog), `${input.launchId}.ps1`);
    writeFileSync(scriptPath, buildLocalAgentConsoleScript(input), "utf8");
    const launch = buildLocalAgentConsoleSpawnCommand(scriptPath);
    const child = spawn(launch.command, launch.args, {
      cwd: input.cwd,
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { pid: child.pid };
  }

  const out = openSync(input.outLog, "a");
  const err = openSync(input.errLog, "a");
  try {
    const launch = resolveLaunchCommand(input.command, input.args);
    const child = spawn(launch.command, launch.args, {
      cwd: input.cwd,
      detached: true,
      shell: false,
      stdio: ["ignore", out, err],
      windowsHide: true
    });
    child.unref();
    return { pid: child.pid };
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

/**
 * Failure-reason markers that halt the queued-main-input auto-trigger
 * (spec §4: agent offline / unavailable / session not ready). Compared by
 * exact equality against `failurePayload.error` to avoid false-positive
 * substring matches in arbitrary LLM-returned error strings.
 */
const HALT_TRIGGER_FAILURE_ERRORS = new Set([
  "active_agent_offline",
  "active_agent_unavailable",
  "agent_session_not_ready"
]);

interface QueuedMainInput {
  input_id: string;
  author_id: string;
  author_name: string;
  author_role: ParticipantRole;
  text: string;
  source: "composer" | "orbit_promote";
  created_at: string;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadServerConfig();
  const app = Fastify({ bodyLimit: config.bodyLimitBytes, trustProxy: config.deploymentMode === "cloud" });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "validation_failed", issues: error.issues });
    }
    return reply.code(500).send({ error: "internal_error" });
  });
  const store = new EventStore(options.dbPath ?? "cacp.db");
  const bus = new EventBus();
  const orbitStates = new Map<string, OrbitRoomState>();
  function getOrbitState(roomId: string): OrbitRoomState {
    if (!orbitStates.has(roomId)) {
      const state = new OrbitRoomState(roomId);
      for (const note of store.getOrbitNotes(roomId)) {
        state.addNote(note);
      }
      orbitStates.set(roomId, state);
    }
    return orbitStates.get(roomId)!;
  }

  const queuedMainInputs = new Map<string, QueuedMainInput[]>();
  const MAX_QUEUED_PER_ROOM = 50;
  function getQueuedMainInputs(roomId: string): QueuedMainInput[] {
    let arr = queuedMainInputs.get(roomId);
    if (!arr) {
      arr = [];
      queuedMainInputs.set(roomId, arr);
    }
    return arr;
  }
  function findQueuedMainInputIndex(roomId: string, inputId: string): number {
    const arr = queuedMainInputs.get(roomId);
    if (!arr) return -1;
    return arr.findIndex((entry) => entry.input_id === inputId);
  }
  const localAgentLauncher = options.localAgentLauncher ?? defaultLocalAgentLauncher;
  const localRepoRoot = options.repoRoot ?? repoRoot;
  const roomLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.roomCreateLimit });
  const inviteLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.inviteCreateLimit });
  const joinLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit });
  const pairingLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.pairingCreateLimit });
  const pairingClaimLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit });
  const messageLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.messageCreateLimit });
  const joinRequestPollLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit * 2 });
  const presenceLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.presenceChangeLimit });
  const typingLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.typingEventLimit });
  const orbitLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.orbitEventLimit });
  /**
   * In-memory registry of rooms that are alive in *this* server process.
   * A room is alive iff `POST /rooms` minted it during the current process
   * lifetime. After a server restart, all SQLite-persisted rooms are
   * dead from the client's perspective: `/me`, `/events`, and `/stream`
   * return `room_ended` so stale tabs/Connectors clear their cache rather
   * than replay durable history. Spec §2.33, §3, §11. (T4)
   *
   * Owner explicit `POST /leave` removes the room from this set
   * ("Leave Room dissolves the room", spec §11 / §2.34). Member-leave
   * (which the existing /leave route already rejects with 403) does not
   * dissolve the room. The set is process-local; we never persist it.
   */
  const aliveRooms = new Set<string>();
  const socketCounts = new Map<string, number>();
  const participantSockets = new Map<string, Set<{ close: (code?: number, reason?: string) => void }>>();
  const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>();
  const REMOVAL_GRACE_MS = options.removalGraceMs ?? 10000;
  let isClosing = false;

  function socketKey(roomId: string, participantId: string): string {
    return `${roomId}:${participantId}`;
  }

  function clearPendingOffline(roomId: string, participantId: string): void {
    const key = socketKey(roomId, participantId);
    const timer = pendingOffline.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingOffline.delete(key);
    }
  }

  function rememberSocket(roomId: string, participantId: string, socket: { close: (code?: number, reason?: string) => void }): () => void {
    const key = socketKey(roomId, participantId);
    const sockets = participantSockets.get(key) ?? new Set();
    sockets.add(socket);
    participantSockets.set(key, sockets);
    return () => {
      sockets.delete(socket);
      if (sockets.size === 0) participantSockets.delete(key);
    };
  }

  function closeParticipantSockets(roomId: string, participantId: string): void {
    const sockets = participantSockets.get(socketKey(roomId, participantId));
    if (!sockets) return;
    for (const socket of sockets) socket.close(4001, "participant_removed");
  }

  function closeRoomSockets(roomId: string, code: number, reason: string): void {
    for (const [key, sockets] of [...participantSockets.entries()]) {
      if (!key.startsWith(`${roomId}:`)) continue;
      for (const socket of [...sockets]) socket.close(code, reason);
    }
  }

  function autoRemoveParticipant(roomId: string, participant: StoredParticipant): void {
    const key = socketKey(roomId, participant.id);
    const stillConnected = participantSockets.has(key) && participantSockets.get(key)!.size > 0;
    if (stillConnected) return;

    const removedAt = new Date().toISOString();

    if (participant.role === "owner") {
      const allParticipants = store.getParticipants(roomId);
      const storedEvents = store.transaction(() => {
        const events: CacpEvent[] = [];
        for (const target of allParticipants) {
          store.revokeParticipant(roomId, target.id, participant.id, removedAt, "owner_disconnected");
          events.push(store.appendEvent(event(roomId, "participant.removed", participant.id, {
            participant_id: target.id,
            removed_by: participant.id,
            removed_at: removedAt,
            reason: "owner_disconnected"
          })));
          if (target.role === "agent") {
            events.push(store.appendEvent(event(roomId, "agent.status_changed", target.id, { agent_id: target.id, status: "offline" })));
            store.deleteAgentPairingByParticipantId(roomId, target.id);
          }
        }
        return events;
      });
      publishEvents(storedEvents);
      closeRoomSockets(roomId, 4001, "owner_disconnected");
      aliveRooms.delete(roomId);
      store.deleteRoom(roomId);
      return;
    }

    const storedEvents = store.transaction(() => {
      store.revokeParticipant(roomId, participant.id, participant.id, removedAt, "disconnected");
      const events: CacpEvent[] = [
        store.appendEvent(event(roomId, "participant.removed", participant.id, {
          participant_id: participant.id,
          removed_by: participant.id,
          removed_at: removedAt,
          reason: "disconnected"
        }))
      ];
      if (participant.role === "agent") {
        store.deleteAgentPairingByParticipantId(roomId, participant.id);
        if (findActiveAgentId(store.listEvents(roomId)) === participant.id) {
          events.push(store.appendEvent(event(roomId, "room.agent_selected", participant.id, { agent_id: "" })));
        }
      }
      return events;
    });
    publishEvents(storedEvents);
    closeParticipantSockets(roomId, participant.id);
  }

  await app.register(websocket);
  app.addHook("onClose", async () => {
    isClosing = true;
    clearInterval(joinRequestCleanupTimer);
    for (const timer of pendingOffline.values()) clearTimeout(timer);
    pendingOffline.clear();
    store.close();
  });

  function publishEvents(events: CacpEvent[]): void {
    for (const stored of events) bus.publish({ event: stored, delivery: roomDelivery() });
  }

  function appendAndPublish(input: CacpEvent): CacpEvent {
    const stored = store.appendEvent(input);
    bus.publish({ event: stored, delivery: roomDelivery() });
    return stored;
  }

  /**
   * Live-only counterpart to `publishRoleFiltered` — broadcasts an event to
   * the room without persisting to the event store. Reserved for T2, which
   * moves `main_input.*` events out of durable storage (so reconnecting
   * clients do not replay stale composer state).
   */
  function publishLiveOnly(event: CacpEvent): void {
    bus.publish({ event, delivery: roomDelivery() });
  }

  function publishRoleFiltered(event: CacpEvent, roles: ParticipantRole[]): void {
    bus.publish({ event, delivery: roleDelivery(roles) });
  }

  function publishTargeted(event: CacpEvent, participantIds: string[]): void {
    bus.publish({ event, delivery: targetedDelivery(participantIds) });
  }

  function canViewEvent(event: CacpEvent, participant: StoredParticipant): boolean {
    if (event.type === "claude.session_catalog.updated") {
      return hasAnyRole(participant, ["owner", "admin"]);
    }
    if (event.type === "agent.session_catalog.updated") {
      return hasAnyRole(participant, ["owner", "admin"]);
    }
    if (event.type.startsWith("claude.session_preview.")) {
      if (participant.role === "agent") return event.payload.agent_id === participant.id;
      return hasAnyRole(participant, ["owner", "admin"]);
    }
    if (event.type.startsWith("agent.session_preview.")) {
      if (participant.role === "agent") return event.payload.agent_id === participant.id;
      return hasAnyRole(participant, ["owner", "admin"]);
    }
    if (event.type === "claude.session_import.message" || event.type === "agent.session_import.message") {
      if (hasAnyRole(participant, ["owner", "admin"])) return true;
      if (participant.role === "agent" && typeof event.payload.agent_id === "string") return event.payload.agent_id === participant.id;
      return participant.main_thread_history_access === "allowed";
    }
    return true;
  }

  function findProposalState(roomId: string, proposalId: string): ProposalState | undefined {
    let policy: Policy | undefined;
    let terminalStatus: ProposalTerminalStatus | undefined;
    const votes: VoteRecord[] = [];
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.payload.proposal_id !== proposalId) continue;
      if (storedEvent.type === "proposal.created") {
        policy = PolicySchema.parse(storedEvent.payload.policy);
      }
      if (storedEvent.type === "proposal.vote_cast") {
        votes.push(VoteRecordSchema.parse({
          voter_id: storedEvent.payload.voter_id,
          vote: storedEvent.payload.vote,
          comment: storedEvent.payload.comment
        }));
      }
      if (storedEvent.type === "proposal.approved") terminalStatus = "approved";
      if (storedEvent.type === "proposal.rejected") terminalStatus = "rejected";
      if (storedEvent.type === "proposal.expired") terminalStatus = "expired";
    }
    return policy ? { policy, votes, terminal_status: terminalStatus } : undefined;
  }

  function findTaskState(roomId: string, taskId: string): TaskState | undefined {
    let task: TaskState | undefined;
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.type === "task.created" && storedEvent.payload.task_id === taskId && typeof storedEvent.payload.target_agent_id === "string") {
        task = { target_agent_id: storedEvent.payload.target_agent_id, started: false };
        continue;
      }
      if (!task || storedEvent.payload.task_id !== taskId) continue;
      if (storedEvent.type === "task.started") task.started = true;
      if (storedEvent.type === "task.completed") task.terminal_status = "completed";
      if (storedEvent.type === "task.failed") task.terminal_status = "failed";
      if (storedEvent.type === "task.cancelled") task.terminal_status = "cancelled";
    }
    return task;
  }

  function findTurnState(roomId: string, turnId: string): TurnState | undefined {
    let turn: TurnState | undefined;
    for (const storedEvent of store.listEvents(roomId)) {
      if (storedEvent.payload.turn_id !== turnId) continue;
      if (storedEvent.type === "agent.turn.requested" && typeof storedEvent.payload.agent_id === "string") {
        turn = { agent_id: storedEvent.payload.agent_id, started: false };
        continue;
      }
      if (!turn) continue;
      if (storedEvent.type === "agent.turn.started") turn.started = true;
      if (storedEvent.type === "agent.turn.completed") turn.terminal_status = "completed";
      if (storedEvent.type === "agent.turn.failed") turn.terminal_status = "failed";
    }
    return turn;
  }

  function isAgentOnline(events: CacpEvent[], agentId: string): boolean {
    for (const storedEvent of [...events].reverse()) {
      if (storedEvent.type === "agent.status_changed" && storedEvent.payload.agent_id === agentId) {
        return storedEvent.payload.status === "online";
      }
    }
    return true;
  }


  function findParticipant(roomId: string, participantId: string): Participant | undefined {
    return store.getParticipants(roomId).find((participant) => participant.id === participantId);
  }

  function requireAssignedAgentTask(roomId: string, taskId: string, participant: Participant, reply: FastifyReply): TaskState | undefined {
    if (participant.role !== "agent") {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    const task = findTaskState(roomId, taskId);
    if (!task) {
      deny(reply, "unknown_task", 404);
      return undefined;
    }
    if (task.target_agent_id !== participant.id) {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    return task;
  }

  function requireAssignedAgentTurn(roomId: string, turnId: string, participant: Participant, reply: FastifyReply): TurnState | undefined {
    if (participant.role !== "agent") {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    const turn = findTurnState(roomId, turnId);
    if (!turn) {
      deny(reply, "unknown_turn", 404);
      return undefined;
    }
    if (turn.agent_id !== participant.id) {
      deny(reply, "forbidden", 403);
      return undefined;
    }
    return turn;
  }

  function buildContextPrompt(roomId: string, agentId: string): string {
    const events = store.listEvents(roomId);
    const participants = store.getParticipants(roomId);
    const names = new Map(participants.map((participant) => [participant.id, participant.display_name]));
    const agent = participants.find((participant) => participant.id === agentId);
    const messages = recentConversationMessages(events, 20).map((message) => ({
      actorName: names.get(message.actor_id) ?? message.actor_id,
      kind: message.kind,
      text: message.text
    }));
    return buildAgentContextPrompt({ participants: participants.map(publicParticipant), messages, agentName: agent?.display_name ?? agentId });
  }

  function openTurnInRoom(roomId: string): OpenTurn | undefined {
    return findAnyOpenTurn(store.listEvents(roomId));
  }

  function findLastTurnId(events: CacpEvent[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "agent.turn.requested" && typeof e.payload.turn_id === "string") {
        return e.payload.turn_id;
      }
    }
    return undefined;
  }

  function claudeQueuedFollowupDetails(messages: ConversationMessage[], names: Map<string, string>, roles: Map<string, string>): { messageText: string; speakerName: string; speakerRole: string } | undefined {
    if (messages.length === 0) return undefined;
    if (messages.length === 1) {
      const [message] = messages;
      return {
        messageText: message.text,
        speakerName: names.get(message.actor_id) ?? message.actor_id,
        speakerRole: roles.get(message.actor_id) ?? "member"
      };
    }
    return {
      messageText: [
        "Queued room messages:",
        ...messages.map((message) => `${names.get(message.actor_id) ?? message.actor_id} (${roles.get(message.actor_id) ?? "member"}): ${message.text}`)
      ].join("\n"),
      speakerName: "Room participants",
      speakerRole: "member"
    };
  }

  function createMainInputTurnRequestEvents(roomId: string, input: {
    actorId: string;
    authorName: string;
    authorRole: ParticipantRole;
    text: string;
    source: "composer" | "orbit_promote";
    includeMessageTextForRemote?: boolean;
  }): CacpEvent[] {
    const events = store.listEvents(roomId);
    const turnEvents = events;
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return [];
    const activeAgent = findParticipant(roomId, activeAgentId);
    if (!activeAgent || activeAgent.role !== "agent" || activeAgent.type !== "agent") return [];
    if (!isAgentOnline(events, activeAgentId)) return [];
    if (findAnyOpenTurn(turnEvents)) return [];

    const capabilities = findAgentCapabilities(events, activeAgentId);
    const localProvider = providerForCapabilities(capabilities);
    if (localProvider) {
      const ready = localProvider === "claude-code"
        ? hasClaudeSessionReady(events, activeAgentId) || hasLocalAgentSessionReady(events, activeAgentId, localProvider)
        : hasLocalAgentSessionReady(events, activeAgentId, localProvider);
      if (!ready) return [];
    }

    const turnId = prefixedId("turn");
    if (localProvider) {
      const room = store.getRoom(roomId);
      return [event(roomId, "agent.turn.requested", input.actorId, {
        turn_id: turnId,
        agent_id: activeAgentId,
        reason: "human_message",
        source: input.source,
        speaker_name: input.authorName,
        speaker_role: input.authorRole,
        room_name: room?.name ?? "Untitled room",
        mode: "normal",
        message_text: input.text
      })];
    }

    const room = input.includeMessageTextForRemote ? store.getRoom(roomId) : undefined;
    return [event(roomId, "agent.turn.requested", input.actorId, {
      turn_id: turnId,
      agent_id: activeAgentId,
      reason: "human_message",
      source: input.source,
      context_prompt: input.text,
      ...(input.includeMessageTextForRemote ? {
        speaker_name: input.authorName,
        speaker_role: input.authorRole,
        room_name: room?.name ?? "Untitled room",
        mode: "normal",
        message_text: input.text
      } : {})
    })];
  }

  function createAgentTurnRequestEvents(roomId: string, actorId: string, reason: "human_message" | "queued_followup", contextPrompt?: string, previousTurnId?: string): CacpEvent[] {
    const events = store.listEvents(roomId);
    const turnEvents = events;
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return [];
    const activeAgent = findParticipant(roomId, activeAgentId);
    if (!activeAgent || activeAgent.role !== "agent" || activeAgent.type !== "agent") return [];
    if (!isAgentOnline(events, activeAgentId)) {
      const openTurn = findOpenTurn(turnEvents, activeAgentId);
      return openTurn ? [event(roomId, "agent.turn.failed", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId, error: "active_agent_offline" })] : [];
    }
    const openTurn = findAnyOpenTurn(turnEvents);
    if (openTurn) {
      if (hasQueuedFollowup(turnEvents, openTurn.turn_id)) return [];
      return [event(roomId, "agent.turn.followup_queued", actorId, { turn_id: openTurn.turn_id, agent_id: openTurn.agent_id })];
    }
    const turnId = prefixedId("turn");
    const capabilities = findAgentCapabilities(events, activeAgentId);
    const localProvider = providerForCapabilities(capabilities);
    if (localProvider) {
      const ready = localProvider === "claude-code"
        ? hasClaudeSessionReady(events, activeAgentId) || hasLocalAgentSessionReady(events, activeAgentId, localProvider)
        : hasLocalAgentSessionReady(events, activeAgentId, localProvider);
      if (!ready) return [];
      const room = store.getRoom(roomId);
      const participants = store.getParticipants(roomId);
      const names = new Map(participants.map((participant) => [participant.id, participant.display_name]));
      const roles = new Map(participants.map((participant) => [participant.id, participant.role]));
      let messageText = "";
      let speakerName = "";
      let speakerRole = "";
      const mode = reason === "queued_followup" ? "followup" : "normal";
      if (reason === "human_message") {
        const latestMessage = recentConversationMessages(events, 1)[0];
        if (latestMessage) {
          messageText = latestMessage.text;
          speakerName = names.get(latestMessage.actor_id) ?? latestMessage.actor_id;
          speakerRole = roles.get(latestMessage.actor_id) ?? "member";
        }
      } else if (reason === "queued_followup") {
        const queuedMessages = previousTurnId ? findQueuedFollowupMessages(events, previousTurnId) : [];
        const queuedDetails = claudeQueuedFollowupDetails(
          queuedMessages.length > 0 ? queuedMessages : previousTurnId ? [findQueuedFollowupMessage(events, previousTurnId)].filter((message): message is ConversationMessage => Boolean(message)) : [],
          names,
          roles
        );
        if (queuedDetails) {
          messageText = queuedDetails.messageText;
          speakerName = queuedDetails.speakerName;
          speakerRole = queuedDetails.speakerRole;
        }
      } else {
        messageText = contextPrompt ?? buildContextPrompt(roomId, activeAgentId);
        const latestMessage = recentConversationMessages(events, 1)[0];
        speakerName = latestMessage ? (names.get(latestMessage.actor_id) ?? latestMessage.actor_id) : "Room";
        speakerRole = latestMessage ? (roles.get(latestMessage.actor_id) ?? "member") : "member";
      }
      return [event(roomId, "agent.turn.requested", actorId, {
        turn_id: turnId,
        agent_id: activeAgentId,
        reason,
        speaker_name: speakerName,
        speaker_role: speakerRole,
        room_name: room?.name ?? "Untitled room",
        mode,
        message_text: messageText
      })];
    }
    return [event(roomId, "agent.turn.requested", actorId, {
      turn_id: turnId,
      agent_id: activeAgentId,
      reason,
      context_prompt: contextPrompt ?? buildContextPrompt(roomId, activeAgentId)
    })];
  }

  /**
   * T5: Pop the FIFO head of the room's queued main inputs and trigger a
   * fresh agent turn for it. Called from `/agent-turns/:turnId/complete` and
   * `/fail` after the terminal event is committed and broadcast.
   *
   * Spec §4: only one agent turn may be active at a time, and queued inputs
   * trigger FIFO once the active turn ends — UNLESS the previous turn failed
   * with a reason indicating the agent is offline / session not ready, in
   * which case the queue stays intact and the user must recover.
   *
   * Returns true if an input was popped and a turn was requested. Returns
   * false on any of: empty queue, agent gone offline, agent session not
   * ready, or a halting failure reason.
   */
  function triggerNextQueuedMainInput(roomId: string, terminalReason: "completed" | "failed", failureError?: string): boolean {
    if (terminalReason === "failed" && failureError && HALT_TRIGGER_FAILURE_ERRORS.has(failureError)) return false;
    const queue = queuedMainInputs.get(roomId);
    if (!queue || queue.length === 0) return false;

    // Re-validate agent readiness before popping. If the agent went offline
    // or its session is no longer ready, keep the queue intact (same
    // halting semantics as the offline failure markers above).
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return false;
    if (!isAgentOnline(events, activeAgentId)) return false;
    const capabilities = findAgentCapabilities(events, activeAgentId);
    const localProvider = providerForCapabilities(capabilities);
    if (localProvider) {
      const ready = localProvider === "claude-code"
        ? hasClaudeSessionReady(events, activeAgentId) || hasLocalAgentSessionReady(events, activeAgentId, localProvider)
        : hasLocalAgentSessionReady(events, activeAgentId, localProvider);
      if (!ready) return false;
    }

    const next = queue.shift()!;

    // Build the turn request from the explicit queue item. Main inputs do not
    // create `message.created` events, so recent conversation state cannot be
    // used as the source of text, speaker, or Orbit promotion metadata.
    const turnRequestEvents = createMainInputTurnRequestEvents(roomId, {
      actorId: next.author_id,
      authorName: next.author_name,
      authorRole: next.author_role,
      text: next.text,
      source: next.source,
      includeMessageTextForRemote: true
    });
    const turnEvent = turnRequestEvents.find((nextEvent) => nextEvent.type === "agent.turn.requested");
    if (!turnEvent || typeof turnEvent.payload.turn_id !== "string") {
      queue.unshift(next);
      return false;
    }
    const turnId = turnEvent.payload.turn_id;

    const triggered = event(roomId, "main_input.triggered", next.author_id, {
      input_id: next.input_id,
      trigger_turn_id: turnId,
      message_id: next.input_id
    });

    // Persist the turn request and triggered marker so reconnecting clients
    // see the complete main-input lifecycle.
    const stored = store.appendEvent(turnEvent);
    bus.publish({ event: stored, delivery: roomDelivery() });
    appendAndPublish(triggered);

    return true;
  }

  function validateClaudeAgent(roomId: string, agentId: string): { ok: true } | { ok: false; error: string; status: number } {
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (activeAgentId !== agentId) return { ok: false, error: "not_active_agent", status: 403 };
    const capabilities = findAgentCapabilities(events, agentId);
    if (!capabilities.includes("claude-code")) return { ok: false, error: "missing_claude_code_capability", status: 403 };
    return { ok: true };
  }

  function validateLocalAgentProvider(roomId: string, agentId: string, provider: "claude-code" | "codex-cli"): { ok: true } | { ok: false; error: string; status: number } {
    const target = findParticipant(roomId, agentId);
    if (!target || target.type !== "agent" || target.role !== "agent") return { ok: false, error: "invalid_target_agent", status: 400 };
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (activeAgentId !== agentId) return { ok: false, error: "not_active_agent", status: 403 };
    const capabilities = findAgentCapabilities(events, agentId);
    const actualProvider = providerForCapabilities(capabilities);
    if (!actualProvider) return { ok: false, error: "missing_local_agent_capability", status: 403 };
    if (actualProvider !== provider) return { ok: false, error: "provider_mismatch", status: 403 };
    return { ok: true };
  }

  function validateLocalAgentRuntime(roomId: string, agentId: string, provider: "claude-code" | "codex-cli", turnId: string): { ok: true } | { ok: false; error: string; status: number } {
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (activeAgentId !== agentId) return { ok: false, error: "not_active_agent", status: 403 };
    const capabilities = findAgentCapabilities(events, agentId);
    const actualProvider = providerForCapabilities(capabilities);
    if (!actualProvider) return { ok: false, error: "missing_local_agent_capability", status: 403 };
    if (actualProvider !== provider) return { ok: false, error: "provider_mismatch", status: 403 };
    const openTurn = findAnyOpenTurn(events);
    if (!openTurn || openTurn.agent_id !== agentId) return { ok: false, error: "no_active_turn", status: 403 };
    if (openTurn.turn_id !== turnId) return { ok: false, error: "turn_not_found", status: 403 };
    return { ok: true };
  }

  function validateClaudeRuntime(roomId: string, agentId: string, turnId: string): { ok: true } | { ok: false; error: string; status: number } {
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (activeAgentId !== agentId) return { ok: false, error: "not_active_agent", status: 403 };
    const capabilities = findAgentCapabilities(events, agentId);
    if (!capabilities.includes("claude-code")) return { ok: false, error: "missing_claude_code_capability", status: 403 };
    const openTurn = findAnyOpenTurn(events);
    if (!openTurn || openTurn.agent_id !== agentId) return { ok: false, error: "no_active_turn", status: 403 };
    if (openTurn.turn_id !== turnId) return { ok: false, error: "turn_not_found", status: 403 };
    return { ok: true };
  }

  function validateTurnBelongsToAgent(events: CacpEvent[], turnId: string, agentId: string): boolean {
    return events.some((storedEvent) =>
      (storedEvent.type === "agent.turn.requested" || storedEvent.type === "agent.turn.started") &&
      storedEvent.payload.turn_id === turnId &&
      storedEvent.payload.agent_id === agentId
    );
  }

  function hasClaudeSessionReady(events: CacpEvent[], agentId: string): boolean {
    let selectionIndex = -1;
    let selection: { mode: "fresh" } | { mode: "resume"; session_id: string } | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const storedEvent = events[index];
      if (storedEvent.type !== "claude.session_selected" || storedEvent.payload.agent_id !== agentId) continue;
      if (storedEvent.payload.mode === "fresh") {
        selectionIndex = index;
        selection = { mode: "fresh" };
        break;
      }
      if (storedEvent.payload.mode === "resume" && typeof storedEvent.payload.session_id === "string") {
        selectionIndex = index;
        selection = { mode: "resume", session_id: storedEvent.payload.session_id };
        break;
      }
    }
    if (!selection || selectionIndex < 0) return false;
    return events.slice(selectionIndex + 1).some((storedEvent) => {
      if (storedEvent.type !== "claude.session_ready" || storedEvent.payload.agent_id !== agentId) return false;
      if (selection.mode === "fresh") return storedEvent.payload.mode === "fresh";
      return storedEvent.payload.mode === "resume" && storedEvent.payload.session_id === selection.session_id;
    });
  }

  function latestClaudeSessionSelection(events: CacpEvent[], agentId: string): { mode: "fresh" } | { mode: "resume"; session_id: string } | undefined {
    for (const storedEvent of [...events].reverse()) {
      if (storedEvent.type !== "claude.session_selected" || storedEvent.payload.agent_id !== agentId) continue;
      if (storedEvent.payload.mode === "fresh") return { mode: "fresh" };
      if (storedEvent.payload.mode === "resume" && typeof storedEvent.payload.session_id === "string") {
        return { mode: "resume", session_id: storedEvent.payload.session_id };
      }
    }
    return undefined;
  }

  function latestLocalAgentSessionSelection(events: CacpEvent[], agentId: string, provider: "claude-code" | "codex-cli"): { mode: "fresh" } | { mode: "resume"; session_id: string } | undefined {
    for (const storedEvent of [...events].reverse()) {
      if (storedEvent.type !== "agent.session_selected" || storedEvent.payload.agent_id !== agentId || storedEvent.payload.provider !== provider) continue;
      if (storedEvent.payload.mode === "fresh") return { mode: "fresh" };
      if (storedEvent.payload.mode === "resume" && typeof storedEvent.payload.session_id === "string") {
        return { mode: "resume", session_id: storedEvent.payload.session_id };
      }
    }
    return undefined;
  }

  function hasLocalAgentSessionReady(events: CacpEvent[], agentId: string, provider: "claude-code" | "codex-cli"): boolean {
    let selectionIndex = -1;
    let selection: { mode: "fresh" } | { mode: "resume"; session_id: string } | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const storedEvent = events[index];
      if (storedEvent.type !== "agent.session_selected" || storedEvent.payload.agent_id !== agentId || storedEvent.payload.provider !== provider) continue;
      if (storedEvent.payload.mode === "fresh") {
        selectionIndex = index;
        selection = { mode: "fresh" };
        break;
      }
      if (storedEvent.payload.mode === "resume" && typeof storedEvent.payload.session_id === "string") {
        selectionIndex = index;
        selection = { mode: "resume", session_id: storedEvent.payload.session_id };
        break;
      }
    }
    if (!selection || selectionIndex < 0) return false;
    return events.slice(selectionIndex + 1).some((storedEvent) => {
      if (storedEvent.type !== "agent.session_ready" || storedEvent.payload.agent_id !== agentId || storedEvent.payload.provider !== provider) return false;
      if (selection.mode === "fresh") return storedEvent.payload.mode === "fresh";
      return storedEvent.payload.mode === "resume" && storedEvent.payload.session_id === selection.session_id;
    });
  }

  function validateSelectedLocalAgentResumeSession(roomId: string, agentId: string, provider: "claude-code" | "codex-cli", sessionId: string): { ok: true } | { ok: false; error: string; status: number } {
    const selection = latestLocalAgentSessionSelection(store.listEvents(roomId), agentId, provider);
    if (!selection || selection.mode !== "resume") {
      return { ok: false, error: "agent_resume_session_not_selected", status: 409 };
    }
    if (selection.session_id !== sessionId) {
      return { ok: false, error: "agent_resume_session_mismatch", status: 409 };
    }
    return { ok: true };
  }

  function validateSelectedLocalAgentSessionReady(roomId: string, agentId: string, provider: "claude-code" | "codex-cli", body: { mode: "fresh" } | { mode: "resume"; session_id: string }): { ok: true } | { ok: false; error: string; status: number } {
    const selection = latestLocalAgentSessionSelection(store.listEvents(roomId), agentId, provider);
    if (!selection) return { ok: false, error: "agent_session_not_selected", status: 409 };
    if (body.mode !== selection.mode) return { ok: false, error: "agent_session_selection_mismatch", status: 409 };
    if (body.mode === "resume" && selection.mode === "resume" && body.session_id !== selection.session_id) {
      return { ok: false, error: "agent_session_selection_mismatch", status: 409 };
    }
    return { ok: true };
  }

  function validateSelectedClaudeResumeSession(roomId: string, agentId: string, sessionId: string): { ok: true } | { ok: false; error: string; status: number } {
    const selection = latestClaudeSessionSelection(store.listEvents(roomId), agentId);
    if (!selection || selection.mode !== "resume") {
      return { ok: false, error: "claude_resume_session_not_selected", status: 409 };
    }
    if (selection.session_id !== sessionId) {
      return { ok: false, error: "claude_resume_session_mismatch", status: 409 };
    }
    return { ok: true };
  }

  function validateSelectedClaudeSessionReady(roomId: string, agentId: string, body: { mode: "fresh" } | { mode: "resume"; session_id: string }): { ok: true } | { ok: false; error: string; status: number } {
    const selection = latestClaudeSessionSelection(store.listEvents(roomId), agentId);
    if (!selection) return { ok: false, error: "claude_session_not_selected", status: 409 };
    if (body.mode !== selection.mode) return { ok: false, error: "claude_session_selection_mismatch", status: 409 };
    if (body.mode === "resume" && selection.mode === "resume" && body.session_id !== selection.session_id) {
      return { ok: false, error: "claude_session_selection_mismatch", status: 409 };
    }
    return { ok: true };
  }

  function claudeImportEvents(roomId: string, importId: string): CacpEvent[] {
    return store.listEvents(roomId).filter((storedEvent) =>
      typeof storedEvent.payload.import_id === "string" &&
      storedEvent.payload.import_id === importId &&
      storedEvent.type.startsWith("claude.session_import.")
    );
  }

  function validateImportMessageBatch(roomId: string, importId: string, messages: Array<{ agent_id: string; session_id: string; sequence: number }>): { ok: true } | { ok: false; error: string; status: number } {
    const related = claudeImportEvents(roomId, importId);
    const started = related.find((storedEvent) => storedEvent.type === "claude.session_import.started");
    if (!started) return { ok: false, error: "unknown_import", status: 404 };
    if (related.some((storedEvent) => storedEvent.type === "claude.session_import.completed" || storedEvent.type === "claude.session_import.failed")) {
      return { ok: false, error: "import_closed", status: 409 };
    }
    if (!messages.every((message) => message.agent_id === started.payload.agent_id && message.session_id === started.payload.session_id)) {
      return { ok: false, error: "import_session_mismatch", status: 400 };
    }
    const existingCount = related.filter((storedEvent) => storedEvent.type === "claude.session_import.message").length;
    const expectedSequences = messages.map((_, index) => existingCount + index);
    if (!messages.every((message, index) => message.sequence === expectedSequences[index])) {
      return { ok: false, error: "import_sequence_gap", status: 409 };
    }
    return { ok: true };
  }

  function validateImportComplete(roomId: string, importId: string, body: { agent_id: string; session_id: string; imported_message_count: number }): { ok: true } | { ok: false; error: string; status: number } {
    const related = claudeImportEvents(roomId, importId);
    const started = related.find((storedEvent) => storedEvent.type === "claude.session_import.started");
    if (!started) return { ok: false, error: "unknown_import", status: 404 };
    if (related.some((storedEvent) => storedEvent.type === "claude.session_import.completed" || storedEvent.type === "claude.session_import.failed")) {
      return { ok: false, error: "import_closed", status: 409 };
    }
    if (body.agent_id !== started.payload.agent_id || body.session_id !== started.payload.session_id) {
      return { ok: false, error: "import_session_mismatch", status: 400 };
    }
    const expectedCount = typeof started.payload.message_count === "number" ? started.payload.message_count : undefined;
    const uploaded = related.filter((storedEvent) => storedEvent.type === "claude.session_import.message");
    const sequenceSet = new Set(uploaded.map((storedEvent) => storedEvent.payload.sequence));
    const hasContinuousSequence = uploaded.every((storedEvent) => typeof storedEvent.payload.sequence === "number") &&
      Array.from({ length: uploaded.length }, (_, index) => index).every((sequence) => sequenceSet.has(sequence));
    if (body.imported_message_count !== uploaded.length || expectedCount !== uploaded.length || !hasContinuousSequence) {
      return { ok: false, error: "import_incomplete", status: 409 };
    }
    return { ok: true };
  }

  function claudePreviewEvents(roomId: string, previewId: string): CacpEvent[] {
    return store.listEvents(roomId).filter((storedEvent) =>
      typeof storedEvent.payload.preview_id === "string" &&
      storedEvent.payload.preview_id === previewId &&
      storedEvent.type.startsWith("claude.session_preview.")
    );
  }

  function validatePreviewOpen(roomId: string, previewId: string, agentId: string, sessionId: string): { ok: true } | { ok: false; error: string; status: number } {
    const related = claudePreviewEvents(roomId, previewId);
    const requested = related.find((storedEvent) => storedEvent.type === "claude.session_preview.requested");
    if (!requested) return { ok: false, error: "unknown_preview", status: 404 };
    if (requested.payload.agent_id !== agentId || requested.payload.session_id !== sessionId) {
      return { ok: false, error: "preview_session_mismatch", status: 400 };
    }
    if (related.some((storedEvent) => storedEvent.type === "claude.session_preview.completed" || storedEvent.type === "claude.session_preview.failed")) {
      return { ok: false, error: "preview_closed", status: 409 };
    }
    return { ok: true };
  }

  function validatePreviewComplete(roomId: string, previewId: string, body: { agent_id: string; session_id: string; previewed_message_count: number }): { ok: true } | { ok: false; error: string; status: number } {
    const related = claudePreviewEvents(roomId, previewId);
    const requested = related.find((storedEvent) => storedEvent.type === "claude.session_preview.requested");
    if (!requested) return { ok: false, error: "unknown_preview", status: 404 };
    if (requested.payload.agent_id !== body.agent_id || requested.payload.session_id !== body.session_id) {
      return { ok: false, error: "preview_session_mismatch", status: 400 };
    }
    const uploaded = related.filter((storedEvent) => storedEvent.type === "claude.session_preview.message");
    const sequenceSet = new Set(uploaded.map((storedEvent) => storedEvent.payload.sequence));
    const hasContinuousSequence = uploaded.every((storedEvent) => typeof storedEvent.payload.sequence === "number") &&
      Array.from({ length: uploaded.length }, (_, index) => index).every((sequence) => sequenceSet.has(sequence));
    if (body.previewed_message_count !== uploaded.length || !hasContinuousSequence) {
      return { ok: false, error: "preview_incomplete", status: 409 };
    }
    return { ok: true };
  }

  function agentImportEvents(roomId: string, importId: string): CacpEvent[] {
    return store.listEvents(roomId).filter((storedEvent) =>
      typeof storedEvent.payload.import_id === "string" &&
      storedEvent.payload.import_id === importId &&
      storedEvent.type.startsWith("agent.session_import.")
    );
  }

  function validateAgentImportMessageBatch(roomId: string, importId: string, messages: Array<{ agent_id: string; provider: string; session_id: string; sequence: number }>): { ok: true } | { ok: false; error: string; status: number } {
    const related = agentImportEvents(roomId, importId);
    const started = related.find((storedEvent) => storedEvent.type === "agent.session_import.started");
    if (!started) return { ok: false, error: "unknown_import", status: 404 };
    if (related.some((storedEvent) => storedEvent.type === "agent.session_import.completed" || storedEvent.type === "agent.session_import.failed")) {
      return { ok: false, error: "import_closed", status: 409 };
    }
    if (!messages.every((message) => message.agent_id === started.payload.agent_id && message.provider === started.payload.provider && message.session_id === started.payload.session_id)) {
      return { ok: false, error: "import_session_mismatch", status: 400 };
    }
    const existingCount = related.filter((storedEvent) => storedEvent.type === "agent.session_import.message").length;
    const expectedSequences = messages.map((_, index) => existingCount + index);
    if (!messages.every((message, index) => message.sequence === expectedSequences[index])) {
      return { ok: false, error: "import_sequence_gap", status: 409 };
    }
    return { ok: true };
  }

  function validateAgentImportComplete(roomId: string, importId: string, body: { agent_id: string; provider: string; session_id: string; imported_message_count: number }): { ok: true } | { ok: false; error: string; status: number } {
    const related = agentImportEvents(roomId, importId);
    const started = related.find((storedEvent) => storedEvent.type === "agent.session_import.started");
    if (!started) return { ok: false, error: "unknown_import", status: 404 };
    if (related.some((storedEvent) => storedEvent.type === "agent.session_import.completed" || storedEvent.type === "agent.session_import.failed")) {
      return { ok: false, error: "import_closed", status: 409 };
    }
    if (body.agent_id !== started.payload.agent_id || body.provider !== started.payload.provider || body.session_id !== started.payload.session_id) {
      return { ok: false, error: "import_session_mismatch", status: 400 };
    }
    const expectedCount = typeof started.payload.message_count === "number" ? started.payload.message_count : undefined;
    const uploaded = related.filter((storedEvent) => storedEvent.type === "agent.session_import.message");
    const sequenceSet = new Set(uploaded.map((storedEvent) => storedEvent.payload.sequence));
    const hasContinuousSequence = uploaded.every((storedEvent) => typeof storedEvent.payload.sequence === "number") &&
      Array.from({ length: uploaded.length }, (_, index) => index).every((sequence) => sequenceSet.has(sequence));
    if (body.imported_message_count !== uploaded.length || expectedCount !== uploaded.length || !hasContinuousSequence) {
      return { ok: false, error: "import_incomplete", status: 409 };
    }
    return { ok: true };
  }

  function agentPreviewEvents(roomId: string, previewId: string): CacpEvent[] {
    return store.listEvents(roomId).filter((storedEvent) =>
      typeof storedEvent.payload.preview_id === "string" &&
      storedEvent.payload.preview_id === previewId &&
      storedEvent.type.startsWith("agent.session_preview.")
    );
  }

  function validateAgentPreviewOpen(roomId: string, previewId: string, agentId: string, provider: string, sessionId: string): { ok: true } | { ok: false; error: string; status: number } {
    const related = agentPreviewEvents(roomId, previewId);
    const requested = related.find((storedEvent) => storedEvent.type === "agent.session_preview.requested");
    if (!requested) return { ok: false, error: "unknown_preview", status: 404 };
    if (requested.payload.agent_id !== agentId || requested.payload.provider !== provider || requested.payload.session_id !== sessionId) {
      return { ok: false, error: "preview_session_mismatch", status: 400 };
    }
    if (related.some((storedEvent) => storedEvent.type === "agent.session_preview.completed" || storedEvent.type === "agent.session_preview.failed")) {
      return { ok: false, error: "preview_closed", status: 409 };
    }
    return { ok: true };
  }

  function validateAgentPreviewComplete(roomId: string, previewId: string, body: { agent_id: string; provider: string; session_id: string; previewed_message_count: number }): { ok: true } | { ok: false; error: string; status: number } {
    const related = agentPreviewEvents(roomId, previewId);
    const requested = related.find((storedEvent) => storedEvent.type === "agent.session_preview.requested");
    if (!requested) return { ok: false, error: "unknown_preview", status: 404 };
    if (requested.payload.agent_id !== body.agent_id || requested.payload.provider !== body.provider || requested.payload.session_id !== body.session_id) {
      return { ok: false, error: "preview_session_mismatch", status: 400 };
    }
    const uploaded = related.filter((storedEvent) => storedEvent.type === "agent.session_preview.message");
    const sequenceSet = new Set(uploaded.map((storedEvent) => storedEvent.payload.sequence));
    const hasContinuousSequence = uploaded.every((storedEvent) => typeof storedEvent.payload.sequence === "number") &&
      Array.from({ length: uploaded.length }, (_, index) => index).every((sequence) => sequenceSet.has(sequence));
    if (body.previewed_message_count !== uploaded.length || !hasContinuousSequence) {
      return { ok: false, error: "preview_incomplete", status: 409 };
    }
    return { ok: true };
  }

  function createStoredAgentPairing(roomId: string, actorId: string, body: z.infer<typeof AgentPairingCreateSchema>) {
    const pairingId = prefixedId("pair");
    const pairingToken = token();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const storedEvents = store.transaction(() => {
      store.createAgentPairing({
        pairing_id: pairingId,
        room_id: roomId,
        token_hash: hashToken(pairingToken, config.tokenSecret),
        created_by: actorId,
        agent_type: body.agent_type,
        permission_level: body.permission_level,
        working_dir: body.working_dir,
        created_at: now,
        expires_at: expiresAt
      });
      return [store.appendEvent(event(roomId, "agent.pairing_created", actorId, {
        pairing_id: pairingId,
        agent_type: body.agent_type,
        permission_level: body.permission_level,
        expires_at: expiresAt
      }))];
    });
    publishEvents(storedEvents);
    return { pairingId, pairingToken, expiresAt };
  }

  function createAgentPairing(roomId: string, actorId: string, body: z.infer<typeof AgentPairingCreateSchema>, serverUrl: string) {
    const pairing = createStoredAgentPairing(roomId, actorId, body);
    const connectionCode = buildConnectionCode({
      server_url: serverUrl,
      pairing_token: pairing.pairingToken,
      expires_at: pairing.expiresAt,
      room_id: roomId,
      agent_type: body.agent_type,
      permission_level: body.permission_level
    });
    return {
      pairing_token: pairing.pairingToken,
      expires_at: pairing.expiresAt,
      connection_code: connectionCode,
      command: pairingCommand(connectionCode)
    };
  }

  app.get("/health", async () => ({ ok: true, protocol: "cacp", version: "0.2.0" }));

  app.post("/rooms", async (request, reply) => {
    if (!roomLimiter.allow(request.ip)) return tooMany(reply);
    const body = CreateRoomSchema.parse(request.body);
    const roomId = prefixedId("room");
    const ownerId = prefixedId("user");
    const ownerToken = token();
    const storedEvents = store.transaction(() => {
      const createdAt = new Date().toISOString();
      store.createRoom({ room_id: roomId, name: body.name, owner_participant_id: ownerId, created_at: createdAt, archived_at: null });
      const owner = store.addParticipant({ room_id: roomId, id: ownerId, token: ownerToken, display_name: body.display_name, type: "human", role: "owner", main_thread_history_access: "allowed" });
      return [
        store.appendEvent(event(roomId, "room.created", ownerId, { name: body.name, created_by: ownerId })),
        store.appendEvent(event(roomId, "participant.joined", ownerId, { participant: publicParticipant(owner) }))
      ];
    });
    // Mint as alive (T4 / spec §11): room is "alive" only for the lifetime
    // of this server process. After restart the room ends. Ordering matters:
    // we add to aliveRooms BEFORE publishEvents so that any subscriber
    // observing room.created on the bus is guaranteed the registry already
    // includes this roomId — closes the sub-millisecond window where a
    // racing /events or /me request could see the event but read the gate
    // as false.
    aliveRooms.add(roomId);
    publishEvents(storedEvents);
    return reply.code(201).send({ room_id: roomId, owner_id: ownerId, owner_token: ownerToken });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/events", async (request, reply) => {
    // 410 Gone (not 404): the spec models rooms as ephemeral relays, so
    // a room that is no longer alive in this process is "existed and is
    // gone", which is the precise semantic of 410. (T4 / spec §11.)
    // Gate runs before auth so a stale token cannot probe whether the
    // room ever existed across a server restart.
    if (!aliveRooms.has(request.params.roomId)) return reply.code(410).send({ error: "room_ended" });
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const events = store.listEvents(request.params.roomId).filter((ev) => canViewEvent(ev, participant));
    return { events, participant: publicParticipant(participant) };
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/me", async (request, reply) => {
    // 410 Gone — see /events above for rationale. Gate before auth. (T4)
    if (!aliveRooms.has(request.params.roomId)) return reply.code(410).send({ error: "room_ended" });
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) {
      const token = bearerToken(request);
      const revoked = token ? store.getRevokedParticipantByToken(request.params.roomId, token) : undefined;
      if (revoked) return deny(reply, "participant_removed", 403);
      return deny(reply, "invalid_token");
    }
    const room = store.getRoom(request.params.roomId);
    if (!room) return deny(reply, "room_not_found", 404);
    return {
      room_id: room.room_id,
      name: room.name,
      role: participant.role,
      participant_id: participant.id,
      main_thread_history_access: participant.main_thread_history_access,
    };
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/presence", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) {
      const token = bearerToken(request);
      const revoked = token ? store.getRevokedParticipantByToken(request.params.roomId, token) : undefined;
      if (revoked) return deny(reply, "participant_removed", 403);
      return deny(reply, "invalid_token");
    }
    if (!presenceLimiter.allow(participant.id)) return tooMany(reply);
    const body = PresenceBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.presence_changed", participant.id, {
      participant_id: participant.id,
      presence: body.presence,
      updated_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.presence_changed" });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/typing/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) {
      const token = bearerToken(request);
      const revoked = token ? store.getRevokedParticipantByToken(request.params.roomId, token) : undefined;
      if (revoked) return deny(reply, "participant_removed", 403);
      return deny(reply, "invalid_token");
    }
    if (!typingLimiter.allow(participant.id)) return tooMany(reply);
    EmptyObjectBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.typing_started", participant.id, {
      participant_id: participant.id,
      scope: "room",
      started_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.typing_started" });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/activity/typing/stop", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) {
      const token = bearerToken(request);
      const revoked = token ? store.getRevokedParticipantByToken(request.params.roomId, token) : undefined;
      if (revoked) return deny(reply, "participant_removed", 403);
      return deny(reply, "invalid_token");
    }
    if (!typingLimiter.allow(participant.id)) return tooMany(reply);
    EmptyObjectBodySchema.parse(request.body ?? {});
    appendAndPublish(event(request.params.roomId, "participant.typing_stopped", participant.id, {
      participant_id: participant.id,
      scope: "room",
      stopped_at: new Date().toISOString()
    }));
    return reply.code(201).send({ ok: true, event_type: "participant.typing_stopped" });
  });

  app.get<{ Params: { roomId: string }; Querystring: { token?: string } }>("/rooms/:roomId/stream", { websocket: true }, (socket, request) => {
    if (!hasAllowedOrigin(config, request.headers.origin)) {
      socket.send(JSON.stringify({ error: "origin_not_allowed" }));
      socket.close();
      return;
    }
    const roomId = request.params.roomId;
    // 410 Gone equivalent over WS: room is not alive in this process.
    // Gate runs before auth + store reads so stale tokens cannot probe
    // room existence after restart. (T4 / spec §11.)
    if (!aliveRooms.has(roomId)) {
      socket.send(JSON.stringify({ error: "room_ended" }));
      socket.close();
      return;
    }
    const currentCount = socketCounts.get(roomId) ?? 0;
    if (currentCount >= config.maxSocketsPerRoom) {
      socket.send(JSON.stringify({ error: "room_full" }));
      socket.close();
      return;
    }
    socketCounts.set(roomId, currentCount + 1);
    const participant = request.query.token ? store.getParticipantByToken(roomId, request.query.token) : undefined;
    if (!participant) {
      socketCounts.set(roomId, (socketCounts.get(roomId) ?? 1) - 1);
      socket.send(JSON.stringify({ error: "invalid_token" }));
      socket.close();
      return;
    }
    if (participant.role === "agent") {
      appendAndPublish(event(roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "online" }));
    }
    for (const existingEvent of store.listEvents(roomId)) {
      if (canViewEvent(existingEvent, participant)) socket.send(JSON.stringify(existingEvent));
    }
    // Orbit events are live-only (T2: not persisted). Without a synthetic
    // catch-up here, a refreshing human would see an empty orbit layer. We
    // emit AFTER the durable replay (so order is durable-first) and BEFORE
    // bus.subscribe (so a brand-new note that arrives mid-handshake cannot
    // race ahead of its round.opened). See spec §6 + orbit-state.replayFor.
    if (HUMAN_ROLES.includes(participant.role)) {
      const orbit = getOrbitState(roomId);
      for (const synthetic of orbit.replayFor(participant)) {
        const payload = synthetic.payload as Record<string, unknown>;
        const noteId = typeof payload.note_id === "string" ? payload.note_id : undefined;
        const createdAt = typeof payload.created_at === "string" ? payload.created_at : undefined;
        const eventId = noteId ? `synth_${noteId}` : undefined;
        socket.send(JSON.stringify(event(roomId, synthetic.type, synthetic.actor_id, payload, createdAt, eventId)));
      }
    }
    const unsubscribe = bus.subscribe(roomId, (envelope) => {
      if (canDeliverEnvelope(envelope, participant) && canViewEvent(envelope.event, participant)) {
        socket.send(JSON.stringify(envelope.event));
      }
    });
    const forgetSocket = rememberSocket(roomId, participant.id, socket);
    clearPendingOffline(roomId, participant.id);
    socket.on("close", () => {
      unsubscribe();
      forgetSocket();
      socketCounts.set(roomId, (socketCounts.get(roomId) ?? 1) - 1);
      if (isClosing) return;
      const key = socketKey(roomId, participant.id);

      // Start / reset the auto-removal timer for this participant
      if (pendingOffline.has(key)) clearTimeout(pendingOffline.get(key));
      pendingOffline.set(key, setTimeout(() => {
        pendingOffline.delete(key);
        autoRemoveParticipant(roomId, participant);
      }, REMOVAL_GRACE_MS));

      // If this was the last socket for an agent, mark it offline immediately
      const stillConnected = participantSockets.has(key) && participantSockets.get(key)!.size > 0;
      if (!stillConnected && participant.role === "agent") {
        appendAndPublish(event(roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "offline" }));
      }
    });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/invites", async (request, reply) => {
    if (!inviteLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = CreateInviteSchema.parse(request.body);
    const inviteId = prefixedId("inv");
    const inviteToken = token();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000).toISOString();
    const humans = store.getParticipants(request.params.roomId).filter((p) => p.role !== "agent");
    const remainingSlots = config.maxParticipantsPerRoom - humans.length;
    if (remainingSlots <= 0) return deny(reply, "max_participants_reached", 409);
    const maxUses = Math.min(body.max_uses, remainingSlots);
    const historyAccess = body.main_thread_history_access ?? (body.role === "observer" ? "denied" : "allowed");
    const storedEvents = store.transaction(() => {
      store.createInvite({
        invite_id: inviteId,
        room_id: request.params.roomId,
        token_hash: hashToken(inviteToken, config.tokenSecret),
        role: body.role,
        main_thread_history_access: historyAccess,
        created_by: participant.id,
        created_at: now,
        expires_at: expiresAt,
        max_uses: maxUses
      });
      return [store.appendEvent(event(request.params.roomId, "invite.created", participant.id, { invite_id: inviteId, role: body.role, main_thread_history_access: historyAccess, expires_at: expiresAt, max_uses: maxUses }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, main_thread_history_access: historyAccess, expires_at: expiresAt, max_uses: maxUses });
  });

  app.get<{ Querystring: { token: string } }>("/invites/verify", async (request, reply) => {
    const token = request.query.token;
    if (!token || typeof token !== "string") return deny(reply, "missing_token", 400);
    const invite = store.getInviteByTokenHash(hashToken(token, config.tokenSecret));
    if (!invite) return reply.code(200).send({ valid: false, reason: "not_found" });
    if (invite.revoked_at !== null) return reply.code(200).send({ valid: false, reason: "revoked" });
    if (Date.parse(invite.expires_at) <= Date.now()) return reply.code(200).send({ valid: false, reason: "expired" });
    const pendingCount = store.countPendingJoinRequestsByInvite(invite.invite_id);
    if (invite.max_uses !== null && invite.used_count + pendingCount >= invite.max_uses) {
      return reply.code(200).send({ valid: false, reason: "limit_reached" });
    }
    return reply.code(200).send({ valid: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join-requests", async (request, reply) => {
    if (!joinLimiter.allow(request.ip)) return tooMany(reply);
    const body = JoinRequestCreateSchema.parse(request.body);
    const requestId = prefixedId("join");
    const requestToken = token();
    const roomId = request.params.roomId;
    const now = new Date().toISOString();
    const expiresAt = joinRequestExpiry();
    const result = store.transaction(() => {
      const invite = store.getInviteByTokenHash(hashToken(body.invite_token, config.tokenSecret));
      if (!invite || invite.room_id !== roomId) return { ok: false as const, error: "invalid_invite" };
      if (invite.revoked_at !== null) return { ok: false as const, error: "invite_revoked", status: 409 };
      if (Date.parse(invite.expires_at) <= Date.now()) return { ok: false as const, error: "invite_expired" };
      const pendingCount = store.countPendingJoinRequestsByInvite(invite.invite_id);
      if (invite.max_uses !== null && invite.used_count + pendingCount >= invite.max_uses) return { ok: false as const, error: "invite_use_limit_reached", status: 409 };
      const stored = store.createJoinRequest({
        request_id: requestId,
        room_id: roomId,
        invite_id: invite.invite_id,
        request_token_hash: hashToken(requestToken, config.tokenSecret),
        display_name: body.display_name,
        role: invite.role === "observer" ? "observer" : "member",
        main_thread_history_access: invite.main_thread_history_access,
        status: "pending",
        requested_at: now,
        expires_at: expiresAt,
        requester_ip: request.ip,
        requester_user_agent: request.headers["user-agent"]
      });
      const created = store.appendEvent(event(roomId, "join_request.created", "system", publicJoinRequest(stored)));
      return { ok: true as const, stored, events: [created] };
    });
    if (!result.ok) return deny(reply, result.error, result.status);
    publishEvents(result.events);
    return reply.code(201).send({ request_id: requestId, request_token: requestToken, status: "pending", main_thread_history_access: result.stored!.main_thread_history_access, expires_at: expiresAt });
  });

  app.get<{ Params: { roomId: string; requestId: string }; Querystring: { request_token?: string } }>("/rooms/:roomId/join-requests/:requestId", async (request, reply) => {
    if (!joinRequestPollLimiter.allow(request.ip)) return tooMany(reply);
    const query = JoinRequestStatusQuerySchema.parse(request.query);
    const tokenHash = hashToken(query.request_token, config.tokenSecret);
    const current = store.getJoinRequest(request.params.requestId);
    if (!current || current.room_id !== request.params.roomId || current.request_token_hash !== tokenHash) return deny(reply, "unknown_join_request", 404);
    if (current.status === "pending" && Date.parse(current.expires_at) <= Date.now()) {
      const expired = store.expireJoinRequest(current.request_id, new Date().toISOString());
      appendAndPublish(event(current.room_id, "join_request.expired", "system", publicJoinRequest(expired)));
      return { status: "expired" };
    }
    if (current.status === "approved") {
      return {
        status: "approved",
        participant_id: current.participant_id,
        participant_token: current.participant_token_sealed ? openSecret(current.participant_token_sealed, config.tokenSecret) : undefined,
        role: current.role,
        main_thread_history_access: current.main_thread_history_access
      };
    }
    return { status: current.status, main_thread_history_access: current.main_thread_history_access };
  });

  app.get<{ Params: { roomId: string }; Querystring: { status?: string } }>("/rooms/:roomId/join-requests", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const query = JoinRequestListQuerySchema.parse(request.query);
    return { requests: store.listJoinRequests(request.params.roomId, query.status).map(publicJoinRequest) };
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/join-requests/:requestId/approve", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const participantId = prefixedId("user");
    const participantToken = token();
    const decidedAt = new Date().toISOString();
    const result = store.transaction(() => {
      const current = store.getJoinRequest(request.params.requestId);
      if (!current || current.room_id !== request.params.roomId) return { ok: false as const, error: "unknown_join_request", status: 404 };
      if (current.status !== "pending") return { ok: false as const, error: "join_request_not_pending", status: 409 };
      if (Date.parse(current.expires_at) <= Date.now()) {
        const expired = store.expireJoinRequest(current.request_id, decidedAt);
        return { ok: false as const, error: "join_request_expired", status: 409, events: [store.appendEvent(event(current.room_id, "join_request.expired", "system", publicJoinRequest(expired)))] };
      }
      const humans = store.getParticipants(current.room_id).filter((p) => p.role !== "agent");
      if (humans.length >= config.maxParticipantsPerRoom) return { ok: false as const, error: "max_participants_reached", status: 409 };
      try {
        store.consumeInvite(current.invite_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "invite_use_limit_reached") return { ok: false as const, error: "invite_use_limit_reached", status: 409 };
        if (message === "invite_revoked") return { ok: false as const, error: "invite_revoked", status: 409 };
        throw err;
      }
      const role = current.role === "observer" ? "observer" : "member";
      const joined = store.addParticipant({ room_id: current.room_id, id: participantId, token: participantToken, display_name: current.display_name, type: role === "observer" ? "observer" : "human", role, main_thread_history_access: current.main_thread_history_access });
      const approved = store.approveJoinRequest(current.request_id, {
        decided_at: decidedAt,
        decided_by: participant.id,
        participant_id: participantId,
        participant_token_sealed: sealSecret(participantToken, config.tokenSecret)
      });
      const events: CacpEvent[] = [
        store.appendEvent(event(current.room_id, "join_request.approved", participant.id, { ...publicJoinRequest(approved), invite_id: current.invite_id })),
        store.appendEvent(event(current.room_id, "participant.joined", joined.id, { participant: publicParticipant(joined) }))
      ];
      const inviteAfter = store.getInviteById(current.invite_id);
      if (inviteAfter && inviteAfter.max_uses !== null && inviteAfter.used_count >= inviteAfter.max_uses && inviteAfter.revoked_at === null) {
        const revoked = store.revokeInvite(current.invite_id, decidedAt);
        events.push(store.appendEvent(event(current.room_id, "invite.revoked", participant.id, { invite_id: current.invite_id, revoked_at: decidedAt })));
      }
      return { ok: true as const, participant: joined, role, events };
    });
    if (!result.ok) {
      if (result.events) publishEvents(result.events);
      return deny(reply, result.error, result.status);
    }
    publishEvents(result.events);
    return reply.code(201).send({ participant_id: result.participant.id, role: result.role });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/join-requests/:requestId/reject", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    JoinDecisionSchema.parse(request.body);
    const current = store.getJoinRequest(request.params.requestId);
    if (!current || current.room_id !== request.params.roomId) return deny(reply, "unknown_join_request", 404);
    const rejected = store.rejectJoinRequest(request.params.requestId, new Date().toISOString(), participant.id);
    appendAndPublish(event(request.params.roomId, "join_request.rejected", participant.id, publicJoinRequest(rejected)));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join", async (request, reply) => {
    return deny(reply, "join_requires_owner_approval", 410);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/leave", async (request, reply) => {
    const actor = requireParticipant(store, request.params.roomId, request);
    if (!actor) return deny(reply, "invalid_token");
    if (!hasHumanRole(actor, ["owner"])) return deny(reply, "forbidden", 403);
    z.object({}).parse(request.body ?? {});

    const removedAt = new Date().toISOString();
    const participants = store.getParticipants(request.params.roomId);
    const storedEvents = store.transaction(() => {
      const events: CacpEvent[] = [];
      for (const target of participants) {
        store.revokeParticipant(request.params.roomId, target.id, actor.id, removedAt, "owner_left_room");
        events.push(store.appendEvent(event(request.params.roomId, "participant.removed", actor.id, {
          participant_id: target.id,
          removed_by: actor.id,
          removed_at: removedAt,
          reason: "owner_left_room"
        })));
        if (target.role === "agent") {
          events.push(store.appendEvent(event(request.params.roomId, "agent.status_changed", target.id, { agent_id: target.id, status: "offline" })));
        }
      }
      return events;
    });
    publishEvents(storedEvents);
    // Owner explicit Leave Room dissolves the room (spec §11 / §2.34).
    // Member-leave never reaches here (rejected with 403 above), so this
    // delete is unconditional once we get past the owner-role check. (T4)
    //
    // Ordering matters: we flip the gate (aliveRooms.delete) BEFORE
    // closeRoomSockets so the room is "dead" from the registry's
    // perspective the moment any failure mode could short-circuit the
    // socket cleanup. closeRoomSockets is wrapped in try/catch so a
    // throw there cannot prevent the 201 response — the client already
    // sees the room as gone (next /me would 410), and any leaked socket
    // is bounded by process lifetime.
    aliveRooms.delete(request.params.roomId);
    try {
      closeRoomSockets(request.params.roomId, 4001, "owner_left_room");
    } catch (err) {
      request.log.error({ err, roomId: request.params.roomId }, "closeRoomSockets failed during owner /leave; continuing");
    }
    store.deleteRoom(request.params.roomId);
    return reply.code(201).send({ ok: true, status: "room_closed" });
  });

  app.post<{ Params: { roomId: string; participantId: string } }>("/rooms/:roomId/participants/:participantId/remove", async (request, reply) => {
    const actor = requireParticipant(store, request.params.roomId, request);
    if (!actor) return deny(reply, "invalid_token");
    if (!hasHumanRole(actor, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = z.object({ reason: z.string().max(300).optional() }).parse(request.body);
    const target = findParticipant(request.params.roomId, request.params.participantId);
    if (!target) return deny(reply, "unknown_participant", 404);
    if (target.role === "owner") return deny(reply, "cannot_remove_owner", 409);
    if (target.id === actor.id) return deny(reply, "cannot_remove_self", 409);
    if (actor.role === "admin" && target.role === "admin") return deny(reply, "cannot_remove_admin", 409);
    const removedAt = new Date().toISOString();
    const storedEvents = store.transaction(() => {
      store.revokeParticipant(request.params.roomId, target.id, actor.id, removedAt, body.reason ?? "removed_by_owner");
      const events = [
        store.appendEvent(event(request.params.roomId, "participant.removed", actor.id, {
          participant_id: target.id,
          removed_by: actor.id,
          removed_at: removedAt,
          reason: body.reason ?? "removed_by_owner"
        }))
      ];
      if (target.role === "agent") {
        events.push(store.appendEvent(event(request.params.roomId, "agent.status_changed", target.id, { agent_id: target.id, status: "offline" })));
        if (findActiveAgentId(store.listEvents(request.params.roomId)) === target.id) {
          events.push(store.appendEvent(event(request.params.roomId, "room.agent_selected", actor.id, { agent_id: "" })));
        }
      }
      return events;
    });
    publishEvents(storedEvents);
    closeParticipantSockets(request.params.roomId, target.id);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; participantId: string } }>("/rooms/:roomId/participants/:participantId/role", async (request, reply) => {
    const actor = requireParticipant(store, request.params.roomId, request);
    if (!actor) return deny(reply, "invalid_token");
    if (!hasHumanRole(actor, ["owner"])) return deny(reply, "forbidden", 403);
    const body = UpdateRoleSchema.parse(request.body);
    const target = findParticipant(request.params.roomId, request.params.participantId);
    if (!target) return deny(reply, "unknown_participant", 404);
    if (target.id === actor.id) return deny(reply, "cannot_change_own_role", 409);
    if (target.role === "owner") return deny(reply, "cannot_change_owner_role", 409);
    const updatedAt = new Date().toISOString();
    const storedEvents = store.transaction(() => {
      store.updateParticipantRole(request.params.roomId, target.id, body.role);
      return [
        store.appendEvent(event(request.params.roomId, "participant.role_updated", actor.id, {
          participant_id: target.id,
          old_role: target.role,
          new_role: body.role,
          updated_by: actor.id,
          updated_at: updatedAt
        }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, participant: publicParticipant({ ...target, role: body.role }) });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/main-inputs", async (request, reply) => {
    if (!messageLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = z.object({ text: z.string().min(1).max(config.maxMessageLength) }).parse(request.body);
    const roomId = request.params.roomId;
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return deny(reply, "active_agent_unavailable", 409);
    if (!isAgentOnline(events, activeAgentId)) return deny(reply, "active_agent_unavailable", 409);
    const capabilities = findAgentCapabilities(events, activeAgentId);
    const localProvider = providerForCapabilities(capabilities);
    if (localProvider) {
      const ready = localProvider === "claude-code"
        ? hasClaudeSessionReady(events, activeAgentId) || hasLocalAgentSessionReady(events, activeAgentId, localProvider)
        : hasLocalAgentSessionReady(events, activeAgentId, localProvider);
      if (!ready) return deny(reply, "agent_session_not_ready", 409);
    }
    const turnEvents = events;
    const openTurn = findAnyOpenTurn(turnEvents);
    const queuedArr = getQueuedMainInputs(roomId);
    if (openTurn && queuedArr.length >= MAX_QUEUED_PER_ROOM) {
      return deny(reply, "queue_full", 409);
    }
    const inputId = prefixedId("input");
    const now = new Date().toISOString();
    const accepted = event(roomId, "main_input.accepted", participant.id, {
      input_id: inputId,
      author_id: participant.id,
      text: body.text,
      source: "composer",
      created_at: now,
      message_id: inputId
    });
    const queuedTurnId = openTurn ? openTurn.turn_id : (findLastTurnId(events) ?? "none");
    const queued = event(roomId, "main_input.queued", participant.id, {
      input_id: inputId,
      queued_after_turn_id: queuedTurnId,
      message_id: inputId
    });
    const messageCreated = event(roomId, "message.created", participant.id, {
      message_id: inputId,
      text: body.text,
      kind: "human",
      created_at: now
    });
    appendAndPublish(messageCreated);
    let triggered: CacpEvent | undefined;
    let extraTurnEvents: CacpEvent[] = [];
    let triggerTurnId = "";
    if (!openTurn) {
      const turnRequestEvents = createMainInputTurnRequestEvents(roomId, {
        actorId: participant.id,
        authorName: participant.display_name,
        authorRole: participant.role,
        text: body.text,
        source: "composer"
      });
      if (turnRequestEvents.length === 0) return deny(reply, "active_agent_unavailable", 409);
      triggerTurnId = (turnRequestEvents.find((e) => e.type === "agent.turn.requested")?.payload as { turn_id: string })?.turn_id ?? "";
      triggered = event(roomId, "main_input.triggered", participant.id, {
        input_id: inputId,
        trigger_turn_id: triggerTurnId,
        message_id: inputId
      });
      extraTurnEvents = store.transaction(() => turnRequestEvents.map((nextEvent) => store.appendEvent(nextEvent)));
    } else {
      queuedArr.push({
        input_id: inputId,
        author_id: participant.id,
        author_name: participant.display_name,
        author_role: participant.role,
        text: body.text,
        source: "composer",
        created_at: now
      });
    }
    appendAndPublish(accepted);
    appendAndPublish(queued);
    if (triggered) appendAndPublish(triggered);
    publishEvents(extraTurnEvents);
    return reply.code(201).send({ input_id: inputId, status: openTurn ? "queued" : "triggered" });
  });

  app.post<{ Params: { roomId: string; inputId: string } }>("/rooms/:roomId/main-inputs/:inputId/cancel", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const roomId = request.params.roomId;
    const inputId = request.params.inputId;
    const idx = findQueuedMainInputIndex(roomId, inputId);
    if (idx < 0) return deny(reply, "input_not_found", 409);
    queuedMainInputs.get(roomId)!.splice(idx, 1);
    appendAndPublish(event(roomId, "main_input.cancelled", participant.id, { input_id: inputId, message_id: inputId, cancelled_by: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/orbit/notes", async (request, reply) => {
    if (!orbitLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = z.object({ text: z.string().min(1).max(2000) }).parse(request.body);
    const roomId = request.params.roomId;
    const orbit = getOrbitState(roomId);
    const noteId = prefixedId("note");
    const now = new Date().toISOString();
    const note = orbit.addNote({
      note_id: noteId,
      author_id: participant.id,
      author_name: participant.display_name,
      text: body.text,
      created_at: now
    });
    store.addOrbitNote({ room_id: roomId, ...note });
    publishRoleFiltered(event(roomId, "orbit.note.created", participant.id, {
      note_id: note.note_id,
      author_id: note.author_id,
      author_name: note.author_name,
      text: note.text,
      created_at: note.created_at
    }), HUMAN_ROLES);
    return reply.code(201).send({ note_id: noteId });
  });

  app.post<{ Params: { roomId: string; noteId: string } }>("/rooms/:roomId/orbit/notes/:noteId/like", async (request, reply) => {
    if (!orbitLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const roomId = request.params.roomId;
    const orbit = getOrbitState(roomId);
    const note = orbit.getNote(request.params.noteId);
    if (!note) return deny(reply, "note_not_found", 404);
    if (note.author_id === participant.id) return deny(reply, "self_like_not_allowed", 409);
    const result = orbit.setLike(request.params.noteId, participant.id, true);
    publishRoleFiltered(event(roomId, "orbit.like.changed", participant.id, {
      note_id: request.params.noteId,
      participant_id: participant.id,
      liked: true,
      likes: result.count
    }), HUMAN_ROLES);
    return reply.code(201).send({ liked: result.liked, count: result.count });
  });

  app.delete<{ Params: { roomId: string; noteId: string } }>("/rooms/:roomId/orbit/notes/:noteId/like", async (request, reply) => {
    if (!orbitLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const roomId = request.params.roomId;
    const orbit = getOrbitState(roomId);
    const note = orbit.getNote(request.params.noteId);
    if (!note) return deny(reply, "note_not_found", 404);
    const result = orbit.setLike(request.params.noteId, participant.id, false);
    publishRoleFiltered(event(roomId, "orbit.like.changed", participant.id, {
      note_id: request.params.noteId,
      participant_id: participant.id,
      liked: false,
      likes: result.count
    }), HUMAN_ROLES);
    return reply.code(201).send({ liked: result.liked, count: result.count });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/orbit/clear", async (request, reply) => {
    if (!orbitLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const roomId = request.params.roomId;
    const now = new Date().toISOString();
    getOrbitState(roomId).reset();
    store.clearOrbitNotes(roomId);
    publishRoleFiltered(event(roomId, "orbit.cleared", participant.id, {
      cleared_by: participant.id,
      cleared_at: now
    }), HUMAN_ROLES);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/orbit/promote", async (request, reply) => {
    if (!orbitLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = z.object({ note_ids: z.array(z.string().min(1)).min(1) }).parse(request.body);
    const roomId = request.params.roomId;
    const orbit = getOrbitState(roomId);
    const freshRequestedIds = body.note_ids.filter((id) => !orbit.isQuoted(id));
    if (freshRequestedIds.length === 0) return deny(reply, "all_already_quoted", 409);
    const payload = orbit.buildPromotionPayload(freshRequestedIds);
    if (!payload) return deny(reply, "no_notes_selected", 409);

    const inputId = prefixedId("input");
    const now = new Date().toISOString();
    const events = store.listEvents(roomId);
    const activeAgentId = findActiveAgentId(events);
    if (!activeAgentId) return deny(reply, "active_agent_unavailable", 409);
    const turnEvents = events;
    const openTurn = findAnyOpenTurn(turnEvents);
    const queuedArr = getQueuedMainInputs(roomId);
    if (openTurn && queuedArr.length >= MAX_QUEUED_PER_ROOM) {
      return deny(reply, "queue_full", 409);
    }
    const queuedTurnId = openTurn ? openTurn.turn_id : (findLastTurnId(turnEvents) ?? "none");

    const accepted = event(roomId, "main_input.accepted", participant.id, {
      input_id: inputId,
      author_id: participant.id,
      text: payload.text,
      source: "orbit_promote",
      created_at: now
    });
    const queued = event(roomId, "main_input.queued", participant.id, {
      input_id: inputId,
      queued_after_turn_id: queuedTurnId
    });
    let triggered: CacpEvent | undefined;
    let extraTurnEvents: CacpEvent[] = [];
    let triggerTurnId = "";
    if (!openTurn) {
      const turnRequestEvents = createMainInputTurnRequestEvents(roomId, {
        actorId: participant.id,
        authorName: participant.display_name,
        authorRole: participant.role,
        text: payload.text,
        source: "orbit_promote"
      });
      if (turnRequestEvents.length === 0) return deny(reply, "active_agent_unavailable", 409);
      triggerTurnId = (turnRequestEvents.find((e) => e.type === "agent.turn.requested")?.payload as { turn_id: string })?.turn_id ?? "";
      triggered = event(roomId, "main_input.triggered", participant.id, {
        input_id: inputId,
        trigger_turn_id: triggerTurnId
      });
      extraTurnEvents = store.transaction(() => turnRequestEvents.map((nextEvent) => store.appendEvent(nextEvent)));
    } else {
      queuedArr.push({
        input_id: inputId,
        author_id: participant.id,
        author_name: participant.display_name,
        author_role: participant.role,
        text: payload.text,
        source: "orbit_promote",
        created_at: now
      });
    }
    publishLiveOnly(accepted);
    publishLiveOnly(queued);
    if (triggered) publishLiveOnly(triggered);
    publishEvents(extraTurnEvents);
    const quotedNoteIds = orbit.markQuoted(payload.noteIds);
    if (quotedNoteIds.length > 0) {
      publishRoleFiltered(event(roomId, "orbit.notes.quoted", participant.id, { note_ids: quotedNoteIds }), HUMAN_ROLES);
    }
    return reply.code(201).send({ input_id: inputId, status: openTurn ? "queued" : "triggered", note_count: payload.noteCount });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    if (!messageLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = z.object({ text: z.string().min(1).max(config.maxMessageLength) }).parse(request.body);
    const storedEvents = store.transaction(() => {
      const messageId = prefixedId("msg");
      const message = store.appendEvent(event(request.params.roomId, "message.created", participant.id, {
        message_id: messageId,
        text: body.text,
        kind: "human"
      }));

      return [message, ...createAgentTurnRequestEvents(request.params.roomId, participant.id, "human_message").map((nextEvent) => store.appendEvent(nextEvent))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send(storedEvents[0]);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/proposals", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = ProposalSchema.parse(request.body);
    const proposalId = prefixedId("prop");
    appendAndPublish(event(request.params.roomId, "proposal.created", participant.id, { proposal_id: proposalId, ...body }));
    return reply.code(201).send({ proposal_id: proposalId });
  });

  app.post<{ Params: { roomId: string; proposalId: string } }>("/rooms/:roomId/proposals/:proposalId/votes", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const state = findProposalState(request.params.roomId, request.params.proposalId);
    if (!state) return deny(reply, "unknown_proposal", 404);
    if (state.terminal_status) return deny(reply, "proposal_closed", 409);
    const vote = VoteRecordSchema.parse({ ...(request.body as object), voter_id: participant.id });
    const votes = [...state.votes, vote];
    const evaluation = evaluatePolicy(state.policy, store.getParticipants(request.params.roomId), votes);
    const eventsToAppend = [event(request.params.roomId, "proposal.vote_cast", participant.id, { proposal_id: request.params.proposalId, ...vote })];
    if (evaluation.status === "approved") eventsToAppend.push(event(request.params.roomId, "proposal.approved", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "rejected") eventsToAppend.push(event(request.params.roomId, "proposal.rejected", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "expired") eventsToAppend.push(event(request.params.roomId, "proposal.expired", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    const storedEvents = store.transaction(() => eventsToAppend.map((nextEvent) => store.appendEvent(nextEvent)));
    publishEvents(storedEvents);
    return reply.code(201).send({ evaluation });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/register", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const agents = store.getParticipants(request.params.roomId).filter((p) => p.role === "agent");
    if (agents.length >= config.maxAgentsPerRoom) return deny(reply, "max_agents_reached", 409);
    const body = AgentRegisterSchema.parse(request.body);
    const agentId = prefixedId("agent");
    const agentToken = token();
    const storedEvents = store.transaction(() => {
      const added = store.addParticipant({ room_id: request.params.roomId, id: agentId, token: agentToken, display_name: body.name, type: "agent", role: "agent", main_thread_history_access: "allowed" });
      return [
        store.appendEvent(event(request.params.roomId, "agent.registered", participant.id, { agent_id: agentId, name: body.name, capabilities: body.capabilities })),
        store.appendEvent(event(request.params.roomId, "participant.joined", agentId, { participant: publicParticipant(added) }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ agent_id: agentId, agent_token: agentToken });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-pairings", async (request, reply) => {
    if (!pairingLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = AgentPairingCreateSchema.parse(request.body);
    const roomId = request.params.roomId;
    const serverUrl = body.server_url ?? config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
    const pairing = createStoredAgentPairing(roomId, participant.id, body);
    return reply.code(201).send({
      connection_code: buildConnectionCode({
        server_url: serverUrl,
        pairing_token: pairing.pairingToken,
        expires_at: pairing.expiresAt,
        room_id: roomId,
        agent_type: body.agent_type,
        permission_level: body.permission_level
      }),
      expires_at: pairing.expiresAt,
      download_url: "/downloads/CACP-Local-Connector.exe"
    });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-pairings/start-local", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    if (!config.enableLocalLaunch) return deny(reply, "local_launch_disabled", 403);
    const body = AgentPairingStartLocalSchema.parse(request.body);
    const serverUrl = body.server_url ?? config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
    const requestHost = request.headers.host;
    if (!isLocalUrl(serverUrl) || !isLocalHost(requestHost)) return deny(reply, "local_launch_requires_localhost", 400);

    const pairing = createAgentPairing(request.params.roomId, participant.id, body, serverUrl);
    const launchId = prefixedId("launch");
    const logDir = resolve(localRepoRoot, ".tmp-test-services", "adapters");
    const outLog = resolve(logDir, `${launchId}.out.log`);
    const errLog = resolve(logDir, `${launchId}.err.log`);
    const launch = await localAgentLauncher({
      launchId,
      command: "corepack",
      args: pairingLaunchArgs(pairing.connection_code),
      cwd: localRepoRoot,
      outLog,
      errLog,
      showConsole: true,
      consoleTitle: "CACP Local Agent Bridge - DO NOT CLOSE"
    });
    return reply.code(201).send({
      launch_id: launchId,
      pairing_token: pairing.pairing_token,
      expires_at: pairing.expires_at,
      command: pairing.command,
      status: "starting",
      pid: launch.pid,
      out_log: outLog,
      err_log: errLog
    });
  });

  app.post<{ Params: { pairingToken: string }; Body: { adapter_name?: string; working_dir?: string }; Querystring: { server_url?: string } }>("/agent-pairings/:pairingToken/claim", async (request, reply) => {
    if (!pairingClaimLimiter.allow(request.ip)) return tooMany(reply);
    const body = AgentPairingClaimSchema.parse(request.body);
    const agentId = prefixedId("agent");
    const agentToken = token();
    const pairingHash = hashToken(request.params.pairingToken, config.tokenSecret);
    const claimResult = store.transaction(() => {
      const pairing = store.getAgentPairingByTokenHash(pairingHash);
      if (!pairing) return { ok: false as const, error: "invalid_pairing" };
      if (pairing.claimed_at !== null) return { ok: false as const, error: "pairing_claimed", status: 409 };
      if (Date.parse(pairing.expires_at) <= Date.now()) return { ok: false as const, error: "pairing_expired" };
      const roomId = pairing.room_id;
      const agents = store.getParticipants(roomId).filter((p) => p.role === "agent");
      if (agents.length >= config.maxAgentsPerRoom) return { ok: false as const, error: "max_agents_reached", status: 409 };
      const serverUrl = request.query.server_url ?? config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
      const hookUrl = `${serverUrl}/rooms/${roomId}/agent-action-approvals?token=${encodeURIComponent(agentToken)}`;
      const agentType = pairing.agent_type as AgentType;
      const permissionLevel = pairing.permission_level as PermissionLevel;
      const workingDir = body.working_dir ?? (pairing.working_dir || ".");
      const profile = buildAgentProfile({
        agentType,
        permissionLevel,
        workingDir,
        hookUrl
      });
      store.claimAgentPairing(pairing.pairing_id, new Date().toISOString(), agentId);
      const added = store.addParticipant({ room_id: roomId, id: agentId, token: agentToken, display_name: body.adapter_name ?? profile.name, type: "agent", role: "agent", main_thread_history_access: "allowed" });
      const shouldSelectAgent = !findActiveAgentId(store.listEvents(roomId));
      const events = [
        store.appendEvent(event(roomId, "agent.registered", pairing.created_by, {
          agent_id: agentId,
          name: body.adapter_name ?? profile.name,
          capabilities: profile.capabilities,
          agent_type: agentType,
          permission_level: permissionLevel
        })),
        store.appendEvent(event(roomId, "participant.joined", agentId, { participant: publicParticipant(added) })),
        store.appendEvent(event(roomId, "agent.status_changed", agentId, { agent_id: agentId, status: "online" }))
      ];
      if (shouldSelectAgent) {
        events.push(store.appendEvent(event(roomId, "room.agent_selected", pairing.created_by, { agent_id: agentId })));
      }
      return { ok: true as const, roomId, agentType, permissionLevel, profile, hookUrl, events };
    });
    if (!claimResult.ok) return deny(reply, claimResult.error, claimResult.status);
    publishEvents(claimResult.events);
    return reply.code(201).send({ room_id: claimResult.roomId, agent_id: agentId, agent_token: agentToken, agent: claimResult.profile, agent_type: claimResult.agentType, permission_level: claimResult.permissionLevel, hook_url: claimResult.hookUrl });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/select", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = SelectAgentSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    appendAndPublish(event(request.params.roomId, "room.agent_selected", participant.id, { agent_id: body.agent_id }));
    return reply.code(201).send({ ok: true, agent_id: body.agent_id });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-catalog", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionCatalogBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_catalog.updated", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-previews", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = ClaudeSessionPreviewRequestBodySchema.parse(request.body);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewId = prefixedId("preview");
    const payload = {
      preview_id: previewId,
      agent_id: body.agent_id,
      session_id: body.session_id,
      requested_by: participant.id,
      requested_at: new Date().toISOString()
    };
    appendAndPublish(event(request.params.roomId, "claude.session_preview.requested", participant.id, payload));
    return reply.code(201).send({ ok: true, preview_id: previewId });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/claude/session-previews/:previewId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionPreviewMessagesBodySchema.parse(request.body);
    if (!body.every((message) => message.preview_id === request.params.previewId)) return deny(reply, "preview_id_mismatch", 400);
    if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
    const first = body[0];
    const validation = validateClaudeAgent(request.params.roomId, first.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewValidation = validatePreviewOpen(request.params.roomId, request.params.previewId, first.agent_id, first.session_id);
    if (!previewValidation.ok) return deny(reply, previewValidation.error, previewValidation.status);
    const storedEvents = store.transaction(() => body.map((message) => store.appendEvent(event(request.params.roomId, "claude.session_preview.message", participant.id, message))));
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, previewed: body.length });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/claude/session-previews/:previewId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionPreviewCompleteBodySchema.parse(request.body);
    if (body.preview_id !== request.params.previewId) return deny(reply, "preview_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewValidation = validatePreviewOpen(request.params.roomId, request.params.previewId, body.agent_id, body.session_id);
    if (!previewValidation.ok) return deny(reply, previewValidation.error, previewValidation.status);
    const completeValidation = validatePreviewComplete(request.params.roomId, request.params.previewId, body);
    if (!completeValidation.ok) return deny(reply, completeValidation.error, completeValidation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_preview.completed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/claude/session-previews/:previewId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionPreviewFailBodySchema.parse(request.body);
    if (body.preview_id !== request.params.previewId) return deny(reply, "preview_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_preview.failed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-selection", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = ClaudeSessionSelectionBodySchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const stored = store.transaction(() => {
      store.purgeContentEvents(request.params.roomId);
      return store.appendEvent(event(request.params.roomId, "claude.session_selected", participant.id, {
        ...body,
        selected_by: participant.id
      }));
    });
    publishEvents([stored]);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-ready", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionReadyBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedClaudeSessionReady(request.params.roomId, body.agent_id, body);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_ready", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-imports/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportStartBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedClaudeResumeSession(request.params.roomId, body.agent_id, body.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_import.started", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportMessagesBodySchema.parse(request.body);
    if (!body.every((message) => message.import_id === request.params.importId)) return deny(reply, "import_id_mismatch", 400);
    if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
    const first = body[0];
    const agentValidation = validateClaudeAgent(request.params.roomId, participant.id);
    if (!agentValidation.ok) return deny(reply, agentValidation.error, agentValidation.status);
    const selectionValidation = validateSelectedClaudeResumeSession(request.params.roomId, first.agent_id, first.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    const batchValidation = validateImportMessageBatch(request.params.roomId, request.params.importId, body);
    if (!batchValidation.ok) return deny(reply, batchValidation.error, batchValidation.status);
    const storedEvents = store.transaction(() => body.map((message) => store.appendEvent(event(request.params.roomId, "claude.session_import.message", participant.id, message))));
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, imported: body.length });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportCompleteBodySchema.parse(request.body);
    if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedClaudeResumeSession(request.params.roomId, body.agent_id, body.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    const completeValidation = validateImportComplete(request.params.roomId, request.params.importId, body);
    if (!completeValidation.ok) return deny(reply, completeValidation.error, completeValidation.status);
    appendAndPublish(event(request.params.roomId, "claude.session_import.completed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportFailBodySchema.parse(request.body);
    if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateClaudeAgent(request.params.roomId, body.agent_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    if (body.session_id) {
      const selectionValidation = validateSelectedClaudeResumeSession(request.params.roomId, body.agent_id, body.session_id);
      if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    }
    appendAndPublish(event(request.params.roomId, "claude.session_import.failed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/runtime-status", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const raw = request.body as { kind?: unknown; payload?: unknown };
    if (raw.kind !== "changed" && raw.kind !== "completed" && raw.kind !== "failed") return deny(reply, "invalid_status_kind", 400);
    const payload = ClaudeRuntimeStatusBodySchema[raw.kind].parse(raw.payload);
    if (!assertAgentOwnsPayload(participant, payload.agent_id)) return deny(reply, "forbidden", 403);
    if (raw.kind === "changed") {
      const runtimeValidation = validateClaudeRuntime(request.params.roomId, payload.agent_id, payload.turn_id);
      if (!runtimeValidation.ok) return deny(reply, runtimeValidation.error, runtimeValidation.status);
    } else {
      const agentValidation = validateClaudeAgent(request.params.roomId, payload.agent_id);
      if (!agentValidation.ok) return deny(reply, agentValidation.error, agentValidation.status);
      const turnValid = validateTurnBelongsToAgent(store.listEvents(request.params.roomId), payload.turn_id, payload.agent_id);
      if (!turnValid) return deny(reply, "turn_not_found", 403);
    }
    const eventType = raw.kind === "changed"
      ? "claude.runtime.status_changed"
      : raw.kind === "completed"
        ? "claude.runtime.status_completed"
        : "claude.runtime.status_failed";
    appendAndPublish(event(request.params.roomId, eventType, participant.id, payload));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/thinking-delta", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const payload = ClaudeThinkingDeltaBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, payload.agent_id)) return deny(reply, "forbidden", 403);
    const runtimeValidation = validateClaudeRuntime(request.params.roomId, payload.agent_id, payload.turn_id);
    if (!runtimeValidation.ok) return deny(reply, runtimeValidation.error, runtimeValidation.status);
    appendAndPublish(event(request.params.roomId, "claude.output.thinking_delta", participant.id, payload));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-sessions/catalog", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionCatalogBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_catalog.updated", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-sessions/selection", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = AgentSessionSelectionBodySchema.parse(request.body);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const stored = store.transaction(() => {
      store.purgeContentEvents(request.params.roomId);
      return store.appendEvent(event(request.params.roomId, "agent.session_selected", participant.id, {
        ...body,
        selected_by: participant.id
      }));
    });
    publishEvents([stored]);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-sessions/ready", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionReadyBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedLocalAgentSessionReady(request.params.roomId, body.agent_id, body.provider, body);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_ready", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-sessions/previews", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = AgentSessionPreviewRequestBodySchema.parse(request.body);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewId = prefixedId("preview");
    const payload = {
      preview_id: previewId,
      agent_id: body.agent_id,
      provider: body.provider,
      session_id: body.session_id,
      requested_by: participant.id,
      requested_at: new Date().toISOString()
    };
    appendAndPublish(event(request.params.roomId, "agent.session_preview.requested", participant.id, payload));
    return reply.code(201).send({ ok: true, preview_id: previewId });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/agent-sessions/previews/:previewId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionPreviewMessagesBodySchema.parse(request.body);
    if (!body.every((message) => message.preview_id === request.params.previewId)) return deny(reply, "preview_id_mismatch", 400);
    if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
    const first = body[0];
    if (!body.every((message) => message.agent_id === first.agent_id && message.provider === first.provider && message.session_id === first.session_id)) {
      return deny(reply, "preview_session_mismatch", 400);
    }
    const validation = validateLocalAgentProvider(request.params.roomId, first.agent_id, first.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewValidation = validateAgentPreviewOpen(request.params.roomId, request.params.previewId, first.agent_id, first.provider, first.session_id);
    if (!previewValidation.ok) return deny(reply, previewValidation.error, previewValidation.status);
    const storedEvents = store.transaction(() => body.map((message) => store.appendEvent(event(request.params.roomId, "agent.session_preview.message", participant.id, message))));
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, previewed: body.length });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/agent-sessions/previews/:previewId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionPreviewCompleteBodySchema.parse(request.body);
    if (body.preview_id !== request.params.previewId) return deny(reply, "preview_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const previewValidation = validateAgentPreviewOpen(request.params.roomId, request.params.previewId, body.agent_id, body.provider, body.session_id);
    if (!previewValidation.ok) return deny(reply, previewValidation.error, previewValidation.status);
    const completeValidation = validateAgentPreviewComplete(request.params.roomId, request.params.previewId, body);
    if (!completeValidation.ok) return deny(reply, completeValidation.error, completeValidation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_preview.completed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; previewId: string } }>("/rooms/:roomId/agent-sessions/previews/:previewId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionPreviewFailBodySchema.parse(request.body);
    if (body.preview_id !== request.params.previewId) return deny(reply, "preview_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_preview.failed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-sessions/imports/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionImportStartBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedLocalAgentResumeSession(request.params.roomId, body.agent_id, body.provider, body.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_import.started", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/agent-sessions/imports/:importId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionImportMessagesBodySchema.parse(request.body);
    if (!body.every((message) => message.import_id === request.params.importId)) return deny(reply, "import_id_mismatch", 400);
    if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
    const first = body[0];
    const validation = validateLocalAgentProvider(request.params.roomId, first.agent_id, first.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedLocalAgentResumeSession(request.params.roomId, first.agent_id, first.provider, first.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    const batchValidation = validateAgentImportMessageBatch(request.params.roomId, request.params.importId, body);
    if (!batchValidation.ok) return deny(reply, batchValidation.error, batchValidation.status);
    const storedEvents = store.transaction(() => body.map((message) => store.appendEvent(event(request.params.roomId, "agent.session_import.message", participant.id, message))));
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, imported: body.length });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/agent-sessions/imports/:importId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionImportCompleteBodySchema.parse(request.body);
    if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const selectionValidation = validateSelectedLocalAgentResumeSession(request.params.roomId, body.agent_id, body.provider, body.session_id);
    if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    const completeValidation = validateAgentImportComplete(request.params.roomId, request.params.importId, body);
    if (!completeValidation.ok) return deny(reply, completeValidation.error, completeValidation.status);
    appendAndPublish(event(request.params.roomId, "agent.session_import.completed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/agent-sessions/imports/:importId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = AgentSessionImportFailBodySchema.parse(request.body);
    if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentProvider(request.params.roomId, body.agent_id, body.provider);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    if (body.session_id) {
      const selectionValidation = validateSelectedLocalAgentResumeSession(request.params.roomId, body.agent_id, body.provider, body.session_id);
      if (!selectionValidation.ok) return deny(reply, selectionValidation.error, selectionValidation.status);
    }
    appendAndPublish(event(request.params.roomId, "agent.session_import.failed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-runtime/status", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const raw = request.body as { kind?: unknown; payload?: unknown };
    if (raw.kind !== "changed" && raw.kind !== "completed" && raw.kind !== "failed") return deny(reply, "invalid_status_kind", 400);
    const payload = AgentRuntimeStatusBodySchema[raw.kind].parse(raw.payload);
    if (!assertAgentOwnsPayload(participant, payload.agent_id)) return deny(reply, "forbidden", 403);
    const validation = validateLocalAgentRuntime(request.params.roomId, payload.agent_id, payload.provider, payload.turn_id);
    if (!validation.ok) return deny(reply, validation.error, validation.status);
    const eventType = raw.kind === "changed"
      ? "agent.runtime.status_changed"
      : raw.kind === "completed"
        ? "agent.runtime.status_completed"
        : "agent.runtime.status_failed";
    appendAndPublish(event(request.params.roomId, eventType, participant.id, payload));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-action-approvals", async (request, reply) => {
    const query = AgentActionApprovalQuerySchema.parse(request.query);
    const participant = query.token ? store.getParticipantByToken(request.params.roomId, query.token) : requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent" || participant.type !== "agent") return deny(reply, "forbidden", 403);
    const body = AgentActionApprovalSchema.parse(request.body);
    const actionId = prefixedId("action");
    const storedEvents = store.transaction(() => [
      store.appendEvent(event(request.params.roomId, "agent.action_approval_requested", participant.id, {
        action_id: actionId,
        agent_id: participant.id,
        tool_name: body.tool_name,
        tool_input: body.tool_input,
        description: body.description
      })),
      store.appendEvent(event(request.params.roomId, "agent.action_approval_resolved", participant.id, {
        action_id: actionId,
        result: "reject",
        reason: "manual_flow_control_required"
      }))
    ]);
    publishEvents(storedEvents);
    return reply.code(201).send({
      action_id: actionId,
      status: "rejected",
      result: "reject",
      raw_result: "reject",
      reason: "manual_flow_control_required"
    });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (turn.started) return deny(reply, "turn_already_started", 409);
    appendAndPublish(event(request.params.roomId, "agent.turn.started", participant.id, { turn_id: request.params.turnId, agent_id: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/delta", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    const body = TurnOutputSchema.parse(request.body);
    appendAndPublish(event(request.params.roomId, "agent.output.delta", participant.id, { turn_id: request.params.turnId, agent_id: participant.id, chunk: body.chunk }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    const body = TurnCompleteSchema.parse(request.body);
    const messageId = prefixedId("msg");
    const storedEvents = store.transaction(() => {
      const completed = store.appendEvent(event(request.params.roomId, "agent.turn.completed", participant.id, {
        turn_id: request.params.turnId,
        agent_id: participant.id,
        message_id: messageId,
        exit_code: body.exit_code
      }));
      const finalMessage = store.appendEvent(event(request.params.roomId, "message.created", participant.id, {
        message_id: messageId,
        text: body.final_text,
        kind: "agent",
        turn_id: request.params.turnId
      }));
      const followupEvents = hasQueuedFollowup(store.listEvents(request.params.roomId), request.params.turnId)
        ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup", undefined, request.params.turnId).map((nextEvent) => store.appendEvent(nextEvent))
        : [];
      return [completed, finalMessage, ...followupEvents];
    });
    publishEvents(storedEvents);
    // T5: after the terminal event has been committed and broadcast,
    // pop the FIFO head of the queued main inputs (if any) and trigger a
    // fresh turn for it. Done after publishEvents so clients see
    // `agent.turn.completed` strictly before `main_input.triggered`.
    triggerNextQueuedMainInput(request.params.roomId, "completed");
    return reply.code(201).send({ ok: true, message_id: messageId });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    // Parse outside the transaction so the error string is available for the
    // T5 auto-trigger decision below.
    const failurePayload = TurnFailedSchema.parse(request.body);
    const storedEvents = store.transaction(() => {
      const failed = store.appendEvent(event(request.params.roomId, "agent.turn.failed", participant.id, {
        turn_id: request.params.turnId,
        agent_id: participant.id,
        ...failurePayload
      }));
      const followupEvents = hasQueuedFollowup(store.listEvents(request.params.roomId), request.params.turnId)
        ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup", undefined, request.params.turnId).map((nextEvent) => store.appendEvent(nextEvent))
        : [];
      return [failed, ...followupEvents];
    });
    publishEvents(storedEvents);
    // T5: trigger the next queued main input, BUT not if the failure reason
    // indicates the agent is offline / session not ready (spec §4).
    triggerNextQueuedMainInput(request.params.roomId, "failed", failurePayload.error);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/tasks", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = TaskCreateSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.target_agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    const capabilities = findAgentCapabilities(store.listEvents(request.params.roomId), body.target_agent_id);
    if (!capabilities.includes("legacy.task_runner")) return deny(reply, "generic_tasks_removed", 410);
    const taskId = prefixedId("task");
    appendAndPublish(event(request.params.roomId, "task.created", participant.id, { task_id: taskId, created_by: participant.id, ...body }));
    return reply.code(201).send({ task_id: taskId });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (task.started) return deny(reply, "task_already_started", 409);
    appendAndPublish(event(request.params.roomId, "task.started", participant.id, { task_id: request.params.taskId, agent_id: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/output", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.output", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskOutputSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.completed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskCompleteSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const task = requireAssignedAgentTask(request.params.roomId, request.params.taskId, participant, reply);
    if (!task) return;
    if (task.terminal_status) return deny(reply, "task_closed", 409);
    if (!task.started) return deny(reply, "task_not_started", 409);
    appendAndPublish(event(request.params.roomId, "task.failed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskFailedSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  const ConnectorSnapshotRequestSchema = z.object({ since_sequence: z.number().int().nonnegative().default(0) });
  const snapshotRequests = new Map<string, { requesterId: string; connectorId: string; sinceSequence: number }>();

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/connector-snapshots", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const canRequest = hasAnyRole(participant, ["owner", "admin"])
      || (participant.role === "member" && participant.main_thread_history_access === "allowed");
    if (!canRequest) return deny(reply, "forbidden", 403);
    const activeAgentId = findActiveAgentId(store.listEvents(request.params.roomId));
    if (!activeAgentId) return deny(reply, "active_agent_unavailable", 404);
    const body = ConnectorSnapshotRequestSchema.parse(request.body);
    const requestId = prefixedId("snap");
    snapshotRequests.set(`${request.params.roomId}:${requestId}`, {
      requesterId: participant.id,
      connectorId: activeAgentId,
      sinceSequence: body.since_sequence
    });
    publishTargeted(event(request.params.roomId, "connector.snapshot.requested", participant.id, {
      request_id: requestId,
      connector_id: activeAgentId,
      since_sequence: body.since_sequence,
      requested_by: participant.id
    }), [participant.id, activeAgentId]);
    return reply.code(201).send({ request_id: requestId });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/connector-snapshots/:requestId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const snapshot = snapshotRequests.get(`${request.params.roomId}:${request.params.requestId}`);
    if (!snapshot) return deny(reply, "snapshot_not_found", 404);
    if (participant.id !== snapshot.connectorId) return deny(reply, "forbidden", 403);
    const body = z.object({ first_sequence: z.number().int().nonnegative(), last_sequence: z.number().int().nonnegative(), total_count: z.number().int().nonnegative().optional() }).parse(request.body);
    publishTargeted(event(request.params.roomId, "connector.snapshot.started", participant.id, {
      request_id: request.params.requestId,
      connector_id: participant.id,
      ...body
    }), [snapshot.requesterId]);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/connector-snapshots/:requestId/entries", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const snapshot = snapshotRequests.get(`${request.params.roomId}:${request.params.requestId}`);
    if (!snapshot) return deny(reply, "snapshot_not_found", 404);
    if (participant.id !== snapshot.connectorId) return deny(reply, "forbidden", 403);
    const body = z.object({ entry: ConnectorLedgerEntrySchema }).parse(request.body);
    publishTargeted(event(request.params.roomId, "connector.snapshot.entry", participant.id, {
      request_id: request.params.requestId,
      connector_id: participant.id,
      entry: body.entry
    }), [snapshot.requesterId]);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/connector-snapshots/:requestId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const snapshot = snapshotRequests.get(`${request.params.roomId}:${request.params.requestId}`);
    if (!snapshot) return deny(reply, "snapshot_not_found", 404);
    if (participant.id !== snapshot.connectorId) return deny(reply, "forbidden", 403);
    const body = z.object({ last_sequence: z.number().int().nonnegative() }).parse(request.body);
    snapshotRequests.delete(`${request.params.roomId}:${request.params.requestId}`);
    publishTargeted(event(request.params.roomId, "connector.snapshot.completed", participant.id, {
      request_id: request.params.requestId,
      connector_id: participant.id,
      last_sequence: body.last_sequence
    }), [snapshot.requesterId]);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/connector-snapshots/:requestId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const snapshot = snapshotRequests.get(`${request.params.roomId}:${request.params.requestId}`);
    if (!snapshot) return deny(reply, "snapshot_not_found", 404);
    if (participant.id !== snapshot.connectorId) return deny(reply, "forbidden", 403);
    const body = z.object({ error: z.string().min(1).max(2000) }).parse(request.body);
    snapshotRequests.delete(`${request.params.roomId}:${request.params.requestId}`);
    publishTargeted(event(request.params.roomId, "connector.snapshot.failed", participant.id, {
      request_id: request.params.requestId,
      connector_id: participant.id,
      error: body.error
    }), [snapshot.requesterId]);
    return reply.code(201).send({ ok: true });
  });

  // Periodic cleanup of expired pending join requests
  const joinRequestCleanupTimer = setInterval(() => {
    const nowIso = new Date().toISOString();
    const stale = store.getExpiredPendingJoinRequests(nowIso);
    for (const request of stale) {
      const expired = store.expireJoinRequest(request.request_id, nowIso);
      appendAndPublish(event(request.room_id, "join_request.expired", "system", publicJoinRequest(expired)));
    }
  }, 60_000);

  return app;
}

function joinRequestExpiry(): string {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

function publicJoinRequest(request: { request_id: string; display_name: string; role: string; status: string; requested_at: string; expires_at: string }) {
  return {
    request_id: request.request_id,
    display_name: request.display_name,
    role: request.role,
    status: request.status,
    requested_at: request.requested_at,
    expires_at: request.expires_at
  };
}

function publicParticipant(participant: Participant): Participant {
  return { id: participant.id, type: participant.type, display_name: participant.display_name, role: participant.role };
}
