import { useEffect, useRef, useState } from "react";
import type {
  WhiteboardCollaborator,
  WhiteboardEditorAdapterLoader,
  WhiteboardEditorController,
  WhiteboardExportFormat,
  WhiteboardExportScope,
  WhiteboardPromotionArtifacts,
  WhiteboardTemplateId,
} from "../whiteboard/whiteboard-editor-adapter.js";
import type { AgentView } from "../room-state.js";
import type {
  WhiteboardSessionController,
  WhiteboardSessionFactoryLoader,
  WhiteboardSessionIdentity,
  WhiteboardSessionActivity,
  WhiteboardSessionStatus,
  WhiteboardSessionError,
} from "../whiteboard/whiteboard-session.js";
import { createWhiteboardImageAssetManager } from "../whiteboard/whiteboard-image-assets.js";
import { useT } from "../i18n/useT.js";
import { WhiteboardRecoveryDialog } from "./WhiteboardRecoveryDialog.js";
import { WhiteboardPromotionDialog } from "./WhiteboardPromotionDialog.js";
import { WhiteboardTemplateMenu } from "./WhiteboardTemplateMenu.js";
import { WhiteboardActionMenu } from "./WhiteboardActionMenu.js";
import { MenuIcon, XIcon } from "./RoomIcons.js";
import { useDialogKeyboard } from "./useDialogKeyboard.js";
import {
  usePhoneWhiteboard,
  useWhiteboardOnboarding,
} from "./useWhiteboardPresentation.js";

export interface WhiteboardSurfaceProps {
  active: boolean;
  identity: WhiteboardSessionIdentity;
  loadEditorAdapter: WhiteboardEditorAdapterLoader;
  loadSession: WhiteboardSessionFactoryLoader;
  langCode: "en" | "zh";
  name: string;
  activeAgent?: AgentView;
  onCollaboratorsChange?: (collaborators: WhiteboardCollaborator[]) => void;
  onActivity?: (activity: WhiteboardSessionActivity) => void;
  onSessionReady?: () => void;
  onAttachmentUsageChanged?: () => void;
  onPromotionComplete?: () => void;
}

