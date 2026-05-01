import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT.js";
import type { AgentImportView, ClaudeImportView, MessageView, StreamingTurnView } from "../room-state.js";

export interface ThreadProps {
  currentParticipantId: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  actorNames: Map<string, string>;
  showSlowStreamingNotice: boolean;
  activeCollectionId?: string;
  claudeImports?: ClaudeImportView[];
  agentImports?: AgentImportView[];
}

function messageClass(kind: string, actorId: string, currentParticipantId: string, collectionId: string | undefined, activeCollectionId: string | undefined): string {
  const isQueued = Boolean(collectionId) && collectionId === activeCollectionId;
  if (isQueued) return "message message-roundtable-queued";
  if (kind === "agent") return "message message-ai-card";
  if (kind === "system") return "message message-system-marker";
  if (actorId === currentParticipantId) return "message message-own";
  return "message message-human-other";
}

function roleLabel(kind: string, collectionId: string | undefined, activeCollectionId: string | undefined, t: ReturnType<typeof useT>): string {
  const isQueued = Boolean(collectionId) && collectionId === activeCollectionId;
  if (isQueued) return t("message.queued");
  switch (kind) {
    case "agent": return t("message.ai");
    case "system": return t("message.system");
    default: return t("message.human");
  }
}

export default function Thread({
  currentParticipantId,
  messages,
  streamingTurns,
  actorNames,
  showSlowStreamingNotice,
  activeCollectionId,
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
          const importView = agentImports?.find((imp) => imp.import_id === msg.agentImportId);
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
          const importView = agentImports?.find((imp) => imp.import_id === msg.agentImportId);
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
        let displayText = msg.text;
        if (msg.text === "__CACP_COLLECTION_CANCELLED__") {
          displayText = t("thread.collectionCancelled", { count: msg.cancelledMessageCount ?? 0 });
        } else if (msg.text === "__CACP_HISTORY_CLEARED__") {
          displayText = t("thread.historyCleared");
        }
        return (
          <article
            key={msg.message_id ?? `${msg.actor_id}-${msg.created_at}`}
            className={messageClass(msg.kind, msg.actor_id, currentParticipantId, msg.collection_id, activeCollectionId)}
          >
            <div className="message-meta">
              <span>{actorName}</span>
              <span>{roleLabel(msg.kind, msg.collection_id, activeCollectionId, t)}</span>
            </div>
            <div className="message-body">{displayText}</div>
          </article>
        );
      })}

      {streamingTurns.map((turn) => {
        const agentName = actorNames.get(turn.agent_id) ?? turn.agent_id;
        return (
          <article key={turn.turn_id} className="message message-ai-card streaming-bubble">
            <div className="message-meta">
              <span>{agentName}</span>
              <span>{t("message.ai")}</span>
            </div>
            <div className="streaming-status">{t("agent.status.streaming")}</div>
            {showSlowStreamingNotice && (
              <div className="message-body" style={{ marginTop: 4, color: "var(--ink-3)", fontSize: 13 }}>
                {t("agent.slowStreamingNotice")}
              </div>
            )}
            {turn.text && <div className="message-body">{turn.text}</div>}
          </article>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
