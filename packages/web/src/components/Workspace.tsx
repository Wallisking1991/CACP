import { useState, useEffect, useMemo, useRef } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { startTyping, stopTyping, updatePresence } from "../api.js";
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
  const room = useMemo(() => deriveRoomState(events), [events]);
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
  const typingControllerRef = useRef<TypingActivityController | undefined>();
  const previousMessageCountRef = useRef(room.messages.length);
  const previousStreamingCountRef = useRef(room.streamingTurns.length);

  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const [dismissedJoinRequestIds, setDismissedJoinRequestIds] = useState<Set<string>>(() => new Set());
  const [dismissedRoundtableRequestIds, setDismissedRoundtableRequestIds] = useState<Set<string>>(() => new Set());

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
      void updatePresence(session, "offline").catch(() => {});
    };
  }, [session.room_id, session.token, session.participant_id]);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    const nextMessages = room.messages.slice(previousMessageCount);
    for (const message of nextMessages) {
      if (shouldPlayCueForMessage({ actorId: message.actor_id, currentParticipantId: session.participant_id })) {
        soundControllerRef.current.play(message.kind === "agent" ? "ai-start" : "message");
      }
    }
    previousMessageCountRef.current = room.messages.length;

    if (room.streamingTurns.length > previousStreamingCountRef.current) {
      soundControllerRef.current.play("ai-start");
    }
    previousStreamingCountRef.current = room.streamingTurns.length;
  }, [room.messages, room.streamingTurns, session.participant_id]);

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
    if (room.pendingRoundtableRequest) return;
    setDismissedRoundtableRequestIds((current) => {
      if (current.size === 0) return current;
      return new Set();
    });
  }, [room.pendingRoundtableRequest]);

  const collectCount = room.activeCollection?.messages.length ?? 0;

  const myDisplayName = peopleParticipants.find((p) => p.id === session.participant_id)?.display_name;

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3737";

  return (
    <div className="workspace-shell">
      <div className="workspace-grid">
        <div className="chat-panel">
          <Header
            roomName={room.roomName ?? session.room_id}
            roomId={session.room_id}
            userDisplayName={myDisplayName}
            userRole={session.role}
            avatarStatuses={room.avatarStatuses}
            onCopyRoomId={(roomId) => void navigator.clipboard.writeText(roomId).catch(() => {})}
          />

          <ClaudeSessionPicker
            canManageRoom={permissions.canManageControls}
            agentId={room.activeAgentId ?? ""}
            catalog={room.claudeSessionCatalog}
            selection={room.claudeSessionSelection}
            previews={room.claudeSessionPreviews}
            onRequestPreview={(sessionId) => requestClaudeSessionPreview({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              sessionId
            })}
            onSelect={(selection) => selectClaudeSession({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              mode: selection.mode,
              sessionId: selection.mode === "resume" ? selection.sessionId : undefined
            })}
          />
          {room.claudeRuntimeStatuses.map((status) => (
            <ClaudeStatusCard key={status.status_id} status={status} />
          ))}

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

      <FloatingLogoControl
        active={turnInFlight}
        pendingCount={(visibleJoinRequest ? 1 : 0) + (visibleRoundtableRequest ? 1 : 0)}
        onOpen={() => setControlCenterOpen(true)}
      />

      <RoomControlCenter
        open={controlCenterOpen}
        onClose={() => setControlCenterOpen(false)}
        soundEnabled={soundEnabled}
        onSoundEnabledChange={(enabled) => {
          soundControllerRef.current.setEnabled(enabled);
          setSoundEnabled(enabled);
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
      />
    </div>
  );
}
