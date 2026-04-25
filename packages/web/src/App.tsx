import { useEffect, useMemo, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { connectEvents, createInvite, createRoom, joinRoom, selectAgent, sendMessage, type RoomSession } from "./api.js";
import { mergeEvent } from "./event-log.js";
import { deriveRoomState } from "./room-state.js";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "./session-storage.js";
import "./App.css";

type InviteRole = "admin" | "member" | "observer";

export default function App() {
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP AI Room");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [session, setSession] = useState<RoomSession | undefined>(() => loadStoredSession(window.localStorage));
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [message, setMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [createdInvite, setCreatedInvite] = useState<{ invite_token: string; role: string }>();
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
    setCreatedInvite(undefined);
    setSession(nextSession);
  }

  function leaveRoom(): void {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setMessage("");
    setCreatedInvite(undefined);
  }

  const canCreateRoom = roomName.trim().length > 0 && displayName.trim().length > 0;
  const canJoinRoom = joinRoomId.trim().length > 0 && inviteToken.trim().length > 0 && displayName.trim().length > 0;
  const canSendMessage = message.trim().length > 0;

  if (!session) {
    return (
      <main className="landing-shell">
        <section className="hero-panel">
          <p className="eyebrow">Collaborative Agent Communication Protocol</p>
          <h1>多人共享的 AI 对话房间</h1>
          <p className="hero-copy">创建一个房间，选择 Claude Code / Codex / 任意 CLI Agent，让多人同时参与同一段 AI 讨论、决策和执行过程。</p>
        </section>
        <section className="landing-grid">
          <form className="glass-card" onSubmit={(event) => { event.preventDefault(); void run(async () => activateSession(await createRoom(roomName.trim(), displayName.trim()))); }}>
            <h2>Create room</h2>
            <label htmlFor="room-name">Room name</label>
            <input id="room-name" required value={roomName} onChange={(event) => setRoomName(event.target.value)} />
            <label htmlFor="display-name">Your name</label>
            <input id="display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <button disabled={!canCreateRoom}>Create AI room</button>
          </form>
          <form className="glass-card" onSubmit={(event) => { event.preventDefault(); void run(async () => activateSession(await joinRoom(joinRoomId.trim(), inviteToken.trim(), displayName.trim()))); }}>
            <h2>Join room</h2>
            <label htmlFor="join-room-id">Room ID</label>
            <input id="join-room-id" value={joinRoomId} onChange={(event) => setJoinRoomId(event.target.value)} placeholder="room_..." />
            <label htmlFor="invite-token">Invite token</label>
            <input id="invite-token" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="cacp_..." />
            <label htmlFor="join-display-name">Your name</label>
            <input id="join-display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <button disabled={!canJoinRoom}>Join shared room</button>
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
          <span className={activeAgent ? "status-pill online" : "status-pill"}>{activeAgent ? `Active: ${activeAgent.name}` : "No active agent"}</span>
          <button type="button" className="secondary" onClick={leaveRoom}>Leave room</button>
        </div>
      </header>

      <section className="workspace-grid">
        <section className="chat-panel">
          <div className="timeline">
            {room.messages.length === 0 && room.streamingTurns.length === 0 ? (
              <div className="empty-state">
                <h2>开始多人 AI 对话</h2>
                <p>先在右侧选择已注册 Agent，然后在下方发送消息。每条人类消息都会由 Server 统一触发当前 Agent 自动回复。</p>
              </div>
            ) : null}
            {room.messages.map((item) => {
              const isAgent = item.kind === "agent";
              return (
                <article key={item.message_id ?? `${item.actor_id}-${item.created_at}`} className={isAgent ? "message agent-message" : "message human-message"}>
                  <div className="message-meta">
                    <span>{actorNames.get(item.actor_id) ?? item.actor_id}</span>
                    <span>{isAgent ? "AI Agent" : "Human"}</span>
                  </div>
                  <p>{item.text}</p>
                </article>
              );
            })}
            {room.streamingTurns.map((turn) => (
              <article key={turn.turn_id} className="message agent-message streaming">
                <div className="message-meta">
                  <span>{actorNames.get(turn.agent_id) ?? turn.agent_id}</span>
                  <span>streaming</span>
                </div>
                <p>{turn.text || "正在生成回复..."}</p>
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message.trim()); setMessage(""); }); }}>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="和团队及 AI 讨论..." />
            <button disabled={!canSendMessage}>Send</button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="sidebar">
          <section className="side-card">
            <h2>Participants</h2>
            <div className="chip-list">
              {room.participants.map((participant) => <span className="chip" key={participant.id}>{participant.display_name}<small>{participant.role}</small></span>)}
              {room.participants.length === 0 && <p className="muted">等待事件流同步参与者...</p>}
            </div>
          </section>

          <section className="side-card">
            <h2>Active Agent</h2>
            <select value={room.activeAgentId ?? ""} onChange={(event) => { const value = event.target.value; if (value) void run(async () => selectAgent(session, value)); }}>
              <option value="">Select agent</option>
              {room.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
            </select>
            {room.agents.length === 0 && <p className="muted">启动 CLI Adapter 后，Agent 会出现在这里。</p>}
          </section>

          <section className="side-card">
            <h2>Invite</h2>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}>
              <option value="member">member</option>
              <option value="observer">observer</option>
              <option value="admin">admin</option>
            </select>
            <button type="button" onClick={() => void run(async () => setCreatedInvite(await createInvite(session, inviteRole)))}>Create invite</button>
            {createdInvite && (
              <div className="invite-box">
                <span>Room ID</span>
                <code>{session.room_id}</code>
                <span>Invite token</span>
                <code>{createdInvite.invite_token}</code>
              </div>
            )}
          </section>

          <section className="side-card">
            <h2>Decisions</h2>
            {room.questions.map((question) => (
              <article className="question-card" key={question.question_id}>
                <strong>{question.question}</strong>
                <ul>{question.options.map((option) => <li key={option}>{option}</li>)}</ul>
              </article>
            ))}
            {room.questions.length === 0 && <p className="muted">AI 输出 cacp-question 后会在这里显示决策卡片。</p>}
          </section>
        </aside>
      </section>
    </main>
  );
}
