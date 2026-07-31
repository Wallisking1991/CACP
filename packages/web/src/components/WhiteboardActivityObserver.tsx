import { useEffect, useRef } from "react";
import type { WhiteboardCollaborator } from "../whiteboard/whiteboard-editor-adapter.js";
import { createWhiteboardObserverEditor } from "../whiteboard/whiteboard-observer-editor.js";
import type {
  WhiteboardSessionActivity,
  WhiteboardSessionController,
  WhiteboardSessionFactoryLoader,
  WhiteboardSessionIdentity,
} from "../whiteboard/whiteboard-session.js";

interface WhiteboardActivityObserverProps {
  identity: WhiteboardSessionIdentity;
  loadSession: WhiteboardSessionFactoryLoader;
  onActivity: (activity: WhiteboardSessionActivity) => void;
  onCollaboratorsChange: (collaborators: WhiteboardCollaborator[]) => void;
}

const SESSION_LOAD_RETRY_BASE_MS = 1_000;
const SESSION_LOAD_RETRY_MAX_MS = 30_000;

export function WhiteboardActivityObserver({
  identity,
  loadSession,
  onActivity,
  onCollaboratorsChange,
}: WhiteboardActivityObserverProps) {
  const { participantId, role, roomId, token } = identity;
  const sessionRef = useRef<WhiteboardSessionController | undefined>(undefined);
  const roleRef = useRef(role);
  const onActivityRef = useRef(onActivity);
  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);

  useEffect(() => {
    roleRef.current = role;
    sessionRef.current?.setRole(role);
  }, [role]);

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  useEffect(() => {
    let disposed = false;
    let unsubscribeCollaborators: (() => void) | undefined;
    let unsubscribeActivity: (() => void) | undefined;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    const editor = createWhiteboardObserverEditor();

    const startSession = async () => {
      let session: WhiteboardSessionController | undefined;
      let nextUnsubscribeCollaborators: (() => void) | undefined;
      let nextUnsubscribeActivity: (() => void) | undefined;
      try {
        const createSession = await loadSession();
        if (disposed) return;
        session = createSession({
          identity: {
            participantId,
            role: roleRef.current,
            roomId,
            token,
          },
          editor,
          observeOnly: true,
          presenceEnabled: false,
        });
        if (disposed) {
          session.destroy();
          return;
        }
        nextUnsubscribeCollaborators = session.subscribeCollaborators(
          (collaborators) => onCollaboratorsChangeRef.current(collaborators)
        );
        nextUnsubscribeActivity = session.subscribeActivity((activity) =>
          onActivityRef.current(activity)
        );
        if (disposed) {
          nextUnsubscribeCollaborators();
          nextUnsubscribeActivity();
          session.destroy();
          return;
        }
        sessionRef.current = session;
        unsubscribeCollaborators = nextUnsubscribeCollaborators;
        unsubscribeActivity = nextUnsubscribeActivity;
      } catch {
        nextUnsubscribeCollaborators?.();
        nextUnsubscribeActivity?.();
        session?.destroy();
        if (disposed) return;
        onCollaboratorsChangeRef.current([]);
        const retryDelay = Math.min(
          SESSION_LOAD_RETRY_BASE_MS * 2 ** retryAttempt,
          SESSION_LOAD_RETRY_MAX_MS
        );
        retryAttempt = Math.min(retryAttempt + 1, 5);
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void startSession();
        }, retryDelay);
      }
    };

    void startSession();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      unsubscribeCollaborators?.();
      unsubscribeActivity?.();
      sessionRef.current?.destroy();
      sessionRef.current = undefined;
      editor.destroy();
    };
  }, [loadSession, participantId, roomId, token]);

  return null;
}
