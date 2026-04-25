import { CacpEventSchema, type CacpEvent } from "@cacp/protocol";

export interface RoomSession {
  room_id: string;
  token: string;
}

async function postJson<T>(path: string, token: string | undefined, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function createRoom(name: string, displayName: string): Promise<RoomSession> {
  const result = await postJson<{ room_id: string; owner_token: string }>("/rooms", undefined, { name, display_name: displayName });
  return { room_id: result.room_id, token: result.owner_token };
}

export async function sendMessage(session: RoomSession, text: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/messages`, session.token, { text });
}

export async function createQuestion(session: RoomSession, question: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/questions`, session.token, { question, expected_response: "free_text", options: [] });
}

export async function createTask(session: RoomSession, targetAgentId: string, prompt: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/tasks`, session.token, { target_agent_id: targetAgentId, prompt, mode: "oneshot" });
}

export function connectEvents(session: RoomSession, onEvent: (event: CacpEvent) => void): WebSocket {
  const url = new URL(`/rooms/${session.room_id}/stream`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);
  const socket = new WebSocket(url);
  socket.addEventListener("message", (message) => {
    const parsed = CacpEventSchema.safeParse(JSON.parse(message.data));
    if (parsed.success) onEvent(parsed.data);
  });
  return socket;
}