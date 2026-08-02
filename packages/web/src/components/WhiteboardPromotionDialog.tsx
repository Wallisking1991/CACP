import { useEffect, useRef, useState } from "react";

import {
  deleteAttachment,
  promoteWhiteboardSelection,
  uploadAttachment,
  WhiteboardOperationError,
  type RoomSession,
} from "../api.js";
import { useT } from "../i18n/useT.js";
import type { AgentView } from "../room-state.js";
import type { WhiteboardPromotionArtifacts } from "../whiteboard/whiteboard-editor-adapter.js";

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
  const idempotencyKey = useRef(newIdempotencyKey());

  if (!open || !artifacts) return null;

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
    const attachments = uploaded;
    setUploaded(undefined);
    void cleanupUploaded(attachments);
    onClose();
  };
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
            )
          );
          pngId = png.attachment_id;
          const source = await uploadAttachment(
            session,
            new File(
              [artifacts.source],
              `whiteboard-selection-r${expectedRevision}.excalidraw`,
              { type: "application/vnd.excalidraw+json" }
            )
          );
          attachments = {
            pngId,
            sourceId: source.attachment_id,
          };
          setUploaded(attachments);
        } catch (cause) {
          if (pngId) {
            await Promise.allSettled([deleteAttachment(session, pngId)]);
          }
          throw cause;
        }
      }
      await promoteWhiteboardSelection(session, {
        expected_revision: expectedRevision,
        selected_element_ids: [...artifacts.selectedElementIds],
        ...(artifacts.frameId ? { frame_id: artifacts.frameId } : {}),
        png_attachment_id: attachments.pngId,
        source_attachment_id: attachments.sourceId,
        agent_id: agent.agent_id,
        instruction: instruction.trim(),
        idempotency_key: idempotencyKey.current,
      });
      setUploaded(undefined);
      onPromoted?.();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof WhiteboardOperationError &&
          cause.code === "stale_revision"
          ? String(t("whiteboard.promotionStale"))
          : String(t("whiteboard.promotionError"))
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="whiteboard-recovery-backdrop">
      <section
        className="whiteboard-promotion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whiteboard-promotion-title"
      >
        <header>
          <div>
            <h2 id="whiteboard-promotion-title">
              {t("whiteboard.promotionTitle")}
            </h2>
            <p>{t("whiteboard.promotionDescription")}</p>
          </div>
          <button type="button" onClick={close} aria-label={t("common.close")}>
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
