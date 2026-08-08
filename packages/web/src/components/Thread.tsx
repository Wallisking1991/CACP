import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AttachmentRef } from "@cacp/protocol";
import { useT } from "../i18n/useT.js";
import type {
  AgentImportView,
  AgentRunView,
  AgentView,
  ClaudeImportView,
  MessageView,
  StreamingTurnView,
} from "../room-state.js";
import { AgentRunCard } from "./AgentRunCard.js";

export interface ThreadProps {
  currentParticipantId: string;
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  agentRuns?: AgentRunView[];
  agents?: AgentView[];
  actorNames: Map<string, string>;
  claudeImports?: ClaudeImportView[];
  agentImports?: AgentImportView[];
  pendingAgentName?: string;
  loadAttachment?: (attachment: AttachmentRef) => Promise<Blob>;
  onResolveApproval?: (
    runId: string,
    nodeId: string,
    decision: "allow" | "deny",
    reason?: string
  ) => void;
  onResolveElicitation?: (
    runId: string,
    nodeId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>
  ) => void;
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function MessageAttachments({
  attachments,
  loadAttachment,
}: {
  attachments: AttachmentRef[];
  loadAttachment?: (attachment: AttachmentRef) => Promise<Blob>;
}) {
  const t = useT();
  const attachmentsRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined"
  );
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<string>();

  const hasInlineImage = attachments.some(
    (attachment) =>
      attachment.kind === "image" && attachment.disposition === "inline"
  );

