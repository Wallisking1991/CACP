import { useState, useEffect, useMemo, useRef } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { startTyping, stopTyping, updatePresence, createAgentPairing } from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import { deriveRoomState, humanParticipants, isCollectionActive, isTurnInFlight } from "../room-state.js";
import { requestClaudeSessionPreview, selectClaudeSession } from "../api.js";
import { createTypingActivityController, type TypingActivityController } from "../activity-client.js";
import { createRoomSoundController, shouldPlayCueForMessage } from "../room-sound.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import Composer from "./Composer.js";
import JoinRequestModal from "./JoinRequestModal.js";
import RoundtableRequestModal from "./RoundtableRequestModal.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";
import { AgentSessionRequiredModal } from "./AgentSessionRequiredModal.js";
import { FloatingLogoControl } from "./FloatingLogoControl.js";
import { RoomControlCenter } from "./RoomControlCenter.js";

export interface WorkspaceProps {
  session: RoomSession;
  events: CacpEvent[];
  onLeaveRoom: () => void;
  onClearRoom: () => void;
  onSendMessage: (text: string) => void;
  onStartCollection: () => void;
  onSubmitCollection: () => void;
  onCancelCollection: () => void;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (role: string, ttl: number) => Promise<string | undefined>;
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onRequestRoundtable: () => void;
  onApproveRoundtableRequest: (requestId: string) => void;
  onRejectRoundtableRequest: (requestId: string) => void;
  createdInvite?: { url: string; role: string; ttl: number };
  error?: string;
  cloudMode?: boolean;
  createdPairing?: { connection_code: string; download_url: string; expires_at: string };
}

