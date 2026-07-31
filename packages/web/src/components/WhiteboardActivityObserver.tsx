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
    const editor = createWhiteboardObserverEditor();

    void loadSession()
      .then((createSession) => {
        if (disposed) return;
        const session = createSession({
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
        sessionRef.current = session;
        unsubscribeCollaborators = session.subscribeCollaborators(
          (collaborators) => onCollaboratorsChangeRef.current(collaborators)
        );
        unsubscribeActivity = session.subscribeActivity((activity) =>
          onActivityRef.current(activity)
        );
      })
      .catch(() => {
        if (!disposed) onCollaboratorsChangeRef.current([]);
      });

    return () => {
      disposed = true;
      unsubscribeCollaborators?.();
      unsubscribeActivity?.();
      onCollaboratorsChangeRef.current([]);
      sessionRef.current?.destroy();
      sessionRef.current = undefined;
      editor.destroy();
    };
  }, [loadSession, participantId, roomId, token]);

  return null;
}