  useEffect(() => {
    if (nearViewport || !hasInlineImage) return;
    const element = attachmentsRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "400px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasInlineImage, nearViewport]);

  useEffect(() => {
    if (!loadAttachment || !nearViewport) return;
    let cancelled = false;
    const urls: string[] = [];
    for (const attachment of attachments) {
      if (attachment.kind !== "image" || attachment.disposition !== "inline")
        continue;
      void loadAttachment(attachment)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setImageUrls((current) => ({
            ...current,
            [attachment.attachment_id]: url,
          }));
        })
        .catch(() => {
          if (!cancelled)
            setFailedImages(
              (current) => new Set([...current, attachment.attachment_id])
            );
        });
    }
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [attachments, loadAttachment, nearViewport]);

  async function download(attachment: AttachmentRef) {
    if (!loadAttachment || downloading) return;
    setDownloading(attachment.attachment_id);
    try {
      const blob = await loadAttachment(attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } finally {
      setDownloading(undefined);
    }
  }

  return (
    <div className="message-attachments" ref={attachmentsRef}>
      {attachments.map((attachment) => {
        const imageUrl = imageUrls[attachment.attachment_id];
        const isInlineImage =
          attachment.kind === "image" && attachment.disposition === "inline";
        return (
          <div
            className={`message-attachment${isInlineImage ? " message-attachment--image" : ""}`}
            key={attachment.attachment_id}
          >
            {isInlineImage && (
              <div className="message-attachment__preview-frame">
                {imageUrl ? (
                  <img
                    className="message-attachment__preview"
                    src={imageUrl}
                    alt={attachment.name}
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="message-attachment__preview-placeholder"
                    aria-hidden="true"
                  />
                )}
              </div>
            )}
            <div className="message-attachment__details">
              <span className="message-attachment__name">
                {attachment.name}
              </span>
              <span className="message-attachment__meta">
                {(attachment.size_bytes / 1024).toFixed(
                  attachment.size_bytes < 1024 * 1024 ? 0 : 1
                )}{" "}
                {attachment.size_bytes < 1024 * 1024 ? "KB" : "MB"}
                {failedImages.has(attachment.attachment_id)
                  ? ` · ${t("attachment.previewUnavailable")}`
                  : ""}
              </span>
            </div>
            <button
              type="button"
              className="message-attachment__download"
              aria-label={String(
                t("attachment.download", { name: attachment.name })
              )}
              title={String(
                t("attachment.download", { name: attachment.name })
              )}
              disabled={!loadAttachment || downloading !== undefined}
              onClick={() => void download(attachment)}
            >
              <DownloadIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function messageClass(
  kind: string,
  actorId: string,
  currentParticipantId: string
): string {
  if (kind === "agent") return "message message-ai-card";
  if (kind === "system") return "message message-system-marker";
  if (kind === "queued") return "message message-queued";
  if (actorId === currentParticipantId) return "message message-own";
  return "message message-human-other";
}

function roleLabel(kind: string, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "agent":
      return t("message.ai");
    case "system":
      return t("message.system");
    case "queued":
      return t("message.queued");
    default:
      return t("message.human");
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
  failed: "Failed",
};

function formatStatusLine(
  phase: string | undefined,
  current: string | undefined,
  metrics:
    { files_read?: number; searches?: number; commands?: number } | undefined
): string {
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

function formatSummary(
  detail: Record<string, unknown> | undefined,
  t: ReturnType<typeof useT>
): string {
  if (!detail) return "";
  const parts: string[] = [];
  const usage = detail.usage as Record<string, number> | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens > 0)
    parts.push(`${totalTokens.toLocaleString()} ${t("agent.summary.tokens")}`);
  const numTurns = typeof detail.num_turns === "number" ? detail.num_turns : 0;
  if (numTurns > 0) parts.push(`${numTurns} ${t("agent.summary.turns")}`);
  const durationMs =
    typeof detail.duration_ms === "number" ? detail.duration_ms : 0;
  if (durationMs > 0) parts.push(`${Math.round(durationMs / 1000)}s`);
  const cost =
    typeof detail.total_cost_usd === "number" ? detail.total_cost_usd : 0;
  if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(" · ");
}

function isToolPhase(phase: string | undefined): boolean {
  return (
    phase === "reading_files" ||
    phase === "searching" ||
    phase === "running_command"
  );
}

const SETTLED_HISTORY_PAGE_SIZE = 120;

export default function Thread({
  currentParticipantId,
  messages,
  streamingTurns,
  agentRuns = [],
  agents = [],
  actorNames,
  claudeImports,
  agentImports,
  pendingAgentName,
  loadAttachment,
  onResolveApproval,
  onResolveElicitation,
}: ThreadProps) {
  const t = useT();
  const threadRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const followsLatestRef = useRef(true);
  const historyRestoreRef = useRef<
    | {
        scrollHeight: number;
        scrollTop: number;
      }
    | undefined
  >(undefined);
  const [historyStartIndex, setHistoryStartIndex] = useState<number | null>(
    null
  );
  const { threadItems, visibleStreamingTurns, runningRuns } = useMemo(() => {
    const runTraceTurnIds = new Set(agentRuns.map((run) => run.turn_id));
    const runTraceMessageIds = new Set(
      agentRuns
        .map((run) => run.message_id)
        .filter((messageId): messageId is string => !!messageId)
    );
    const visibleMessages = messages.filter((msg) => {
      if (msg.kind !== "agent") return true;
      if (msg.turn_id && runTraceTurnIds.has(msg.turn_id)) return false;
      if (msg.message_id && runTraceMessageIds.has(msg.message_id))
        return false;
      return true;
    });
    const nextVisibleStreamingTurns = streamingTurns.filter(
      (turn) => !runTraceTurnIds.has(turn.turn_id)
    );
    const completedRuns = agentRuns.filter(
      (run) => run.status === "completed" || run.status === "failed"
    );
    const nextRunningRuns = agentRuns.filter((run) => run.status === "running");
    const nextThreadItems = [
      ...visibleMessages.map((msg) => ({
        type: "message" as const,
        data: msg,
        time: msg.created_at,
      })),
      ...completedRuns.map((run) => ({
        type: "run" as const,
        data: run,
        time: run.started_at,
      })),
    ].sort((a, b) => a.time.localeCompare(b.time));

    return {
      threadItems: nextThreadItems,
      visibleStreamingTurns: nextVisibleStreamingTurns,
      runningRuns: nextRunningRuns,
    };
  }, [agentRuns, messages, streamingTurns]);

  const latestHistoryStartIndex = Math.max(
    0,
    threadItems.length - SETTLED_HISTORY_PAGE_SIZE
  );
  const visibleHistoryStartIndex = Math.min(
    historyStartIndex ?? latestHistoryStartIndex,
    latestHistoryStartIndex
  );
  const hiddenSettledItemCount = visibleHistoryStartIndex;
  const visibleThreadItems = useMemo(
    () => threadItems.slice(visibleHistoryStartIndex),
    [threadItems, visibleHistoryStartIndex]
  );
  const settledScrollSignal = useMemo(() => {
    const item = threadItems.at(-1);
    if (!item) return "";
    return item.type === "message"
      ? `${item.data.message_id}:${item.data.kind}`
      : `${item.data.run_id}:${item.data.status}`;
  }, [threadItems]);
  const liveScrollSignal = useMemo(
    () =>
      [
        ...visibleStreamingTurns.map(
          (turn) =>
            `${turn.turn_id}:${turn.phase ?? ""}:${turn.text.length}:${turn.thinkingText?.length ?? 0}`
        ),
        ...runningRuns.map(
          (run) =>
            `${run.run_id}:${run.status}:${run.answer_text?.length ?? 0}:${run.final_text?.length ?? 0}:${run.nodes
              .map((node) => {
                const lastChunk = node.text_chunks.at(-1);
                return `${node.node_id}:${node.status}:${node.text_chunks.length}:${lastChunk?.length ?? 0}`;
              })
              .join(",")}`
        ),
      ].join("|"),
    [runningRuns, visibleStreamingTurns]
  );

  useEffect(() => {
    if (!followsLatestRef.current) return;
    const bottom = bottomRef.current;
    if (typeof bottom?.scrollIntoView !== "function") return;
    const behavior =
      visibleStreamingTurns.length > 0 ||
      runningRuns.length > 0 ||
      pendingAgentName
        ? "auto"
        : "smooth";
    if (typeof window.requestAnimationFrame !== "function") {
      bottom.scrollIntoView({ behavior });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (followsLatestRef.current) {
        bottom.scrollIntoView({ behavior });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    threadItems.length,
    settledScrollSignal,
    liveScrollSignal,
    pendingAgentName,
  ]);

  useLayoutEffect(() => {
    const restore = historyRestoreRef.current;
    const thread = threadRef.current;
    if (!restore || !thread) return;
    thread.scrollTop =
      restore.scrollTop + (thread.scrollHeight - restore.scrollHeight);
    historyRestoreRef.current = undefined;
  }, [hiddenSettledItemCount]);

  const isEmpty =
    threadItems.length === 0 &&
    visibleStreamingTurns.length === 0 &&
    runningRuns.length === 0 &&
    !pendingAgentName;

  return (
    <div
      className="thread"
      ref={threadRef}
      onScroll={() => {
        const thread = threadRef.current;
        if (!thread) return;
        const distanceFromBottom =
          thread.scrollHeight - thread.scrollTop - thread.clientHeight;
        const followsLatest = distanceFromBottom <= 48;
        followsLatestRef.current = followsLatest;
        setHistoryStartIndex((current) =>
          followsLatest ? null : (current ?? latestHistoryStartIndex)
        );
      }}
    >
      {isEmpty && (
        <div className="empty-thread">
          <h2>{t("thread.emptyHeadline")}</h2>
          <p>{t("thread.emptySubcopy")}</p>
        </div>
      )}

      {hiddenSettledItemCount > 0 && (
        <button
          type="button"
          className="thread-history-more"
          onClick={() => {
            const thread = threadRef.current;
            if (thread) {
              historyRestoreRef.current = {
                scrollHeight: thread.scrollHeight,
                scrollTop: thread.scrollTop,
              };
            }
            setHistoryStartIndex(
              Math.max(0, visibleHistoryStartIndex - SETTLED_HISTORY_PAGE_SIZE)
            );
          }}
        >
          {t("thread.showEarlier", {
            count: String(
              Math.min(hiddenSettledItemCount, SETTLED_HISTORY_PAGE_SIZE)
            ),
          })}
        </button>
      )}

      {visibleThreadItems.map((item) => {
        if (item.type === "run") {
          const run = item.data;
          const agent = agents.find((a) => a.agent_id === run.agent_id);
          return (
            <AgentRunCard
              key={run.run_id}
              run={run}
              agentName={actorNames.get(run.agent_id) ?? run.agent_id}
              thinkingEnabled={agent?.thinking_enabled !== false}
              onResolveApproval={onResolveApproval}
              onResolveElicitation={onResolveElicitation}
            />
          );
        }

        const msg = item.data;
        if (msg.kind === "claude_import_banner") {
          const importView = claudeImports?.find(
            (imp) => imp.import_id === msg.claudeImportId
          );
          const bannerText =
            importView?.status === "failed"
              ? t("claude.import.banner.failed", {
                  title: importView.title,
                  error: importView.error ?? "",
                })
              : importView?.status === "completed"
                ? t("claude.import.banner.completed", {
                    title: importView.title,
                    count: String(
                      importView.imported_message_count ??
                        importView.message_count
                    ),
                  })
                : t("claude.import.banner.started", {
                    title: importView?.title ?? "",
                  });
          return (
            <div
              key={msg.message_id}
              className={`message message--claude-import-banner ${importView?.status === "failed" ? "message--claude-import-banner--failed" : ""}`}
            >
              {bannerText}
            </div>
          );
        }

        if (msg.kind === "agent_import_banner") {
          const importView = agentImports?.find(
            (imp) => imp.import_id === msg.agentImportId
          );
          const provider =
            importView?.provider === "kimi-cli"
              ? "Kimi CLI"
              : importView?.provider === "codex-cli"
                ? "Codex CLI"
                : importView?.provider === "github-copilot"
                  ? "GitHub Copilot"
                  : importView?.provider === "claude-code"
                    ? "Claude Code"
                    : "Local agent";
          const bannerText =
            importView?.status === "failed"
              ? t("agent.import.banner.failed", {
                  provider,
                  title: importView.title,
                  error: importView.error ?? "",
                })
              : importView?.status === "completed"
                ? t("agent.import.banner.completed", {
                    provider,
                    title: importView.title,
                    count: String(
                      importView.imported_message_count ??
                        importView.message_count
                    ),
                  })
                : t("agent.import.banner.started", {
                    provider,
                    title: importView?.title ?? "",
                  });
          return (
            <div
              key={msg.message_id}
              className={`message message--agent-import-banner ${importView?.status === "failed" ? "message--agent-import-banner--failed" : ""}`}
            >
              {bannerText}
            </div>
          );
        }

        if (msg.kind.startsWith("claude_import_")) {
          const label =
            msg.kind === "claude_import_user"
              ? t("claude.import.user")
              : msg.kind === "claude_import_assistant"
                ? t("claude.import.assistant")
                : t("claude.import.tool");
          return (
            <article
              key={msg.message_id}
              className={`message message--${msg.kind}`}
            >
              <div className="message-meta">
                <span>{label}</span>
                <span>{t("claude.import.label")}</span>
              </div>
              <div className="message-body">{msg.text}</div>
            </article>
          );
        }

        if (msg.kind.startsWith("agent_import_")) {
          const importView = agentImports?.find(
            (imp) => imp.import_id === msg.agentImportId
          );
          const provider =
            importView?.provider === "kimi-cli"
              ? "Kimi CLI"
              : importView?.provider === "codex-cli"
                ? "Codex CLI"
                : importView?.provider === "github-copilot"
                  ? "GitHub Copilot"
                  : importView?.provider === "claude-code"
                    ? "Claude Code"
                    : "Local agent";
          const label =
            msg.kind === "agent_import_user"
              ? t("agent.import.user", { provider })
              : msg.kind === "agent_import_assistant"
                ? t("agent.import.assistant", { provider })
                : t("agent.import.tool", { provider });
          return (
            <article
              key={msg.message_id}
              className={`message message--${msg.kind}`}
            >
              <div className="message-meta">
                <span>{label}</span>
                <span>{t("agent.import.label")}</span>
              </div>
              <div className="message-body">{msg.text}</div>
            </article>
          );
        }

        const actorName = actorNames.get(msg.actor_id) ?? msg.actor_id;
        const baseClass = messageClass(
          msg.kind,
          msg.actor_id,
          currentParticipantId
        );
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
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments
                attachments={msg.attachments}
                loadAttachment={loadAttachment}
              />
            )}
            {msg.turnFailed && msg.turnError && (
              <div className="message-body">{msg.turnError}</div>
            )}
            {msg.kind === "agent" &&
              (msg.agentPhase || msg.agentSummary || msg.agentMetrics) && (
                <div className="turn-summary-footer">
                  {msg.agentPhase
                    ? `${msg.agentPhase}${msg.agentElapsed ? ` · ${msg.agentElapsed}` : ""}`
                    : ""}
                  {msg.agentSummary &&
                  msg.agentSummary.toLowerCase() !==
                    msg.agentPhase?.toLowerCase()
                    ? ` · ${msg.agentSummary}`
                    : ""}
                </div>
              )}
          </article>
        );
      })}

      {runningRuns.map((run) => {
        const agent = agents.find((a) => a.agent_id === run.agent_id);
        return (
          <AgentRunCard
            key={run.run_id}
            run={run}
            agentName={actorNames.get(run.agent_id) ?? run.agent_id}
            thinkingEnabled={agent?.thinking_enabled !== false}
            onResolveApproval={onResolveApproval}
            onResolveElicitation={onResolveElicitation}
          />
        );
      })}

      {visibleStreamingTurns.map((turn) => {
        const agentName = actorNames.get(turn.agent_id) ?? turn.agent_id;
        const statusLine = formatStatusLine(
          turn.phase,
          turn.current,
          turn.metrics
        );
        const elapsedSeconds =
          typeof turn.detail?.elapsed_time_seconds === "number"
            ? turn.detail.elapsed_time_seconds
            : 0;
        const memoryCount =
          typeof turn.detail?.memory_count === "number"
            ? turn.detail.memory_count
            : 0;
        return (
          <article
            key={turn.turn_id}
            className="message message-ai-card streaming-bubble"
          >
            <div className="message-meta">
              <span>{agentName}</span>
              <span>{t("message.ai")}</span>
            </div>
            <div className="streaming-status">
              {statusLine || t("agent.status.streaming")}
            </div>

            {isToolPhase(turn.phase) && (
              <div className="tool-progress-bar">
                <div className="tool-progress-bar__track">
                  <div
                    className="tool-progress-bar__fill"
                    style={{ width: "100%" }}
                  />
                </div>
                {elapsedSeconds > 0 && (
                  <span className="tool-progress-bar__elapsed">
                    {t("agent.tool.elapsed")} {elapsedSeconds}s
                  </span>
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
              <div className="turn-summary-footer">
                {formatSummary(turn.detail, t)}
              </div>
            )}
          </article>
        );
      })}

      {pendingAgentName && (
        <article className="message message-ai-card skeleton-bubble">
          <div className="message-meta">
            <span>{pendingAgentName}</span>
            <span>{t("message.ai")}</span>
          </div>
          <div className="skeleton-content">
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line--short" />
          </div>
        </article>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
