import { useState, useEffect, useMemo, useRef } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { startTyping, stopTyping, updatePresence, createAgentPairing } from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import { deriveRoomState, humanParticipants, isCollectionActive, isTurnInFlight } from "../room-state.js";
import type { AgentSessionReadyView, AgentSessionSelectionView, ClaudeSessionReadyView, ClaudeSessionSelectionView } from "../room-state.js";
import { requestClaudeSessionPreview, selectClaudeSession, requestAgentSessionPreview, selectAgentSession } from "../api.js";
import { createTypingActivityController, type TypingActivityController } from "../activity-client.js";
import { createRoomSoundController, shouldPlayCueForMessage } from "../room-sound.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import Composer from "./Composer.js";
import { AgentSessionRequiredModal } from "./AgentSessionRequiredModal.js";
import { FloatingLogoControl } from "./FloatingLogoControl.js";
import { Popover } from "./Popover.js";
import { AgentAvatarPopover } from "./AgentAvatarPopover.js";
import { PeopleAvatarPopover } from "./PeopleAvatarPopover.js";

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
  onCreateInvite: (role: string, ttl: number, maxUses: number) => Promise<string | undefined>;
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

function claudeSelectionIsReady(
  activeAgentId: string | undefined,
  selection: ClaudeSessionSelectionView | undefined,
  ready: ClaudeSessionReadyView | undefined
): boolean {
  if (!activeAgentId || !selection || !ready) return false;
  if (selection.agent_id !== activeAgentId || ready.agent_id !== activeAgentId) return false;
  if (selection.mode !== ready.mode) return false;
  if (selection.mode === "resume") return ready.mode === "resume" && ready.session_id === selection.session_id;
  return ready.mode === "fresh";
}

