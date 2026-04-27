import { useState, useEffect, useMemo } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import { deriveRoomState, isCollectionActive, isTurnInFlight } from "../room-state.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import Composer from "./Composer.js";
import MobileDrawer from "./MobileDrawer.js";

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
  createdInvite,
  error,
  cloudMode,
  createdPairing,
}: WorkspaceProps) {
  const room = useMemo(() => deriveRoomState(events), [events]);
  const permissions = roomPermissionsForRole(session.role);
  const isOwner = session.role === "owner";

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
    participants: room.participants,
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

  const collectCount = room.activeCollection?.messages.length ?? 0;

  const myDisplayName = room.participants.find((p) => p.id === session.participant_id)?.display_name;

  return (
    <div className="workspace-shell">
      <div className="workspace-grid">
        <div className="chat-panel">
          <Header
            roomName={room.roomName ?? session.room_id}
            roomId={session.room_id}
            userDisplayName={myDisplayName}
            participantCount={room.participants.length}
            agentName={activeAgent?.name}
            agentOnline={activeAgent?.status === "online"}
            mode={mode}
            isOwner={isOwner}
            onClearRoom={onClearRoom}
            onLeaveRoom={onLeaveRoom}
            onOpenDrawer={() => setDrawerOpen(true)}
          />

          <Thread
            messages={room.messages}
            streamingTurns={room.streamingTurns}
            actorNames={actorNames}
            showSlowStreamingNotice={showSlowStreamingNotice}
            activeCollectionId={room.activeCollection?.collection_id}
          />

          <Composer
            role={session.role}
            mode={composerMode}
            turnInFlight={turnInFlight}
            collectCount={collectCount}
            canSendMessages={permissions.canSendMessages}
            onSend={onSendMessage}
            onToggleMode={composerMode === "live" ? onStartCollection : onCancelCollection}
            onSubmitCollection={onSubmitCollection}
            onCancelCollection={onCancelCollection}
          />

          {error && (
            <p className="error inline-error" style={{ padding: "0 16px 12px" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      <MobileDrawer
        {...sidebarProps}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
