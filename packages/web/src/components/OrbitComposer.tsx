import { useState, useCallback, useRef, useEffect } from "react";
import type { AttachmentRef } from "@cacp/protocol";
import { useT } from "../i18n/useT.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import type { RoomSession } from "../api.js";
import type {
  AttachmentUploadOptions,
  AttachmentUsage,
} from "../attachment-api.js";
import MentionDropdown from "./MentionDropdown.js";
import MentionOverlay from "./MentionOverlay.js";
import type { MentionItem } from "./MentionDropdown.js";
import type { MentionRange } from "./MentionOverlay.js";

export interface OrbitComposerProps {
  role: RoomSession["role"];
  members: Array<{ id: string; display_name: string; role: string }>;
  attachmentUsage?: AttachmentUsage;
  onUploadAttachment?: (
    file: File,
    options?: AttachmentUploadOptions
  ) => Promise<AttachmentRef>;
  onDeleteAttachment?: (attachment: AttachmentRef) => Promise<void>;
  onAttachmentUsageChanged?: () => void;
  onSendOrbitNote: (
    text: string,
    attachments: AttachmentRef[],
    replyTo?: string
  ) => Promise<void> | void;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  replyTo?: { noteId: string; authorName: string; text: string };
  onCancelReply?: () => void;
}

