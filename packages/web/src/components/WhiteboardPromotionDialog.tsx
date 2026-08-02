import { useEffect, useRef, useState } from "react";

import {
  cancelAttachmentUpload,
  deleteAttachment,
  promoteWhiteboardSelection,
  uploadAttachment,
  WhiteboardOperationError,
  type RoomSession,
} from "../api.js";
import { useT } from "../i18n/useT.js";
import type { AgentView } from "../room-state.js";
import type { WhiteboardPromotionArtifacts } from "../whiteboard/whiteboard-editor-adapter.js";
import { useDialogKeyboard } from "./useDialogKeyboard.js";

interface UploadedPromotionAttachments {
  pngId: string;
  sourceId: string;
}

export interface WhiteboardPromotionDialogProps {
  open: boolean;
  session: RoomSession;
  artifacts?: WhiteboardPromotionArtifacts;
  expectedRevision?: number;
  agent?: AgentView;
  onClose(): void;
  onPromoted?(): void;
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function"
    ? `whiteboard-promotion-${crypto.randomUUID()}`
    : `whiteboard-promotion-${Date.now()}-${Math.random()}`;
}

export function WhiteboardPromotionDialog({
  open,
  session,
  artifacts,
  expectedRevision,
  agent,
  onClose,
  onPromoted,
}: WhiteboardPromotionDialogProps) {
  const t = useT();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [uploaded, setUploaded] = useState<UploadedPromotionAttachments>();
  const [operationKeys] = useState(() => {
    const promotion = newIdempotencyKey();
    return {
      promotion,
      png: `${promotion}:png`,
      source: `${promotion}:source`,
    };
  });
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(false);
  const completedRef = useRef(false);
  const activeSessionKeyRef = useRef("");
  const uploadedRef = useRef<UploadedPromotionAttachments | undefined>(
    undefined
  );
  const dialogRef = useRef<HTMLElement>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  const capabilities = agent?.input_capabilities;
  const capabilityReady = Boolean(
    agent &&
    agent.status !== "offline" &&
    capabilities &&
    capabilities.image !== "unsupported" &&
    capabilities.text !== "unsupported" &&
    capabilities.max_attachments >= 2
  );
  const cleanupUploaded = async (
    attachments: UploadedPromotionAttachments | undefined
  ) => {
    if (!attachments) return;
    await Promise.allSettled(
      [attachments.pngId, attachments.sourceId].map((attachmentId) =>
        deleteAttachment(session, attachmentId)
      )
    );
  };
  const close = () => {
    if (submitting) return;
    const attachments = uploaded;
    setUploaded(undefined);
    uploadedRef.current = undefined;
    abortControllerRef.current?.abort();
    void Promise.allSettled([
      cancelAttachmentUpload(session, operationKeys.png),
      cancelAttachmentUpload(session, operationKeys.source),
    ]);
    void cleanupUploaded(attachments);
    onClose();
  };

  useDialogKeyboard(
    dialogRef,
    open && Boolean(artifacts),
    () => {
      if (!submitting) close();
    },
    instructionRef
  );

  useEffect(() => {
    const cleanupSession = {
      room_id: session.room_id,
      token: session.token,
    };
    const sessionKey = `${session.room_id}\u0000${session.token}`;
    activeSessionKeyRef.current = sessionKey;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      queueMicrotask(() => {
        const strictModeReplay =
          mountedRef.current && activeSessionKeyRef.current === sessionKey;
        if (strictModeReplay || completedRef.current) return;
        const attachments = uploadedRef.current;
        uploadedRef.current = undefined;
        void Promise.allSettled([
          cancelAttachmentUpload(cleanupSession, operationKeys.png),
          cancelAttachmentUpload(cleanupSession, operationKeys.source),
          ...(attachments
            ? [
                deleteAttachment(cleanupSession, attachments.pngId),
                deleteAttachment(cleanupSession, attachments.sourceId),
              ]
            : []),
        ]);
      });
    };
  }, [operationKeys, session.room_id, session.token]);

  if (!open || !artifacts) return null;

  const submit = async () => {
    if (
      submitting ||
      !capabilityReady ||
      !agent ||
      expectedRevision === undefined ||
      instruction.trim().length === 0
    ) {
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let attachments = uploaded;
    try {
      if (!attachments) {
        let pngId: string | undefined;
        try {
          const png = await uploadAttachment(
            session,
            new File(
              [artifacts.png],
              `whiteboard-selection-r${expectedRevision}.png`,
              { type: "image/png" }
            ),
            {
              idempotencyKey: operationKeys.png,
              signal: abortController.signal,
            }
          );
          pngId = png.attachment_id;
          const source = await uploadAttachment(
            session,
            new File(
              [artifacts.source],
              `whiteboard-selection-r${expectedRevision}.excalidraw`,
              { type: "application/vnd.excalidraw+json" }
            ),
            {
              idempotencyKey: operationKeys.source,
              signal: abortController.signal,
            }
          );
          attachments = {
            pngId,
            sourceId: source.attachment_id,
          };
          uploadedRef.current = attachments;
          if (mountedRef.current) setUploaded(attachments);
        } catch (cause) {
          if (pngId) {
            await Promise.allSettled([deleteAttachment(session, pngId)]);
          }
          throw cause;
        }
      }
      await promoteWhiteboardSelection(
        session,
        {
          expected_revision: expectedRevision,
          selected_element_ids: [...artifacts.selectedElementIds],
          ...(artifacts.frameId ? { frame_id: artifacts.frameId } : {}),
          png_attachment_id: attachments.pngId,
          source_attachment_id: attachments.sourceId,
          agent_id: agent.agent_id,
          instruction: instruction.trim(),
          idempotency_key: operationKeys.promotion,
        },
        { signal: abortController.signal }
      );
      completedRef.current = true;
      uploadedRef.current = undefined;
      if (mountedRef.current) setUploaded(undefined);
      onPromoted?.();
      onClose();
    } catch (cause) {
      if (mountedRef.current && !abortController.signal.aborted) {
        setError(
          cause instanceof WhiteboardOperationError &&
            cause.code === "stale_revision"
            ? String(t("whiteboard.promotionStale"))
            : String(t("whiteboard.promotionError"))
        );
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = undefined;
      }
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <div className="whiteboard-recovery-backdrop">
      <section
        ref={dialogRef}
        className="whiteboard-promotion-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="whiteboard-promotion-title"
      >
        <header>
          <div>
            <h2 id="whiteboard-promotion-title">
              {t("whiteboard.promotionTitle")}
            </h2>
            <p>{t("whiteboard.promotionDescription")}</p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={close}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </header>

        <div className="whiteboard-promotion-dialog__content">
          <PromotionPreview png={artifacts.png} />
          <dl className="whiteboard-promotion-dialog__details">
            <div>
              <dt>{t("whiteboard.promotionSource")}</dt>
              <dd>.excalidraw</dd>
            </div>
            <div>
              <dt>{t("whiteboard.promotionTarget")}</dt>
              <dd>{agent?.name ?? t("whiteboard.promotionNoAgent")}</dd>
            </div>
            <div>
              <dt>{t("whiteboard.promotionRevision")}</dt>
              <dd>{expectedRevision ?? "—"}</dd>
            </div>
          </dl>
          <p
            className={
              capabilityReady
                ? "whiteboard-promotion-dialog__capability"
                : "whiteboard-promotion-dialog__capability whiteboard-promotion-dialog__capability--error"
            }
            role={capabilityReady ? "status" : "alert"}
          >
            {t(
              capabilityReady
                ? "whiteboard.promotionCapabilityReady"
                : "whiteboard.promotionCapabilityUnsupported"
            )}
          </p>
          <label>
            <span>{t("whiteboard.promotionInstruction")}</span>
            <textarea
              ref={instructionRef}
              value={instruction}
              maxLength={4000}
              rows={4}
              disabled={submitting}
              onChange={(event) => setInstruction(event.currentTarget.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>

        <footer>
          <button type="button" disabled={submitting} onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              submitting ||
              !capabilityReady ||
              expectedRevision === undefined ||
              instruction.trim().length === 0
            }
            onClick={() => void submit()}
          >
            {t(
              submitting
                ? "whiteboard.promotionSubmitting"
                : "whiteboard.promotionSubmit"
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}

function PromotionPreview({ png }: { png: Blob }) {
  const t = useT();
  const [url] = useState(() => URL.createObjectURL(png));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <img
      className="whiteboard-promotion-dialog__preview"
      src={url}
      alt={String(t("whiteboard.promotionPreview"))}
    />
  );
}
