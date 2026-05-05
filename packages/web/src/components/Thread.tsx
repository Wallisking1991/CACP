import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT.js";
import type { AgentImportView, ClaudeImportView, MessageView, StreamingTurnView } from "../room-state.js";

export interface ThreadProps {
  currentParticipantId: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  actorNames: Map<string, string>;
  claudeImports?: ClaudeImportView[];
  agentImports?: AgentImportView[];
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
  thinking: "Thinking",
  reading_files: "Reading files",
  searching: "Searching",
  running_command: "Running command",
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


export default function Thread({
  currentParticipantId,
  messages,
  streamingTurns,
  actorNames,
  claudeImports,
  agentImports,
}: ThreadProps) {
  const t = useT();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, streamingTurns.length, streamingTurns.map((t) => t.text).join("|")]);

  const isEmpty = messages.length === 0 && streamingTurns.length === 0;

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
          </article>
        );
      })}

      {streamingTurns.map((turn) => {
        const agentName = actorNames.get(turn.agent_id) ?? turn.agent_id;
        const statusLine = formatStatusLine(turn.phase, turn.current, turn.metrics);
        return (
          <article key={turn.turn_id} className="message message-ai-card streaming-bubble">
            <div className="message-meta">
              <span>{agentName}</span>
              <span>{t("message.ai")}</span>
            </div>
            <div className="streaming-status">{statusLine || t("agent.status.streaming")}</div>
            {turn.text && <div className="message-body">{turn.text}</div>}
          </article>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
