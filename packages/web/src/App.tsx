import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
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
  getRoomMe,
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
import { clearStoredSession, loadAllSessions, saveAllSessions, saveStoredSession } from "./session-storage.js";
import { LangProvider } from "./i18n/LangProvider.js";
import { isCloudMode } from "./runtime-config.js";
import ConnectionCodeModal, { type ConnectionCodeModalPairing } from "./components/ConnectionCodeModal.js";
import Landing from "./components/Landing.js";
import Workspace from "./components/Workspace.js";
import WaitingRoom from "./components/WaitingRoom.js";
import "./App.css";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const roomMatch = useMatch("/room/:roomId");
  const urlRoomId = roomMatch?.params.roomId;

  const inviteTarget = useMemo(() => {
    if (location.pathname === "/join") {
      return parseInviteUrl(location.search) ?? parseInviteUrl(location.hash.replace(/^#/, "?"));
    }
    return undefined;
  }, [location.pathname, location.search, location.hash]);

  const [allSessions, setAllSessions] = useState<Record<string, RoomSession>>(() => loadAllSessions(window.localStorage));
  const currentSession = urlRoomId ? allSessions[urlRoomId] : undefined;

  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ url: string; role: string; ttl: number }>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();
  const [createdPairing, setCreatedPairing] = useState<{ connection_code: string; download_url: string; expires_at: string }>();
  const [connectorModalPairing, setConnectorModalPairing] = useState<ConnectionCodeModalPairing>();
  const [waitingRoom, setWaitingRoom] = useState<{ roomId: string; requestId: string; requestToken: string; displayName: string } | undefined>();
  const [validating, setValidating] = useState(false);
  const [sessionValid, setSessionValid] = useState<boolean | undefined>();
  const waitingRoomRef = useRef(waitingRoom);
  waitingRoomRef.current = waitingRoom;

  // Validate session when URL roomId changes
  useEffect(() => {
    if (!urlRoomId || !currentSession) {
      setSessionValid(undefined);
      return;
    }
    setValidating(true);
    setSessionValid(undefined);
    getRoomMe(currentSession)
      .then(() => setSessionValid(true))
      .catch(() => {
        setSessionValid(false);
        const next = { ...allSessions };
        delete next[urlRoomId];
        setAllSessions(next);
        saveAllSessions(window.localStorage, next);
      })
      .finally(() => setValidating(false));
  }, [urlRoomId, currentSession?.room_id, currentSession?.token]);

  // WebSocket connection for current room
  useEffect(() => {
    if (!currentSession || !sessionValid) return;
    const socket = connectEvents(
      currentSession,
      (event) => setEvents((current) => mergeEvent(current, event)),
      (code, reason) => {
        if (code === 4001 || reason === "participant_removed" || reason === "owner_left_room") {
          const next = { ...allSessions };
          delete next[currentSession.room_id];
          setAllSessions(next);
          saveAllSessions(window.localStorage, next);
          setEvents([]);
          setCreatedInvite(undefined);
          setLocalLaunch(undefined);
          setCreatedPairing(undefined);
          setConnectorModalPairing(undefined);
          setWaitingRoom(undefined);
          setError(reason === "owner_left_room" ? "The room owner closed the room." : "You have been removed from the room.");
          navigate("/", { replace: true });
        }
      }
    );
    return () => clearEventSocket(socket);
  }, [currentSession, sessionValid]);

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
            setAllSessions((prev) => ({ ...prev, [nextSession.room_id]: nextSession }));
            setEvents([]);
            setCreatedInvite(undefined);
            setLocalLaunch(undefined);
            setCreatedPairing(undefined);
            setConnectorModalPairing(undefined);
            setWaitingRoom(undefined);
            navigate(`/room/${nextSession.room_id}`, { replace: true });
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
  }, [waitingRoom, navigate]);

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
    setAllSessions((prev) => ({ ...prev, [nextSession.room_id]: nextSession }));
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setCreatedPairing(undefined);
    setConnectorModalPairing(undefined);
    setWaitingRoom(undefined);
    navigate(`/room/${nextSession.room_id}`, { replace: true });
  }, [navigate]);

  const clearActiveRoomSession = useCallback((roomId: string): void => {
    clearStoredSession(window.localStorage, roomId);
    setAllSessions((prev) => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    setEvents([]);
    setCreatedInvite(undefined);
    setLocalLaunch(undefined);
    setCreatedPairing(undefined);
    setConnectorModalPairing(undefined);
    setWaitingRoom(undefined);
    setError(undefined);
  }, []);

  const handleLeaveRoom = useCallback((): void => {
    if (!currentSession) return;
    if (currentSession.role !== "owner") {
      clearActiveRoomSession(currentSession.room_id);
      navigate("/", { replace: true });
      return;
    }
    void run(async () => {
      await leaveRoom(currentSession);
      clearActiveRoomSession(currentSession.room_id);
      navigate("/", { replace: true });
    });
  }, [clearActiveRoomSession, currentSession, navigate]);

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
    if (!currentSession) return;
    await run(async () => {
      await sendMessage(currentSession, text);
    });
  }, [currentSession]);

  const handleClearRoom = useCallback(() => {
    if (!currentSession) return;
    void run(async () => {
      await clearRoom(currentSession);
    });
  }, [currentSession]);

  const handleStartCollection = useCallback(() => {
    if (!currentSession) return;
    void run(async () => {
      await startAiCollection(currentSession);
    });
  }, [currentSession]);

  const handleSubmitCollection = useCallback(() => {
    if (!currentSession) return;
    void run(async () => {
      await submitAiCollection(currentSession);
    });
  }, [currentSession]);

  const handleCancelCollection = useCallback(() => {
    if (!currentSession) return;
    void run(async () => {
      await cancelAiCollection(currentSession);
    });
  }, [currentSession]);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!currentSession) return;
    void run(async () => {
      await selectAgent(currentSession, agentId);
    });
  }, [currentSession]);

  const handleCreateInvite = useCallback(async (role: string, ttl: number): Promise<string | undefined> => {
    if (!currentSession) return undefined;
    setError(undefined);
    setLoading(true);
    try {
      if (role !== "member" && role !== "observer") throw new Error("Invalid invite role");
      const invite = await createInvite(currentSession, role, ttl);
      const url = inviteUrlFor(window.location.origin, currentSession.room_id, invite.invite_token);
      setCreatedInvite({ url, role, ttl });
      return url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [currentSession]);

  const handleApproveJoinRequest = useCallback((requestId: string) => {
    if (!currentSession) return;
    void run(async () => {
      await approveJoinRequest(currentSession, requestId);
    });
  }, [currentSession]);

  const handleRejectJoinRequest = useCallback((requestId: string) => {
    if (!currentSession) return;
    void run(async () => {
      await rejectJoinRequest(currentSession, requestId);
    });
  }, [currentSession]);

  const handleRemoveParticipant = useCallback((participantId: string) => {
    if (!currentSession) return;
    void run(async () => {
      await removeParticipant(currentSession, participantId);
    });
  }, [currentSession]);

  const handleRequestRoundtable = useCallback(() => {
    if (!currentSession) return;
    void run(async () => { await requestAiCollection(currentSession); });
  }, [currentSession]);

  const handleApproveRoundtableRequest = useCallback((requestId: string) => {
    if (!currentSession) return;
    void run(async () => { await approveAiCollectionRequest(currentSession, requestId); });
  }, [currentSession]);

  const handleRejectRoundtableRequest = useCallback((requestId: string) => {
    if (!currentSession) return;
    void run(async () => { await rejectAiCollectionRequest(currentSession, requestId); });
  }, [currentSession]);

  // Redirect to root when on room route but no valid session
  useEffect(() => {
    if (urlRoomId && (!currentSession || sessionValid === false)) {
      navigate("/", { replace: true });
    }
  }, [urlRoomId, currentSession, sessionValid, navigate]);

  const content = (() => {
    if (waitingRoom) {
      return (
        <>
          <WaitingRoom displayName={waitingRoom.displayName} onCancel={handleCancelWaiting} />
          {error && (
            <div className="error banner" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
              {error}
            </div>
          )}
        </>
      );
    }

    if (urlRoomId && currentSession && sessionValid && !validating) {
      return (
        <>
          <Workspace
            session={currentSession}
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
        </>
      );
    }

    return (
      <>
        <Landing onCreate={handleCreate} onJoin={handleJoin} loading={loading} />
        {error && (
          <div className="error banner" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
            {error}
          </div>
        )}
      </>
    );
  })();

  return <LangProvider>{content}</LangProvider>;
}
