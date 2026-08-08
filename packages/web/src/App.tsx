import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import type { CacpEvent } from "@cacp/protocol";
import {
  approveJoinRequest,
  clearEventSocket,
  connectEvents,
  createAgentPairing,
  createInvite,
  createJoinRequest,
  createLocalAgentLaunch,
  createRoom,
  createRoomWithLocalAgent,
  fetchRoomEvents,
  getRoomMe,
  inviteUrlFor,
  joinRequestStatus,
  leaveRoom,
  parseInviteUrl,
  rejectJoinRequest,
  removeParticipant,
  selectAgent,
  sendMessage,
  sendCollaborationDiagnostics,
  updateAgentThinking,
  updateParticipantRole,
  type LocalAgentLaunch,
  type RoomSession,
} from "./api.js";
import {
  mergeEvent,
  mergeEvents,
  reconcileAuthoritativeEvents,
} from "./event-log.js";
import { createCollaborationDiagnostics } from "./collaboration-diagnostics.js";
import {
  clearStoredSession,
  loadAllSessions,
  saveAllSessions,
  saveStoredSession,
} from "./session-storage.js";
import { LangProvider } from "./i18n/LangProvider.js";
import { isCloudMode } from "./runtime-config.js";
import ConnectionCodeModal, {
  type ConnectionCodeModalPairing,
} from "./components/ConnectionCodeModal.js";
import Landing from "./components/Landing.js";
import WaitingRoom from "./components/WaitingRoom.js";
import "./App.css";

const Workspace = lazy(() => import("./components/Workspace.js"));

const roomRoles: ReadonlySet<RoomSession["role"]> = new Set([
  "owner",
  "admin",
  "member",
  "observer",
  "agent",
]);
const eventReplayRetryDelaysMs = [250, 1_000] as const;

