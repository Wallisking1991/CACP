import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import gsap from "gsap";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { startTyping, stopTyping, updatePresence, createAgentPairing } from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import { deriveRoomState, humanParticipants, isTurnInFlight } from "../room-state.js";
import type { AgentSessionReadyView, AgentSessionSelectionView, ClaudeSessionReadyView, ClaudeSessionSelectionView } from "../room-state.js";
import { requestClaudeSessionPreview, selectClaudeSession, requestAgentSessionPreview, selectAgentSession, sendOrbitNote, likeOrbitNote, unlikeOrbitNote, promoteOrbitNotes, sendMainInput, cancelMainInput, clearOrbit, resolveAgentRunApproval, resolveAgentRunElicitation } from "../api.js";
import { createTypingActivityController, type TypingActivityController } from "../activity-client.js";
import { createRoomSoundController, shouldPlayCueForMessage } from "../room-sound.js";
import { useT } from "../i18n/useT.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import MainComposer from "./MainComposer.js";
import { MainInputQueueBar } from "./MainInputQueueBar.js";
import OrbitComposer from "./OrbitComposer.js";
import { AgentSessionRequiredModal } from "./AgentSessionRequiredModal.js";
import { Popover } from "./Popover.js";
import { AgentAvatarPopover } from "./AgentAvatarPopover.js";
import { PeopleAvatarPopover } from "./PeopleAvatarPopover.js";
import { OrbitLayer } from "./OrbitLayer.js";
import { OrbitPromoteModal } from "./OrbitPromoteModal.js";
import { OrbitToggleTab } from "./OrbitToggleTab.js";
import { OrbitClearConfirmDialog } from "./OrbitClearConfirmDialog.js";
import AgentRippleOverlay from "./AgentRippleOverlay.js";

