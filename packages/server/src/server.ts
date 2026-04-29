import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Fastify, { type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { buildConnectionCode, evaluatePolicy, PolicySchema, VoteRecordSchema, type CacpEvent, type Participant, type Policy, type VoteRecord } from "@cacp/protocol";
import { requireParticipant, hasAnyRole, hasHumanRole } from "./auth.js";
import { buildAgentContextPrompt, buildCollectedAnswersPrompt, eventsAfterLastHistoryClear, findActiveAgentId, findAnyOpenTurn, findOpenTurn, hasQueuedFollowup, recentConversationMessages, type OpenTurn } from "./conversation.js";
import { EventBus } from "./event-bus.js";
import { EventStore, type StoredParticipant } from "./event-store.js";
import { hasAllowedOrigin, loadServerConfig, type ServerConfig } from "./config.js";
import { event, hashToken, openSecret, prefixedId, sealSecret, token } from "./ids.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { AgentTypeValues, PermissionLevelValues, buildAgentProfile, isLlmAgentType, type AgentType, type PermissionLevel } from "./pairing.js";
import {
  ClaudeRuntimeStatusBodySchema,
  ClaudeSessionCatalogBodySchema,
  ClaudeSessionImportCompleteBodySchema,
  ClaudeSessionImportFailBodySchema,
  ClaudeSessionImportMessagesBodySchema,
  ClaudeSessionImportStartBodySchema,
  ClaudeSessionSelectionBodySchema,
  assertAgentOwnsPayload
} from "./claude-events.js";

const CreateRoomSchema = z.object({ name: z.string().min(1).max(200), display_name: z.string().min(1).max(100).default("Owner") });
const CreateInviteSchema = z.object({ role: z.enum(["member", "observer"]).default("member"), expires_in_seconds: z.number().int().positive().max(60 * 60 * 24 * 7).default(60 * 60 * 24) });
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

export interface BuildServerOptions { dbPath?: string; localAgentLauncher?: LocalAgentLauncher; repoRoot?: string; config?: ServerConfig }
type ProposalTerminalStatus = "approved" | "rejected" | "expired";
type ProposalState = { policy: Policy; votes: VoteRecord[]; terminal_status?: ProposalTerminalStatus };
type TaskTerminalStatus = "completed" | "failed" | "cancelled";
type TaskState = { target_agent_id: string; started: boolean; terminal_status?: TaskTerminalStatus };
type TurnTerminalStatus = "completed" | "failed";
type TurnState = { agent_id: string; started: boolean; terminal_status?: TurnTerminalStatus };
type ActiveCollection = { collection_id: string; started_by: string; started_at: string };
type PendingCollectionRequest = { request_id: string; requested_by: string; requested_at: string };
type CollectedMessage = { message_id?: string; actor_id: string; text: string; kind: string; created_at: string };

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
    "Write-Host 'WARNING: CACP LOCAL AGENT BRIDGE IS RUNNING' -ForegroundColor Red",
    "Write-Host '============================================================' -ForegroundColor Red",
    "Write-Host 'This console was opened by the AI Collaboration Platform Demo.' -ForegroundColor Cyan",
    "Write-Host 'It runs the trusted local CLI agent bridge for your web room.' -ForegroundColor Cyan",
    "Write-Host 'Do not close or delete this window while using the web room.' -ForegroundColor Yellow",
    "Write-Host 'Closing it will disconnect the local CLI agent from the shared room.' -ForegroundColor Yellow",
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
  const localAgentLauncher = options.localAgentLauncher ?? defaultLocalAgentLauncher;
  const localRepoRoot = options.repoRoot ?? repoRoot;
  const roomLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.roomCreateLimit });
  const inviteLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.inviteCreateLimit });
  const joinLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit });
  const pairingLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.pairingCreateLimit });
  const pairingClaimLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit });
  const messageLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.messageCreateLimit });
  const joinRequestPollLimiter = new FixedWindowRateLimiter({ windowMs: config.rateLimitWindowMs, limit: config.joinAttemptLimit * 2 });
  const socketCounts = new Map<string, number>();
  const participantSockets = new Map<string, Set<{ close: (code?: number, reason?: string) => void }>>();

  function socketKey(roomId: string, participantId: string): string {
    return `${roomId}:${participantId}`;
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

  await app.register(websocket);
  app.addHook("onClose", async () => {
    clearInterval(joinRequestCleanupTimer);
    store.close();
  });

  function publishEvents(events: CacpEvent[]): void {
    for (const stored of events) bus.publish(stored);
  }

  function appendAndPublish(input: CacpEvent): CacpEvent {
    const stored = store.appendEvent(input);
    bus.publish(stored);
    return stored;
  }

  function canViewEvent(event: CacpEvent, participant: StoredParticipant): boolean {
    if (event.type === "claude.session_catalog.updated") {
      return hasAnyRole(participant, ["owner", "admin"]);
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
    if (isTurnCleared(roomId, turnId)) {
      deny(reply, "turn_cleared", 409);
      return undefined;
    }
    return turn;
  }

  function isTurnCleared(roomId: string, turnId: string): boolean {
    const events = store.listEvents(roomId);
    const postClearEvents = eventsAfterLastHistoryClear(events);
    if (postClearEvents === events) return false;
    const wasRequested = events.some((storedEvent) => storedEvent.type === "agent.turn.requested" && storedEvent.payload.turn_id === turnId);
    const requestedAfterClear = postClearEvents.some((storedEvent) => storedEvent.type === "agent.turn.requested" && storedEvent.payload.turn_id === turnId);
    return wasRequested && !requestedAfterClear;
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

  function buildCollectedContextPrompt(roomId: string, agentId: string, collectionId: string): string {
    const participants = store.getParticipants(roomId);
    const names = new Map(participants.map((participant) => [participant.id, participant.display_name]));
    const agent = participants.find((participant) => participant.id === agentId);
    const messages = collectedMessagesFor(roomId, collectionId).map((message) => ({
      actorName: names.get(message.actor_id) ?? message.actor_id,
      kind: message.kind,
      text: message.text
    }));
    return buildCollectedAnswersPrompt({ participants: participants.map(publicParticipant), messages, agentName: agent?.display_name ?? agentId });
  }

  function activeCollectionFor(roomId: string): ActiveCollection | undefined {
    let active: ActiveCollection | undefined;
    for (const storedEvent of eventsAfterLastHistoryClear(store.listEvents(roomId))) {
      if (storedEvent.type === "ai.collection.started" && typeof storedEvent.payload.collection_id === "string") {
        active = {
          collection_id: storedEvent.payload.collection_id,
          started_by: typeof storedEvent.payload.started_by === "string" ? storedEvent.payload.started_by : storedEvent.actor_id,
          started_at: storedEvent.created_at
        };
      }
      if ((storedEvent.type === "ai.collection.submitted" || storedEvent.type === "ai.collection.cancelled") && typeof storedEvent.payload.collection_id === "string" && active?.collection_id === storedEvent.payload.collection_id) {
        active = undefined;
      }
    }
    return active;
  }

  function pendingCollectionRequestFor(roomId: string): PendingCollectionRequest | undefined {
    let pending: PendingCollectionRequest | undefined;
    for (const storedEvent of eventsAfterLastHistoryClear(store.listEvents(roomId))) {
      if (storedEvent.type === "ai.collection.requested" && typeof storedEvent.payload.request_id === "string" && typeof storedEvent.payload.requested_by === "string") {
        pending = { request_id: storedEvent.payload.request_id, requested_by: storedEvent.payload.requested_by, requested_at: storedEvent.created_at };
      }
      if ((storedEvent.type === "ai.collection.request_approved" || storedEvent.type === "ai.collection.request_rejected") && typeof storedEvent.payload.request_id === "string" && pending?.request_id === storedEvent.payload.request_id) {
        pending = undefined;
      }
    }
    return pending;
  }

  function openTurnInRoom(roomId: string): OpenTurn | undefined {
    return findAnyOpenTurn(eventsAfterLastHistoryClear(store.listEvents(roomId)));
  }

  function collectedMessagesFor(roomId: string, collectionId: string): CollectedMessage[] {
    return eventsAfterLastHistoryClear(store.listEvents(roomId))
      .filter((storedEvent) => storedEvent.type === "message.created" && storedEvent.payload.collection_id === collectionId && typeof storedEvent.payload.text === "string")
      .map((storedEvent) => ({
        message_id: typeof storedEvent.payload.message_id === "string" ? storedEvent.payload.message_id : undefined,
        actor_id: storedEvent.actor_id,
        text: String(storedEvent.payload.text),
        kind: typeof storedEvent.payload.kind === "string" ? storedEvent.payload.kind : "human",
        created_at: storedEvent.created_at
      }));
  }

  function createAgentTurnRequestEvents(roomId: string, actorId: string, reason: "human_message" | "queued_followup" | "collected_answers", contextPrompt?: string): CacpEvent[] {
    const events = store.listEvents(roomId);
    const turnEvents = eventsAfterLastHistoryClear(events);
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
    return [event(roomId, "agent.turn.requested", actorId, {
      turn_id: turnId,
      agent_id: activeAgentId,
      reason,
      context_prompt: contextPrompt ?? buildContextPrompt(roomId, activeAgentId)
    })];
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
      const owner = store.addParticipant({ room_id: roomId, id: ownerId, token: ownerToken, display_name: body.display_name, type: "human", role: "owner" });
      return [
        store.appendEvent(event(roomId, "room.created", ownerId, { name: body.name, created_by: ownerId })),
        store.appendEvent(event(roomId, "participant.joined", ownerId, { participant: publicParticipant(owner) }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ room_id: roomId, owner_id: ownerId, owner_token: ownerToken });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/events", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const events = store.listEvents(request.params.roomId).filter((ev) => canViewEvent(ev, participant));
    return { events, participant: publicParticipant(participant) };
  });

  app.get<{ Params: { roomId: string }; Querystring: { token?: string } }>("/rooms/:roomId/stream", { websocket: true }, (socket, request) => {
    if (!hasAllowedOrigin(config, request.headers.origin)) {
      socket.send(JSON.stringify({ error: "origin_not_allowed" }));
      socket.close();
      return;
    }
    const roomId = request.params.roomId;
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
    const unsubscribe = bus.subscribe(roomId, (nextEvent) => {
      if (canViewEvent(nextEvent, participant)) socket.send(JSON.stringify(nextEvent));
    });
    const forgetSocket = rememberSocket(roomId, participant.id, socket);
    socket.on("close", () => {
      unsubscribe();
      forgetSocket();
      socketCounts.set(roomId, (socketCounts.get(roomId) ?? 1) - 1);
      if (participant.role === "agent") {
        appendAndPublish(event(roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "offline" }));
      }
    });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/history/clear", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "room.history_cleared", participant.id, {
      cleared_by: participant.id,
      cleared_at: new Date().toISOString(),
      scope: "messages"
    }));
    return reply.code(201).send({ ok: true });
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
    const storedEvents = store.transaction(() => {
      store.createInvite({
        invite_id: inviteId,
        room_id: request.params.roomId,
        token_hash: hashToken(inviteToken, config.tokenSecret),
        role: body.role,
        created_by: participant.id,
        created_at: now,
        expires_at: expiresAt,
        max_uses: 1
      });
      return [store.appendEvent(event(request.params.roomId, "invite.created", participant.id, { invite_id: inviteId, role: body.role, expires_at: expiresAt }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, expires_at: expiresAt });
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
      if (invite.revoked_at !== null) return { ok: false as const, error: "invite_revoked" };
      if (Date.parse(invite.expires_at) <= Date.now()) return { ok: false as const, error: "invite_expired" };
      if (invite.max_uses !== null && invite.used_count >= invite.max_uses) return { ok: false as const, error: "invite_use_limit_reached", status: 409 };
      store.consumeInvite(invite.invite_id);
      const stored = store.createJoinRequest({
        request_id: requestId,
        room_id: roomId,
        invite_id: invite.invite_id,
        request_token_hash: hashToken(requestToken, config.tokenSecret),
        display_name: body.display_name,
        role: invite.role === "observer" ? "observer" : "member",
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
    return reply.code(201).send({ request_id: requestId, request_token: requestToken, status: "pending", expires_at: expiresAt });
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
        role: current.role
      };
    }
    return { status: current.status };
  });

  app.get<{ Params: { roomId: string }; Querystring: { status?: string } }>("/rooms/:roomId/join-requests", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    const query = JoinRequestListQuerySchema.parse(request.query);
    return { requests: store.listJoinRequests(request.params.roomId, query.status).map(publicJoinRequest) };
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/join-requests/:requestId/approve", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
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
      const role = current.role === "observer" ? "observer" : "member";
      const joined = store.addParticipant({ room_id: current.room_id, id: participantId, token: participantToken, display_name: current.display_name, type: role === "observer" ? "observer" : "human", role });
      const approved = store.approveJoinRequest(current.request_id, {
        decided_at: decidedAt,
        decided_by: participant.id,
        participant_id: participantId,
        participant_token_sealed: sealSecret(participantToken, config.tokenSecret)
      });
      return { ok: true as const, participant: joined, role, events: [
        store.appendEvent(event(current.room_id, "join_request.approved", participant.id, publicJoinRequest(approved))),
        store.appendEvent(event(current.room_id, "participant.joined", joined.id, { participant: publicParticipant(joined) }))
      ] };
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
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
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

  app.post<{ Params: { roomId: string; participantId: string } }>("/rooms/:roomId/participants/:participantId/remove", async (request, reply) => {
    const actor = requireParticipant(store, request.params.roomId, request);
    if (!actor) return deny(reply, "invalid_token");
    if (!hasHumanRole(actor, ["owner"])) return deny(reply, "forbidden", 403);
    const body = z.object({ reason: z.string().max(300).optional() }).parse(request.body);
    const target = findParticipant(request.params.roomId, request.params.participantId);
    if (!target) return deny(reply, "unknown_participant", 404);
    if (target.role === "owner") return deny(reply, "cannot_remove_owner", 409);
    if (target.id === actor.id) return deny(reply, "cannot_remove_self", 409);
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
      }
      return events;
    });
    publishEvents(storedEvents);
    closeParticipantSockets(request.params.roomId, target.id);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    if (!messageLimiter.allow(request.ip)) return tooMany(reply);
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = z.object({ text: z.string().min(1).max(config.maxMessageLength) }).parse(request.body);
    const activeCollection = activeCollectionFor(request.params.roomId);
    const storedEvents = store.transaction(() => {
      const messageId = prefixedId("msg");
      const message = store.appendEvent(event(request.params.roomId, "message.created", participant.id, {
        message_id: messageId,
        text: body.text,
        kind: "human",
        ...(activeCollection ? { collection_id: activeCollection.collection_id } : {})
      }));

      if (activeCollection) return [message];

      return [message, ...createAgentTurnRequestEvents(request.params.roomId, participant.id, "human_message").map((nextEvent) => store.appendEvent(nextEvent))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send(storedEvents[0]);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
    if (pendingCollectionRequestFor(request.params.roomId)) return deny(reply, "pending_collection_request_exists", 409);
    if (openTurnInRoom(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
    const collectionId = prefixedId("collection");
    appendAndPublish(event(request.params.roomId, "ai.collection.started", participant.id, {
      collection_id: collectionId,
      started_by: participant.id
    }));
    return reply.code(201).send({ collection_id: collectionId });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/request", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["admin", "member"])) return deny(reply, "forbidden", 403);
    if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
    if (pendingCollectionRequestFor(request.params.roomId)) return deny(reply, "pending_collection_request_exists", 409);
    const requestId = prefixedId("collection_request");
    appendAndPublish(event(request.params.roomId, "ai.collection.requested", participant.id, { request_id: requestId, requested_by: participant.id }));
    return reply.code(201).send({ request_id: requestId, requested_by: participant.id, status: "pending" });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/ai-collection/requests/:requestId/approve", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    const pending = pendingCollectionRequestFor(request.params.roomId);
    if (!pending || pending.request_id !== request.params.requestId) return deny(reply, "no_pending_collection_request", 409);
    if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
    if (openTurnInRoom(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
    const collectionId = prefixedId("collection");
    const storedEvents = store.transaction(() => [
      store.appendEvent(event(request.params.roomId, "ai.collection.request_approved", participant.id, { request_id: request.params.requestId, approved_by: participant.id, collection_id: collectionId })),
      store.appendEvent(event(request.params.roomId, "ai.collection.started", participant.id, { collection_id: collectionId, started_by: participant.id, request_id: request.params.requestId }))
    ]);
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, collection_id: collectionId, request_id: request.params.requestId });
  });

  app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/ai-collection/requests/:requestId/reject", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    const pending = pendingCollectionRequestFor(request.params.roomId);
    if (!pending || pending.request_id !== request.params.requestId) return deny(reply, "no_pending_collection_request", 409);
    appendAndPublish(event(request.params.roomId, "ai.collection.request_rejected", participant.id, { request_id: request.params.requestId, rejected_by: participant.id }));
    return reply.code(201).send({ ok: true, request_id: request.params.requestId });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/submit", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    const activeCollection = activeCollectionFor(request.params.roomId);
    if (!activeCollection) return deny(reply, "no_active_collection", 409);
    if (openTurnInRoom(request.params.roomId)) return deny(reply, "active_turn_in_flight", 409);
    const activeAgentId = findActiveAgentId(store.listEvents(request.params.roomId));
    const contextPrompt = activeAgentId ? buildCollectedContextPrompt(request.params.roomId, activeAgentId, activeCollection.collection_id) : undefined;
    const collectedMessages = collectedMessagesFor(request.params.roomId, activeCollection.collection_id);
    const messageIds = collectedMessages.flatMap((message) => message.message_id ? [message.message_id] : []);
    const storedEvents = store.transaction(() => {
      const submitted = store.appendEvent(event(request.params.roomId, "ai.collection.submitted", participant.id, {
        collection_id: activeCollection.collection_id,
        submitted_by: participant.id,
        message_ids: messageIds
      }));
      const turnEvents = createAgentTurnRequestEvents(request.params.roomId, participant.id, "collected_answers", contextPrompt).map((nextEvent) => store.appendEvent(nextEvent));
      return [submitted, ...turnEvents];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, collection_id: activeCollection.collection_id, message_ids: messageIds });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/cancel", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
    const activeCollection = activeCollectionFor(request.params.roomId);
    if (!activeCollection) return deny(reply, "no_active_collection", 409);
    appendAndPublish(event(request.params.roomId, "ai.collection.cancelled", participant.id, {
      collection_id: activeCollection.collection_id,
      cancelled_by: participant.id
    }));
    return reply.code(201).send({ ok: true, collection_id: activeCollection.collection_id });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/proposals", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
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
      const added = store.addParticipant({ room_id: request.params.roomId, id: agentId, token: agentToken, display_name: body.name, type: "agent", role: "agent" });
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
      store.claimAgentPairing(pairing.pairing_id, new Date().toISOString());
      const added = store.addParticipant({ room_id: roomId, id: agentId, token: agentToken, display_name: body.adapter_name ?? profile.name, type: "agent", role: "agent" });
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
    appendAndPublish(event(request.params.roomId, "claude.session_catalog.updated", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-selection", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = ClaudeSessionSelectionBodySchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    appendAndPublish(event(request.params.roomId, "claude.session_selected", participant.id, {
      ...body,
      selected_by: participant.id
    }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/claude/session-imports/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportStartBodySchema.parse(request.body);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "claude.session_import.started", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportMessagesBodySchema.parse(request.body);
    if (!body.every((message) => message.import_id === request.params.importId)) return deny(reply, "import_id_mismatch", 400);
    if (!body.every((message) => assertAgentOwnsPayload(participant, message.agent_id))) return deny(reply, "forbidden", 403);
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
    appendAndPublish(event(request.params.roomId, "claude.session_import.completed", participant.id, body));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; importId: string } }>("/rooms/:roomId/claude/session-imports/:importId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const body = ClaudeSessionImportFailBodySchema.parse(request.body);
    if (body.import_id !== request.params.importId) return deny(reply, "import_id_mismatch", 400);
    if (!assertAgentOwnsPayload(participant, body.agent_id)) return deny(reply, "forbidden", 403);
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
    const eventType = raw.kind === "changed"
      ? "claude.runtime.status_changed"
      : raw.kind === "completed"
        ? "claude.runtime.status_completed"
        : "claude.runtime.status_failed";
    appendAndPublish(event(request.params.roomId, eventType, participant.id, payload));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string }; Querystring: { token?: string; wait_ms?: string | number } }>("/rooms/:roomId/agent-action-approvals", async (request, reply) => {
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
        ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup").map((nextEvent) => store.appendEvent(nextEvent))
        : [];
      return [completed, finalMessage, ...followupEvents];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true, message_id: messageId });
  });

  app.post<{ Params: { roomId: string; turnId: string } }>("/rooms/:roomId/agent-turns/:turnId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    const turn = requireAssignedAgentTurn(request.params.roomId, request.params.turnId, participant, reply);
    if (!turn) return;
    if (turn.terminal_status) return deny(reply, "turn_closed", 409);
    if (!turn.started) return deny(reply, "turn_not_started", 409);
    const storedEvents = store.transaction(() => {
      const failed = store.appendEvent(event(request.params.roomId, "agent.turn.failed", participant.id, {
        turn_id: request.params.turnId,
        agent_id: participant.id,
        ...TurnFailedSchema.parse(request.body)
      }));
      const followupEvents = hasQueuedFollowup(store.listEvents(request.params.roomId), request.params.turnId)
        ? createAgentTurnRequestEvents(request.params.roomId, participant.id, "queued_followup").map((nextEvent) => store.appendEvent(nextEvent))
        : [];
      return [failed, ...followupEvents];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/tasks", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = TaskCreateSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.target_agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
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
