import { useEffect, useState } from "react";
import type {
  WhiteboardSnapshot,
  WhiteboardSnapshotList,
} from "@cacp/protocol";
import {
  clearWhiteboard,
  fetchWhiteboardSnapshots,
  restoreWhiteboardSnapshot,
  WhiteboardOperationError,
  type RoomSession,
} from "../api.js";
import { useT } from "../i18n/useT.js";

type PendingRecovery =
  { type: "clear" } | { type: "restore"; snapshot: WhiteboardSnapshot };

export interface WhiteboardRecoveryDialogProps {
  langCode: "en" | "zh";
  open: boolean;
  session: RoomSession;
  onClose(): void;
}

export function WhiteboardRecoveryDialog({
  langCode,
  open,
  session,
  onClose,
}: WhiteboardRecoveryDialogProps) {
  const t = useT();
  const [snapshotList, setSnapshotList] = useState<WhiteboardSnapshotList>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingRecovery>();
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<
    { kind: "load" | "mutation" } | { kind: "stale"; revision: number | "?" }
  >();

  const loadSnapshots = async (clearError = true) => {
    setLoading(true);
    setSnapshotList(undefined);
    if (clearError) setError(undefined);
    try {
      setSnapshotList(await fetchWhiteboardSnapshots(session));
    } catch {
      setError({ kind: "load" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchWhiteboardSnapshots({
      room_id: session.room_id,
      participant_id: session.participant_id,
      token: session.token,
      role: session.role,
    })
      .then((listed) => {
        if (cancelled) return;
        setSnapshotList(listed);
        setError(undefined);
      })
      .catch(() => {
        if (!cancelled) setError({ kind: "load" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    session.participant_id,
    session.role,
    session.room_id,
    session.token,
  ]);

  if (!open) return null;

  const currentRevision = snapshotList?.current_revision;
  const confirm = async () => {
    if (!pending || currentRevision === undefined) return;
    setMutating(true);
    setError(undefined);
    try {
      if (pending.type === "clear") {
        await clearWhiteboard(session, currentRevision);
      } else {
        await restoreWhiteboardSnapshot(
          session,
          pending.snapshot.snapshot_id,
          currentRevision
        );
      }
      setPending(undefined);
      await loadSnapshots();
    } catch (cause) {
      setPending(undefined);
      if (
        cause instanceof WhiteboardOperationError &&
        cause.code === "stale_revision"
      ) {
        setError({
          kind: "stale",
          revision: cause.currentRevision ?? "?",
        });
        await loadSnapshots(false);
      } else {
        setError({ kind: "mutation" });
      }
    } finally {
      setMutating(false);
    }
  };

  return (
    <div className="whiteboard-recovery-backdrop">
      <section
        className="whiteboard-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whiteboard-recovery-title"
      >
        <header>
          <div>
            <h2 id="whiteboard-recovery-title">
              {t("whiteboard.recoveryTitle")}
            </h2>
            {currentRevision !== undefined && (
              <p>
                {t("whiteboard.currentRevision", {
                  revision: currentRevision,
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setPending(undefined);
              onClose();
            }}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </header>

        {loading && <p role="status">{t("whiteboard.recoveryLoading")}</p>}
        {error && (
          <p role="alert">
            {error.kind === "stale"
              ? t("whiteboard.recoveryStale", {
                  revision: error.revision,
                })
              : t(
                  error.kind === "load"
                    ? "whiteboard.recoveryLoadError"
                    : "whiteboard.recoveryMutationError"
                )}
          </p>
        )}
        {snapshotList && (
          <>
            <div className="whiteboard-recovery-dialog__actions">
              <button
                type="button"
                className="danger"
                disabled={loading || mutating}
                onClick={() => setPending({ type: "clear" })}
              >
                {t("whiteboard.clearBoard")}
              </button>
            </div>
            {snapshotList.snapshots.length === 0 ? (
              <p>{t("whiteboard.noSnapshots")}</p>
            ) : (
              <ul className="whiteboard-recovery-list">
                {snapshotList.snapshots.map((snapshot) => (
                  <li key={snapshot.snapshot_id}>
                    <div>
                      <strong>
                        {t("whiteboard.snapshotRevision", {
                          revision: snapshot.revision,
                        })}
                      </strong>
                      <span>
                        {new Intl.DateTimeFormat(
                          langCode === "zh" ? "zh-CN" : "en",
                          { dateStyle: "medium", timeStyle: "medium" }
                        ).format(new Date(snapshot.created_at))}
                      </span>
                      <span>
                        {t(
                          snapshot.reason === "pre_operation"
                            ? "whiteboard.snapshotPreOperation"
                            : "whiteboard.snapshotAutomatic"
                        )}
                        {" · "}
                        {t("whiteboard.snapshotElements", {
                          count: snapshot.element_count,
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={loading || mutating}
                      onClick={() => setPending({ type: "restore", snapshot })}
                      aria-label={t("whiteboard.restoreRevision", {
                        revision: snapshot.revision,
                      })}
                    >
                      {t("whiteboard.restore")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {pending && currentRevision !== undefined && (
          <div
            className="whiteboard-recovery-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="whiteboard-recovery-confirm-title"
          >
            <h3 id="whiteboard-recovery-confirm-title">
              {t(
                pending.type === "clear"
                  ? "whiteboard.confirmClearTitle"
                  : "whiteboard.confirmRestoreTitle"
              )}
            </h3>
            <p>
              {t("whiteboard.confirmCurrent", { revision: currentRevision })}
            </p>
            <p>
              {pending.type === "clear"
                ? t("whiteboard.confirmClearTarget", {
                    revision: currentRevision + 1,
                  })
                : t("whiteboard.confirmRestoreTarget", {
                    target: pending.snapshot.revision,
                    revision: currentRevision + 1,
                  })}
            </p>
            <p>
              {t(
                pending.type === "clear"
                  ? "whiteboard.confirmClearImpact"
                  : "whiteboard.confirmRestoreImpact"
              )}
            </p>
            <div>
              <button
                type="button"
                disabled={loading || mutating}
                onClick={() => setPending(undefined)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="danger"
                disabled={loading || mutating}
                onClick={() => void confirm()}
              >
                {t(
                  pending.type === "clear"
                    ? "whiteboard.confirmClear"
                    : "whiteboard.confirmRestore"
                )}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
