import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Fastify, { type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { evaluatePolicy, PolicySchema, VoteRecordSchema, type CacpEvent, type Participant, type Policy, type VoteRecord } from "@cacp/protocol";
import { requireParticipant, hasAnyRole, hasHumanRole } from "./auth.js";
import { buildAgentContextPrompt, buildCollectedAnswersPrompt, eventsAfterLastHistoryClear, findActiveAgentId, findOpenTurn, hasQueuedFollowup, recentConversationMessages } from "./conversation.js";
import { EventBus } from "./event-bus.js";
import { EventStore } from "./event-store.js";
import { event, prefixedId, token } from "./ids.js";
import { AgentTypeValues, PermissionLevelValues, buildAgentProfile, type AgentType, type PermissionLevel } from "./pairing.js";

const CreateRoomSchema = z.object({ name: z.string().min(1), display_name: z.string().min(1).default("Owner") });
const CreateInviteSchema = z.object({ role: z.enum(["member", "observer"]).default("member"), expires_in_seconds: z.number().int().positive().max(60 * 60 * 24 * 7).default(60 * 60 * 24) });
const JoinSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1) });
const MessageSchema = z.object({ text: z.string().min(1) });
const ProposalSchema = z.object({ title: z.string().min(1), proposal_type: z.string().min(1), policy: PolicySchema });
const AgentRegisterSchema = z.object({ name: z.string().min(1), capabilities: z.array(z.string()).default([]) });
const AgentPairingCreateSchema = z.object({
  agent_type: z.enum(AgentTypeValues).default("claude-code"),
  permission_level: z.enum(PermissionLevelValues).default("read_only"),
  working_dir: z.string().default("."),
  server_url: z.string().url().optional()
});
const AgentPairingStartLocalSchema = AgentPairingCreateSchema.extend({
  command: z.string().optional()
});
const AgentActionApprovalSchema = z.object({ tool_name: z.string().min(1), tool_input: z.unknown().optional(), description: z.string().optional() });
const AgentActionApprovalQuerySchema = z.object({ token: z.string().optional(), wait_ms: z.coerce.number().int().min(0).max(5 * 60 * 1000).default(0) });
const SelectAgentSchema = z.object({ agent_id: z.string().min(1) });
const TaskCreateSchema = z.object({ target_agent_id: z.string().min(1), prompt: z.string().min(1), mode: z.literal("oneshot").default("oneshot"), requires_approval: z.boolean().default(false) });
const TaskOutputSchema = z.object({ stream: z.enum(["stdout", "stderr"]), chunk: z.string() });
const TaskCompleteSchema = z.object({ exit_code: z.number().int() });
const TaskFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });
const TurnOutputSchema = z.object({ chunk: z.string() });
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

export interface BuildServerOptions { dbPath?: string; localAgentLauncher?: LocalAgentLauncher; repoRoot?: string }

