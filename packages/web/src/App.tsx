import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CacpEvent } from "@cacp/protocol";
import {
  approveAiCollectionRequest,
  approveJoinRequest,
  cancelAiCollection,
  clearEventSocket,
  clearRoom,
  connectEvents,
  createAgentPairing,
  createInvite,
  createJoinRequest,
  createLocalAgentLaunch,
  createRoom,
  createRoomWithLocalAgent,
  inviteUrlFor,
  joinRequestStatus,
  leaveRoom,
  parseInviteUrl,
  rejectAiCollectionRequest,
  rejectJoinRequest,
  removeParticipant,
  requestAiCollection,
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
import { isCloudMode } from "./runtime-config.js";
import ConnectionCodeModal, { type ConnectionCodeModalPairing } from "./components/ConnectionCodeModal.js";
import Landing from "./components/Landing.js";
import Workspace from "./components/Workspace.js";
import WaitingRoom from "./components/WaitingRoom.js";
import "./App.css";

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search) ?? parseInviteUrl(window.location.hash.replace(/^#/, "?")), []);
  const [session, setSession] = useState<RoomSession | undefined>(() => loadInitialSession(window.localStorage, inviteTarget));
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ url: string; role: string; ttl: number }>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();
  const [createdPairing, setCreatedPairing] = useState<{ connection_code: string; download_url: string; expires_at: string }>();
  const [connectorModalPairing, setConnectorModalPairing] = useState<ConnectionCodeModalPairing>();
  const [waitingRoom, setWaitingRoom] = useState<{ roomId: string; requestId: string; requestToken: string; displayName: string } | undefined>();
  const waitingRoomRef = useRef(waitingRoom);
  waitingRoomRef.current = waitingRoom;

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(
      session,
      (event) => setEvents((current) => mergeEvent(current, event)),
      (code, reason) => {
        if (code === 4001 || reason === "participant_removed" || reason === "owner_left_room") {
          clearStoredSession(window.localStorage);
          setSession(undefined);
          setEvents([]);
          setCreatedInvite(undefined);
          setLocalLaunch(undefined);
          setCreatedPairing(undefined);
          setConnectorModalPairing(undefined);
          setWaitingRoom(undefined);
          setError(reason === "owner_left_room" ? "The room owner closed the room." : "You have been removed from the room.");
        }
      }
    );
    return () => clearEventSocket(socket);
  }, [session]);

  // Poll join-request status when in waiting room
  useEffect(() => {
    if (!waitingRoom) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled && waitingRoomRef.current) {
        try {
          const status = await joinRequestStatus(waitingRoomRef.current.roomId, waitingRoomRef.current.requestId, waitingRoomRef.current.requestToken);
          if (status.status === "approved" && status.participant_id && status.participant_token && status.role) {
            const nextSession: RoomSession = {
              room_id: waitingRoomRef.current.roomId,
              token: status.participant_token,
              participant_id: status.participant_id,
              role: status.role,
            };
            saveStoredSession(window.localStorage, nextSession);
            setSession(nextSession);
            setEvents([]);
            setCreatedInvite(undefined);
            setLocalLaunch(undefined);
            setCreatedPairing(undefined);
            setConnectorModalPairing(undefined);
            setWaitingRoom(undefined);
            if (inviteTarget) window.history.replaceState({}, {}, "/");
            return;
          }
          if (status.status === "rejected" || status.status === "expired") {
            setError(status.status === "rejected" ? "Your join request was rejected by the room owner." : "Your join request has expired.");
            setWaitingRoom(undefined);
            return;
          }
        } catch {
          // ignore transient errors, keep polling
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [waitingRoom, inviteTarget]);

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
    setCreatedPairing(undefined);
    setConnectorModalPairing(undefined);
    setWaitingRoom(undefined);
    setSession(nextSession);
    if (inviteTarget) window.history.replaceState({}, {}, "/");
  }, [inviteTarget]);

  const clearActiveRoomSession = useCallback((): void => {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setCreatedPairing(undefined);
    setConnectorModalPairing(undefined);
    setWaitingRoom(undefined);
    setError(undefined);
  }, []);

  const handleLeaveRoom = useCallback((): void => {
    if (!session || session.role !== "owner") {
      clearActiveRoomSession();
      return;
    }
    void run(async () => {
      await leaveRoom(session);
      clearActiveRoomSession();
    });
  }, [clearActiveRoomSession, session]);

  const handleCreate = useCallback(async (params: {
    roomName: string;
    displayName: string;
    agentType: string;
    permissionLevel: string;
  }) => {
    await run(async () => {
      if (isCloudMode()) {
        const session = await createRoom(params.roomName, params.displayName);
        activateSession(session);
        const pairing = await createAgentPairing(session, {
          agent_type: params.agentType,
          permission_level: params.permissionLevel,
          working_dir: ".",
        });
        const modalPairing = {
          connection_code: pairing.connection_code,
          download_url: pairing.download_url,
          expires_at: pairing.expires_at,
        };
        setCreatedPairing(modalPairing);
        setConnectorModalPairing(modalPairing);
      } else {
        const result = await createRoomWithLocalAgent(
          params.roomName,
          params.displayName,
          {
            agent_type: params.agentType,
            permission_level: params.permissionLevel,
            working_dir: ".",
          }
        );
        activateSession(result.session);
        if (result.launch) {
          setLocalLaunch(result.launch);
        }
        if (result.launch_error) {
          setError(`Starting the local agent failed: ${result.launch_error}`);
        }
      }
    });
  }, [activateSession]);

  const handleJoin = useCallback(async (params: {
    roomId: string;
    inviteToken: string;
    displayName: string;
  }) => {
    await run(async () => {
      const result = await createJoinRequest(params.roomId, params.inviteToken, params.displayName);
      setWaitingRoom({
        roomId: params.roomId,
        requestId: result.request_id,
        requestToken: result.request_token,
        displayName: params.displayName,
      });
    });
  }, []);

  const handleCancelWaiting = useCallback(() => {
    setWaitingRoom(undefined);
    setError(undefined);
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!session) return;
    await run(async () => {
      await sendMessage(session, text);
    });
  }, [session]);

  const handleClearRoom = useCallback(() => {
    if (!session) return;
    if (window.confirm("Clear all chat messages and Roundtable history for everyone?")) {
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
      if (role !== "member" && role !== "observer") throw new Error("Invalid invite role");
      const invite = await createInvite(session, role, ttl);
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

  const handleApproveJoinRequest = useCallback((requestId: string) => {
    if (!session) return;
    void run(async () => {
      await approveJoinRequest(session, requestId);
    });
  }, [session]);

  const handleRejectJoinRequest = useCallback((requestId: string) => {
    if (!session) return;
    void run(async () => {
      await rejectJoinRequest(session, requestId);
    });
  }, [session]);

  const handleRemoveParticipant = useCallback((participantId: string) => {
    if (!session) return;
    void run(async () => {
      await removeParticipant(session, participantId);
    });
  }, [session]);

  const handleRequestRoundtable = useCallback(() => {
    if (!session) return;
    void run(async () => { await requestAiCollection(session); });
  }, [session]);

  const handleApproveRoundtableRequest = useCallback((requestId: string) => {
    if (!session) return;
    void run(async () => { await approveAiCollectionRequest(session, requestId); });
  }, [session]);

  const handleRejectRoundtableRequest = useCallback((requestId: string) => {
    if (!session) return;
    void run(async () => { await rejectAiCollectionRequest(session, requestId); });
  }, [session]);

  if (waitingRoom) {
    return (
      <LangProvider>
        <WaitingRoom displayName={waitingRoom.displayName} onCancel={handleCancelWaiting} />
        {error && (
          <div className="error banner" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
            {error}
          </div>
        )}
      </LangProvider>
    );
  }

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
        onApproveJoinRequest={handleApproveJoinRequest}
        onRejectJoinRequest={handleRejectJoinRequest}
        onRemoveParticipant={handleRemoveParticipant}
        onRequestRoundtable={handleRequestRoundtable}
        onApproveRoundtableRequest={handleApproveRoundtableRequest}
        onRejectRoundtableRequest={handleRejectRoundtableRequest}
        createdInvite={createdInvite}
        error={error}
        cloudMode={isCloudMode()}
        createdPairing={createdPairing}
      />
      <ConnectionCodeModal
        pairing={connectorModalPairing}
        onClose={() => setConnectorModalPairing(undefined)}
      />
    </LangProvider>
  );
}
