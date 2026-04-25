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

  if (!session) {
    return <main className="shell"><h1>CACP Web Room</h1><section className="card"><label>Room name</label><input value={roomName} onChange={(event) => setRoomName(event.target.value)} /><label>Your name</label><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><button onClick={() => run(async () => setSession(await createRoom(roomName, displayName)))}>Create room</button></section>{error && <p className="error">{error}</p>}</main>;
  }

  return (
    <main className="shell">
      <header><h1>CACP Room</h1><p><strong>Room:</strong> {session.room_id}</p><p><strong>Token:</strong> {session.token}</p></header>
      <section className="grid">
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message); setMessage(""); }); }}><h2>Message</h2><textarea value={message} onChange={(event) => setMessage(event.target.value)} /><button>Send</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createQuestion(session, question); setQuestion(""); }); }}><h2>Question</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><button>Create question</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createTask(session, agentId, taskPrompt); setTaskPrompt(""); }); }}><h2>Agent task</h2><select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Select agent</option>{agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name} ({agent.agent_id})</option>)}</select><textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} /><button disabled={!agentId}>Create task</button></form>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="card"><h2>Event stream</h2><ol className="events">{events.map((event) => <li key={event.event_id}><code>{event.type}</code><pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></section>
    </main>
  );
}