function agentSelectionIsReady(
  activeAgentId: string | undefined,
  activeAgentProvider: "claude-code" | "codex-cli" | undefined,
  selection: AgentSessionSelectionView | undefined,
  ready: AgentSessionReadyView | undefined
): boolean {
  if (!activeAgentId || !activeAgentProvider || !selection || !ready) return false;
  if (selection.agent_id !== activeAgentId || ready.agent_id !== activeAgentId) return false;
  if (selection.provider !== activeAgentProvider || ready.provider !== activeAgentProvider) return false;
  if (selection.mode !== ready.mode) return false;
  if (selection.mode === "resume") return ready.mode === "resume" && ready.session_id === selection.session_id;
  return ready.mode === "fresh";
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
  const activeAgentProvider = activeAgent?.capabilities.includes("codex-cli")
    ? "codex-cli"
    : activeAgent?.capabilities.includes("claude-code")
      ? "claude-code"
      : undefined;
  const turnInFlight = isTurnInFlight(events);
  const collectionActive = isCollectionActive(events);

  const composerMode: "live" | "collect" = collectionActive ? "collect" : "live";

  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of room.participants) names.set(p.id, p.display_name);
    for (const a of room.agents) names.set(a.agent_id, a.name);
    return names;
  }, [room.participants, room.agents]);

  const soundControllerRef = useRef(createRoomSoundController());
  const [soundEnabled, setSoundEnabled] = useState(soundControllerRef.current.enabled());
  const [soundVolume, setSoundVolume] = useState(soundControllerRef.current.volume());
  const typingControllerRef = useRef<TypingActivityController | undefined>();
  const prevEventsRef = useRef<CacpEvent[]>([]);
  const initialLoadCompleteRef = useRef(false);
  const growthTimerRef = useRef<number>(0);
  const lastRoomIdRef = useRef(session.room_id);
  const railRef = useRef<HTMLDivElement>(null);

  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [peoplePopoverOpen, setPeoplePopoverOpen] = useState(false);

  const pendingNotificationCount = useMemo(() => {
    if (!isOwner) return 0;
    let count = room.joinRequests.length;
    if (room.pendingRoundtableRequest) count += 1;
    return count;
  }, [isOwner, room.joinRequests, room.pendingRoundtableRequest]);

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

  const needsClaudeSessionSelection =
    permissions.canManageControls &&
    room.activeAgentId &&
    room.claudeSessionCatalog &&
    room.claudeSessionCatalog.agent_id === room.activeAgentId &&
    !claudeSelectionIsReady(room.activeAgentId, room.claudeSessionSelection, room.claudeSessionReady);

  const needsGenericSessionSelection =
    permissions.canManageControls &&
    room.activeAgentId &&
    activeAgentProvider &&
    room.agentSessionCatalog &&
    room.agentSessionCatalog.agent_id === room.activeAgentId &&
    room.agentSessionCatalog.provider === activeAgentProvider &&
    !agentSelectionIsReady(room.activeAgentId, activeAgentProvider, room.agentSessionSelection, room.agentSessionReady);

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
            onLeaveRoom={onLeaveRoom}
            onCreatePairing={async (agentType, permissionLevel) => {
              const result = await createAgentPairing(session, {
                agent_type: agentType,
                permission_level: permissionLevel,
                working_dir: ".",
              });
              return result.connection_code;
            }}
            onCreateInvite={onCreateInvite}
            onRemoveAvatar={onRemoveParticipant}
            currentParticipantId={session.participant_id}
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
            pendingNotificationCount={pendingNotificationCount}
            joinRequests={room.joinRequests}
            roundtableRequest={room.pendingRoundtableRequest ?? undefined}
            turnInFlight={turnInFlight}
            onApproveJoinRequest={onApproveJoinRequest}
            onRejectJoinRequest={onRejectJoinRequest}
            onApproveRoundtableRequest={onApproveRoundtableRequest}
            onRejectRoundtableRequest={onRejectRoundtableRequest}
            onClickHumanAvatar={() => setPeoplePopoverOpen(true)}
            onClickAgentAvatar={() => setAgentPopoverOpen(true)}
            railRef={railRef}
            createdInvite={createdInvite}
            invites={room.invites}
          />

          <Thread
            currentParticipantId={session.participant_id}
            messages={room.messages}
            streamingTurns={room.streamingTurns}
            actorNames={actorNames}
            showSlowStreamingNotice={showSlowStreamingNotice}
            activeCollectionId={room.activeCollection?.collection_id}
            claudeImports={room.claudeImports}
            agentImports={room.agentImports}
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

      {needsClaudeSessionSelection && room.activeAgentId && room.claudeSessionCatalog && (
        <AgentSessionRequiredModal
          agentId={room.activeAgentId}
          provider="claude-code"
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

      {needsGenericSessionSelection && room.activeAgentId && room.agentSessionCatalog && activeAgentProvider && (
        <AgentSessionRequiredModal
          agentId={room.activeAgentId}
          provider={activeAgentProvider}
          catalog={room.agentSessionCatalog}
          previews={room.agentSessionPreviews}
          onRequestPreview={(sessionId) =>
            requestAgentSessionPreview({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId, provider: activeAgentProvider, sessionId })
          }
          onSelect={(selection) =>
            selectAgentSession({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId, provider: activeAgentProvider, ...selection })
          }
        />
      )}

      <Popover triggerRef={railRef} open={peoplePopoverOpen} onClose={() => setPeoplePopoverOpen(false)}>
        <PeopleAvatarPopover
          participants={peopleParticipants}
          isOwner={isOwner}
          currentParticipantId={session.participant_id}
          onRemoveParticipant={onRemoveParticipant}
        />
      </Popover>

      <Popover triggerRef={railRef} open={agentPopoverOpen} onClose={() => setAgentPopoverOpen(false)}>
        <AgentAvatarPopover
          agents={room.agents}
          activeAgentId={room.activeAgentId}
          canManageRoom={permissions.canManageControls}
          onSelectAgent={onSelectAgent}
          claudeSessionCatalog={room.claudeSessionCatalog}
          claudeSessionSelection={room.claudeSessionSelection}
          claudeSessionPreviews={room.claudeSessionPreviews}
          claudeRuntimeStatuses={room.claudeRuntimeStatuses}
          agentSessionCatalog={room.agentSessionCatalog}
          agentSessionSelection={room.agentSessionSelection}
          agentSessionPreviews={room.agentSessionPreviews}
          agentRuntimeStatuses={room.agentRuntimeStatuses}
          serverUrl={serverUrl}
          roomSessionToken={session.token}
          roomSessionParticipantId={session.participant_id}
          onRequestClaudeSessionPreview={(sessionId) =>
            requestClaudeSessionPreview({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", sessionId })
          }
          onSelectClaudeSession={(selection) =>
            selectClaudeSession({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", ...selection })
          }
          onRequestAgentSessionPreview={(sessionId) =>
            requestAgentSessionPreview({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", provider: activeAgentProvider ?? "claude-code", sessionId })
          }
          onSelectAgentSession={(selection) =>
            selectAgentSession({ serverUrl, roomId: session.room_id, token: session.token, agentId: room.activeAgentId ?? "", provider: activeAgentProvider ?? "claude-code", ...selection })
          }
        />
      </Popover>

      <FloatingLogoControl active={turnInFlight} pendingCount={0} onOpen={() => {}} />
    </div>
  );
}
