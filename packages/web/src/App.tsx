import { useEffect, useMemo, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { connectEvents, createAgentPairing, createInvite, createRoom, inviteUrlFor, joinRoom, parseInviteUrl, selectAgent, sendMessage, submitQuestionResponse, type RoomSession } from "./api.js";
import { mergeEvent } from "./event-log.js";
import { deriveRoomState } from "./room-state.js";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "./session-storage.js";
import "./App.css";

type InviteRole = "member" | "observer";

const agentTypes = [
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "opencode CLI" },
  { value: "echo", label: "Echo Test Agent" }
];

const permissionLevels = [
  { value: "read_only", label: "只读" },
  { value: "limited_write", label: "受限写入" },
  { value: "full_access", label: "完整权限" }
];

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search), []);
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP AI Room");
  const [defaultPolicy, setDefaultPolicy] = useState("majority");
  const [joinRoomId, setJoinRoomId] = useState(inviteTarget?.room_id ?? "");
  const [inviteToken, setInviteToken] = useState(inviteTarget?.invite_token ?? "");
  const [session, setSession] = useState<RoomSession | undefined>(() => loadStoredSession(window.localStorage));
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

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => socket.close();
  }, [session]);

  const room = useMemo(() => deriveRoomState(events), [events]);
  const activeAgent = room.agents.find((agent) => agent.agent_id === room.activeAgentId);
  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of room.participants) names.set(participant.id, participant.display_name);
    for (const agent of room.agents) names.set(agent.agent_id, agent.name);
    return names;
  }, [room.participants, room.agents]);

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
  }

  if (!session) {
    const inviteMode = Boolean(inviteTarget);
    return (
      <main className="landing-shell">
        <section className="hero-panel">
          <p className="eyebrow">Collaborative Agent Communication Protocol</p>
          <h1>{inviteMode ? "加入多人 AI 房间" : "创建多人协同 AI 房间"}</h1>
          <p className="hero-copy">
            {inviteMode ? "你已通过邀请链接进入，只需要输入自己的名字即可加入同一个 AI 会话。" : "房主创建房间、连接本地 CLI Agent，然后把邀请链接发给其他参与者。"}
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
                <option value="owner_approval">房主批准</option>
                <option value="majority">多数通过</option>
                <option value="unanimous">全员一致</option>
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
        <div>
          <p className="eyebrow">CACP Room</p>
          <h1>AI Collaboration Command Center</h1>
          <p className="room-id">{session.room_id}</p>
        </div>
        <div className="header-actions">
          <span className={activeAgent?.status === "online" ? "status-pill online" : "status-pill"}>{activeAgent ? `Active: ${activeAgent.name} · ${activeAgent.status}` : "No active agent"}</span>
          <button type="button" className="secondary" onClick={leaveRoom}>Leave room</button>
        </div>
      </header>

      <section className="workspace-grid">
        <section className="chat-panel">
          <div className="timeline">
            {room.messages.length === 0 && room.streamingTurns.length === 0 ? (
              <div className="empty-state">
                <h2>开始多人 AI 对话</h2>
                <p>先在右侧生成本地 CLI Agent 连接命令并运行，然后选择在线 Agent，再发送消息。</p>
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
            {room.streamingTurns.map((turn) => (
              <article key={turn.turn_id} className="message agent-message streaming">
                <div className="message-meta"><span>{actorNames.get(turn.agent_id) ?? turn.agent_id}</span><span>streaming</span></div>
                <p>{turn.text || "正在生成回复..."}</p>
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message.trim()); setMessage(""); }); }}>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="和团队及 AI 讨论..." />
            <button disabled={!message.trim()}>Send</button>
          </form>
          {activeAgent && activeAgent.status !== "online" && <p className="error">当前 Active Agent 离线，请在右侧选择一个在线 Agent。</p>}
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="sidebar">
          <section className="side-card">
            <h2>Local Agent</h2>
            <label>Agent type</label>
            <select value={agentType} onChange={(event) => setAgentType(event.target.value)}>{agentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            <label>Permission</label>
            <select value={permissionLevel} onChange={(event) => setPermissionLevel(event.target.value)}>{permissionLevels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            <label>Working directory</label>
            <input value={workingDir} onChange={(event) => setWorkingDir(event.target.value)} />
            <button type="button" onClick={() => void run(async () => setPairingCommand((await createAgentPairing(session, { agent_type: agentType, permission_level: permissionLevel, working_dir: workingDir })).command))}>Generate connect command</button>
            {pairingCommand && <code className="command-box">{pairingCommand}</code>}
          </section>

          <section className="side-card">
            <h2>Participants</h2>
            <div className="chip-list">
              {room.participants.map((participant) => <span className="chip" key={participant.id}>{participant.display_name}<small>{participant.role}</small></span>)}
            </div>
          </section>

          <section className="side-card">
            <h2>Active Agent</h2>
            <select value={room.activeAgentId ?? ""} onChange={(event) => { const value = event.target.value; if (value) void run(async () => selectAgent(session, value)); }}>
              <option value="">Select agent</option>
              {room.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.status === "online" ? "🟢" : "⚪"} {agent.name} · {agent.agent_id.slice(-6)}</option>)}
            </select>
            {room.agents.length === 0 && <p className="muted">运行连接命令后 Agent 会显示在这里。</p>}
          </section>

          <section className="side-card">
            <h2>Invite link</h2>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="member">参与者</option><option value="observer">观察者</option></select>
            <select value={inviteTtl} onChange={(event) => setInviteTtl(Number(event.target.value))}><option value={3600}>1 小时</option><option value={86400}>24 小时</option><option value={604800}>7 天</option></select>
            <button type="button" onClick={() => void run(async () => { const invite = await createInvite(session, inviteRole, inviteTtl); setCreatedInviteUrl(inviteUrlFor(window.location.origin, session.room_id, invite.invite_token)); })}>Create invite link</button>
            {createdInviteUrl && <code className="command-box">{createdInviteUrl}</code>}
          </section>

          <section className="side-card">
            <h2>Decisions</h2>
            {room.questions.map((question) => (
              <article className="question-card" key={question.question_id}>
                <strong>{question.question}</strong>
                <div className="vote-row">
                  {question.options.map((option) => <button className="secondary" disabled={question.closed} key={option} onClick={() => void run(async () => submitQuestionResponse(session, question.question_id, option))}>{option}</button>)}
                </div>
                {question.responses.map((response) => <p className="muted" key={response.respondent_id}>{actorNames.get(response.respondent_id) ?? response.respondent_id}: {String(response.response)}</p>)}
                {question.closed && <p className="status-pill online">Result: {String(question.selected_response)}</p>}
              </article>
            ))}
            {room.questions.length === 0 && <p className="muted">AI 发起选择题或工具审批时会显示在这里。</p>}
          </section>
        </aside>
      </section>
    </main>
  );
}
