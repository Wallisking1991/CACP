import { useState, useEffect, useMemo } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import { deriveRoomState, humanParticipants, isCollectionActive, isTurnInFlight } from "../room-state.js";
import { selectClaudeSession } from "../api.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import Composer from "./Composer.js";
import MobileDrawer from "./MobileDrawer.js";
import JoinRequestModal from "./JoinRequestModal.js";
import RoundtableRequestModal from "./RoundtableRequestModal.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";

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

  const mode: "live" | "collect" | "replying" = collectionActive
    ? "collect"
    : turnInFlight
    ? "replying"
    : "live";

  const composerMode: "live" | "collect" = collectionActive ? "collect" : "live";

  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of room.participants) names.set(p.id, p.display_name);
    for (const a of room.agents) names.set(a.agent_id, a.name);
    return names;
  }, [room.participants, room.agents]);

  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const sidebarProps = {
    agents: room.agents,
    activeAgentId: room.activeAgentId,
    participants: peopleParticipants,
    inviteCount: room.inviteCount,
    joinRequests: room.joinRequests,
    isOwner,
    canManageRoom: permissions.canManageControls,
    currentParticipantId: session.participant_id,
    onSelectAgent,
    onCreateInvite,
    onApproveJoinRequest,
    onRejectJoinRequest,
    onRemoveParticipant,
    createdInvite,
    cloudMode,
    createdPairing,
  };

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
            participantCount={peopleParticipants.length}
            agentName={activeAgent?.name}
            agentOnline={activeAgent?.status === "online"}
            mode={mode}
            isOwner={isOwner}
            onClearRoom={onClearRoom}
            onLeaveRoom={onLeaveRoom}
            onOpenDrawer={() => setDrawerOpen(true)}
          />

          <ClaudeSessionPicker
            canManageRoom={permissions.canManageControls}
            agentId={room.activeAgentId ?? ""}
            catalog={room.claudeSessionCatalog}
            selection={room.claudeSessionSelection}
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

      <MobileDrawer
        {...sidebarProps}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
