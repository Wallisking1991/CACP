import { useEffect, useMemo, useRef, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { cancelAiCollection, clearEventSocket, clearRoom, connectEvents, createAgentPairing, createInvite, createLocalAgentLaunch, createRoomWithLocalAgent, inviteUrlFor, joinRoom, parseInviteUrl, selectAgent, sendMessage, startAiCollection, submitAiCollection, type LocalAgentLaunch, type RoomSession } from "./api.js";
import { badgeChangesForCollapsedControls, type ControlBadges, type ControlCounts } from "./control-badges.js";
import { mergeEvent } from "./event-log.js";
import { roomPermissionsForRole } from "./role-permissions.js";
import { deriveRoomState } from "./room-state.js";
import { clearStoredSession, loadInitialSession, saveStoredSession } from "./session-storage.js";
import "./App.css";

type InviteRole = "member" | "observer";
type ControlSectionKey = keyof ControlBadges;
type ControlSectionSignatures = Record<ControlSectionKey, string>;

const agentTypes = [
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "opencode CLI" },
  { value: "echo", label: "Echo Test Agent" }
];

const permissionLevels = [
  { value: "read_only", label: "Read only" },
  { value: "limited_write", label: "Limited write" },
  { value: "full_access", label: "Full access" }
];

const zeroControlBadges: ControlBadges = { agent: 0, invite: 0, participants: 0, flow: 0 };
const controlSectionKeys = ["agent", "invite", "participants", "flow"] as const satisfies readonly ControlSectionKey[];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roleLabel(value: string): string {
  const labels: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    observer: "Observer",
    agent: "Agent"
  };
  return labels[value] ?? titleCase(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  }) ?? "";
}

function controlSectionSignatures(room: ReturnType<typeof deriveRoomState>): ControlSectionSignatures {
  const agentSignature = stableJson({
    activeAgentId: room.activeAgentId,
    agents: [...room.agents]
      .sort((left, right) => left.agent_id.localeCompare(right.agent_id))
      .map((agent) => ({ id: agent.agent_id, name: agent.name, status: agent.status, lastStatusAt: agent.last_status_at }))
  });
  const participantSignature = stableJson([...room.participants]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((participant) => ({ id: participant.id, name: participant.display_name, role: participant.role, type: participant.type })));
  const flowSignature = stableJson({
    activeCollection: room.activeCollection,
    collectionHistory: room.collectionHistory
  });

  return {
    agent: agentSignature,
    invite: stableJson({ inviteCount: room.inviteCount }),
    participants: participantSignature,
    flow: flowSignature
  };
}