export default function Workspace({
  session,
  events,
  onLeaveRoom,
  onClearRoom,
  onSendMessage,
  onStartCollection,
  onSubmitCollection,
  onCancelCollection,
  onSelectAgent,
  onCreateInvite,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onRemoveParticipant,
  onRequestRoundtable,
  onApproveRoundtableRequest,
  onRejectRoundtableRequest,
  createdInvite,
  error,
  cloudMode,
  createdPairing,
}: WorkspaceProps) {
  const [typingTick, setTypingTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setTypingTick(Date.now()), 2000);
    return () => window.clearInterval(interval);
  }, []);

  const room = useMemo(() => deriveRoomState(events, { now: new Date(typingTick).toISOString() }), [events, typingTick]);
  const permissions = roomPermissionsForRole(session.role);
  const isOwner = session.role === "owner";
  const peopleParticipants = useMemo(() => humanParticipants(room.participants), [room.participants]);

  const activeAgent = room.agents.find((a) => a.agent_id === room.activeAgentId);
  const turnInFlight = isTurnInFlight(events);
  const collectionActive = isCollectionActive(events);

  const composerMode: "live" | "collect" = collectionActive ? "collect" : "live";

  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of room.participants) names.set(p.id, p.display_name);
    for (const a of room.agents) names.set(a.agent_id, a.name);
    return names;
  }, [room.participants, room.agents]);

  const [controlCenterOpen, setControlCenterOpen] = useState(false);
  const soundControllerRef = useRef(createRoomSoundController());
  const [soundEnabled, setSoundEnabled] = useState(soundControllerRef.current.enabled());
  const [soundVolume, setSoundVolume] = useState(soundControllerRef.current.volume());
  const typingControllerRef = useRef<TypingActivityController | undefined>();
  const prevEventsRef = useRef<CacpEvent[]>([]);
  const initialLoadCompleteRef = useRef(false);
  const growthTimerRef = useRef<number>(0);
  const lastRoomIdRef = useRef(session.room_id);

  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const [dismissedJoinRequestIds, setDismissedJoinRequestIds] = useState<Set<string>>(() => new Set());
  const [dismissedRoundtableRequestIds, setDismissedRoundtableRequestIds] = useState<Set<string>>(() => new Set());

  const visibleJoinRequest = useMemo(() => {
    if (!isOwner) return undefined;
    return room.joinRequests.find((request) => !dismissedJoinRequestIds.has(request.request_id));
  }, [dismissedJoinRequestIds, isOwner, room.joinRequests]);

  const remainingJoinRequestCount = visibleJoinRequest
    ? room.joinRequests.filter((request) => request.request_id !== visibleJoinRequest.request_id && !dismissedJoinRequestIds.has(request.request_id)).length
    : 0;

  useEffect(() => {
    const pendingIds = new Set(room.joinRequests.map((request) => request.request_id));
    setDismissedJoinRequestIds((current) => {
      const next = new Set([...current].filter((requestId) => pendingIds.has(requestId)));
      return next.size === current.size ? current : next;
    });
  }, [room.joinRequests]);

  const visibleRoundtableRequest = useMemo(() => {
    if (!isOwner) return undefined;
    return room.pendingRoundtableRequest && !dismissedRoundtableRequestIds.has(room.pendingRoundtableRequest.request_id)
      ? room.pendingRoundtableRequest
      : undefined;
  }, [dismissedRoundtableRequestIds, isOwner, room.pendingRoundtableRequest]);

  useEffect(() => {
    if (visibleJoinRequest || visibleRoundtableRequest) {
      setControlCenterOpen(false);
    }
  }, [visibleJoinRequest, visibleRoundtableRequest]);

  useEffect(() => {
    if (room.pendingRoundtableRequest) return;
    setDismissedRoundtableRequestIds((current) => {
      if (current.size === 0) return current;
      return new Set();
    });
  }, [room.pendingRoundtableRequest]);

  const streamingKey = useMemo(
    () => room.streamingTurns.map((t) => t.turn_id).join("|"),
    [room.streamingTurns]
  );

  useEffect(() => {
    if (!streamingKey) {
      setShowSlowStreamingNotice(false);
      return;
    }
    setShowSlowStreamingNotice(false);
    const timeout = window.setTimeout(() => setShowSlowStreamingNotice(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [streamingKey]);

  useEffect(() => {
    typingControllerRef.current?.dispose();
    typingControllerRef.current = createTypingActivityController({
      startTyping: () => { void startTyping(session).catch(() => {}); },
      stopTyping: () => { void stopTyping(session).catch(() => {}); }
    });
    void updatePresence(session, "online").catch(() => {});
    return () => {
      typingControllerRef.current?.dispose();
    };
  }, [session.room_id, session.token, session.participant_id]);

  useEffect(() => {
    return () => window.clearTimeout(growthTimerRef.current);
  }, []);

  useEffect(() => {
    if (lastRoomIdRef.current !== session.room_id) {
      lastRoomIdRef.current = session.room_id;
      prevEventsRef.current = [];
      initialLoadCompleteRef.current = false;
      window.clearTimeout(growthTimerRef.current);
    }

    const prevEvents = prevEventsRef.current;
    const newEvents = events.filter((e) => !prevEvents.some((pe) => pe.event_id === e.event_id));
    const grew = newEvents.length > 0;
    prevEventsRef.current = events;

    if (grew) {
      window.clearTimeout(growthTimerRef.current);
      if (!initialLoadCompleteRef.current) {
        const hasRecent = newEvents.some((e) => Date.now() - Date.parse(e.created_at) < 10000);
        if (hasRecent) {
          initialLoadCompleteRef.current = true;
        } else {
          growthTimerRef.current = window.setTimeout(() => {
            initialLoadCompleteRef.current = true;
          }, 300);
        }
      }
    }

    if (!initialLoadCompleteRef.current) return;

    for (const event of newEvents) {
      switch (event.type) {
        case "message.created": {
          if (shouldPlayCueForMessage({ actorId: event.actor_id, currentParticipantId: session.participant_id })) {
            const kind = typeof event.payload.kind === "string" ? event.payload.kind : "human";
            soundControllerRef.current.play(kind === "agent" ? "message" : "message");
          }
          break;
        }
        case "agent.turn.started": {
          soundControllerRef.current.play("ai-start");
          break;
        }
        case "join_request.created": {
          soundControllerRef.current.play("join-request");
          break;
        }
        case "ai.collection.started": {
          soundControllerRef.current.play("roundtable");
          break;
        }
        case "agent.status_changed": {
          if (event.payload.status === "online") {
            soundControllerRef.current.play("agent-online");
          }
          break;
        }
      }
    }
  }, [events, session.room_id, session.participant_id]);

  const collectCount = room.activeCollection?.messages.length ?? 0;

  const myDisplayName = peopleParticipants.find((p) => p.id === session.participant_id)?.display_name;

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3737";

  const needsSessionSelection =
    permissions.canManageControls &&
    room.activeAgentId &&
    room.claudeSessionCatalog &&
    room.claudeSessionCatalog.agent_id === room.activeAgentId &&
    (!room.claudeSessionSelection || room.claudeSessionSelection.agent_id !== room.activeAgentId);

  return (
    <div className="workspace-shell">
      <div className="workspace-grid">
        <div className="chat-panel">
          <Header
            roomName={room.roomName ?? session.room_id}
            roomId={session.room_id}
            userDisplayName={myDisplayName}
            userRole={session.role}
            isOwner={isOwner}
            avatarStatuses={room.avatarStatuses}
            onCopyRoomId={(roomId) => void navigator.clipboard.writeText(roomId).catch(() => {})}
            onCreatePairing={async (agentType, permissionLevel) => {
              const result = await createAgentPairing(session, {
                agent_type: agentType,
                permission_level: permissionLevel,
                working_dir: ".",
              });
              return result.connection_code;
            }}
          />

          <Thread
            currentParticipantId={session.participant_id}
            messages={room.messages}
            streamingTurns={room.streamingTurns}
            actorNames={actorNames}
            showSlowStreamingNotice={showSlowStreamingNotice}
            activeCollectionId={room.activeCollection?.collection_id}
            claudeImports={room.claudeImports}
          />

          <Composer
            role={session.role}
            mode={composerMode}
            turnInFlight={turnInFlight}
            collectCount={collectCount}
            canSendMessages={permissions.canSendMessages}
            pendingRoundtableRequest={Boolean(room.pendingRoundtableRequest)}
            onSend={onSendMessage}
            onToggleMode={composerMode === "live" ? onStartCollection : onCancelCollection}
            onSubmitCollection={onSubmitCollection}
            onCancelCollection={onCancelCollection}
            onRequestRoundtable={onRequestRoundtable}
            onTypingInput={(value) => typingControllerRef.current?.inputChanged(value)}
            onStopTyping={() => typingControllerRef.current?.stopNow()}
            onClearConversation={onClearRoom}
          />

          {error && (
            <p className="error inline-error" style={{ padding: "0 16px 12px" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      <JoinRequestModal
        request={visibleJoinRequest}
        remainingCount={remainingJoinRequestCount}
        onApprove={onApproveJoinRequest}
        onReject={onRejectJoinRequest}
        onLater={(requestId) => setDismissedJoinRequestIds((current) => new Set(current).add(requestId))}
      />

      <RoundtableRequestModal
        request={visibleRoundtableRequest}
        turnInFlight={turnInFlight}
        onApprove={onApproveRoundtableRequest}
        onReject={onRejectRoundtableRequest}
        onLater={(requestId) => setDismissedRoundtableRequestIds((current) => new Set(current).add(requestId))}
      />

      {needsSessionSelection && room.activeAgentId && room.claudeSessionCatalog && (
        <AgentSessionRequiredModal
          agentId={room.activeAgentId}
          catalog={room.claudeSessionCatalog}
          previews={room.claudeSessionPreviews}
          onRequestPreview={(sessionId) =>
            requestClaudeSessionPreview({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId, sessionId })
          }
          onSelect={(selection) =>
            selectClaudeSession({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId, ...selection })
          }
        />
      )}

      <FloatingLogoControl
        active={turnInFlight}
        pendingCount={(visibleJoinRequest ? 1 : 0) + (visibleRoundtableRequest ? 1 : 0)}
        onOpen={() => setControlCenterOpen(true)}
      />

      <RoomControlCenter
        open={controlCenterOpen}
        onClose={() => setControlCenterOpen(false)}
        soundEnabled={soundEnabled}
        soundVolume={soundVolume}
        onSoundEnabledChange={(enabled) => {
          soundControllerRef.current.setEnabled(enabled);
          setSoundEnabled(enabled);
        }}
        onSoundVolumeChange={(volume) => {
          soundControllerRef.current.setVolume(volume);
          setSoundVolume(volume);
        }}
        onTestSound={() => soundControllerRef.current.play("message")}
        agents={room.agents}
        activeAgentId={room.activeAgentId}
        participants={peopleParticipants}
        inviteCount={room.inviteCount}
        isOwner={isOwner}
        roomId={session.room_id}
        onLeaveRoom={onLeaveRoom}
        onCreateInvite={onCreateInvite}
        onSelectAgent={onSelectAgent}
        onRemoveParticipant={onRemoveParticipant}
        onClearRoom={onClearRoom}
        joinRequests={room.joinRequests}
        onApproveJoinRequest={onApproveJoinRequest}
        onRejectJoinRequest={onRejectJoinRequest}
        createdInvite={createdInvite}
        cloudMode={cloudMode}
        createdPairing={createdPairing}
        canManageRoom={permissions.canManageControls}
        claudeSessionCatalog={room.claudeSessionCatalog}
        claudeSessionSelection={room.claudeSessionSelection}
        claudeSessionPreviews={room.claudeSessionPreviews}
        claudeRuntimeStatuses={room.claudeRuntimeStatuses}
        serverUrl={serverUrl}
        roomSessionToken={session.token}
        roomSessionParticipantId={session.participant_id}
        onRequestClaudeSessionPreview={(sessionId) =>
          requestClaudeSessionPreview({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", sessionId })
        }
        onSelectClaudeSession={(selection) =>
          selectClaudeSession({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", ...selection })
        }
      />
    </div>
  );
}
