#!/usr/bin/env node
import WebSocket from "ws";
import { CacpEventSchema } from "@cacp/protocol";
import { loadConfig } from "./config.js";
import { runCommandForTask } from "./runner.js";

const configPath = process.argv[2] ?? "docs/examples/generic-cli-agent.json";
const config = loadConfig(configPath);

async function postJson<T>(path: string, participantToken: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.server_url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${participantToken}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as T;
}

const registered = await postJson<{ agent_id: string; agent_token: string }>(`/rooms/${config.room_id}/agents/register`, config.token, {
  name: config.agent.name,
  capabilities: config.agent.capabilities
});
console.log(`Registered ${config.agent.name} as ${registered.agent_id}`);

const streamUrl = new URL(`/rooms/${config.room_id}/stream`, config.server_url);
streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
streamUrl.searchParams.set("token", registered.agent_token);

const ws = new WebSocket(streamUrl);
const runningTasks = new Set<string>();

ws.on("message", (raw) => {
  void (async () => {
    const parsed = CacpEventSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success || parsed.data.type !== "task.created") return;
    const payload = parsed.data.payload as { task_id?: string; target_agent_id?: string; prompt?: string };
    if (!payload.task_id || !payload.prompt || payload.target_agent_id !== registered.agent_id || runningTasks.has(payload.task_id)) return;
    runningTasks.add(payload.task_id);
    try {
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/start`, registered.agent_token, {});
      const result = await runCommandForTask({
        command: config.agent.command,
        args: config.agent.args,
        working_dir: config.agent.working_dir,
        prompt: payload.prompt,
        onOutput: async (output) => {
          await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/output`, registered.agent_token, output);
        }
      });
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/complete`, registered.agent_token, result);
    } catch (error) {
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/fail`, registered.agent_token, {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      runningTasks.delete(payload.task_id);
    }
  })();
});

ws.on("open", () => console.log(`Connected adapter stream for room ${config.room_id}`));
ws.on("close", () => console.log("Adapter stream closed"));
ws.on("error", (error) => console.error(error));