type Invite = { room_id: string; role: "member" | "observer"; expires_at: string };
type Pairing = { room_id: string; created_by: string; agent_type: AgentType; permission_level: PermissionLevel; working_dir: string; expires_at: string; claimed?: boolean };
type ProposalTerminalStatus = "approved" | "rejected" | "expired";
type ProposalState = { policy: Policy; votes: VoteRecord[]; terminal_status?: ProposalTerminalStatus };
type TaskTerminalStatus = "completed" | "failed" | "cancelled";
type TaskState = { target_agent_id: string; started: boolean; terminal_status?: TaskTerminalStatus };
type TurnTerminalStatus = "completed" | "failed";
type TurnState = { agent_id: string; started: boolean; terminal_status?: TurnTerminalStatus };
type ActiveCollection = { collection_id: string; started_by: string; started_at: string };
type CollectedMessage = { message_id?: string; actor_id: string; text: string; kind: string; created_at: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function deny(reply: FastifyReply, error: string, status = 401) {
  return reply.code(status).send({ error });
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

function pairingCommand(serverUrl: string, pairingToken: string): string {
  return `corepack pnpm --filter @cacp/cli-adapter dev -- --server ${serverUrl} --pair ${pairingToken}`;
}

function pairingLaunchArgs(serverUrl: string, pairingToken: string): string[] {
  return ["pnpm", "--filter", "@cacp/cli-adapter", "dev", "--", "--server", serverUrl, "--pair", pairingToken];
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
  const app = Fastify({ logger: false });
  const store = new EventStore(options.dbPath ?? "cacp.db");
  const bus = new EventBus();
  const invites = new Map<string, Invite>();
  const pairings = new Map<string, Pairing>();
  const localAgentLauncher = options.localAgentLauncher ?? defaultLocalAgentLauncher;
  const localRepoRoot = options.repoRoot ?? repoRoot;
  await app.register(websocket);
  app.addHook("onClose", async () => store.close());

  function publishEvents(events: CacpEvent[]): void {
    for (const stored of events) bus.publish(stored);
  }

  function appendAndPublish(input: CacpEvent): CacpEvent {
    const stored = store.appendEvent(input);
    bus.publish(stored);
    return stored;
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

  function isOpenTurnStale(turnEvents: CacpEvent[], statusEvents: CacpEvent[], turnId: string, agentId: string): boolean {
    const requested = turnEvents.find((storedEvent) => storedEvent.type === "agent.turn.requested" && storedEvent.payload.turn_id === turnId);
    if (!requested) return false;
    const ageMs = Date.now() - Date.parse(requested.created_at);
    return ageMs > 2 * 60 * 1000 || !isAgentOnline(statusEvents, agentId);
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
    const openTurn = findOpenTurn(turnEvents, activeAgentId);
    if (openTurn) {
      if (isOpenTurnStale(turnEvents, events, openTurn.turn_id, activeAgentId)) {
        const turnId = prefixedId("turn");
        return [
          event(roomId, "agent.turn.failed", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId, error: "stale_turn_recovered" }),
          event(roomId, "agent.turn.requested", actorId, {
            turn_id: turnId,
            agent_id: activeAgentId,
            reason,
            context_prompt: contextPrompt ?? buildContextPrompt(roomId, activeAgentId)
          })
        ];
      }
      if (hasQueuedFollowup(turnEvents, openTurn.turn_id)) return [];
      return [event(roomId, "agent.turn.followup_queued", actorId, { turn_id: openTurn.turn_id, agent_id: activeAgentId })];
    }
    const turnId = prefixedId("turn");
    return [event(roomId, "agent.turn.requested", actorId, {
      turn_id: turnId,
      agent_id: activeAgentId,
      reason,
      context_prompt: contextPrompt ?? buildContextPrompt(roomId, activeAgentId)
    })];
  }

  function createAgentPairing(roomId: string, actorId: string, body: z.infer<typeof AgentPairingCreateSchema>, serverUrl: string) {
    const pairingToken = token();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    pairings.set(pairingToken, {
      room_id: roomId,
      created_by: actorId,
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      working_dir: body.working_dir,
      expires_at: expiresAt
    });
    appendAndPublish(event(roomId, "agent.pairing_created", actorId, {
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      expires_at: expiresAt
    }));
    return {
      pairing_token: pairingToken,
      expires_at: expiresAt,
      command: pairingCommand(serverUrl, pairingToken)
    };
  }

  app.get("/health", async () => ({ ok: true, protocol: "cacp", version: "0.2.0" }));

  app.post("/rooms", async (request, reply) => {
    const body = CreateRoomSchema.parse(request.body);
    const roomId = prefixedId("room");
    const ownerId = prefixedId("user");
    const ownerToken = token();
    const storedEvents = store.transaction(() => {
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
    return { events: store.listEvents(request.params.roomId), participant: publicParticipant(participant) };
  });

  app.get<{ Params: { roomId: string }; Querystring: { token?: string } }>("/rooms/:roomId/stream", { websocket: true }, (socket, request) => {
    const participant = request.query.token ? store.getParticipantByToken(request.params.roomId, request.query.token) : undefined;
    if (!participant) {
      socket.send(JSON.stringify({ error: "invalid_token" }));
      socket.close();
      return;
    }
    if (participant.role === "agent") {
      appendAndPublish(event(request.params.roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "online" }));
    }
    for (const existingEvent of store.listEvents(request.params.roomId)) socket.send(JSON.stringify(existingEvent));
    const unsubscribe = bus.subscribe(request.params.roomId, (nextEvent) => socket.send(JSON.stringify(nextEvent)));
    socket.on("close", () => {
      unsubscribe();
      if (participant.role === "agent") {
        appendAndPublish(event(request.params.roomId, "agent.status_changed", participant.id, { agent_id: participant.id, status: "offline" }));
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
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = CreateInviteSchema.parse(request.body);
    const inviteToken = token();
    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000).toISOString();
    invites.set(inviteToken, { room_id: request.params.roomId, role: body.role, expires_at: expiresAt });
    appendAndPublish(event(request.params.roomId, "invite.created", participant.id, { role: body.role, expires_at: expiresAt }));
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, expires_at: expiresAt });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join", async (request, reply) => {
    const body = JoinSchema.parse(request.body);
    const invite = invites.get(body.invite_token);
    if (!invite || invite.room_id !== request.params.roomId) return deny(reply, "invalid_invite");
    if (Date.parse(invite.expires_at) <= Date.now()) return deny(reply, "invite_expired");
    const participantId = prefixedId("user");
    const participantToken = token();
    const storedEvents = store.transaction(() => {
      const participant = store.addParticipant({ room_id: request.params.roomId, id: participantId, token: participantToken, display_name: body.display_name, type: invite.role === "observer" ? "observer" : "human", role: invite.role });
      return [store.appendEvent(event(request.params.roomId, "participant.joined", participant.id, { participant: publicParticipant(participant) }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ participant_id: participantId, participant_token: participantToken, role: invite.role });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = MessageSchema.parse(request.body);
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
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    if (activeCollectionFor(request.params.roomId)) return deny(reply, "active_collection_exists", 409);
    const collectionId = prefixedId("collection");
    appendAndPublish(event(request.params.roomId, "ai.collection.started", participant.id, {
      collection_id: collectionId,
      started_by: participant.id
    }));
    return reply.code(201).send({ collection_id: collectionId });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/ai-collection/submit", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const activeCollection = activeCollectionFor(request.params.roomId);
    if (!activeCollection) return deny(reply, "no_active_collection", 409);
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
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
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
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = AgentRegisterSchema.parse(request.body);
    const agentId = prefixedId("agent");
    const agentToken = token();
    const storedEvents = store.transaction(() => {
      store.addParticipant({ room_id: request.params.roomId, id: agentId, token: agentToken, display_name: body.name, type: "agent", role: "agent" });
      return [store.appendEvent(event(request.params.roomId, "agent.registered", participant.id, { agent_id: agentId, name: body.name, capabilities: body.capabilities }))];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ agent_id: agentId, agent_token: agentToken });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-pairings", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = AgentPairingCreateSchema.parse(request.body);
    const serverUrl = body.server_url ?? `${request.protocol}://${request.headers.host}`;
    return reply.code(201).send(createAgentPairing(request.params.roomId, participant.id, body, serverUrl));
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent-pairings/start-local", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = AgentPairingStartLocalSchema.parse(request.body);
    const serverUrl = body.server_url ?? `${request.protocol}://${request.headers.host}`;
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
      args: pairingLaunchArgs(serverUrl, pairing.pairing_token),
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

  app.post<{ Params: { pairingToken: string }; Body: { adapter_name?: string }; Querystring: { server_url?: string } }>("/agent-pairings/:pairingToken/claim", async (request, reply) => {
    const pairing = pairings.get(request.params.pairingToken);
    if (!pairing) return deny(reply, "invalid_pairing");
    if (pairing.claimed) return deny(reply, "pairing_claimed", 409);
    if (Date.parse(pairing.expires_at) <= Date.now()) return deny(reply, "pairing_expired");
    const agentId = prefixedId("agent");
    const agentToken = token();
    const serverUrl = request.query.server_url ?? `${request.protocol}://${request.headers.host}`;
    const hookUrl = `${serverUrl}/rooms/${pairing.room_id}/agent-action-approvals?token=${encodeURIComponent(agentToken)}`;
    const profile = buildAgentProfile({
      agentType: pairing.agent_type,
      permissionLevel: pairing.permission_level,
      workingDir: pairing.working_dir,
      hookUrl
    });
    const storedEvents = store.transaction(() => {
      pairing.claimed = true;
      store.addParticipant({ room_id: pairing.room_id, id: agentId, token: agentToken, display_name: request.body?.adapter_name ?? profile.name, type: "agent", role: "agent" });
      return [
        store.appendEvent(event(pairing.room_id, "agent.registered", pairing.created_by, {
          agent_id: agentId,
          name: request.body?.adapter_name ?? profile.name,
          capabilities: profile.capabilities,
          agent_type: pairing.agent_type,
          permission_level: pairing.permission_level
        })),
        store.appendEvent(event(pairing.room_id, "agent.status_changed", agentId, { agent_id: agentId, status: "online" }))
      ];
    });
    publishEvents(storedEvents);
    return reply.code(201).send({ room_id: pairing.room_id, agent_id: agentId, agent_token: agentToken, agent: profile, agent_type: pairing.agent_type, permission_level: pairing.permission_level, hook_url: hookUrl });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/select", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasHumanRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = SelectAgentSchema.parse(request.body);
    const targetAgent = findParticipant(request.params.roomId, body.agent_id);
    if (!targetAgent || targetAgent.type !== "agent" || targetAgent.role !== "agent") return deny(reply, "invalid_target_agent", 400);
    appendAndPublish(event(request.params.roomId, "room.agent_selected", participant.id, { agent_id: body.agent_id }));
    return reply.code(201).send({ ok: true, agent_id: body.agent_id });
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
    appendAndPublish(event(request.params.roomId, "agent.turn.failed", participant.id, { turn_id: request.params.turnId, agent_id: participant.id, ...TurnFailedSchema.parse(request.body) }));
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

  return app;
}

function publicParticipant(participant: Participant): Participant {
  return { id: participant.id, type: participant.type, display_name: participant.display_name, role: participant.role };
}