export interface WorkspaceProps {
  session: RoomSession;
  events: CacpEvent[];
  onLeaveRoom: () => void;
  onSendMessage: (text: string) => void;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (role: string, ttl: number, maxUses: number) => Promise<string | undefined>;
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onUpdateParticipantRole?: (participantId: string, role: string) => void;
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
  onSendMessage,
  onSelectAgent,
  onCreateInvite,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onRemoveParticipant,
  onUpdateParticipantRole,
  createdInvite,
  error,
  cloudMode,
  createdPairing,
}: WorkspaceProps) {
  const t = useT();
  const room = useMemo(
    () => deriveRoomState(events, { now: new Date().toISOString(), currentParticipantId: session.participant_id }),
    [events, session.participant_id]
  );
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

  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of room.participants) names.set(p.id, p.display_name);
    for (const a of room.agents) names.set(a.agent_id, a.name);
    return names;
  }, [room.participants, room.agents]);

  const actorKinds = useMemo(() => {
    const kinds = new Map<string, "human" | "agent">();
    for (const p of room.participants) kinds.set(p.id, "human");
    for (const a of room.agents) kinds.set(a.agent_id, "agent");
    return kinds;
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

  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [peoplePopoverOpen, setPeoplePopoverOpen] = useState(false);
  const [wantsReselect, setWantsReselect] = useState(false);
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  useEffect(() => { panelOpenRef.current = panelOpen; }, [panelOpen]);
  const [unreadOrbit, setUnreadOrbit] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [pendingAgentName, setPendingAgentName] = useState<string | undefined>();
  const [replyToNoteId, setReplyToNoteId] = useState<string | undefined>();
  const seenOrbitEventIdsRef = useRef<Set<string>>(new Set());
  const orbitUnreadBaselineReadyRef = useRef(false);

  const [orbitBubbles, setOrbitBubbles] = useState<Map<string, { text: string; id: string }>>(new Map());
  const orbitBubbleTimersRef = useRef<Map<string, number>>(new Map());

  const pendingNotificationCount = useMemo(() => {
    if (!permissions.canManageJoinRequests) return 0;
    return room.joinRequests.length;
  }, [permissions.canManageJoinRequests, room.joinRequests]);

  const streamingKey = useMemo(
    () => room.streamingTurns.map((t) => t.turn_id).join("|"),
    [room.streamingTurns]
  );

  useEffect(() => {
    if (events.length === 0) return;
    const known = seenOrbitEventIdsRef.current;
    const orbitNoteEvents = events.filter((event) => event.type === "orbit.note.created");
    const newOrbitEvents = orbitNoteEvents.filter((event) => !known.has(event.event_id));
    for (const event of orbitNoteEvents) known.add(event.event_id);
    if (!orbitUnreadBaselineReadyRef.current) {
      orbitUnreadBaselineReadyRef.current = true;
      return;
    }
    if (!panelOpen) {
      const myJoinEvent = events.find((event) => {
        if (event.type !== "participant.joined") return false;
        const payload = event.payload as { participant?: { id?: string } };
        return payload.participant?.id === session.participant_id;
      });
      const myJoinTime = myJoinEvent ? Date.parse(myJoinEvent.created_at) : 0;
      const foreignCount = newOrbitEvents.filter((event) => {
        if (event.actor_id === session.participant_id) return false;
        const payload = event.payload as { created_at?: string };
        const noteCreatedAt = payload.created_at ? Date.parse(payload.created_at) : Date.parse(event.created_at);
        return noteCreatedAt >= myJoinTime;
      }).length;
      if (foreignCount > 0) setUnreadOrbit((current) => current + foreignCount);

      const myName = peopleParticipants.find((p) => p.id === session.participant_id)?.display_name;
      const mentionCount = newOrbitEvents.filter((event) => {
        if (event.actor_id === session.participant_id) return false;
        const payload = event.payload as { created_at?: string; text?: string; reply_to?: string };
        const noteCreatedAt = payload.created_at ? Date.parse(payload.created_at) : Date.parse(event.created_at);
        if (noteCreatedAt < myJoinTime) return false;
        const isMentioned = myName ? new RegExp("@" + myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(payload.text ?? "") : false;
        const isReplyToMe = room.orbitNotes.some((n) => n.note_id === payload.reply_to && n.created_by === session.participant_id);
        return isMentioned || isReplyToMe;
      }).length;
      if (mentionCount > 0) setUnreadMentions((current) => current + mentionCount);
    }
  }, [events, panelOpen, session.participant_id, peopleParticipants, room.orbitNotes]);

  useEffect(() => {
    if (panelOpen) {
      setUnreadOrbit(0);
      setUnreadMentions(0);
    }
  }, [panelOpen]);

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
        case "orbit.note.created": {
          const orbitText = typeof event.payload.text === "string" ? event.payload.text : "";
          const orbitReplyTo = typeof event.payload.reply_to === "string" ? event.payload.reply_to : undefined;
          const myName = peopleParticipants.find((p) => p.id === session.participant_id)?.display_name;
          const isMentioned = myName ? new RegExp("@" + myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(orbitText) : false;
          const isReplyToMe = room.orbitNotes.some((n) => n.note_id === orbitReplyTo && n.created_by === session.participant_id);
          const isDirectedAtMe = isMentioned || isReplyToMe;

          if (shouldPlayCueForMessage({ actorId: event.actor_id, currentParticipantId: session.participant_id })) {
            soundControllerRef.current.play(isDirectedAtMe ? "mention" : "message");
          }

          // Browser notification for @mention / reply when page not focused
          if (isDirectedAtMe && event.actor_id !== session.participant_id && document.visibilityState === "hidden") {
            const senderName = actorNames.get(event.actor_id) || event.actor_id;
            const actionLabel = isReplyToMe ? t("notification.replyToYou") : t("notification.mentionedYou");
            const bodyText = orbitText.slice(0, 60) + (orbitText.length > 60 ? "…" : "");
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              const notification = new Notification(`${senderName} ${actionLabel}`, { body: bodyText });
              notification.onclick = () => {
                window.focus();
                setPanelOpen(true);
                notification.close();
              };
            } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
              void Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                  const notification = new Notification(`${senderName} ${actionLabel}`, { body: bodyText });
                  notification.onclick = () => {
                    window.focus();
                    setPanelOpen(true);
                    notification.close();
                  };
                }
              });
            }
          }

          // Show bubble if not self and orbit panel is closed
          if (event.actor_id !== session.participant_id && !panelOpenRef.current && typeof event.payload.text === "string") {
            const avatarId = event.actor_id;
            const text = event.payload.text;
            const bubbleId = `${avatarId}-${Date.now()}`;
            setOrbitBubbles((prev) => {
              const next = new Map(prev);
              next.set(avatarId, { text, id: bubbleId });
              return next;
            });
            // Clear any existing timer for this avatar
            const existingTimer = orbitBubbleTimersRef.current.get(avatarId);
            if (existingTimer) window.clearTimeout(existingTimer);
            const timer = window.setTimeout(() => {
              setOrbitBubbles((prev) => {
                const next = new Map(prev);
                const current = next.get(avatarId);
                if (current && current.id === bubbleId) {
                  next.delete(avatarId);
                }
                return next;
              });
              orbitBubbleTimersRef.current.delete(avatarId);
            }, 4000); // slightly longer than bubble duration (3500ms) + exit animation
            orbitBubbleTimersRef.current.set(avatarId, timer);
          }
          break;
        }
        case "agent.turn.started": {
          setPendingAgentName(undefined);
          soundControllerRef.current.play("ai-start");
          break;
        }
        case "join_request.created": {
          soundControllerRef.current.play("join-request");
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
  }, [events, session.room_id, session.participant_id, peopleParticipants, room.orbitNotes]);

  const shellRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      const targets = gsap.utils.toArray<HTMLElement>(".workspace-header, .thread, .main-composer");
      const orbitPanel = shell.querySelector<HTMLElement>(".orbit-panel");
      if (orbitPanel) targets.push(orbitPanel);

      gsap.set(targets, { opacity: 0, y: 14 });

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        delay: 0.15,
      });

      tl.to(".workspace-header", { opacity: 1, y: 0, duration: 0.5 })
        .to(".thread", { opacity: 1, y: 0, duration: 0.45 }, "-=0.28")
        .to(".main-composer", { opacity: 1, y: 0, duration: 0.4 }, "-=0.24");

      if (orbitPanel) {
        tl.to(orbitPanel, { opacity: 1, y: 0, duration: 0.4 }, "-=0.28");
      }
    }, shell);

    return () => ctx.revert();
  }, []);

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

  const canPromoteOrbit = permissions.canManageControls;
  const canClearOrbit = permissions.canManageControls;
  const promotableOrbitNotes = room.orbitNotes.filter((note) => !note.quoted);

  const replyToNote = replyToNoteId ? room.orbitNotes.find((n) => n.note_id === replyToNoteId) : undefined;

  const orbitPanel = panelOpen ? (
    <div className="orbit-panel">
      <OrbitLayer
        notes={room.orbitNotes}
        currentParticipantId={session.participant_id}
        currentDisplayName={myDisplayName}
        actorNames={actorNames}
        actorKinds={actorKinds}
        canReact={permissions.canSendOrbitNotes}
        onLike={(noteId) => { void likeOrbitNote(session, noteId).catch(() => {}); }}
        onUnlike={(noteId) => { void unlikeOrbitNote(session, noteId).catch(() => {}); }}
        onReply={(noteId) => setReplyToNoteId(noteId)}
        canPromote={canPromoteOrbit}
        hasPromotable={promotableOrbitNotes.length > 0}
        onPromoteClick={() => setPromoteModalOpen(true)}
        canClear={canClearOrbit}
        onClearClick={() => setClearDialogOpen(true)}
      />
      <OrbitPromoteModal
        open={promoteModalOpen}
        notes={promotableOrbitNotes}
        canPromote={canPromoteOrbit}
        onPromote={(noteIds) => { void promoteOrbitNotes(session, noteIds).catch(() => {}); }}
        onClose={() => setPromoteModalOpen(false)}
      />
      <OrbitComposer
        role={session.role}
        members={peopleParticipants}
        onSendOrbitNote={(text, replyTo) => {
          void sendOrbitNote(session, text, replyTo).catch(() => {});
          setReplyToNoteId(undefined);
        }}
        onTypingInput={(value) => typingControllerRef.current?.inputChanged(value)}
        onStopTyping={() => typingControllerRef.current?.stopNow()}
        replyTo={replyToNote ? {
          noteId: replyToNote.note_id,
          authorName: actorNames.get(replyToNote.created_by) || replyToNote.created_by,
          text: replyToNote.text,
        } : undefined}
        onCancelReply={() => setReplyToNoteId(undefined)}
      />
    </div>
  ) : null;

  return (
    <div className="workspace-shell" ref={shellRef}>
      <div className="workspace-orb workspace-orb--primary" aria-hidden="true" />
      <div className="workspace-orb workspace-orb--secondary" aria-hidden="true" />
      <AgentRippleOverlay avatarStatuses={room.avatarStatuses} turnInFlight={turnInFlight} />
      <div className={`workspace-grid${panelOpen ? " workspace-grid--with-orbit" : ""}`}>
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
            turnInFlight={turnInFlight}
            onApproveJoinRequest={onApproveJoinRequest}
            onRejectJoinRequest={onRejectJoinRequest}
            onClickHumanAvatar={() => setPeoplePopoverOpen(true)}
            onClickAgentAvatar={() => setAgentPopoverOpen(true)}
            railRef={railRef}
            createdInvite={createdInvite}
            invites={room.invites}
            orbitBubbles={new Map(Array.from(orbitBubbles.entries()).map(([k, v]) => [k, v.text]))}
          />

          <Thread
            currentParticipantId={session.participant_id}
            messages={room.messages}
            streamingTurns={room.streamingTurns}
            agentRuns={room.agentRuns}
            actorNames={actorNames}
            claudeImports={room.claudeImports}
            agentImports={room.agentImports}
            pendingAgentName={pendingAgentName}
            onResolveApproval={(runId, nodeId, decision, reason) => {
              void resolveAgentRunApproval({ serverUrl, roomId: session.room_id, token: session.token, runId, nodeId, decision, reason }).catch(() => {});
            }}
            onResolveElicitation={(runId, nodeId, action, content) => {
              void resolveAgentRunElicitation({ serverUrl, roomId: session.room_id, token: session.token, runId, nodeId, action, content }).catch(() => {});
            }}
          />

          <MainInputQueueBar
            queue={room.mainInputQueue}
            onCancel={(inputId) => {
              void cancelMainInput(session, inputId).catch(() => {});
            }}
          />

          <MainComposer
            role={session.role}
            turnInFlight={turnInFlight}
            agents={room.agents}
            onSendMainInput={(text) => {
              const agent = room.agents.find((a) => a.agent_id === room.activeAgentId);
              if (!turnInFlight) {
                setPendingAgentName(agent?.name ?? t("message.ai"));
              }
              void sendMainInput(session, text).catch(() => {});
            }}
            onTypingInput={(value) => typingControllerRef.current?.inputChanged(value)}
            onStopTyping={() => typingControllerRef.current?.stopNow()}
          />

          {error && (
            <p className="error inline-error" style={{ padding: "0 16px 12px" }}>
              {error}
            </p>
          )}
        </div>

        {orbitPanel}
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
          canRemoveParticipants={permissions.canRemoveParticipants}
          currentParticipantId={session.participant_id}
          onRemoveParticipant={onRemoveParticipant}
          onUpdateRole={onUpdateParticipantRole}
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
          agentSessionCatalog={room.agentSessionCatalog}
          agentSessionSelection={room.agentSessionSelection}
          agentSessionPreviews={room.agentSessionPreviews}
          serverUrl={serverUrl}
          roomSessionToken={session.token}
          roomSessionParticipantId={session.participant_id}
          wantsReselect={wantsReselect}
          onReselectChange={setWantsReselect}
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

      {panelOpen && (
        <button
          type="button"
          className="orbit-mobile-backdrop"
          aria-label={String(t("orbit.toggle"))}
          onClick={() => setPanelOpen(false)}
        />
      )}
      <OrbitToggleTab
        open={panelOpen}
        unreadCount={unreadOrbit}
        hasMentions={unreadMentions > 0}
        onClick={() => setPanelOpen((open) => !open)}
      />
      <OrbitClearConfirmDialog
        open={clearDialogOpen}
        onCancel={() => setClearDialogOpen(false)}
        onConfirm={() => {
          setClearDialogOpen(false);
          void clearOrbit(session).catch(() => {});
        }}
      />
    </div>
  );
}
