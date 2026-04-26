import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT.js";
import type { MessageView, StreamingTurnView } from "../room-state.js";

export interface ThreadProps {
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  actorNames: Map<string, string>;
  showSlowStreamingNotice: boolean;
  activeCollectionId?: string;
}

function messageClass(kind: string, collectionId: string | undefined, activeCollectionId: string | undefined): string {
  const base = "message";
  const isQueued = Boolean(collectionId) && collectionId === activeCollectionId;
  if (isQueued) return `${base} message-queued`;
  switch (kind) {
    case "agent": return `${base} message-agent`;
    case "system": return `${base} message-system`;
    default: return `${base} message-human`;
  }
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
  messages,
  streamingTurns,
  actorNames,
  showSlowStreamingNotice,
  activeCollectionId,
}: ThreadProps) {
  const t = useT();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
        const actorName = actorNames.get(msg.actor_id) ?? msg.actor_id;
        const displayText = msg.text === "__CACP_COLLECTION_CANCELLED__"
          ? t("thread.collectionCancelled", { count: msg.cancelledMessageCount ?? 0 })
          : msg.text;
        return (
          <article
            key={msg.message_id ?? `${msg.actor_id}-${msg.created_at}`}
            className={messageClass(msg.kind, msg.collection_id, activeCollectionId)}
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
          <article key={turn.turn_id} className="message message-agent streaming-bubble">
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
