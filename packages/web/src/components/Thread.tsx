import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT.js";
import type { AgentImportView, AgentRunView, ClaudeImportView, MessageView, StreamingTurnView } from "../room-state.js";
import { AgentRunCard } from "./AgentRunCard.js";

export interface ThreadProps {
  currentParticipantId: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  agentRuns?: AgentRunView[];
  actorNames: Map<string, string>;
  claudeImports?: ClaudeImportView[];
  agentImports?: AgentImportView[];
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

function messageClass(kind: string, actorId: string, currentParticipantId: string): string {
  if (kind === "agent") return "message message-ai-card";
  if (kind === "system") return "message message-system-marker";
  if (kind === "queued") return "message message-queued";
  if (actorId === currentParticipantId) return "message message-own";
  return "message message-human-other";
}

function roleLabel(kind: string, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "agent": return t("message.ai");
    case "system": return t("message.system");
    case "queued": return t("message.queued");
    default: return t("message.human");
  }
}

const phaseDisplayNames: Record<string, string> = {
  connecting: "Connecting",
  resuming_session: "Resuming session",
  importing_session: "Importing session",
  requesting_api: "Requesting API",
  retrying_api: "Retrying API",
  compacting_context: "Compacting context",
  recalling_memory: "Recalling memory",
  thinking: "Thinking",
  reading_files: "Reading files",
  searching: "Searching",
  running_command: "Running command",
  running_subagent: "Running subagent",
  executing_hook: "Executing hook",
  waiting_for_approval: "Waiting for approval",
  generating_answer: "Generating answer",
  completed: "Completed",
  failed: "Failed"
};

function formatStatusLine(phase: string | undefined, current: string | undefined, metrics: { files_read?: number; searches?: number; commands?: number } | undefined): string {
  const parts: string[] = [];
  if (phase) parts.push(phaseDisplayNames[phase] ?? phase);
  if (current) parts.push(current);
  if (metrics) {
    if (metrics.files_read) parts.push(`已读 ${metrics.files_read} 个文件`);
    if (metrics.searches) parts.push(`搜索 ${metrics.searches} 次`);
    if (metrics.commands) parts.push(`执行 ${metrics.commands} 个命令`);
  }
  return parts.join(" · ");
}

function formatSummary(detail: Record<string, unknown> | undefined, t: ReturnType<typeof useT>): string {
  if (!detail) return "";
  const parts: string[] = [];
  const usage = detail.usage as Record<string, number> | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens > 0) parts.push(`${totalTokens.toLocaleString()} ${t("agent.summary.tokens")}`);
  const numTurns = typeof detail.num_turns === "number" ? detail.num_turns : 0;
  if (numTurns > 0) parts.push(`${numTurns} ${t("agent.summary.turns")}`);
  const durationMs = typeof detail.duration_ms === "number" ? detail.duration_ms : 0;
  if (durationMs > 0) parts.push(`${Math.round(durationMs / 1000)}s`);
  const cost = typeof detail.total_cost_usd === "number" ? detail.total_cost_usd : 0;
  if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(" · ");
}

function isToolPhase(phase: string | undefined): boolean {
  return phase === "reading_files" || phase === "searching" || phase === "running_command";
}


