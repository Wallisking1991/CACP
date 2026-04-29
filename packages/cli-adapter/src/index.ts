#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { CacpEventSchema } from "@cacp/protocol";
import { loadRuntimeConfigFromArgs } from "./config.js";
import { printConnectedBanner } from "./connected-banner.js";
import { runLlmTurn } from "./llm/runner.js";
import { sanitizeLlmError } from "./llm/sanitize.js";
import { handleFatalError } from "./fatal-error.js";
import { RoomClient, statusSummary } from "./room-client.js";
import { listClaudeSessions } from "./claude/session-catalog.js";
import { buildClaudeImportFromSessionMessages, chunkClaudeImportMessages } from "./claude/transcript-import.js";
import { ClaudeRuntime } from "./claude/runtime.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: cacp-cli-adapter [config.json]\n       cacp-cli-adapter --connect <connection_code>\n       cacp-cli-adapter --server <url> --pair <pairing_token>\n\nDouble-click without arguments to paste a CACP connection code.");
  process.exit(0);
}

async function postJson<T>(serverUrl: string, path: string, participantToken: string, body: unknown): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${participantToken}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function main() {
  const config = await loadRuntimeConfigFromArgs(process.argv.slice(2));

  const registered = config.registered_agent ?? await postJson<{ agent_id: string; agent_token: string }>(
    config.server_url,
    `/rooms/${config.room_id}/agents/register`,
    config.token!,
    {
      name: config.agent.name,
      capabilities: config.agent.capabilities
    }
  );
  console.log(`Registered ${config.agent.name} as ${registered.agent_id}`);

  const roomClient = new RoomClient({
    serverUrl: config.server_url,
    roomId: config.room_id,
    agentToken: registered.agent_token
  });

  const isClaudeCode = !config.llm && config.agent.capabilities.includes("claude-code");
  const turnStatusStartedAt = new Map<string, string>();
  const claudeRuntime = isClaudeCode ? new ClaudeRuntime({
    agentId: registered.agent_id,
    workingDir: config.agent.working_dir,
    permissionMode: config.permission_level ?? "read_only",
    model: config.agent.model ?? "claude-sonnet-4-20250514",
    publishDelta: async (turnId, chunk) => {
      await roomClient.publishTurnDelta(turnId, chunk);
    },
    publishStatus: async (turnId, status) => {
      const now = new Date().toISOString();
      const startedAt = turnStatusStartedAt.get(turnId) ?? now;
      turnStatusStartedAt.set(turnId, startedAt);
      await roomClient.publishRuntimeStatus("changed", {
        agent_id: registered.agent_id,
        turn_id: turnId,
        status_id: `status_${turnId}`,
        phase: status.phase,
        current: status.current,
        recent: status.recent,
        metrics: status.metrics,
        started_at: startedAt,
        updated_at: now
      });
    }
  }) : undefined;

  const streamUrl = new URL(`/rooms/${config.room_id}/stream`, config.server_url);
  streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
  streamUrl.searchParams.set("token", registered.agent_token);

  const ws = new WebSocket(streamUrl, { origin: config.server_url });
  const runningTasks = new Set<string>();

  async function handleMessage(raw: WebSocket.RawData): Promise<void> {
    try {
      const parsed = CacpEventSchema.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) return;

      if (parsed.data.type === "claude.session_preview.requested" && claudeRuntime) {
        const payload = parsed.data.payload as { preview_id?: string; agent_id?: string; session_id?: string };
        if (!payload.preview_id || !payload.session_id || payload.agent_id !== registered.agent_id) return;
        try {
          const previewResult = await buildClaudeImportFromSessionMessages({
            importId: payload.preview_id,
            agentId: registered.agent_id,
            workingDir: config.agent.working_dir,
            sessionId: payload.session_id,
            title: `Claude session ${payload.session_id.slice(0, 8)}`
          });
          for (const chunk of chunkClaudeImportMessages(previewResult.messages)) {
            await roomClient.uploadPreviewMessages(payload.preview_id, chunk.map((message) => {
              const { import_id: _importId, ...previewMessage } = message;
              return { ...previewMessage, preview_id: payload.preview_id! };
            }));
          }
          await roomClient.completePreview(payload.preview_id, {
            preview_id: payload.preview_id,
            agent_id: registered.agent_id,
            session_id: payload.session_id,
            previewed_message_count: previewResult.messages.length,
            completed_at: new Date().toISOString()
          });
        } catch (error) {
          await roomClient.failPreview(payload.preview_id, {
            preview_id: payload.preview_id,
            agent_id: registered.agent_id,
            session_id: payload.session_id,
            error: error instanceof Error ? error.message : String(error),
            failed_at: new Date().toISOString()
          });
        }
        return;
      }

      if (parsed.data.type === "claude.session_selected" && claudeRuntime) {
        const payload = parsed.data.payload as { agent_id?: string; mode?: string; session_id?: string };
        if (payload.agent_id !== registered.agent_id) return;
        if (payload.mode === "fresh") {
          const sessionId = await claudeRuntime.selectSession({ mode: "fresh" });
          await roomClient.publishSessionReady({
            agent_id: registered.agent_id,
            mode: "fresh",
            ...(sessionId ? { session_id: sessionId } : {}),
            ready_at: new Date().toISOString()
          });
          return;
        }
        if (payload.mode === "resume" && payload.session_id) {
          const importId = `import_${randomUUID()}`;
          const fallbackTitle = `Claude session ${payload.session_id.slice(0, 8)}`;
          let importClosed = false;
          try {
            const catalog = await listClaudeSessions({ workingDir: config.agent.working_dir });
            const selected = catalog.sessions.find((session) => session.session_id === payload.session_id);
            const importResult = await buildClaudeImportFromSessionMessages({
              importId,
              agentId: registered.agent_id,
              workingDir: config.agent.working_dir,
              sessionId: payload.session_id,
              title: selected?.title ?? fallbackTitle
            });
            const startedAt = new Date().toISOString();
            await roomClient.startImport({
              import_id: importId,
              agent_id: registered.agent_id,
              session_id: payload.session_id,
              title: importResult.title,
              message_count: importResult.messages.length,
              started_at: startedAt
            });
            for (const chunk of chunkClaudeImportMessages(importResult.messages)) {
              await roomClient.uploadImportMessages(importId, chunk);
            }
            await claudeRuntime.selectSession({ mode: "resume", sessionId: payload.session_id });
            await roomClient.completeImport(importId, {
              import_id: importId,
              agent_id: registered.agent_id,
              session_id: payload.session_id,
              imported_message_count: importResult.messages.length,
              completed_at: new Date().toISOString()
            });
            importClosed = true;
            await roomClient.publishSessionReady({
              agent_id: registered.agent_id,
              mode: "resume",
              session_id: payload.session_id,
              ready_at: new Date().toISOString()
            });
          } catch (error) {
            if (importClosed) throw error;
            await roomClient.failImport(importId, {
              import_id: importId,
              agent_id: registered.agent_id,
              session_id: payload.session_id,
              error: error instanceof Error ? error.message : String(error),
              failed_at: new Date().toISOString()
            });
            importClosed = true;
          }
        }
        return;
      }

      if (parsed.data.type === "task.created") {
        const payload = parsed.data.payload as { task_id?: string; target_agent_id?: string };
        if (payload.target_agent_id === registered.agent_id) {
          console.log("Ignoring task.created because this connector no longer runs generic local command tasks.");
        }
        return;
      }

      if (parsed.data.type === "agent.turn.requested") {
        const payload = parsed.data.payload as { turn_id?: string; agent_id?: string; context_prompt?: string; message_text?: string; room_name?: string; speaker_name?: string; speaker_role?: string; mode?: string };
        const turnText = payload.message_text ?? payload.context_prompt;
        if (!payload.turn_id || !turnText || payload.agent_id !== registered.agent_id || runningTasks.has(payload.turn_id)) return;
        runningTasks.add(payload.turn_id);
        let finalText = "";
        const turnId = payload.turn_id;
        try {
          if (config.llm) {
            await roomClient.startTurn(turnId);
            const result = await runLlmTurn({
              llm: config.llm,
              prompt: payload.context_prompt ?? payload.message_text ?? "",
              systemPrompt: config.agent.system_prompt,
              onDelta: async (chunk) => {
                finalText += chunk;
                await roomClient.publishTurnDelta(turnId, chunk);
              }
            });
            await roomClient.completeTurn(turnId, result.finalText);
          } else if (claudeRuntime) {
            const startedAt = Date.now();
            await roomClient.startTurn(turnId);
            const result = await claudeRuntime.runTurn({
              turnId,
              roomName: typeof payload.room_name === "string" ? payload.room_name : undefined,
              speakerName: typeof payload.speaker_name === "string" ? payload.speaker_name : "Room participant",
              speakerRole: typeof payload.speaker_role === "string" ? payload.speaker_role : "member",
              modeLabel: typeof payload.mode === "string" ? payload.mode : "normal",
              text: turnText
            });
            await roomClient.publishRuntimeStatus("completed", {
              agent_id: registered.agent_id,
              turn_id: turnId,
              status_id: `status_${turnId}`,
              summary: statusSummary({ elapsedMs: Date.now() - startedAt, metrics: result.metrics }),
              metrics: result.metrics,
              completed_at: new Date().toISOString()
            });
            await roomClient.completeTurn(turnId, result.finalText);
          }
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : String(error);
          const displayError = config.llm ? sanitizeLlmError(rawMessage, config.llm.apiKey) : rawMessage;
          console.error("Adapter turn failed", displayError);
          try {
            if (claudeRuntime) {
              await roomClient.publishRuntimeStatus("failed", {
                agent_id: registered.agent_id,
                turn_id: turnId,
                status_id: `status_${turnId}`,
                error: displayError,
                metrics: { files_read: 0, searches: 0, commands: 0 },
                failed_at: new Date().toISOString()
              });
            }
            await roomClient.failTurn(turnId, displayError);
          } catch (reportError) {
            console.error("Adapter failed to report turn failure", reportError);
          }
        } finally {
          turnStatusStartedAt.delete(turnId);
          runningTasks.delete(turnId);
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

  ws.on("open", () => {
    printConnectedBanner({
      roomId: config.room_id,
      agentName: config.agent.name,
      workingDir: config.agent.working_dir,
      claudeSessionMode: isClaudeCode ? "pending-selection" : "not-applicable"
    });
    console.log(`Connected adapter stream for room ${config.room_id}`);
    if (isClaudeCode) {
      void listClaudeSessions({ workingDir: config.agent.working_dir })
        .then((catalog) => roomClient.publishCatalog({
          agent_id: registered.agent_id,
          working_dir: catalog.workingDir,
          sessions: catalog.sessions
        }))
        .catch((error) => {
          console.error("Failed to publish Claude session catalog", error instanceof Error ? error.message : String(error));
        });
    }
  });
  ws.on("close", (code, reason) => {
    const reasonText = reason.toString();
    console.log(`Adapter stream closed${reasonText ? `: ${reasonText}` : ""}`);
    if (code === 4001 || reasonText === "participant_removed") {
      console.log("This local Agent session was removed by the room owner.");
    }
    void claudeRuntime?.close().catch((error) => {
      console.error("Failed to close Claude session", error);
    });
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 25).unref();
  });
  ws.on("error", (error) => console.error(error));
}

void main().catch((error) => handleFatalError(error));
