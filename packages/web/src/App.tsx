import { useEffect, useMemo, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { connectEvents, createQuestion, createRoom, createTask, sendMessage, type RoomSession } from "./api.js";
import { mergeEvent } from "./event-log.js";
import "./App.css";

export default function App() {
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP MVP Room");
  const [session, setSession] = useState<RoomSession>();
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [agentId, setAgentId] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => socket.close();
  }, [session]);

  const agents = useMemo(() => events.filter((event) => event.type === "agent.registered").map((event) => event.payload as { agent_id: string; name: string }), [events]);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const canCreateRoom = roomName.trim().length > 0 && displayName.trim().length > 0;
  const canSendMessage = message.trim().length > 0;
  const canCreateQuestion = question.trim().length > 0;
  const canCreateTask = agentId.trim().length > 0 && taskPrompt.trim().length > 0;

  if (!session) {
    return <main className="shell"><h1>CACP Web Room</h1><section className="card"><label htmlFor="room-name">Room name</label><input id="room-name" required value={roomName} onChange={(event) => setRoomName(event.target.value)} /><label htmlFor="display-name">Your name</label><input id="display-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><button disabled={!canCreateRoom} onClick={() => run(async () => setSession(await createRoom(roomName.trim(), displayName.trim())))}>Create room</button></section>{error && <p className="error">{error}</p>}</main>;
  }

  return (
    <main className="shell">
      <header><h1>CACP Room</h1><p><strong>Room:</strong> {session.room_id}</p><p><strong>Token (local demo secret):</strong> {session.token}</p></header>
      <section className="grid">
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message.trim()); setMessage(""); }); }}><h2>Message</h2><label htmlFor="message-text">Message</label><textarea id="message-text" required value={message} onChange={(event) => setMessage(event.target.value)} /><button disabled={!canSendMessage}>Send</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createQuestion(session, question.trim()); setQuestion(""); }); }}><h2>Question</h2><label htmlFor="question-text">Question</label><textarea id="question-text" required value={question} onChange={(event) => setQuestion(event.target.value)} /><button disabled={!canCreateQuestion}>Create question</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createTask(session, agentId, taskPrompt.trim()); setTaskPrompt(""); }); }}><h2>Agent task</h2><label htmlFor="agent-id">Agent</label><select id="agent-id" required value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Select agent</option>{agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name} ({agent.agent_id})</option>)}</select><label htmlFor="task-prompt">Task prompt</label><textarea id="task-prompt" required value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} /><button disabled={!canCreateTask}>Create task</button></form>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="card"><h2>Event stream</h2><ol className="events">{events.map((event) => <li key={event.event_id}><code>{event.type}</code><pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></section>
    </main>
  );
}