interface PendingAttachment {
  id: string;
  file: File;
  status:
    "pending" | "uploading" | "uploaded" | "failed" | "cancelled" | "deleting";
  progress: number;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
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

function SendIcon() {
  return (
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

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        d="M19 8v5h-5M5.5 16a7 7 0 0 0 12-3M5 11V6h5m8.5 2A7 7 0 0 0 6 11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function OrbitComposer({
  role,
  members,
  attachmentUsage,
  onUploadAttachment,
  onDeleteAttachment,
  onAttachmentUsageChanged,
  onSendOrbitNote,
  onTypingInput,
  onStopTyping,
  replyTo,
  onCancelReply,
}: OrbitComposerProps) {
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
  const cursorPosRef = useRef(0);
  const uploadControllersRef = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      for (const controller of uploadControllersRef.current.values()) {
        controller.abort();
      }
      uploadControllersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const perms = roomPermissionsForRole(role);
  const canInput = perms.canSendOrbitNotes;
  const mentionItems: MentionItem[] = members.map((member) => ({
    id: member.id,
    name: member.display_name,
    type: "member",
  }));
  const mentions: MentionRange[] = [];
  const mentionRegex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    const member = members.find(
      (candidate) => candidate.display_name === match![1]
    );
    if (member) {
      mentions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "user",
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
        if (!AcceptedExtensions.has(extensionOf(file.name))) {
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
          progress: 0,
        });
      }
      if (next.length > 0) setAttachments((current) => [...current, ...next]);
      if (error) setAttachmentError(error);
    },
    [attachments, t]
  );

  const uploadOne = useCallback(
    async (attachment: PendingAttachment): Promise<AttachmentRef> => {
      if (!onUploadAttachment)
        throw new Error(String(t("mainComposer.attachmentUploadUnavailable")));
      const controller = new AbortController();
      uploadControllersRef.current.set(attachment.id, controller);
      setAttachments((current) =>
        current.map((item) =>
          item.id === attachment.id
            ? {
                ...item,
                status: "uploading",
                progress: 0,
                uploaded: undefined,
              }
            : item
        )
      );
      try {
        const uploaded = await onUploadAttachment(attachment.file, {
          signal: controller.signal,
          onProgress: ({ percent }) => {
            setAttachments((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? { ...item, progress: percent }
                  : item
              )
            );
          },
        });
        setAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? { ...item, status: "uploaded", progress: 100, uploaded }
              : item
          )
        );
        onAttachmentUsageChanged?.();
        return uploaded;
      } catch (cause) {
        setAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: isAbortError(cause) ? "cancelled" : "failed",
                  progress: 0,
                }
              : item
          )
        );
        throw cause;
      } finally {
        uploadControllersRef.current.delete(attachment.id);
      }
    },
    [onAttachmentUsageChanged, onUploadAttachment, t]
  );

  const retryAttachment = useCallback(
    (attachment: PendingAttachment) => {
      setAttachmentError("");
      void uploadOne(attachment).catch((cause) => {
        setAttachmentError(
          String(
            t(
              isAbortError(cause)
                ? "mainComposer.attachmentUploadCancelled"
                : "mainComposer.attachmentUploadFailed"
            )
          )
        );
      });
    },
    [t, uploadOne]
  );

  const removeAttachment = useCallback(
    async (attachment: PendingAttachment) => {
      if (attachment.status === "uploading") {
        uploadControllersRef.current.get(attachment.id)?.abort();
        return;
      }
      if (attachment.uploaded && onDeleteAttachment) {
        setAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id ? { ...item, status: "deleting" } : item
          )
        );
        try {
          await onDeleteAttachment(attachment.uploaded);
          onAttachmentUsageChanged?.();
        } catch {
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id ? { ...item, status: "uploaded" } : item
            )
          );
          setAttachmentError(String(t("mainComposer.attachmentDeleteFailed")));
          return;
        }
      }
      setAttachments((current) =>
        current.filter((item) => item.id !== attachment.id)
      );
    },
    [onAttachmentUsageChanged, onDeleteAttachment, t]
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;
    setAttachmentError("");
    setIsSending(true);
    try {
      const uploaded: AttachmentRef[] = [];
      for (const attachment of attachments) {
        if (attachment.uploaded) uploaded.push(attachment.uploaded);
        else uploaded.push(await uploadOne(attachment));
      }
      await onSendOrbitNote(trimmed, uploaded, replyTo?.noteId);
      setText("");
      setAttachments([]);
      setMentionActive(false);
      onStopTyping();
    } catch (cause) {
      setAttachmentError(
        String(
          t(
            isAbortError(cause)
              ? "mainComposer.attachmentUploadCancelled"
              : "mainComposer.attachmentUploadFailed"
          )
        )
      );
    } finally {
      setIsSending(false);
    }
  }, [
    attachments,
    isSending,
    onSendOrbitNote,
    onStopTyping,
    replyTo,
    t,
    text,
    uploadOne,
  ]);

  const checkMention = useCallback((value: string, position: number) => {
    const beforeCursor = value.slice(0, position);
    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex >= 0 && !beforeCursor.slice(atIndex + 1).includes(" ")) {
      setMentionQuery(beforeCursor.slice(atIndex + 1));
      setMentionActive(true);
      setMentionIndex(0);
    } else {
      setMentionActive(false);
    }
  }, []);

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      const position = event.currentTarget.selectionStart ?? value.length;
      cursorPosRef.current = position;
      setText(value);
      onTypingInput(value);
      checkMention(value, position);
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          checkMention(
            textarea.value,
            textarea.selectionStart ?? textarea.value.length
          );
        }
      });
    },
    [checkMention, onTypingInput]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionActive) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMentionIndex((index) => index + 1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setMentionIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const filtered = mentionItems.filter((item) =>
            item.name.toLowerCase().includes(mentionQuery.toLowerCase())
          );
          const selected = filtered[mentionIndex % filtered.length];
          if (selected) {
            const position = cursorPosRef.current;
            setText(
              `${text.slice(0, position - mentionQuery.length - 1)}@${
                selected.name
              } ${text.slice(position)}`
            );
            setMentionActive(false);
          }
          return;
        }
        if (event.key === "Escape") {
          setMentionActive(false);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend, mentionActive, mentionIndex, mentionItems, mentionQuery, text]
  );

  return (
    <div
      className={`orbit-composer${isDragging ? " orbit-composer--dragging" : ""}`}
      data-testid="orbit-composer"
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
      {replyTo && (
        <div className="orbit-composer-reply-bar">
          <span className="orbit-composer-reply-bar__label">
            {t("orbitComposer.replyingTo")}
          </span>
          <span className="orbit-composer-reply-bar__name">
            {replyTo.authorName}
          </span>
          <span className="orbit-composer-reply-bar__preview">
            {replyTo.text}
          </span>
          <button
            type="button"
            className="orbit-composer-reply-bar__cancel"
            onClick={onCancelReply}
            aria-label={t("orbitComposer.cancelReply")}
            title={t("orbitComposer.cancelReply")}
          >
            <RemoveIcon />
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div
          className="main-composer__attachments orbit-composer__attachments"
          aria-label={String(t("mainComposer.attachments"))}
        >
          {attachments.map((attachment) => (
            <div className="main-composer__attachment" key={attachment.id}>
              <span className="main-composer__attachment-name">
                {attachment.file.name}
              </span>
              <span className="main-composer__attachment-meta">
                {formatFileSize(attachment.file.size)}
                {` · ${t(`mainComposer.status.${attachment.status}` as never)}`}
              </span>
              {attachment.status === "uploading" && (
                <progress
                  className="main-composer__attachment-progress"
                  aria-label={String(
                    t("mainComposer.uploadProgress", {
                      name: attachment.file.name,
                    })
                  )}
                  max={100}
                  value={attachment.progress}
                />
              )}
              <div className="main-composer__attachment-actions">
                {(attachment.status === "failed" ||
                  attachment.status === "cancelled") && (
                  <button
                    type="button"
                    className="main-composer__attachment-action"
                    aria-label={String(
                      t("mainComposer.retryAttachment", {
                        name: attachment.file.name,
                      })
                    )}
                    disabled={isSending}
                    onClick={() => retryAttachment(attachment)}
                  >
                    <RetryIcon />
                  </button>
                )}
                <button
                  type="button"
                  className="main-composer__attachment-action"
                  aria-label={String(
                    t(
                      attachment.status === "uploading"
                        ? "mainComposer.cancelUpload"
                        : "mainComposer.removeAttachment",
                      { name: attachment.file.name }
                    )
                  )}
                  disabled={
                    attachment.status === "deleting" ||
                    (isSending && attachment.status !== "uploading")
                  }
                  onClick={() => void removeAttachment(attachment)}
                >
                  <RemoveIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {attachmentUsage && (
        <div className="orbit-composer__storage" aria-live="polite">
          {t("mainComposer.storageSummary", {
            used: formatFileSize(attachmentUsage.used_bytes),
            max: formatFileSize(attachmentUsage.max_bytes),
          })}
          {" · "}
          {t("mainComposer.storageExpires")}
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
          placeholder={String(t("orbitComposer.placeholder"))}
          aria-label={t("orbitComposer.placeholder")}
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
          data-testid="orbit-composer-attachment-input"
          className="visually-hidden"
          type="file"
          aria-label={String(t("mainComposer.addAttachment"))}
          multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.md,.markdown,.csv,.json,.jsonc,.yaml,.yml,.toml,.xml,.html,.htm,.css,.scss,.less,.js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.py,.rb,.rs,.go,.java,.kt,.kts,.c,.h,.cc,.cpp,.cxx,.hpp,.cs,.php,.sh,.bash,.zsh,.ps1,.sql,.docx,.xlsx,.pptx"
          disabled={!canInput || !onUploadAttachment || isSending}
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          className="composer-attachment-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={
            !canInput ||
            !onUploadAttachment ||
            isSending ||
            attachments.length >= MaxAttachments
          }
          aria-label={String(t("mainComposer.addAttachment"))}
          title={String(t("mainComposer.addAttachmentHint"))}
        >
          <PaperclipIcon />
        </button>
        <button
          type="button"
          className="composer-send-floating composer-send-floating--warm"
          onClick={() => void handleSend()}
          disabled={
            (!text.trim() && attachments.length === 0) || !canInput || isSending
          }
          aria-label={t("orbitComposer.send")}
          title={t("orbitComposer.send")}
        >
          <SendIcon />
        </button>
      </div>
      <div className="orbit-composer__hint" aria-live="polite">
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
            const position = cursorPosRef.current;
            const beforeCursor = text.slice(0, position);
            const atIndex = beforeCursor.lastIndexOf("@");
            if (atIndex >= 0) {
              setText(
                `${text.slice(0, atIndex)}@${name} ${text.slice(position)}`
              );
            }
            setMentionActive(false);
            setMentionIndex(0);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onClose={() => setMentionActive(false)}
        />
      )}
    </div>
  );
}
