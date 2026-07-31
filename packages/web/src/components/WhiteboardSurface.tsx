import { useEffect, useRef, useState } from "react";
import type {
  WhiteboardCollaborator,
  WhiteboardEditorAdapterLoader,
  WhiteboardEditorController,
} from "../whiteboard/whiteboard-editor-adapter.js";
import type {
  WhiteboardSessionController,
  WhiteboardSessionFactoryLoader,
  WhiteboardSessionIdentity,
  WhiteboardSessionActivity,
  WhiteboardSessionStatus,
} from "../whiteboard/whiteboard-session.js";
import { useT } from "../i18n/useT.js";

export interface WhiteboardSurfaceProps {
  active: boolean;
  identity: WhiteboardSessionIdentity;
  loadEditorAdapter: WhiteboardEditorAdapterLoader;
  loadSession: WhiteboardSessionFactoryLoader;
  langCode: "en" | "zh";
  name: string;
  onCollaboratorsChange?: (collaborators: WhiteboardCollaborator[]) => void;
  onActivity?: (activity: WhiteboardSessionActivity) => void;
}

export function WhiteboardSurface({
  active,
  identity,
  loadEditorAdapter,
  loadSession,
  langCode,
  name,
  onCollaboratorsChange,
  onActivity,
}: WhiteboardSurfaceProps) {
  const t = useT();
  const { participantId, role, roomId, token } = identity;
  const editorLabel = String(t("whiteboard.editorLabel"));
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WhiteboardEditorController | undefined>(
    undefined
  );
  const sessionRef = useRef<WhiteboardSessionController | undefined>(undefined);
  const unsubscribeStatusRef = useRef<(() => void) | undefined>(undefined);
  const unsubscribeCollaboratorsRef = useRef<(() => void) | undefined>(
    undefined
  );
  const unsubscribeActivityRef = useRef<(() => void) | undefined>(undefined);
  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  const onActivityRef = useRef(onActivity);
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

  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

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
          presenceEnabled: latestActiveRef.current,
        });
        sessionRef.current = whiteboardSession;
        unsubscribeStatusRef.current =
          whiteboardSession.subscribeStatus(setConnectionStatus);
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
        setStatus("ready");
      } catch {
        unsubscribeStatusRef.current?.();
        unsubscribeStatusRef.current = undefined;
        unsubscribeCollaboratorsRef.current?.();
        unsubscribeCollaboratorsRef.current = undefined;
        unsubscribeActivityRef.current?.();
        unsubscribeActivityRef.current = undefined;
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
            : t("whiteboard.syncing");

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
                  connectionStatus === "conflicted"
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
      <div
        ref={hostRef}
        className="whiteboard-surface__editor"
        aria-hidden={status !== "ready"}
      />
    </section>
  );
}
