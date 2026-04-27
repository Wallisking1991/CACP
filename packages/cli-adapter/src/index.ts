#!/usr/bin/env node
import WebSocket from "ws";
import { CacpEventSchema } from "@cacp/protocol";
import { loadRuntimeConfigFromArgs } from "./config.js";
import { runCommandForTask } from "./runner.js";
import { taskReportForExitCode } from "./task-result.js";
import { appendTurnOutput, turnCompleteBody } from "./turn-result.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: cacp-cli-adapter [config.json]\n       cacp-cli-adapter --server http://127.0.0.1:3737 --pair <pairing_token>\n\nRuns a trusted local CLI command for assigned CACP tasks or paired agent turns.");
  process.exit(0);
}

const config = await loadRuntimeConfigFromArgs(process.argv.slice(2));

async function postJson<T>(path: string, participantToken: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.server_url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${participantToken}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as T;
}

const registered = config.registered_agent ?? await postJson<{ agent_id: string; agent_token: string }>(`/rooms/${config.room_id}/agents/register`, config.token!, {
  name: config.agent.name,
  capabilities: config.agent.capabilities
});
console.log(`Registered ${config.agent.name} as ${registered.agent_id}`);

const streamUrl = new URL(`/rooms/${config.room_id}/stream`, config.server_url);
streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
streamUrl.searchParams.set("token", registered.agent_token);

const ws = new WebSocket(streamUrl);
const runningTasks = new Set<string>();

async function handleMessage(raw: WebSocket.RawData): Promise<void> {
  try {
    const parsed = CacpEventSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) return;
    if (parsed.data.type === "task.created") {
      const payload = parsed.data.payload as { task_id?: string; target_agent_id?: string; prompt?: string };
      if (!payload.task_id || !payload.prompt || payload.target_agent_id !== registered.agent_id || runningTasks.has(payload.task_id)) return;
      runningTasks.add(payload.task_id);
      try {
        await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/start`, registered.agent_token, {});
        const taskPrompt = config.agent.system_prompt ? `${config.agent.system_prompt}\n\n${payload.prompt}` : payload.prompt;
        const result = await runCommandForTask({
          command: config.agent.command,
          args: config.agent.args,
          working_dir: config.agent.working_dir,
          prompt: taskPrompt,
          onOutput: async (output) => {
            await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/output`, registered.agent_token, output);
          }
        });
        const report = taskReportForExitCode(result);
        await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/${report.action}`, registered.agent_token, report.body);
      } catch (error) {
        console.error("Adapter task failed", error);
        try {
          await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/fail`, registered.agent_token, {
            error: error instanceof Error ? error.message : String(error)
          });
        } catch (reportError) {
          console.error("Adapter failed to report task failure", reportError);
        }
      } finally {
        runningTasks.delete(payload.task_id);
      }
      return;
    }

    if (parsed.data.type === "agent.turn.requested") {
      const payload = parsed.data.payload as { turn_id?: string; agent_id?: string; context_prompt?: string };
      if (!payload.turn_id || !payload.context_prompt || payload.agent_id !== registered.agent_id || runningTasks.has(payload.turn_id)) return;
      runningTasks.add(payload.turn_id);
      let finalText = "";
      try {
        await postJson(`/rooms/${config.room_id}/agent-turns/${payload.turn_id}/start`, registered.agent_token, {});
        const turnPrompt = config.agent.system_prompt ? `${config.agent.system_prompt}\n\n${payload.context_prompt}` : payload.context_prompt;
        const result = await runCommandForTask({
          command: config.agent.command,
          args: config.agent.args,
          working_dir: config.agent.working_dir,
          prompt: turnPrompt,
          onOutput: async (output) => {
            finalText = appendTurnOutput(finalText, output);
            await postJson(`/rooms/${config.room_id}/agent-turns/${payload.turn_id}/delta`, registered.agent_token, { chunk: output.chunk });
          }
        });
        if (result.exit_code === 0) {
          await postJson(`/rooms/${config.room_id}/agent-turns/${payload.turn_id}/complete`, registered.agent_token, turnCompleteBody(finalText, result.exit_code));
        } else {
          await postJson(`/rooms/${config.room_id}/agent-turns/${payload.turn_id}/fail`, registered.agent_token, {
            error: `command exited with code ${result.exit_code}`,
            exit_code: result.exit_code
          });
        }
      } catch (error) {
        console.error("Adapter turn failed", error);
        try {
          await postJson(`/rooms/${config.room_id}/agent-turns/${payload.turn_id}/fail`, registered.agent_token, {
            error: error instanceof Error ? error.message : String(error)
          });
        } catch (reportError) {
          console.error("Adapter failed to report turn failure", reportError);
        }
      } finally {
        runningTasks.delete(payload.turn_id);
      }
    }
  } catch (error) {
    console.error("Ignoring malformed adapter stream message", error);
  }
}

ws.on("message", (raw) => {
  void handleMessage(raw).catch((error) => {
    console.error("Adapter message handling failed", error);
  });
});

ws.on("open", () => console.log(`Connected adapter stream for room ${config.room_id}`));
ws.on("close", () => console.log("Adapter stream closed"));
ws.on("error", (error) => console.error(error));
