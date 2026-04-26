import { useEffect, useMemo, useRef, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { cancelDecision, clearRoom, connectEvents, createAgentPairing, createInvite, createRoom, inviteUrlFor, joinRoom, parseInviteUrl, selectAgent, sendMessage, type RoomSession } from "./api.js";
import { badgeChangesForCollapsedControls, type ControlBadges, type ControlCounts } from "./control-badges.js";
import { mergeEvent } from "./event-log.js";
import { deriveRoomState, type DecisionView } from "./room-state.js";
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

const policyOptions = [
  { value: "owner_approval", label: "Owner approval" },
  { value: "majority", label: "Majority" },
  { value: "unanimous", label: "Unanimous" }
];

const zeroControlBadges: ControlBadges = { agent: 0, invite: 0, participants: 0, decisions: 0 };
const controlSectionKeys = ["agent", "invite", "participants", "decisions"] as const satisfies readonly ControlSectionKey[];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function policyLabel(value: unknown): string {
  if (typeof value === "string") {
    return policyOptions.find((option) => option.value === value)?.label ?? titleCase(value);
  }
  if (value && typeof value === "object" && "type" in value && typeof (value as { type?: unknown }).type === "string") {
    return policyLabel((value as { type: string }).type);
  }
  return "Room default";
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

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "None";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function statusLabel(decision: DecisionView): string {
  if (decision.terminal_status === "resolved") return "Resolved";
  if (decision.terminal_status === "cancelled") return "Cancelled";
  return decision.blocking ? "Active blocking decision" : "Active decision";
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
  const decisionSignature = stableJson({
    currentDecision: room.currentDecision,
    decisionHistory: room.decisionHistory
  });

  return {
    agent: agentSignature,
    invite: stableJson({ inviteCount: room.inviteCount }),
    participants: participantSignature,
    decisions: decisionSignature
  };
}

function countForSection(counts: ControlCounts, section: ControlSectionKey): number {
  switch (section) {
    case "agent": return counts.agents;
    case "invite": return counts.invites;
    case "participants": return counts.participants;
    case "decisions": return counts.decisions;
  }
}

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search), []);
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP AI Room");
  const [defaultPolicy, setDefaultPolicy] = useState("majority");
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
  const [error, setError] = useState<string>();
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [controlBadges, setControlBadges] = useState<ControlBadges>(zeroControlBadges);
  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => socket.close();
  }, [session]);

  const room = useMemo(() => deriveRoomState(events), [events]);
  const activeAgent = room.agents.find((agent) => agent.agent_id === room.activeAgentId);
  const canManageRoom = session?.role === "owner" || session?.role === "admin";
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
    decisions: (room.currentDecision ? 1 : 0) + room.decisionHistory.length
  }), [room.agents.length, room.currentDecision, room.decisionHistory.length, room.inviteCount, room.participants.length]);
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

  function renderDecision(decision: DecisionView, mode: "current" | "history") {
    return (
      <article className="decision-card" key={decision.decision_id}>
        <div className="decision-title-row">
          <div>
            <strong>{decision.title}</strong>
            <p className="muted compact">{decision.description}</p>
          </div>
          <span className={decision.terminal_status === "resolved" ? "status-pill online" : "status-pill"}>{statusLabel(decision)}</span>
        </div>
        <dl className="decision-meta">
          <div><dt>Policy</dt><dd>{policyLabel(decision.policy)}</dd></div>
          <div><dt>Kind</dt><dd>{titleCase(decision.kind)}</dd></div>
          <div><dt>Created</dt><dd>{new Date(decision.created_at).toLocaleString()}</dd></div>
        </dl>
        {decision.options.length > 0 && (
          <div className="option-list">
            <span>Options</span>
            <ul>
              {decision.options.map((option) => <li key={option.id}><b>{option.label}</b><small>{option.id}</small></li>)}
            </ul>
          </div>
        )}
        {mode === "current" && <p className="decision-help">Answer this decision in the main chat. The room will record interpreted responses automatically.</p>}
        {decision.responses.length > 0 ? (
          <div className="response-list">
            <span>Responses</span>
            {decision.responses.map((response) => (
              <p className="muted" key={response.respondent_id}>
                {actorNames.get(response.respondent_id) ?? response.respondent_id}: {response.response_label ?? displayValue(response.response)}
              </p>
            ))}
          </div>
        ) : <p className="muted">No responses recorded yet.</p>}
        {decision.terminal_status === "resolved" && <p className="status-line">Result: {decision.result_label ?? displayValue(decision.result)}</p>}
        {decision.terminal_status === "cancelled" && <p className="status-line">Cancelled: {decision.cancelled_reason ?? "No reason provided"}</p>}
        {mode === "current" && canManageRoom && (
          <button type="button" className="secondary danger" onClick={() => void run(async () => {
            if (window.confirm("Cancel this decision for everyone?")) await cancelDecision(session, decision.decision_id, "Cancelled from the web room controls");
          })}>
            Cancel decision
          </button>
        )}
      </article>
    );
  }

  if (!session) {
    const inviteMode = Boolean(inviteTarget);
    return (
      <main className="landing-shell">
        <section className="hero-panel">
          <p className="eyebrow">Collaborative Agent Communication Protocol</p>
          <h1>{inviteMode ? "Join a shared AI room" : "Create a governed AI room"}</h1>
          <p className="hero-copy">
            {inviteMode
              ? "You opened an invite link. Enter your name to join the same AI collaboration room."
              : "Create a room, connect a local CLI agent, and invite teammates into one governed chat workspace."}
          </p>
        </section>
        <section className="landing-grid">
          {!inviteMode && (
            <form className="glass-card" onSubmit={(event) => { event.preventDefault(); void run(async () => activateSession(await createRoom(roomName.trim(), displayName.trim(), defaultPolicy))); }}>
              <h2>Create room</h2>
              <label htmlFor="room-name">Room name</label>
              <input id="room-name" required value={roomName} onChange={(event) => setRoomName(event.target.value)} />
              <label htmlFor="display-name">Your name</label>
              <input id="display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              <label htmlFor="default-policy">Default policy</label>
              <select id="default-policy" value={defaultPolicy} onChange={(event) => setDefaultPolicy(event.target.value)}>
                {policyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button>Create governed AI room</button>
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
      <header className="workspace-header">
        <div className="header-title">
          <p className="eyebrow">CACP Room</p>
          <h1>Decision Workspace</h1>
          <p className="room-id">Room ID: {session.room_id}</p>
        </div>
        <div className="header-actions">
          <span className={activeAgent?.status === "online" ? "status-pill online" : "status-pill"}>{activeAgent ? `Active agent: ${activeAgent.name} (${activeAgent.status})` : "No active agent"}</span>
          <span className="status-pill">{room.participants.length} participant{room.participants.length === 1 ? "" : "s"}</span>
          {canManageRoom && (
            <button type="button" className="secondary danger" onClick={() => void run(async () => {
              if (window.confirm("Clear all messages and decision history for everyone?")) await clearRoom(session);
            })}>
              Clear room
            </button>
          )}
          <button type="button" className="secondary" onClick={toggleControls}>{controlsCollapsed ? "Expand controls" : "Collapse controls"}</button>
          <button type="button" className="secondary" onClick={leaveRoom}>Leave room</button>
        </div>
      </header>

      <section className={`workspace-grid ${controlsCollapsed ? "collapsed-controls" : ""}`}>
        <section className="chat-panel">
          <div className="timeline" ref={timelineRef}>
            {room.messages.length === 0 && room.streamingTurns.length === 0 ? (
              <div className="empty-state">
                <h2>Start the shared conversation</h2>
                <p>Connect a local CLI agent from the controls, select an online agent, then send messages here. Decision answers also belong in this chat.</p>
              </div>
            ) : null}
            {room.messages.map((item) => {
              const isAgent = item.kind === "agent";
              return (
                <article key={item.message_id ?? `${item.actor_id}-${item.created_at}`} className={isAgent ? "message agent-message" : "message human-message"}>
                  <div className="message-meta"><span>{actorNames.get(item.actor_id) ?? item.actor_id}</span><span>{isAgent ? "AI Agent" : "Human"}</span></div>
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
                  {showSlowStreamingNotice && <p className="muted compact">Still waiting for the local CLI agent...</p>}
                  {turn.text && <p>{turn.text}</p>}
                </article>
              );
            })}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message.trim()); setMessage(""); }); }}>
            <textarea aria-label="Message the room" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message the room and answer decisions here..." />
            <button disabled={!message.trim()}>Send</button>
          </form>
          {activeAgent && activeAgent.status !== "online" && <p className="error inline-error">The active agent is offline. Select an online agent from the controls.</p>}
          {error && <p className="error inline-error">{error}</p>}
        </section>

        {controlsCollapsed ? (
          <aside className="control-rail" aria-label="Collapsed controls">
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand local agent controls">A{renderBadge(controlBadges.agent)}</button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand participants controls">P{renderBadge(controlBadges.participants)}</button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand invite controls">I{renderBadge(controlBadges.invite)}</button>
            <button type="button" className="rail-button" onClick={toggleControls} aria-label="Expand decision controls">D{renderBadge(controlBadges.decisions)}</button>
          </aside>
        ) : (
          <aside className="sidebar">
            <section className="side-card">
              <h2>Local Agent</h2>
              <label htmlFor="agent-type">Agent type</label>
              <select id="agent-type" value={agentType} onChange={(event) => setAgentType(event.target.value)}>{agentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <label htmlFor="permission-level">Permission</label>
              <select id="permission-level" value={permissionLevel} onChange={(event) => setPermissionLevel(event.target.value)}>{permissionLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <label htmlFor="working-dir">Working directory</label>
              <input id="working-dir" value={workingDir} onChange={(event) => setWorkingDir(event.target.value)} />
              <button type="button" onClick={() => void run(async () => setPairingCommand((await createAgentPairing(session, { agent_type: agentType, permission_level: permissionLevel, working_dir: workingDir })).command))}>Generate connect command</button>
              {pairingCommand && <code className="command-box">{pairingCommand}</code>}
            </section>

            <section className="side-card">
              <h2>Participants</h2>
              <div className="chip-list">
                {room.participants.map((participant) => <span className="chip" key={participant.id}>{participant.display_name}<small>{roleLabel(participant.role)}</small></span>)}
              </div>
              {room.participants.length === 0 && <p className="muted">No participants are visible yet.</p>}
            </section>

            <section className="side-card">
              <h2>Active Agent</h2>
              <select aria-label="Active agent" value={room.activeAgentId ?? ""} onChange={(event) => { const value = event.target.value; if (value) void run(async () => selectAgent(session, value)); }}>
                <option value="">Select agent</option>
                {room.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.status === "online" ? "Online" : "Offline"} - {agent.name} - {agent.agent_id.slice(-6)}</option>)}
              </select>
              {room.agents.length === 0 && <p className="muted">Run the connect command and the agent will appear here.</p>}
            </section>

            <section className="side-card">
              <h2>Invite link</h2>
              <label htmlFor="invite-role">Invite role</label>
              <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="member">Member</option><option value="observer">Observer</option></select>
              <label htmlFor="invite-ttl">Invite expires</label>
              <select id="invite-ttl" value={inviteTtl} onChange={(event) => setInviteTtl(Number(event.target.value))}><option value={3600}>1 hour</option><option value={86400}>24 hours</option><option value={604800}>7 days</option></select>
              <button type="button" onClick={() => void run(async () => { const invite = await createInvite(session, inviteRole, inviteTtl); setCreatedInviteUrl(inviteUrlFor(window.location.origin, session.room_id, invite.invite_token)); })}>Create invite link</button>
              {createdInviteUrl && <code className="command-box">{createdInviteUrl}</code>}
            </section>

            <section className="side-card decisions-panel">
              <h2>Current Decision</h2>
              {room.currentDecision ? renderDecision(room.currentDecision, "current") : <p className="muted">No active decision.</p>}
              <h2 className="section-spacer">Decision History</h2>
              {room.decisionHistory.length > 0 ? room.decisionHistory.map((decision) => renderDecision(decision, "history")) : <p className="muted">No completed decisions yet.</p>}
            </section>
          </aside>
        )}
      </section>
    </main>
  );
}