export function WhiteboardSurface({
  active,
  identity,
  loadEditorAdapter,
  loadSession,
  langCode,
  name,
  activeAgent,
  onCollaboratorsChange,
  onActivity,
  onSessionReady,
  onAttachmentUsageChanged,
  onPromotionComplete,
}: WhiteboardSurfaceProps) {
  const t = useT();
  const { participantId, role, roomId, token } = identity;
  const editorLabel = String(t("whiteboard.editorLabel"));
  const hostRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const promotionButtonRef = useRef<HTMLButtonElement>(null);
  const templateButtonRef = useRef<HTMLButtonElement>(null);
  const recoveryButtonRef = useRef<HTMLButtonElement>(null);
  const mobileActionsButtonRef = useRef<HTMLButtonElement>(null);
  const mobileActionsDialogRef = useRef<HTMLElement>(null);
  const mobileActionsCloseRef = useRef<HTMLButtonElement>(null);
  const promotionCompletedRef = useRef(false);
  const controllerRef = useRef<WhiteboardEditorController | undefined>(
    undefined
  );
  const sessionRef = useRef<WhiteboardSessionController | undefined>(undefined);
  const unsubscribeStatusRef = useRef<(() => void) | undefined>(undefined);
  const unsubscribeCollaboratorsRef = useRef<(() => void) | undefined>(
    undefined
  );
  const unsubscribeActivityRef = useRef<(() => void) | undefined>(undefined);
  const unsubscribeErrorRef = useRef<(() => void) | undefined>(undefined);
  const unsubscribeOnboardingRef = useRef<(() => void) | undefined>(undefined);
  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  const onActivityRef = useRef(onActivity);
  const onSessionReadyRef = useRef(onSessionReady);
  const latestRoleRef = useRef(role);
  const latestActiveRef = useRef(active);
  const mountOptionsRef = useRef({
    ariaLabel: editorLabel,
    langCode,
    name,
    readOnly: true,
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [connectionStatus, setConnectionStatus] =
    useState<WhiteboardSessionStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [collaborators, setCollaborators] = useState<WhiteboardCollaborator[]>(
    []
  );
  const [sessionError, setSessionError] = useState<
    WhiteboardSessionError | undefined
  >(undefined);
  const [exportScope, setExportScope] =
    useState<WhiteboardExportScope>("scene");
  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const [insertingImage, setInsertingImage] = useState(false);
  const [imageInsertError, setImageInsertError] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [promotionArtifacts, setPromotionArtifacts] =
    useState<WhiteboardPromotionArtifacts>();
  const [promotionRevision, setPromotionRevision] = useState<number>();
  const [promotionError, setPromotionError] = useState<string>();
  const [preparingPromotion, setPreparingPromotion] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [insertingTemplate, setInsertingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const isPhoneWhiteboard = usePhoneWhiteboard();
  const { visible: showOnboarding, dismiss: dismissOnboarding } =
    useWhiteboardOnboarding(roomId, participantId);
  const dismissOnboardingRef = useRef(dismissOnboarding);
  useEffect(() => {
    dismissOnboardingRef.current = dismissOnboarding;
  }, [dismissOnboarding]);
  const closeMobileActions = () => {
    setMobileActionsOpen(false);
    requestAnimationFrame(() => mobileActionsButtonRef.current?.focus());
  };
  useDialogKeyboard(
    mobileActionsDialogRef,
    isPhoneWhiteboard &&
      mobileActionsOpen &&
      !templateOpen &&
      !recoveryOpen &&
      !promotionArtifacts,
    closeMobileActions,
    mobileActionsCloseRef
  );
  const canManageRecovery =
    status === "ready" &&
    connectionStatus === "connected" &&
    (role === "owner" || role === "admin");

  useEffect(() => {
    if (!canManageRecovery) {
      queueMicrotask(() => {
        setRecoveryOpen(false);
        setPromotionArtifacts(undefined);
        setPromotionRevision(undefined);
      });
    }
  }, [canManageRecovery]);

  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    onSessionReadyRef.current = onSessionReady;
  }, [onSessionReady]);

  useEffect(() => {
    latestRoleRef.current = role;
  }, [role]);

  useEffect(() => {
    latestActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    mountOptionsRef.current = {
      ariaLabel: editorLabel,
      langCode,
      name,
      readOnly: true,
    };
  }, [editorLabel, langCode, name]);

  useEffect(() => {
    let disposed = false;

    const mountEditor = async () => {
      const host = hostRef.current;
      if (!host) return;

      try {
        const [adapter, createSession] = await Promise.all([
          loadEditorAdapter(),
          loadSession(),
        ]);
        if (disposed) return;
        const controller = await adapter.mount(host, mountOptionsRef.current);
        if (disposed) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        unsubscribeOnboardingRef.current = controller.subscribeSceneChanges(
          (scene) => {
            if (
              scene.elements.some(
                (element) =>
                  typeof element === "object" &&
                  element !== null &&
                  (element as { isDeleted?: boolean }).isDeleted !== true
              )
            ) {
              dismissOnboardingRef.current();
            }
          }
        );
        controller.setDisplayOptions(mountOptionsRef.current);
        controller.setReadOnly(true);
        const whiteboardSession = createSession({
          identity: {
            participantId,
            role: latestRoleRef.current,
            roomId,
            token,
          },
          editor: controller,
          imageAssets: createWhiteboardImageAssetManager({
            session: { room_id: roomId, token },
          }),
          presenceEnabled: latestActiveRef.current,
        });
        sessionRef.current = whiteboardSession;
        unsubscribeStatusRef.current = whiteboardSession.subscribeStatus(
          (nextStatus) => {
            setConnectionStatus(nextStatus);
            if (nextStatus === "connected") onSessionReadyRef.current?.();
          }
        );
        unsubscribeCollaboratorsRef.current =
          whiteboardSession.subscribeCollaborators((nextCollaborators) => {
            setCollaborators(nextCollaborators);
            onCollaboratorsChangeRef.current?.(nextCollaborators);
          });
        unsubscribeActivityRef.current = whiteboardSession.subscribeActivity(
          (activity) => {
            onActivityRef.current?.(activity);
          }
        );
        unsubscribeErrorRef.current =
          whiteboardSession.subscribeError?.(setSessionError);
        setStatus("ready");
      } catch {
        unsubscribeStatusRef.current?.();
        unsubscribeStatusRef.current = undefined;
        unsubscribeCollaboratorsRef.current?.();
        unsubscribeCollaboratorsRef.current = undefined;
        unsubscribeActivityRef.current?.();
        unsubscribeActivityRef.current = undefined;
        unsubscribeErrorRef.current?.();
        unsubscribeErrorRef.current = undefined;
        unsubscribeOnboardingRef.current?.();
        unsubscribeOnboardingRef.current = undefined;
        if (!disposed) {
          setCollaborators([]);
          onCollaboratorsChangeRef.current?.([]);
        }
        sessionRef.current?.destroy();
        sessionRef.current = undefined;
        controllerRef.current?.destroy();
        controllerRef.current = undefined;
        if (!disposed) setStatus("error");
      }
    };

    void mountEditor();

    return () => {
      disposed = true;
      unsubscribeStatusRef.current?.();
      unsubscribeStatusRef.current = undefined;
      unsubscribeCollaboratorsRef.current?.();
      unsubscribeCollaboratorsRef.current = undefined;
      unsubscribeActivityRef.current?.();
      unsubscribeActivityRef.current = undefined;
      unsubscribeErrorRef.current?.();
      unsubscribeErrorRef.current = undefined;
      unsubscribeOnboardingRef.current?.();
      unsubscribeOnboardingRef.current = undefined;
      setSessionError(undefined);
      setCollaborators([]);
      onCollaboratorsChangeRef.current?.([]);
      sessionRef.current?.destroy();
      sessionRef.current = undefined;
      controllerRef.current?.destroy();
      controllerRef.current = undefined;
    };
  }, [attempt, loadEditorAdapter, loadSession, participantId, roomId, token]);

  useEffect(() => {
    controllerRef.current?.setDisplayOptions({
      ariaLabel: editorLabel,
      langCode,
      name,
    });
  }, [editorLabel, langCode, name]);

  useEffect(() => {
    sessionRef.current?.setRole(role);
  }, [role]);

  useEffect(() => {
    sessionRef.current?.setPresenceEnabled(active);
  }, [active]);

  const connectionMessage =
    connectionStatus === "disconnected"
      ? t("whiteboard.reconnecting")
      : connectionStatus === "rejected"
        ? t("whiteboard.syncRejected")
        : connectionStatus === "conflicted"
          ? t("whiteboard.syncConflict")
          : connectionStatus === "forbidden"
            ? t("whiteboard.accessUnavailable")
            : connectionStatus === "ended"
              ? t("whiteboard.roomEnded")
              : t("whiteboard.syncing");
  const imageErrorMessage = sessionError
    ? t(
        sessionError.code === "whiteboard_image_download_failed"
          ? "whiteboard.imageDownloadError"
          : sessionError.code === "whiteboard_image_data_missing"
            ? "whiteboard.imageDataMissing"
            : "whiteboard.imageUploadError"
      )
    : undefined;

  const exportWhiteboard = async (format: WhiteboardExportFormat) => {
    const controller = controllerRef.current;
    if (!controller) return;
    setExportError(undefined);
    try {
      const blob = await controller.exportScene(format, exportScope);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = name.replace(/[^\p{L}\p{N}_.-]+/gu, "-");
      anchor.href = url;
      anchor.download = `${safeName || "whiteboard"}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setExportError(
        message.startsWith("whiteboard_export_missing_image:")
          ? String(t("whiteboard.exportMissingImage"))
          : message === "whiteboard_export_empty_selection"
            ? String(t("whiteboard.exportEmptySelection"))
            : String(t("whiteboard.exportError"))
      );
    }
  };

  const insertImage = async (file: File) => {
    const controller = controllerRef.current;
    if (!controller?.insertImage) {
      setImageInsertError(true);
      return;
    }
    setInsertingImage(true);
    setImageInsertError(false);
    try {
      await controller.insertImage(file);
    } catch {
      setImageInsertError(true);
    } finally {
      setInsertingImage(false);
    }
  };

  const preparePromotion = async (fromMobileActions = false) => {
    const controller = controllerRef.current;
    const revisionBeforeExport = sessionRef.current?.currentRevision?.();
    if (fromMobileActions) setMobileActionsOpen(false);
    const restoreMobileFocus = () => {
      if (fromMobileActions) {
        requestAnimationFrame(() => mobileActionsButtonRef.current?.focus());
      }
    };
    setPromotionError(undefined);
    if (
      !controller?.createPromotionArtifacts ||
      revisionBeforeExport === undefined
    ) {
      setPromotionError(String(t("whiteboard.promotionUnavailable")));
      restoreMobileFocus();
      return;
    }
    setPreparingPromotion(true);
    try {
      const artifacts = await controller.createPromotionArtifacts();
      const revisionAfterExport = sessionRef.current?.currentRevision?.();
      if (revisionAfterExport !== revisionBeforeExport) {
        setPromotionError(String(t("whiteboard.promotionUnavailable")));
        restoreMobileFocus();
        return;
      }
      setPromotionRevision(revisionBeforeExport);
      setPromotionArtifacts(artifacts);
    } catch (cause) {
      setPromotionError(
        cause instanceof Error &&
          cause.message === "whiteboard_export_empty_selection"
          ? String(t("whiteboard.promotionEmptySelection"))
          : String(t("whiteboard.promotionUnavailable"))
      );
      restoreMobileFocus();
    } finally {
      setPreparingPromotion(false);
    }
  };

  const insertTemplate = async (templateId: WhiteboardTemplateId) => {
    const controller = controllerRef.current;
    if (!controller?.insertTemplate) {
      setTemplateError(true);
      return;
    }
    setInsertingTemplate(true);
    setTemplateError(false);
    try {
      await controller.insertTemplate(templateId);
      setTemplateOpen(false);
      requestAnimationFrame(() =>
        (isPhoneWhiteboard
          ? mobileActionsButtonRef.current
          : templateButtonRef.current
        )?.focus()
      );
      dismissOnboardingRef.current();
    } catch {
      setTemplateError(true);
    } finally {
      setInsertingTemplate(false);
    }
  };

  const closeTemplateMenu = () => {
    setTemplateOpen(false);
    requestAnimationFrame(() =>
      (isPhoneWhiteboard
        ? mobileActionsButtonRef.current
        : templateButtonRef.current
      )?.focus()
    );
  };

  const closeRecovery = () => {
    setRecoveryOpen(false);
    requestAnimationFrame(() =>
      (isPhoneWhiteboard
        ? mobileActionsButtonRef.current
        : recoveryButtonRef.current
      )?.focus()
    );
  };

  const actionMenu = (mobile: boolean) => (
    <WhiteboardActionMenu
      mobile={mobile}
      canEdit={role !== "observer"}
      canManage={canManageRecovery}
      editDisabled={connectionStatus !== "connected"}
      state={{
        exportScope,
        insertingImage,
        preparingPromotion,
        templateOpen,
      }}
      promotionTriggerRef={promotionButtonRef}
      recoveryTriggerRef={recoveryButtonRef}
      templateTriggerRef={templateButtonRef}
      actions={{
        addImage: () => imageInputRef.current?.click(),
        export: (format) => void exportWhiteboard(format),
        openRecovery: () => {
          if (mobile) setMobileActionsOpen(false);
          setRecoveryOpen(true);
        },
        preparePromotion: () => void preparePromotion(mobile),
        setExportScope,
        toggleTemplates: () => {
          if (mobile) setMobileActionsOpen(false);
          setTemplateOpen((current) => !current);
        },
      }}
    />
  );

  return (
    <section className="whiteboard-surface" aria-label={editorLabel}>
      {status === "ready" && collaborators.length > 0 && (
        <div
          className="whiteboard-collaborators"
          aria-label={t("whiteboard.collaborators")}
        >
          {collaborators.map((collaborator) => {
            const isPeer = collaborator.participantId !== participantId;
            const canFollow = isPeer && collaborator.viewport !== undefined;
            const contents = (
              <>
                <span
                  className="whiteboard-collaborators__avatar"
                  style={{
                    background: collaborator.color.background,
                    borderColor: collaborator.color.stroke,
                  }}
                  aria-hidden="true"
                >
                  {collaborator.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="whiteboard-collaborators__name">
                  {collaborator.displayName}
                </span>
              </>
            );
            return canFollow ? (
              <button
                key={collaborator.participantId}
                type="button"
                className="whiteboard-collaborators__person"
                aria-label={t("whiteboard.viewCollaborator", {
                  name: collaborator.displayName,
                })}
                onClick={() =>
                  sessionRef.current?.focusCollaborator(
                    collaborator.participantId
                  )
                }
              >
                {contents}
              </button>
            ) : (
              <span
                key={collaborator.participantId}
                className="whiteboard-collaborators__person"
                aria-label={collaborator.displayName}
              >
                {contents}
              </span>
            );
          })}
        </div>
      )}
      {status === "loading" && (
        <div className="whiteboard-surface__status" role="status">
          {t("whiteboard.loading")}
        </div>
      )}
      {status === "error" && (
        <div
          className="whiteboard-surface__status whiteboard-surface__status--error"
          role="alert"
        >
          <span>{t("whiteboard.loadError")}</span>
          <button
            type="button"
            onClick={() => {
              setStatus("loading");
              setConnectionStatus("connecting");
              setAttempt((value) => value + 1);
            }}
          >
            {t("whiteboard.retry")}
          </button>
        </div>
      )}
      {status === "ready" && connectionStatus !== "connected" && (
        <div
          className={`whiteboard-surface__status${
            connectionStatus === "forbidden"
              ? " whiteboard-surface__status--error"
              : connectionStatus === "rejected" ||
                  connectionStatus === "conflicted" ||
                  connectionStatus === "ended"
                ? " whiteboard-surface__status--warning"
                : ""
          }`}
          role={
            connectionStatus === "forbidden" ||
            connectionStatus === "conflicted"
              ? "alert"
              : "status"
          }
        >
          {connectionMessage}
          {connectionStatus === "conflicted" && (
            <button
              type="button"
              onClick={() => sessionRef.current?.loadSharedScene()}
            >
              {t("whiteboard.loadShared")}
            </button>
          )}
        </div>
      )}
      {status === "ready" && imageErrorMessage && (
        <div className="whiteboard-surface__asset-error" role="alert">
          {imageErrorMessage}
        </div>
      )}
      {status === "ready" && imageInsertError && (
        <div className="whiteboard-surface__asset-error" role="alert">
          {t("whiteboard.imageUploadError")}
        </div>
      )}
      {status === "ready" && (
        <>
          {role !== "observer" && (
            <input
              ref={imageInputRef}
              className="whiteboard-export-tools__file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (file) void insertImage(file);
                input.value = "";
              }}
            />
          )}
          {isPhoneWhiteboard ? (
            <>
              <div className="whiteboard-mobile-toolbar">
                <button
                  ref={mobileActionsButtonRef}
                  type="button"
                  className="whiteboard-mobile-toolbar__action"
                  aria-label={t("whiteboard.advancedActions")}
                  aria-expanded={mobileActionsOpen}
                  aria-controls="whiteboard-mobile-actions"
                  onClick={() => setMobileActionsOpen(true)}
                >
                  <MenuIcon />
                </button>
              </div>
              {mobileActionsOpen && (
                <>
                  <div
                    className="whiteboard-mobile-actions-backdrop"
                    aria-hidden="true"
                    onClick={closeMobileActions}
                  />
                  <section
                    ref={mobileActionsDialogRef}
                    id="whiteboard-mobile-actions"
                    className="whiteboard-mobile-actions"
                    role="dialog"
                    aria-modal="true"
                    tabIndex={-1}
                    aria-labelledby="whiteboard-mobile-actions-title"
                  >
                    <header>
                      <div>
                        <h2 id="whiteboard-mobile-actions-title">
                          {t("whiteboard.advancedActions")}
                        </h2>
                        <p>{t("whiteboard.advancedActionsDescription")}</p>
                      </div>
                      <button
                        ref={mobileActionsCloseRef}
                        type="button"
                        onClick={closeMobileActions}
                        aria-label={t("common.close")}
                      >
                        <XIcon />
                      </button>
                    </header>
                    <div className="whiteboard-mobile-actions__grid">
                      {actionMenu(true)}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <div
              className="whiteboard-export-tools"
              aria-label={t("whiteboard.exportTools")}
            >
              {actionMenu(false)}
            </div>
          )}
        </>
      )}
      {status === "ready" && exportError && (
        <div className="whiteboard-surface__export-error" role="alert">
          {exportError}
        </div>
      )}
      {status === "ready" && promotionError && (
        <div className="whiteboard-surface__export-error" role="alert">
          {promotionError}
        </div>
      )}
      {status === "ready" && templateError && (
        <div className="whiteboard-surface__export-error" role="alert">
          {t("whiteboard.templateInsertError")}
        </div>
      )}
      {status === "ready" && showOnboarding && (
        <aside
          className="whiteboard-onboarding"
          aria-labelledby="whiteboard-onboarding-title"
        >
          <button
            type="button"
            aria-label={t("whiteboard.dismissOnboarding")}
            onClick={() => dismissOnboardingRef.current()}
          >
            <XIcon />
          </button>
          <strong id="whiteboard-onboarding-title">
            {t("whiteboard.onboardingTitle")}
          </strong>
          <span>{t("whiteboard.onboardingBody")}</span>
        </aside>
      )}
      {status === "ready" &&
        connectionStatus === "connected" &&
        role !== "observer" &&
        templateOpen && (
          <WhiteboardTemplateMenu
            busy={insertingTemplate}
            onClose={closeTemplateMenu}
            onInsert={(templateId) => void insertTemplate(templateId)}
          />
        )}
      <div
        ref={hostRef}
        className="whiteboard-surface__editor"
        aria-hidden={status !== "ready"}
      />
      {recoveryOpen && canManageRecovery && (
        <WhiteboardRecoveryDialog
          langCode={langCode}
          open
          session={{
            room_id: roomId,
            participant_id: participantId,
            token,
            role,
          }}
          onClose={closeRecovery}
        />
      )}
      {promotionArtifacts && canManageRecovery && (
        <WhiteboardPromotionDialog
          open
          session={{
            room_id: roomId,
            participant_id: participantId,
            token,
            role,
          }}
          artifacts={promotionArtifacts}
          expectedRevision={promotionRevision}
          agent={activeAgent}
          onClose={() => {
            setPromotionArtifacts(undefined);
            setPromotionRevision(undefined);
            if (!promotionCompletedRef.current) {
              requestAnimationFrame(() =>
                (isPhoneWhiteboard
                  ? mobileActionsButtonRef.current
                  : promotionButtonRef.current
                )?.focus()
              );
            }
            promotionCompletedRef.current = false;
          }}
          onPromoted={() => {
            promotionCompletedRef.current = true;
            onAttachmentUsageChanged?.();
            onPromotionComplete?.();
          }}
        />
      )}
    </section>
  );
}
