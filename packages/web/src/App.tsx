import { useEffect, useMemo, useState, useCallback } from "react";
import type { CacpEvent } from "@cacp/protocol";
import {
  cancelAiCollection,
  clearEventSocket,
  clearRoom,
  connectEvents,
  createAgentPairing,
  createInvite,
  createLocalAgentLaunch,
  createRoomWithLocalAgent,
  inviteUrlFor,
  joinRoom,
  parseInviteUrl,
  selectAgent,
  sendMessage,
  startAiCollection,
  submitAiCollection,
  type LocalAgentLaunch,
  type RoomSession,
} from "./api.js";
import { mergeEvent } from "./event-log.js";
import { clearStoredSession, loadInitialSession, saveStoredSession } from "./session-storage.js";
import { LangProvider } from "./i18n/LangProvider.js";
import Landing from "./components/Landing.js";
import Workspace from "./components/Workspace.js";
import "./App.css";

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search) ?? parseInviteUrl(window.location.hash.replace(/^#/, "?")), []);
  const [session, setSession] = useState<RoomSession | undefined>(() => loadInitialSession(window.localStorage, inviteTarget));
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ url: string; role: string; ttl: number }>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => clearEventSocket(socket);
  }, [session]);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    setLoading(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  const activateSession = useCallback((nextSession: RoomSession): void => {
    saveStoredSession(window.localStorage, nextSession);
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setSession(nextSession);
    if (inviteTarget) window.history.replaceState({}, "", "/");
  }, [inviteTarget]);

  const handleLeaveRoom = useCallback((): void => {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setError(undefined);
  }, []);

  const handleCreate = useCallback(async (params: {
    roomName: string;
    displayName: string;
    agentType: string;
    permissionLevel: string;
    workingDir: string;
  }) => {
    await run(async () => {
      const result = await createRoomWithLocalAgent(
        params.roomName,
        params.displayName,
        {
          agent_type: params.agentType,
          permission_level: params.permissionLevel,
          working_dir: params.workingDir,
        }
      );
      activateSession(result.session);
      if (result.launch) {
        setLocalLaunch(result.launch);
      }
      if (result.launch_error) {
        setError(`Starting the local agent failed: ${result.launch_error}`);
      }
    });
  }, [activateSession]);

  const handleJoin = useCallback(async (params: {
    roomId: string;
    inviteToken: string;
    displayName: string;
  }) => {
    await run(async () => {
      const nextSession = await joinRoom(params.roomId, params.inviteToken, params.displayName);
      activateSession(nextSession);
    });
  }, [activateSession]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!session) return;
    await run(async () => {
      await sendMessage(session, text);
    });
  }, [session]);

  const handleClearRoom = useCallback(() => {
    if (!session) return;
    if (window.confirm("Clear all chat messages and AI flow history for everyone?")) {
      void run(async () => {
        await clearRoom(session);
      });
    }
  }, [session]);

  const handleStartCollection = useCallback(() => {
    if (!session) return;
    void run(async () => {
      await startAiCollection(session);
    });
  }, [session]);

  const handleSubmitCollection = useCallback(() => {
    if (!session) return;
    void run(async () => {
      await submitAiCollection(session);
    });
  }, [session]);

  const handleCancelCollection = useCallback(() => {
    if (!session) return;
    void run(async () => {
      await cancelAiCollection(session);
    });
  }, [session]);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!session) return;
    void run(async () => {
      await selectAgent(session, agentId);
    });
  }, [session]);

  const handleCreateInvite = useCallback(async (role: string, ttl: number): Promise<string | undefined> => {
    if (!session) return undefined;
    setError(undefined);
    setLoading(true);
    try {
      const invite = await createInvite(session, role as "member" | "observer", ttl);
      const url = inviteUrlFor(window.location.origin, session.room_id, invite.invite_token);
      setCreatedInvite({ url, role, ttl });
      return url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [session]);

  if (!session) {
    return (
      <LangProvider>
        <Landing onCreate={handleCreate} onJoin={handleJoin} loading={loading} />
        {error && (
          <div className="error banner" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
            {error}
          </div>
        )}
      </LangProvider>
    );
  }

  return (
    <LangProvider>
      <Workspace
        session={session}
        events={events}
        onLeaveRoom={handleLeaveRoom}
        onClearRoom={handleClearRoom}
        onSendMessage={handleSendMessage}
        onStartCollection={handleStartCollection}
        onSubmitCollection={handleSubmitCollection}
        onCancelCollection={handleCancelCollection}
        onSelectAgent={handleSelectAgent}
        onCreateInvite={handleCreateInvite}
        createdInvite={createdInvite}
        error={error}
      />
    </LangProvider>
  );
}