export default function Thread({
  currentParticipantId,
  messages,
  streamingTurns,
  agentRuns = [],
  actorNames,
  claudeImports,
  agentImports,
  onResolveApproval,
  onResolveElicitation,
}: ThreadProps) {
  const t = useT();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, streamingTurns.length, streamingTurns.map((t) => t.text).join("|"), agentRuns.length, agentRuns.map((run) => `${run.run_id}:${run.status}:${run.nodes.map((node) => `${node.node_id}:${node.status}:${node.text_chunks.join("")}`).join(",")}`).join("|")]);

  const isEmpty = messages.length === 0 && streamingTurns.length === 0 && agentRuns.length === 0;

  return (
    <div className="thread">
      {isEmpty && (
        <div className="empty-thread">
          <h2>{t("thread.emptyHeadline")}</h2>
          <p>{t("thread.emptySubcopy")}</p>
        </div>
      )}

      {messages.map((msg) => {
        if (msg.kind === "claude_import_banner") {
          const importView = claudeImports?.find((imp) => imp.import_id === msg.claudeImportId);
          const bannerText = importView?.status === "failed"
            ? t("claude.import.banner.failed", { title: importView.title, error: importView.error ?? "" })
            : importView?.status === "completed"
              ? t("claude.import.banner.completed", { title: importView.title, count: String(importView.imported_message_count ?? importView.message_count) })
              : t("claude.import.banner.started", { title: importView?.title ?? "" });
          return (
            <div key={msg.message_id} className={`message message--claude-import-banner ${importView?.status === "failed" ? "message--claude-import-banner--failed" : ""}`}>
              {bannerText}
            </div>
          );
        }

        if (msg.kind === "agent_import_banner") {
          const importView = agentImports?.find((imp) => imp.agentImportId === msg.agentImportId);
          const provider = importView?.provider === "codex-cli" ? "Codex CLI" : importView?.provider === "claude-code" ? "Claude Code" : "Local agent";
          const bannerText = importView?.status === "failed"
            ? t("agent.import.banner.failed", { provider, title: importView.title, error: importView.error ?? "" })
            : importView?.status === "completed"
              ? t("agent.import.banner.completed", { provider, title: importView.title, count: String(importView.imported_message_count ?? importView.message_count) })
              : t("agent.import.banner.started", { provider, title: importView?.title ?? "" });
          return (
            <div key={msg.message_id} className={`message message--agent-import-banner ${importView?.status === "failed" ? "message--agent-import-banner--failed" : ""}`}>
              {bannerText}
            </div>
          );
        }

        if (msg.kind.startsWith("claude_import_")) {
          const label = msg.kind === "claude_import_user"
            ? t("claude.import.user")
            : msg.kind === "claude_import_assistant"
              ? t("claude.import.assistant")
              : t("claude.import.tool");
          return (
            <article key={msg.message_id} className={`message message--${msg.kind}`}>
              <div className="message-meta">
                <span>{label}</span>
                <span>{t("claude.import.label")}</span>
              </div>
              <div className="message-body">{msg.text}</div>
            </article>
          );
        }

        if (msg.kind.startsWith("agent_import_")) {
          const importView = agentImports?.find((imp) => imp.agentImportId === msg.agentImportId);
          const provider = importView?.provider === "codex-cli" ? "Codex CLI" : importView?.provider === "claude-code" ? "Claude Code" : "Local agent";
          const label = msg.kind === "agent_import_user"
            ? t("agent.import.user", { provider })
            : msg.kind === "agent_import_assistant"
              ? t("agent.import.assistant", { provider })
              : t("agent.import.tool", { provider });
          return (
            <article key={msg.message_id} className={`message message--${msg.kind}`}>
              <div className="message-meta">
                <span>{label}</span>
                <span>{t("agent.import.label")}</span>
              </div>
              <div className="message-body">{msg.text}</div>
            </article>
          );
        }

        const actorName = actorNames.get(msg.actor_id) ?? msg.actor_id;
        const baseClass = messageClass(msg.kind, msg.actor_id, currentParticipantId);
        const failedClass = msg.turnFailed ? " message--failed" : "";
        return (
          <article
            key={msg.message_id ?? `${msg.actor_id}-${msg.created_at}`}
            className={`${baseClass}${failedClass}`}
          >
            <div className="message-meta">
              <span>{actorName}</span>
              <span>{roleLabel(msg.kind, t)}</span>
            </div>
            <div className="message-body">{msg.text}</div>
            {msg.turnFailed && msg.turnError && (
              <div className="message-body">{msg.turnError}</div>
            )}
            {msg.kind === "agent" && (msg.agentPhase || msg.agentSummary || msg.agentMetrics) && (
              <div className="turn-summary-footer">
                {msg.agentPhase ? `${msg.agentPhase}${msg.agentElapsed ? ` · ${msg.agentElapsed}` : ""}` : ""}
                {msg.agentSummary && msg.agentSummary.toLowerCase() !== msg.agentPhase?.toLowerCase() ? ` · ${msg.agentSummary}` : ""}
              </div>
            )}
          </article>
        );
      })}

      {agentRuns.map((run) => (
        <AgentRunCard
          key={run.run_id}
          run={run}
          agentName={actorNames.get(run.agent_id) ?? run.agent_id}
          onResolveApproval={onResolveApproval}
          onResolveElicitation={onResolveElicitation}
        />
      ))}

      {streamingTurns.map((turn) => {
        const agentName = actorNames.get(turn.agent_id) ?? turn.agent_id;
        const statusLine = formatStatusLine(turn.phase, turn.current, turn.metrics);
        const elapsedSeconds = typeof turn.detail?.elapsed_time_seconds === "number" ? turn.detail.elapsed_time_seconds : 0;
        const memoryCount = typeof turn.detail?.memory_count === "number" ? turn.detail.memory_count : 0;
        return (
          <article key={turn.turn_id} className="message message-ai-card streaming-bubble">
            <div className="message-meta">
              <span>{agentName}</span>
              <span>{t("message.ai")}</span>
            </div>
            <div className="streaming-status">{statusLine || t("agent.status.streaming")}</div>

            {turn.thinkingText !== undefined && (
              <details className="thinking-accordion">
                <summary className="thinking-accordion__summary">
                  <span className={`thinking-accordion__pulse${turn.thinkingDone ? "" : " thinking-accordion__pulse--active"}`} />
                  <span>{t("agent.thinking.collapsed")}</span>
                </summary>
                <div className="thinking-accordion__content">{turn.thinkingText}</div>
              </details>
            )}

            {isToolPhase(turn.phase) && (
              <div className="tool-progress-bar">
                <div className="tool-progress-bar__track">
                  <div className="tool-progress-bar__fill" style={{ width: "100%" }} />
                </div>
                {elapsedSeconds > 0 && (
                  <span className="tool-progress-bar__elapsed">{t("agent.tool.elapsed")} {elapsedSeconds}s</span>
                )}
              </div>
            )}

            {turn.phase === "recalling_memory" && memoryCount > 0 && (
              <div className="memory-recall-pill">
                {t("agent.memory.recalled")} · {memoryCount}
              </div>
            )}

            {turn.text && <div className="message-body">{turn.text}</div>}

            {turn.phase === "completed" && turn.detail && (
              <div className="turn-summary-footer">{formatSummary(turn.detail, t)}</div>
            )}
          </article>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