function countForSection(counts: ControlCounts, section: ControlSectionKey): number {
  switch (section) {
    case "agent": return counts.agents;
    case "invite": return counts.invites;
    case "participants": return counts.participants;
    case "flow": return counts.flow;
  }
}

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search), []);
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP AI Room");
  const [joinRoomId, setJoinRoomId] = useState(inviteTarget?.room_id ?? "");
  const [inviteToken, setInviteToken] = useState(inviteTarget?.invite_token ?? "");
  const [session, setSession] = useState<RoomSession | undefined>(() => loadInitialSession(window.localStorage, inviteTarget));
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [message, setMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteTtl, setInviteTtl] = useState(24 * 60 * 60);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string>();
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [workingDir, setWorkingDir] = useState("D:\\Development\\2");
  const [pairingCommand, setPairingCommand] = useState<string>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();
  const [showManualCommand, setShowManualCommand] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [error, setError] = useState<string>();
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [controlBadges, setControlBadges] = useState<ControlBadges>(zeroControlBadges);
  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => clearEventSocket(socket);
  }, [session]);

  const room = useMemo(() => deriveRoomState(events), [events]);
  const activeAgent = room.agents.find((agent) => agent.agent_id === room.activeAgentId);
  const permissions = roomPermissionsForRole(session?.role);
  const canManageRoom = permissions.canManageControls;
  const canUseAiFlowControl = permissions.canUseAiFlowControl;
  const canSendMessages = permissions.canSendMessages;
  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of room.participants) names.set(participant.id, participant.display_name);
    for (const agent of room.agents) names.set(agent.agent_id, agent.name);
    return names;
  }, [room.participants, room.agents]);

  const controlCounts = useMemo<ControlCounts>(() => ({
    agents: room.agents.length,
    invites: room.inviteCount,
    participants: room.participants.length,
    flow: (room.activeCollection ? 1 : 0) + room.collectionHistory.length
  }), [room.agents.length, room.activeCollection, room.collectionHistory.length, room.inviteCount, room.participants.length]);
  const currentControlSignatures = useMemo(() => controlSectionSignatures(room), [room]);
  const previousControlCounts = useRef<ControlCounts>(controlCounts);
  const previousControlSignatures = useRef<ControlSectionSignatures>(currentControlSignatures);

  useEffect(() => {
    const previousCounts = previousControlCounts.current;
    const previousSignatures = previousControlSignatures.current;
    setControlBadges((existing) => {
      const countBadges = badgeChangesForCollapsedControls({
        collapsed: controlsCollapsed,
        previous: previousCounts,
        current: controlCounts,
        existing
      });
      if (!controlsCollapsed) return countBadges;

      const nextBadges = { ...countBadges };
      for (const section of controlSectionKeys) {
        const countDidNotIncrease = countForSection(controlCounts, section) <= countForSection(previousCounts, section);
        if (countDidNotIncrease && currentControlSignatures[section] !== previousSignatures[section]) {
          nextBadges[section] += 1;
        }
      }
      return nextBadges;
    });
    previousControlCounts.current = controlCounts;
    previousControlSignatures.current = currentControlSignatures;
  }, [controlCounts, controlsCollapsed, currentControlSignatures]);

  const streamingKey = useMemo(() => room.streamingTurns.map((turn) => turn.turn_id).join("|"), [room.streamingTurns]);
  const streamingTextKey = useMemo(() => room.streamingTurns.map((turn) => `${turn.turn_id}:${turn.text}`).join("|"), [room.streamingTurns]);

  useEffect(() => {
    if (!streamingKey) {
      setShowSlowStreamingNotice(false);
      return;
    }
    setShowSlowStreamingNotice(false);
    const timeout = window.setTimeout(() => setShowSlowStreamingNotice(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [streamingKey]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [room.messages.length, room.streamingTurns.length, streamingTextKey]);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function activateSession(nextSession: RoomSession): void {
    saveStoredSession(window.localStorage, nextSession);
    setEvents([]);
    setCreatedInviteUrl(undefined);
    setPairingCommand(undefined);
    setLocalLaunch(undefined);
    setShowManualCommand(false);
    setShowAgentManager(false);
    setSession(nextSession);
    if (inviteTarget) window.history.replaceState({}, "", "/");
  }

  function leaveRoom(): void {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setMessage("");
    setCreatedInviteUrl(undefined);
    setPairingCommand(undefined);
    setLocalLaunch(undefined);
    setShowManualCommand(false);
    setShowAgentManager(false);
    setError(undefined);
  }

  function toggleControls(): void {
    setControlsCollapsed((current) => {
      const next = !current;
      if (!next) setControlBadges(zeroControlBadges);
      return next;
    });
  }

  function renderBadge(value: number) {
    return value > 0 ? <span className="badge">{value}</span> : null;
  }

  async function createRoomAndStartAgent(): Promise<void> {
    const result = await createRoomWithLocalAgent(roomName.trim(), displayName.trim(), { agent_type: agentType, permission_level: permissionLevel, working_dir: workingDir });
    activateSession(result.session);
    if (result.launch) {
      setLocalLaunch(result.launch);
      setPairingCommand(result.launch.command);
    }
    if (result.launch_error) {
      setShowAgentManager(true);
      setError(`Starting the local agent failed: ${result.launch_error}`);
    }
  }

  async function startLocalAgent(): Promise<void> {
    const launch = await createLocalAgentLaunch(session, { agent_type: agentType, permission_level: permissionLevel, working_dir: workingDir });
    setLocalLaunch(launch);
    setPairingCommand(launch.command);
    setShowManualCommand(false);
  }

  async function toggleManualCommand(): Promise<void> {
    if (showManualCommand) {
      setShowManualCommand(false);
      return;
    }
    if (!pairingCommand) {
      const pairing = await createAgentPairing(session, { agent_type: agentType, permission_level: permissionLevel, working_dir: workingDir });
      setPairingCommand(pairing.command);
    }
    setShowManualCommand(true);
  }

  async function startCollection(): Promise<void> {
    await startAiCollection(session);
  }

  async function submitCollection(): Promise<void> {
    await submitAiCollection(session);
  }

  async function cancelCollection(): Promise<void> {
    await cancelAiCollection(session);
  }

  if (!session) {
    const inviteMode = Boolean(inviteTarget);
    return (
      <main className="landing-shell">
        <div className="workspace-backdrop" aria-hidden="true">
          <span className="workspace-orb orb-primary" />
          <span className="workspace-orb orb-secondary" />
        </div>
        <section className="hero-panel">
          <p className="eyebrow">Collaborative Agent Communication Protocol</p>
          <h1>{inviteMode ? "Join a shared AI room" : "Create a collaborative AI room"}</h1>
          <p className="hero-copy">
            {inviteMode
              ? "You opened an invite link. Enter your name to join the same AI collaboration room."
              : "Create a room, connect a local CLI agent, and invite teammates into one governed chat workspace."}
          </p>
        </section>
        <section className="landing-grid">
          {!inviteMode && (
            <form className="glass-card setup-card" onSubmit={(event) => { event.preventDefault(); void run(createRoomAndStartAgent); }}>
              <div className="form-heading">
                <span className="status-pill online">Room host</span>
                <h2>Local Agent setup</h2>
                <p className="muted compact">Create the collaboration room and start the trusted local CLI bridge in one guided setup flow.</p>
              </div>
              <div className="field-grid">
                <div>
                  <label htmlFor="room-name">Room name</label>
                  <input id="room-name" required value={roomName} onChange={(event) => setRoomName(event.target.value)} />
                </div>
                <div>
                  <label htmlFor="display-name">Your name</label>
                  <input id="display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </div>
              </div>
              <div className="form-divider" />
              <div className="field-grid">
                <div>
                  <label htmlFor="setup-agent-type">Agent type</label>
                  <select id="setup-agent-type" value={agentType} onChange={(event) => setAgentType(event.target.value)}>{agentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                </div>
                <div>
                  <label htmlFor="setup-permission-level">Permission</label>
                  <select id="setup-permission-level" value={permissionLevel} onChange={(event) => setPermissionLevel(event.target.value)}>{permissionLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                </div>
              </div>
              <label htmlFor="setup-working-dir">Working directory</label>
              <input id="setup-working-dir" required value={workingDir} onChange={(event) => setWorkingDir(event.target.value)} />
              <button disabled={!roomName.trim() || !displayName.trim() || !workingDir.trim()}>Create room and start agent</button>
              <p className="muted compact">If automatic startup fails, the room still opens and you can retry or use the manual command fallback.</p>
            </form>
          )}
          <form className="glass-card" onSubmit={(event) => { event.preventDefault(); void run(async () => activateSession(await joinRoom(joinRoomId.trim(), inviteToken.trim(), displayName.trim()))); }}>
            <h2>{inviteMode ? "Accept invite" : "Join room"}</h2>
            {!inviteMode && (
              <>
                <label htmlFor="join-room-id">Room ID</label>
                <input id="join-room-id" value={joinRoomId} onChange={(event) => setJoinRoomId(event.target.value)} placeholder="room_..." />
                <label htmlFor="invite-token">Invite token</label>
                <input id="invite-token" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="cacp_..." />
              </>
            )}
            <label htmlFor="join-display-name">Your name</label>
            <input id="join-display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <button disabled={!joinRoomId || !inviteToken || !displayName.trim()}>Join shared room</button>
          </form>
        </section>
        {error && <p className="error banner">{error}</p>}
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      <div className="workspace-backdrop" aria-hidden="true">
        <span className="workspace-orb orb-primary" />
        <span className="workspace-orb orb-secondary" />
        <span className="workspace-orb orb-tertiary" />
      </div>
      <header className="workspace-header">
        <div className="header-title">
          <p className="eyebrow">Collaborative AI workspace demo</p>
          <h1>AI Collaboration Platform Demo</h1>
          <p className="room-id">Room ID: {session.room_id}</p>
        </div>
        <div className="header-actions">
          <span className={activeAgent?.status === "online" ? "status-pill online" : "status-pill"}>{activeAgent ? `Active agent: ${activeAgent.name} (${activeAgent.status})` : "No active agent"}</span>
          {room.activeCollection && <span className="status-pill paused">AI paused: collecting answers</span>}
          <span className="status-pill">{room.participants.length} participant{room.participants.length === 1 ? "" : "s"}</span>
          {canManageRoom && (
            <button type="button" className="secondary danger" onClick={() => void run(async () => {
              if (window.confirm("Clear all chat messages and AI flow history for everyone?")) await clearRoom(session);
            })}>
              Clear room
            </button>
          )}
          <button type="button" className="secondary" onClick={toggleControls}>{controlsCollapsed ? "Expand controls" : "Collapse controls"}</button>
          <button type="button" className="secondary" onClick={leaveRoom}>Leave room</button>
        </div>
      </header>

      <section className={`workspace-grid ${controlsCollapsed ? "collapsed-controls" : ""}`}>
        <section className="chat-panel chat-stage">
          <div className="timeline" ref={timelineRef}>
            {room.messages.length === 0 && room.streamingTurns.length === 0 ? (
              <div className="empty-state">
                <h2>Start the shared conversation</h2>
                <p>The room is ready. If the local agent is still starting, wait for it to appear as the active online agent before sending AI-directed messages. Use AI Flow Control when the host wants to collect multiple human answers before sending them to AI.</p>
              </div>
            ) : null}
            {room.messages.map((item) => {
              const isAgent = item.kind === "agent";
              const isSystem = item.kind === "system";
              return (
                <article key={item.message_id ?? `${item.actor_id}-${item.created_at}`} className={isAgent ? "message agent-message" : isSystem ? "message system-message" : "message human-message"}>
                  <div className="message-meta"><span>{actorNames.get(item.actor_id) ?? item.actor_id}</span><span>{item.collection_id ? "Queued for AI" : isAgent ? "AI Agent" : isSystem ? "System" : "Human"}</span></div>
                  <p>{item.text}</p>
                </article>
              );
            })}
            {room.streamingTurns.map((turn) => {
              const agentName = actorNames.get(turn.agent_id) ?? turn.agent_id;
              return (
                <article key={turn.turn_id} className="message agent-message streaming">
                  <div className="message-meta"><span>{agentName}</span><span>Streaming</span></div>
                  <p className="streaming-status">{agentName} is responding...</p>
                  {showSlowStreamingNotice && <p className="muted compact">Still waiting for the local CLI agent... It will fail automatically if the CLI hangs.</p>}
                  {turn.text && <p>{turn.text}</p>}
                </article>
              );
            })}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); if (!canSendMessages) return; void run(async () => { await sendMessage(session, message.trim()); setMessage(""); }); }}>
            <textarea aria-label="Message the room" disabled={!canSendMessages} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={!canSendMessages ? "Observer mode: read-only room view." : room.activeCollection ? "AI is paused. Messages are being collected for the host." : "Message the shared AI room..."} />
            <button disabled={!canSendMessages || !message.trim()}>Send</button>
          </form>
          {!canSendMessages && <p className="muted compact">Observer mode is read-only. You can watch the conversation but cannot send messages.</p>}
          {activeAgent && activeAgent.status !== "online" && <p className="error inline-error">The active agent is offline. Select an online agent from the controls.</p>}
          {error && <p className="error inline-error">{error}</p>}
        </section>

        {controlsCollapsed ? (
          <aside className="control-rail command-center-dock" aria-label="Collapsed controls">
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand local agent controls">
              <span className="dock-icon">A</span><span className="dock-label">Agent</span>{renderBadge(controlBadges.agent)}
            </button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand participants controls">
              <span className="dock-icon">P</span><span className="dock-label">People</span>{renderBadge(controlBadges.participants)}
            </button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand invite controls">
              <span className="dock-icon">I</span><span className="dock-label">Invite</span>{renderBadge(controlBadges.invite)}
            </button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand AI flow controls">
              <span className="dock-icon">F</span><span className="dock-label">Flow</span>{renderBadge(controlBadges.flow)}
            </button>
          </aside>
        ) : (
          <aside className="sidebar command-center-panel">
            <section className="side-card agent-status-card">
              <div className="side-card-title-row">
                <div>
                  <h2>Agent Status</h2>
                  <p className="muted compact">The first claimed local agent becomes active automatically.</p>
                </div>
                {canManageRoom && (
                  <button type="button" className="secondary compact-button" onClick={() => setShowAgentManager((current) => !current)}>
                    {showAgentManager ? "Close" : "Manage Agent"}
                  </button>
                )}
              </div>
              <div className={activeAgent?.status === "online" ? "agent-summary online" : "agent-summary"}>
                <span className="agent-summary-dot" aria-hidden="true" />
                <div>
                  <strong>{activeAgent ? activeAgent.name : localLaunch ? "Local agent is starting" : "No active agent"}</strong>
                  <p className="muted compact">
                    {activeAgent ? `${titleCase(activeAgent.status)} - ${activeAgent.agent_id.slice(-8)}` : localLaunch ? "Waiting for the adapter to claim this room." : "Create or start a local agent to enable AI replies."}
                  </p>
                </div>
              </div>
              <label htmlFor="active-agent">Active agent</label>
              <select id="active-agent" aria-label="Active agent" disabled={!canManageRoom || room.agents.length === 0} value={room.activeAgentId ?? ""} onChange={(event) => { const value = event.target.value; if (value) void run(async () => selectAgent(session, value)); }}>
                <option value="">Select agent</option>
                {room.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.status === "online" ? "Online" : "Offline"} - {agent.name} - {agent.agent_id.slice(-6)}</option>)}
              </select>
              {room.agents.length === 0 && <p className="muted compact">The local agent should appear here automatically after it claims the room.</p>}
              {!canManageRoom && <p className="muted compact">Only owners and admins can change or start local agents.</p>}
              {localLaunch && <p className="status-line">Local launch started{localLaunch.pid ? ` (pid ${localLaunch.pid})` : ""}.</p>}
              {localLaunch?.out_log && <p className="muted compact">Logs: {localLaunch.out_log}</p>}
              {showAgentManager && (
                <div className="manager-panel">
                  <h3>Local Agent setup</h3>
                  <label htmlFor="agent-type">Agent type</label>
                  <select id="agent-type" disabled={!canManageRoom} value={agentType} onChange={(event) => setAgentType(event.target.value)}>{agentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                  <label htmlFor="permission-level">Permission</label>
                  <select id="permission-level" disabled={!canManageRoom} value={permissionLevel} onChange={(event) => setPermissionLevel(event.target.value)}>{permissionLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                  <p className="muted compact">Permission is applied when a local agent starts. Restart the agent after changing it.</p>
                  <label htmlFor="working-dir">Working directory</label>
                  <input id="working-dir" disabled={!canManageRoom} value={workingDir} onChange={(event) => setWorkingDir(event.target.value)} />
                  <div className="agent-actions">
                    <button type="button" disabled={!canManageRoom} onClick={() => void run(startLocalAgent)}>Start local agent</button>
                    <button type="button" className="secondary" disabled={!canManageRoom} onClick={() => void run(toggleManualCommand)}>{showManualCommand ? "Hide manual command" : "Show manual command"}</button>
                  </div>
                  {showManualCommand && pairingCommand && <code className="command-box">{pairingCommand}</code>}
                </div>
              )}
            </section>

            <section className="side-card">
              <h2>Participants</h2>
              <div className="chip-list">
                {room.participants.map((participant) => <span className="chip" key={participant.id}>{participant.display_name}<small>{roleLabel(participant.role)}</small></span>)}
              </div>
              {room.participants.length === 0 && <p className="muted">No participants are visible yet.</p>}
            </section>

            <section className="side-card collection-panel">
              <h2>AI Flow Control</h2>
              {room.activeCollection ? (
                <article className="collection-card active">
                  <div className="flow-title-row">
                    <div>
                      <strong>Collecting answers</strong>
                      <p className="muted compact">AI is paused. Human messages are visible in the room and queued for one combined AI turn.</p>
                    </div>
                    <span className="status-pill paused">Paused</span>
                  </div>
                  <dl className="flow-meta">
                    <div><dt>Collected</dt><dd>{room.activeCollection.messages.length} message{room.activeCollection.messages.length === 1 ? "" : "s"}</dd></div>
                    <div><dt>Started</dt><dd>{new Date(room.activeCollection.started_at).toLocaleTimeString()}</dd></div>
                  </dl>
                  {canUseAiFlowControl ? (
                    <div className="collection-actions">
                      <button type="button" disabled={room.activeCollection.messages.length === 0} onClick={() => void run(submitCollection)}>Submit collected answers</button>
                      <button type="button" className="secondary danger" onClick={() => void run(cancelCollection)}>Cancel collection</button>
                    </div>
                  ) : <p className="muted compact">The host will decide when to submit the collected answers.</p>}
                </article>
              ) : (
                <>
                  <p className="muted compact">Live mode is on. New human messages are sent to the active AI agent automatically.</p>
                  <button type="button" disabled={!canUseAiFlowControl} onClick={() => void run(startCollection)}>Start collecting answers</button>
                  {!canUseAiFlowControl && <p className="muted compact">Only the host can pause AI and collect answers.</p>}
                </>
              )}
              {room.collectionHistory.length > 0 && (
                <div className="collection-history">
                  <span>Recent collection rounds</span>
                  {room.collectionHistory.slice(-3).reverse().map((collection) => (
                    <p className="muted compact" key={collection.collection_id}>
                      {collection.submitted_at ? "Submitted" : "Cancelled"} · {collection.messages.length} message{collection.messages.length === 1 ? "" : "s"}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="side-card">
              <h2>Invite link</h2>
              <label htmlFor="invite-role">Invite role</label>
              <select id="invite-role" disabled={!canManageRoom} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="member">Member</option><option value="observer">Observer</option></select>
              <label htmlFor="invite-ttl">Invite expires</label>
              <select id="invite-ttl" disabled={!canManageRoom} value={inviteTtl} onChange={(event) => setInviteTtl(Number(event.target.value))}><option value={3600}>1 hour</option><option value={86400}>24 hours</option><option value={604800}>7 days</option></select>
              <button type="button" disabled={!canManageRoom} onClick={() => void run(async () => { const invite = await createInvite(session, inviteRole, inviteTtl); setCreatedInviteUrl(inviteUrlFor(window.location.origin, session.room_id, invite.invite_token)); })}>Create invite link</button>
              {!canManageRoom && <p className="muted compact">Only owners and admins can create invite links.</p>}
              {createdInviteUrl && <code className="command-box">{createdInviteUrl}</code>}
            </section>
          </aside>
        )}
      </section>
    </main>
  );
}
