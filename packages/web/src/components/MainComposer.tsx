import { useState, useCallback, useRef } from "react";
import type {
  AgentInputCapabilities,
  AttachmentKind,
  AttachmentRef,
} from "@cacp/protocol";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import MentionDropdown from "./MentionDropdown.js";
import MentionOverlay from "./MentionOverlay.js";
import type { MentionItem } from "./MentionDropdown.js";
import type { MentionRange } from "./MentionOverlay.js";

export interface MainComposerProps {
  role: RoomSession["role"];
  turnInFlight: boolean;
  agents: Array<{ agent_id: string; name: string }>;
  agentReady?: boolean;
  attachmentCapabilities?: AgentInputCapabilities;
  onUploadAttachment?: (file: File) => Promise<AttachmentRef>;
  onSendMainInput: (
    text: string,
    attachments: AttachmentRef[]
  ) => Promise<void> | void;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
}

interface PendingAttachment {
  id: string;
  file: File;
  status: "pending" | "uploading" | "uploaded" | "failed";
  uploaded?: AttachmentRef;
}

const MaxAttachments = 5;
const MaxAttachmentBytes = 10 * 1024 * 1024;
const AcceptedExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "sql",
  "docx",
  "xlsx",
  "pptx",
]);

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function attachmentKind(file: File): AttachmentKind {
  const extension = extensionOf(file.name);
  if (
    ["png", "jpg", "jpeg", "gif", "webp"].includes(extension) ||
    (file.type.startsWith("image/") && extension !== "svg")
  )
    return "image";
  if (extension === "pdf") return "pdf";
  if (["docx", "xlsx", "pptx"].includes(extension)) return "office";
  if (AcceptedExtensions.has(extension) && extension !== "svg") return "text";
  return "file";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path
        d="M20.5 11.5 12 20a6 6 0 0 1-8.5-8.5l9-9a4 4 0 1 1 5.7 5.6l-9 9a2 2 0 0 1-2.9-2.8l8.4-8.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SendIcon({ queued }: { queued: boolean }) {
  return queued ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 7v5l3 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path
        d="m5 12 14-7-4.5 14-2.7-5.8L5 12Zm6.8 1.2L19 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function MainComposer({
  role,
  turnInFlight,
  agents,
  agentReady = true,
  attachmentCapabilities,
  onUploadAttachment,
  onSendMainInput,
  onTypingInput,
  onStopTyping,
}: MainComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const perms = roomPermissionsForRole(role);
  const canInput = perms.canSendMainInput && agentReady;
  const isQueued = turnInFlight;

  const mentionItems: MentionItem[] = agents.map((a) => ({
    id: a.agent_id,
    name: a.name,
    type: "agent",
  }));

  const mentions: MentionRange[] = [];
  const mentionRegex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    const agent = agents.find((a) => a.name === match![1]);
    if (agent) {
      mentions.push({
        start: match!.index,
        end: match!.index + match![0].length,
        type: "agent",
      });
    }
  }

  const addFiles = useCallback(
    (files: File[]) => {
      setAttachmentError("");
      const next: PendingAttachment[] = [];
      let error = "";
      for (const file of files) {
        if (attachments.length + next.length >= MaxAttachments) {
          error = String(t("mainComposer.attachmentTooMany"));
          break;
        }
        const extension = extensionOf(file.name);
        if (!AcceptedExtensions.has(extension)) {
          error = String(
            t("mainComposer.attachmentUnsupported", { name: file.name })
          );
          continue;
        }
        if (file.size <= 0 || file.size > MaxAttachmentBytes) {
          error = String(
            t("mainComposer.attachmentTooLarge", { name: file.name })
          );
          continue;
        }
        const kind = attachmentKind(file);
        if (attachmentCapabilities?.[kind] === "unsupported") {
          error = String(
            t("mainComposer.attachmentAgentUnsupported", { name: file.name })
          );
          continue;
        }
        const duplicate = [...attachments, ...next].some(
          (item) =>
            item.file.name === file.name &&
            item.file.size === file.size &&
            item.file.lastModified === file.lastModified
        );
        if (duplicate) continue;
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          status: "pending",
        });
      }
      if (next.length > 0) setAttachments((current) => [...current, ...next]);
      if (error) setAttachmentError(error);
    },
    [attachmentCapabilities, attachments, t]
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setAttachmentError("");
    setIsSending(true);
    try {
      const uploaded: AttachmentRef[] = [];
      for (const attachment of attachments) {
        if (attachment.uploaded) {
          uploaded.push(attachment.uploaded);
          continue;
        }
        if (!onUploadAttachment)
          throw new Error(
            String(t("mainComposer.attachmentUploadUnavailable"))
          );
        setAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id ? { ...item, status: "uploading" } : item
          )
        );
        try {
          const result = await onUploadAttachment(attachment.file);
          uploaded.push(result);
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id
                ? { ...item, status: "uploaded", uploaded: result }
                : item
            )
          );
        } catch (cause) {
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id ? { ...item, status: "failed" } : item
            )
          );
          throw cause;
        }
      }
      await onSendMainInput(trimmed, uploaded);
      setText("");
      setAttachments([]);
      setMentionActive(false);
      onStopTyping();
    } catch {
      setAttachmentError(String(t("mainComposer.attachmentUploadFailed")));
    } finally {
      setIsSending(false);
    }
  }, [
    attachments,
    isSending,
    onSendMainInput,
    onStopTyping,
    onUploadAttachment,
    t,
    text,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionActive) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => i + 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const filtered = mentionItems.filter((item) =>
            item.name.toLowerCase().includes(mentionQuery.toLowerCase())
          );
          const selected = filtered[mentionIndex % filtered.length];
          if (selected && textareaRef.current) {
            const cursorPos = textareaRef.current.selectionStart;
            const before = text.slice(0, cursorPos - mentionQuery.length - 1);
            const after = text.slice(cursorPos);
            const newText = before + "@" + selected.name + " " + after;
            setText(newText);
            setMentionActive(false);
            setMentionIndex(0);
          }
          return;
        }
        if (e.key === "Escape") {
          setMentionActive(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [mentionActive, mentionItems, mentionQuery, mentionIndex, text, handleSend]
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      const cursorPos = e.currentTarget.selectionStart;
      setText(value);
      onTypingInput(value);

      const beforeCursor = value.slice(0, cursorPos);
      const atIndex = beforeCursor.lastIndexOf("@");
      if (atIndex >= 0 && !beforeCursor.slice(atIndex + 1).includes(" ")) {
        const query = beforeCursor.slice(atIndex + 1);
        setMentionQuery(query);
        setMentionActive(true);
        setMentionIndex(0);
      } else {
        setMentionActive(false);
      }
    },
    [onTypingInput]
  );

  const composerClass = [
    "composer main-composer",
    isQueued ? "main-composer-queued" : "",
    isDragging ? "main-composer--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sendLabel = String(
    t(isQueued ? "mainComposer.queued" : "mainComposer.send")
  );
  const queuedHint = String(t("mainComposer.queuedHint"));

  return (
    <div
      className={composerClass}
      data-testid="main-composer"
      onDragEnter={(event) => {
        event.preventDefault();
        if (canInput) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (canInput) addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {attachments.length > 0 && (
        <div
          className="main-composer__attachments"
          aria-label={String(t("mainComposer.attachments"))}
        >
          {attachments.map((attachment) => {
            const mode =
              attachmentCapabilities?.[attachmentKind(attachment.file)];
            return (
              <div className="main-composer__attachment" key={attachment.id}>
                <span className="main-composer__attachment-name">
                  {attachment.file.name}
                </span>
                <span className="main-composer__attachment-meta">
                  {formatFileSize(attachment.file.size)}
                  {mode ? ` · ${t(`mainComposer.mode.${mode}` as never)}` : ""}
                  {attachment.status === "uploading"
                    ? ` · ${t("mainComposer.uploading")}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="main-composer__attachment-remove"
                  aria-label={String(
                    t("mainComposer.removeAttachment", {
                      name: attachment.file.name,
                    })
                  )}
                  disabled={isSending}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id)
                    )
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {attachmentError && (
        <div className="main-composer__error" role="alert">
          {attachmentError}
        </div>
      )}
      <div className="mention-overlay-wrapper composer-input-wrapper">
        <MentionOverlay text={text} mentions={mentions} />
        <textarea
          ref={textareaRef}
          className="input composer-input composer-input--with-floating-btn"
          placeholder={String(t("mainComposer.placeholder"))}
          aria-label={t("mainComposer.placeholder")}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length > 0) {
              event.preventDefault();
              addFiles(files);
            }
          }}
          disabled={!canInput}
          rows={2}
        />
        <input
          ref={fileInputRef}
          id="main-composer-attachment"
          data-testid="main-composer-attachment-input"
          className="visually-hidden"
          type="file"
          aria-label={String(t("mainComposer.addAttachment"))}
          multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.md,.markdown,.csv,.json,.jsonc,.yaml,.yml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.py,.rb,.rs,.go,.java,.kt,.kts,.c,.h,.cc,.cpp,.cxx,.hpp,.cs,.php,.sh,.bash,.zsh,.ps1,.sql,.docx,.xlsx,.pptx"
          disabled={!canInput || isSending}
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          className="composer-attachment-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canInput || isSending || attachments.length >= 5}
          aria-label={String(t("mainComposer.addAttachment"))}
          title={String(t("mainComposer.addAttachmentHint"))}
        >
          <PaperclipIcon />
        </button>
        <button
          type="button"
          className={`composer-send-floating${isQueued ? "" : " composer-send-floating--warm"}`}
          onClick={() => void handleSend()}
          disabled={!text.trim() || !canInput || isSending}
          aria-label={sendLabel}
          title={isQueued ? queuedHint : sendLabel}
        >
          <SendIcon queued={isQueued} />
        </button>
      </div>
      <div className="main-composer__hint" aria-live="polite">
        {isDragging
          ? t("mainComposer.dropFiles")
          : attachments.length > 0
            ? t("mainComposer.attachmentCount", {
                count: String(attachments.length),
              })
            : t("mainComposer.attachmentHint")}
      </div>
      {mentionActive && (
        <MentionDropdown
          items={mentionItems}
          query={mentionQuery}
          activeIndex={mentionIndex}
          onSelect={(id, name) => {
            const cursorPos =
              textareaRef.current?.selectionStart ?? text.length;
            const beforeCursor = text.slice(0, cursorPos);
            const atIndex = beforeCursor.lastIndexOf("@");
            if (atIndex >= 0) {
              const newText =
                text.slice(0, atIndex) +
                "@" +
                name +
                " " +
                text.slice(cursorPos);
              setText(newText);
            }
            setMentionActive(false);
            setMentionIndex(0);
            textareaRef.current?.focus();
          }}
          onClose={() => setMentionActive(false)}
        />
      )}
    </div>
  );
}