function isRoomRole(value: string): value is RoomSession["role"] {
  return roomRoles.has(value as RoomSession["role"]);
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const roomMatch = useMatch("/room/:roomId");
  const urlRoomId = roomMatch?.params.roomId;

  const inviteTarget = useMemo(() => {
    if (location.pathname === "/join") {
      return (
        parseInviteUrl(location.search) ??
        parseInviteUrl(location.hash.replace(/^#/, "?"))
      );
    }
    return undefined;
  }, [location.pathname, location.search, location.hash]);

  const [allSessions, setAllSessions] = useState<Record<string, RoomSession>>(
    () => loadAllSessions(window.localStorage)
  );
  const currentSession = urlRoomId ? allSessions[urlRoomId] : undefined;

  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [eventReplayReadySessionKey, setEventReplayReadySessionKey] =
    useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    url: string;
    role: string;
    ttl: number;
    max_uses: number;
  }>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();
  const [createdPairing, setCreatedPairing] = useState<{
    connection_code: string;
    download_url: string;
    expires_at: string;
  }>();
  const [connectorModalPairing, setConnectorModalPairing] =
    useState<ConnectionCodeModalPairing>();
  const [waitingRoom, setWaitingRoom] = useState<
    | {
        roomId: string;
        requestId: string;
        requestToken: string;
        displayName: string;
      }
    | undefined
  >();
  const currentSessionValidationKey = currentSession
    ? `${currentSession.room_id}:${currentSession.token}`
    : undefined;
  const [sessionValidation, setSessionValidation] = useState<{
    key: string;
    valid: boolean;
  }>();
  const sessionValid =
    sessionValidation && sessionValidation.key === currentSessionValidationKey
      ? sessionValidation.valid
      : undefined;
  const diagnostics = useMemo(
    () =>
      currentSession
        ? createCollaborationDiagnostics({
            send: (batch) =>
              sendCollaborationDiagnostics(currentSession, batch),
          })
        : undefined,
    [currentSession]
  );
  useEffect(
    () => () => {
      void diagnostics?.destroy();
    },
    [diagnostics]
  );
  const validating =
    currentSessionValidationKey !== undefined && sessionValid === undefined;
  const waitingRoomRef = useRef(waitingRoom);
  waitingRoomRef.current = waitingRoom;

  // Validate session when URL roomId changes
  useEffect(() => {
    if (!urlRoomId || !currentSession || !currentSessionValidationKey) return;
    let cancelled = false;
    getRoomMe(currentSession)
      .then(() => {
        if (!cancelled) {
          setSessionValidation({
            key: currentSessionValidationKey,
            valid: true,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSessionValidation({
          key: currentSessionValidationKey,
          valid: false,
        });
        const next = { ...allSessions };
        delete next[urlRoomId];
        setAllSessions(next);
        saveAllSessions(window.localStorage, next);
      });
    return () => {
      cancelled = true;
    };
  }, [allSessions, currentSession, currentSessionValidationKey, urlRoomId]);

  // WebSocket connection for current room
  useEffect(() => {
    if (!currentSession || !sessionValid) return;
    let cancelled = false;
    let replayRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const socket = connectEvents(
      currentSession,
      (event) => {
        setEvents((current) => {
          const merged = mergeEvent(current, event);
          if (merged === current) {
            diagnostics?.record({
              area: event.type.startsWith("orbit.") ? "orbit" : "room_state",
              action: "event_duplicate",
              event_type: event.type,
              event_id: event.event_id,
              was_duplicate: true,
            });
          }
          return merged;
        });
        // Session-selection events trigger a server-side purge of prior content events.
        // Re-fetch the authoritative event log so the client mirrors the new server state.
        if (
          event.type === "claude.session_selected" ||
          event.type === "agent.session_selected"
        ) {
          void fetchRoomEvents(currentSession)
            .then((fresh) =>
              setEvents((current) => {
                const reconciled = reconcileAuthoritativeEvents(current, fresh);
                diagnostics?.record({
                  area: "room_state",
                  action: "state_reconciled",
                  event_count: reconciled.length,
                  orbit_note_count: reconciled.filter(
                    (item) => item.type === "orbit.note.created"
                  ).length,
                });
                return reconciled;
              })
            )
            .catch(() => {});
        }
        if (event.type === "participant.role_updated") {
          const payload = event.payload as {
            participant_id?: string;
            new_role?: string;
          };
          if (
            payload.participant_id === currentSession.participant_id &&
            payload.new_role &&
            isRoomRole(payload.new_role) &&
            payload.new_role !== currentSession.role
          ) {
            const updated = { ...currentSession, role: payload.new_role };
            saveStoredSession(window.localStorage, updated);
            setAllSessions((prev) => ({ ...prev, [updated.room_id]: updated }));
          }
        }
      },
      (code, reason) => {
        if (
          code === 4001 ||
          reason === "invalid_token" ||
          reason === "participant_removed" ||
          reason === "owner_left_room" ||
          reason === "room_ended"
        ) {
          setAllSessions((current) => {
            const next = { ...current };
            delete next[currentSession.room_id];
            saveAllSessions(window.localStorage, next);
            return next;
          });
          setEvents([]);
          setCreatedInvite(undefined);
          setLocalLaunch(undefined);
          setCreatedPairing(undefined);
          setConnectorModalPairing(undefined);
          setWaitingRoom(undefined);
          setError(
            reason === "owner_left_room" || reason === "room_ended"
              ? "The room owner closed the room."
              : "You have been removed from the room."
          );
          navigate("/", { replace: true });
        }
      },
      diagnostics
    );
    const bootstrapReplay = (attempt: number) => {
      diagnostics?.record({
        area: "room_state",
        action: "replay_started",
        reconnect_attempt: attempt,
      });
      void fetchRoomEvents(currentSession)
        .then((replayedEvents) => {
          if (cancelled) return;
          setEvents((current) =>
            mergeEvents(
              current.filter(
                (currentEvent) =>
                  currentEvent.room_id === currentSession.room_id
              ),
              replayedEvents
            )
          );
          setEventReplayReadySessionKey(currentSessionValidationKey);
          diagnostics?.record({
            area: "room_state",
            action: "replay_succeeded",
            reconnect_attempt: attempt,
            event_count: replayedEvents.length,
          });
        })
        .catch(() => {
          if (cancelled) return;
          const retryDelay = eventReplayRetryDelaysMs[attempt];
          diagnostics?.record({
            area: "room_state",
            action: "replay_failed",
            reconnect_attempt: attempt,
            ...(retryDelay !== undefined ? { retry_delay_ms: retryDelay } : {}),
          });
          if (retryDelay !== undefined) {
            replayRetryTimer = setTimeout(
              () => bootstrapReplay(attempt + 1),
              retryDelay
            );
            return;
          }
          // The live stream remains authoritative. After bounded retries,
          // treat everything received so far as the read baseline instead of
          // permanently disabling unread activity.
          setEventReplayReadySessionKey(currentSessionValidationKey);
        });
    };
    bootstrapReplay(0);
    return () => {
      cancelled = true;
      if (replayRetryTimer) clearTimeout(replayRetryTimer);
      clearEventSocket(socket);
    };
  }, [
    currentSession,
    currentSessionValidationKey,
    diagnostics,
    navigate,
    sessionValid,
  ]);

  // Poll join-request status when in waiting room
  useEffect(() => {
    if (!waitingRoom) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled && waitingRoomRef.current) {
        try {
          const status = await joinRequestStatus(
            waitingRoomRef.current.roomId,
            waitingRoomRef.current.requestId,
            waitingRoomRef.current.requestToken
          );
          if (
            status.status === "approved" &&
            status.participant_id &&
            status.participant_token &&
            status.role
          ) {
            const nextSession: RoomSession = {
              room_id: waitingRoomRef.current.roomId,
              token: status.participant_token,
              participant_id: status.participant_id,
              role: status.role,
            };
            saveStoredSession(window.localStorage, nextSession);
            setAllSessions((prev) => ({
              ...prev,
              [nextSession.room_id]: nextSession,
            }));
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
            setError(
              status.status === "rejected"
                ? "Your join request was rejected by the room owner."
                : "Your join request has expired."
            );
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
    return () => {
      cancelled = true;
    };
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

  const activateSession = useCallback(
    (nextSession: RoomSession): void => {
      saveStoredSession(window.localStorage, nextSession);
      setAllSessions((prev) => ({
        ...prev,
        [nextSession.room_id]: nextSession,
      }));
      setEvents([]);
      setCreatedInvite(undefined);
      setLocalLaunch(undefined);
      setCreatedPairing(undefined);
      setConnectorModalPairing(undefined);
      setWaitingRoom(undefined);
      navigate(`/room/${nextSession.room_id}`, { replace: true });
    },
    [navigate]
  );

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

  const handleCreate = useCallback(
    async (params: {
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
    },
    [activateSession]
  );

  const handleJoin = useCallback(
    async (params: {
      roomId: string;
      inviteToken: string;
      displayName: string;
    }) => {
      await run(async () => {
        const result = await createJoinRequest(
          params.roomId,
          params.inviteToken,
          params.displayName
        );
        setWaitingRoom({
          roomId: params.roomId,
          requestId: result.request_id,
          requestToken: result.request_token,
          displayName: params.displayName,
        });
      });
    },
    []
  );

  const handleCancelWaiting = useCallback(() => {
    setWaitingRoom(undefined);
    setError(undefined);
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!currentSession) return;
      await run(async () => {
        await sendMessage(currentSession, text);
      });
    },
    [currentSession]
  );

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      if (!currentSession) return;
      void run(async () => {
        await selectAgent(currentSession, agentId);
      });
    },
    [currentSession]
  );

  const handleCreateInvite = useCallback(
    async (
      role: string,
      ttl: number,
      maxUses: number
    ): Promise<string | undefined> => {
      if (!currentSession) return undefined;
      setError(undefined);
      setLoading(true);
      try {
        if (role !== "member" && role !== "observer")
          throw new Error("Invalid invite role");
        const invite = await createInvite(currentSession, role, ttl, maxUses);
        const url = inviteUrlFor(
          window.location.origin,
          currentSession.room_id,
          invite.invite_token
        );
        setCreatedInvite({ url, role, ttl, max_uses: invite.max_uses });
        return url;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [currentSession]
  );

  const handleApproveJoinRequest = useCallback(
    (requestId: string) => {
      if (!currentSession) return;
      void run(async () => {
        await approveJoinRequest(currentSession, requestId);
      });
    },
    [currentSession]
  );

  const handleRejectJoinRequest = useCallback(
    (requestId: string) => {
      if (!currentSession) return;
      void run(async () => {
        await rejectJoinRequest(currentSession, requestId);
      });
    },
    [currentSession]
  );

  const handleRemoveParticipant = useCallback(
    (participantId: string) => {
      if (!currentSession) return;
      void run(async () => {
        await removeParticipant(currentSession, participantId);
      });
    },
    [currentSession]
  );

  const handleUpdateParticipantRole = useCallback(
    (participantId: string, role: string) => {
      if (!currentSession) return;
      void run(async () => {
        await updateParticipantRole(currentSession, participantId, role);
      });
    },
    [currentSession]
  );

  const handleUpdateAgentThinking = useCallback(
    (agentId: string, enabled: boolean) => {
      if (!currentSession) return;
      void run(async () => {
        await updateAgentThinking(currentSession, agentId, enabled);
      });
    },
    [currentSession]
  );

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
          <WaitingRoom
            displayName={waitingRoom.displayName}
            onCancel={handleCancelWaiting}
          />
          {error && (
            <div
              className="error banner"
              style={{
                position: "fixed",
                bottom: 16,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 100,
              }}
            >
              {error}
            </div>
          )}
        </>
      );
    }

    if (urlRoomId && currentSession && sessionValid && !validating) {
      return (
        <>
          <Suspense
            fallback={
              <div
                className="workspace-loading"
                role="status"
                aria-live="polite"
              >
                Loading room…
              </div>
            }
          >
            <Workspace
              session={currentSession}
              diagnostics={diagnostics}
              events={events}
              eventReplayReady={
                eventReplayReadySessionKey === currentSessionValidationKey
              }
              onLeaveRoom={handleLeaveRoom}
              onSendMessage={handleSendMessage}
              onSelectAgent={handleSelectAgent}
              onCreateInvite={handleCreateInvite}
              onApproveJoinRequest={handleApproveJoinRequest}
              onRejectJoinRequest={handleRejectJoinRequest}
              onRemoveParticipant={handleRemoveParticipant}
              onUpdateParticipantRole={handleUpdateParticipantRole}
              onUpdateAgentThinking={handleUpdateAgentThinking}
              createdInvite={createdInvite}
              error={error}
              cloudMode={isCloudMode()}
              createdPairing={createdPairing}
            />
          </Suspense>
          <ConnectionCodeModal
            pairing={connectorModalPairing}
            onClose={() => setConnectorModalPairing(undefined)}
          />
        </>
      );
    }

    return (
      <>
        <Landing
          onCreate={handleCreate}
          onJoin={handleJoin}
          loading={loading}
        />
        {error && (
          <div
            className="error banner"
            style={{
              position: "fixed",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 100,
            }}
          >
            {error}
          </div>
        )}
      </>
    );
  })();

  return <LangProvider>{content}</LangProvider>;
}
