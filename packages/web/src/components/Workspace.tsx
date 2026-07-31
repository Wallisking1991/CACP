import {
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
} from "react";
import gsap from "gsap";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import {
  startTyping,
  stopTyping,
  updatePresence,
  createAgentPairing,
} from "../api.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import {
  deriveRoomState,
  humanParticipants,
  isTurnInFlight,
  computeAgentReadiness,
  claudeSelectionIsReady,
  agentSelectionIsReady,
} from "../room-state.js";
import type {
  AgentSessionReadyView,
  AgentSessionSelectionView,
  ClaudeSessionReadyView,
  ClaudeSessionSelectionView,
} from "../room-state.js";
import {
  requestClaudeSessionPreview,
  selectClaudeSession,
  requestAgentSessionPreview,
  selectAgentSession,
  sendOrbitNote,
  likeOrbitNote,
  unlikeOrbitNote,
  promoteOrbitNotes,
  sendMainInput,
  cancelMainInput,
  clearOrbit,
  deleteAttachment,
  fetchAttachmentUsage,
  resolveAgentRunApproval,
  resolveAgentRunElicitation,
  fetchAttachmentBlob,
  uploadAttachment,
  type AttachmentUsage,
} from "../api.js";
import {
  createTypingActivityController,
  type TypingActivityController,
} from "../activity-client.js";
import {
  createRoomSoundController,
  shouldPlayCueForMessage,
} from "../room-sound.js";
import { useT } from "../i18n/useT.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import MainComposer from "./MainComposer.js";
import { MainInputQueueBar } from "./MainInputQueueBar.js";
import OrbitComposer from "./OrbitComposer.js";
import { AgentSessionRequiredModal } from "./AgentSessionRequiredModal.js";
import { AgentStatusBanner } from "./AgentStatusBanner.js";
import { Popover } from "./Popover.js";
import { AgentAvatarPopover } from "./AgentAvatarPopover.js";
import { PeopleAvatarPopover } from "./PeopleAvatarPopover.js";
import { OrbitLayer } from "./OrbitLayer.js";
import { OrbitPromoteModal } from "./OrbitPromoteModal.js";
import { OrbitToggleTab } from "./OrbitToggleTab.js";
import { OrbitClearConfirmDialog } from "./OrbitClearConfirmDialog.js";
import AgentRippleOverlay from "./AgentRippleOverlay.js";
import { WhiteboardSurface } from "./WhiteboardSurface.js";
import { WhiteboardActivityObserver } from "./WhiteboardActivityObserver.js";
import type { WorkspaceMode } from "./WorkspaceModeSwitch.js";
import { loadExcalidrawEditorAdapter } from "../whiteboard/load-excalidraw-editor-adapter.js";
import type {
  WhiteboardCollaborator,
  WhiteboardEditorAdapterLoader,
} from "../whiteboard/whiteboard-editor-adapter.js";
import { loadWhiteboardSession } from "../whiteboard/load-whiteboard-session.js";
import type {
  WhiteboardSessionActivity,
  WhiteboardSessionFactoryLoader,
} from "../whiteboard/whiteboard-session.js";
import { LangContext } from "../i18n/LangProvider.js";

export interface WorkspaceProps {
  session: RoomSession;
  events: CacpEvent[];
  onLeaveRoom: () => void;
  onSendMessage: (text: string) => void;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (
    role: string,
    ttl: number,
    maxUses: number
  ) => Promise<string | undefined>;
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onUpdateParticipantRole?: (participantId: string, role: string) => void;
  onUpdateAgentThinking?: (agentId: string, enabled: boolean) => void;
  createdInvite?: {
    url: string;
    role: string;
    ttl: number;
    max_uses: number;
  };
  error?: string;
  cloudMode?: boolean;
  createdPairing?: {
    connection_code: string;
    download_url: string;
    expires_at: string;
  };
  loadWhiteboardEditorAdapter?: WhiteboardEditorAdapterLoader;
  loadWhiteboardSession?: WhiteboardSessionFactoryLoader;
  eventReplayReady?: boolean;
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
  onUpdateAgentThinking,
  createdInvite,
  error,
  cloudMode,
  createdPairing,
  loadWhiteboardEditorAdapter = loadExcalidrawEditorAdapter,
  loadWhiteboardSession: loadWhiteboardSessionFactory = loadWhiteboardSession,
  eventReplayReady = true,
}: WorkspaceProps) {
  const t = useT();
  const lang = useContext(LangContext)?.lang ?? "en";
  const room = useMemo(
    () =>
      deriveRoomState(events, {
        now: new Date().toISOString(),
        currentParticipantId: session.participant_id,
      }),
    [events, session.participant_id]
  );
  const permissions = roomPermissionsForRole(session.role);
  const isOwner = session.role === "owner";
  const peopleParticipants = useMemo(
    () => humanParticipants(room.participants),
    [room.participants]
  );

  const activeAgent = room.agents.find(
    (a) => a.agent_id === room.activeAgentId
  );
  const loadAttachment = useCallback(
    (attachment: { attachment_id: string }) =>
      fetchAttachmentBlob(session, attachment.attachment_id),
    [session]
  );
  const activeAgentProvider = activeAgent?.capabilities.includes("kimi-cli")
    ? "kimi-cli"
    : activeAgent?.capabilities.includes("github-copilot")
      ? "github-copilot"
      : activeAgent?.capabilities.includes("codex-cli")
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
  const [soundEnabled, setSoundEnabled] = useState(
    soundControllerRef.current.enabled()
  );
  const [soundVolume, setSoundVolume] = useState(
    soundControllerRef.current.volume()
  );
  const [attachmentUsage, setAttachmentUsage] = useState<AttachmentUsage>();
  const typingControllerRef = useRef<TypingActivityController | undefined>(
    undefined
  );

  const refreshAttachmentUsage = useCallback(() => {
    void fetchAttachmentUsage(session)
      .then(setAttachmentUsage)
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    refreshAttachmentUsage();
    const timer = window.setInterval(refreshAttachmentUsage, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshAttachmentUsage]);
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
  const [workspaceState, setWorkspaceState] = useState<{
    roomId: string;
    mode: WorkspaceMode;
    whiteboardOpened: boolean;
  }>({
    roomId: session.room_id,
    mode: "conversation",
    whiteboardOpened: false,
  });
  const canUseWhiteboard = session.role !== "agent";
  const workspaceMode =
    canUseWhiteboard && workspaceState.roomId === session.room_id
      ? workspaceState.mode
      : "conversation";
  const whiteboardOpened =
    canUseWhiteboard &&
    workspaceState.roomId === session.room_id &&
    workspaceState.whiteboardOpened;
  const workspaceModeRef = useRef(workspaceMode);
  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);
  const [whiteboardActiveEditorCount, setWhiteboardActiveEditorCount] =
    useState(0);
  const [hasWhiteboardActivity, setHasWhiteboardActivity] = useState(false);
  const [hasConversationActivity, setHasConversationActivity] = useState(false);
  const mainConversationActivityIds = useMemo(
    () => [
      ...room.messages.map(
        (message) =>
          message.message_id ??
          `${message.actor_id}:${message.created_at}:${message.kind}`
      ),
      ...room.streamingTurns.map((turn) => `turn:${turn.turn_id}`),
      ...room.streamingTurns.map(
        (turn) =>
          `turn-state:${turn.turn_id}:${JSON.stringify({
            text: turn.text,
            phase: turn.phase,
            current: turn.current,
            metrics: turn.metrics,
            detail: turn.detail,
            thinkingText: turn.thinkingText,
            thinkingDone: turn.thinkingDone,
          })}`
      ),
    ],
    [room.messages, room.streamingTurns]
  );
  const mainConversationActivityRef = useRef({
    roomId: session.room_id,
    ids: new Set(mainConversationActivityIds),
    replayReady: eventReplayReady,
  });
  const panelOpenRef = useRef(panelOpen);
  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const handleWorkspaceModeChange = useCallback(
    (mode: WorkspaceMode) => {
      if (mode === "whiteboard") {
        setHasWhiteboardActivity(false);
      } else {
        setHasConversationActivity(false);
      }
      setWorkspaceState((current) => ({
        roomId: session.room_id,
        mode,
        whiteboardOpened:
          mode === "whiteboard" ||
          (current.roomId === session.room_id && current.whiteboardOpened),
      }));
    },
    [session.room_id]
  );

  const handleWhiteboardCollaborators = useCallback(
    (collaborators: WhiteboardCollaborator[]) => {
      setWhiteboardActiveEditorCount(
        new Set(
          collaborators
            .filter((collaborator) => collaborator.canEdit)
            .map((collaborator) => collaborator.participantId)
        ).size
      );
    },
    []
  );

  const handleWhiteboardActivity = useCallback(
    (_activity: WhiteboardSessionActivity) => {
      if (workspaceModeRef.current !== "whiteboard") {
        setHasWhiteboardActivity(true);
      }
    },
    []
  );

  useEffect(() => {
    const previous = mainConversationActivityRef.current;
    if (previous.roomId !== session.room_id) {
      mainConversationActivityRef.current = {
        roomId: session.room_id,
        ids: new Set(mainConversationActivityIds),
        replayReady: eventReplayReady,
      };
      setWhiteboardActiveEditorCount(0);
      setHasWhiteboardActivity(false);
      setHasConversationActivity(false);
      return;
    }
    if (!eventReplayReady || !previous.replayReady) {
      mainConversationActivityRef.current = {
        roomId: session.room_id,
        ids: new Set(mainConversationActivityIds),
        replayReady: eventReplayReady,
      };
      return;
    }
    const hasNewActivity = mainConversationActivityIds.some(
      (activityId) => !previous.ids.has(activityId)
    );
    mainConversationActivityRef.current = {
      roomId: session.room_id,
      ids: new Set(mainConversationActivityIds),
      replayReady: true,
    };
    if (hasNewActivity && workspaceModeRef.current === "whiteboard") {
      setHasConversationActivity(true);
    }
  }, [eventReplayReady, mainConversationActivityIds, session.room_id]);
  const [unreadOrbit, setUnreadOrbit] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [pendingAgentName, setPendingAgentName] = useState<
    string | undefined
  >();
  const [replyToNoteId, setReplyToNoteId] = useState<string | undefined>();
  const [focusedOrbitNoteId, setFocusedOrbitNoteId] = useState<
    string | undefined
  >();
  const seenOrbitEventIdsRef = useRef<Set<string>>(new Set());
  const orbitUnreadBaselineReadyRef = useRef(false);

  const [orbitBubbles, setOrbitBubbles] = useState<
    Map<string, { text: string; id: string; noteId: string }>
  >(new Map());
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
    const orbitNoteEvents = events.filter(
      (event) => event.type === "orbit.note.created"
    );
    const newOrbitEvents = orbitNoteEvents.filter(
      (event) => !known.has(event.event_id)
    );
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
        const noteCreatedAt = payload.created_at
          ? Date.parse(payload.created_at)
          : Date.parse(event.created_at);
        return noteCreatedAt >= myJoinTime;
      }).length;
      if (foreignCount > 0) setUnreadOrbit((current) => current + foreignCount);

      const myName = peopleParticipants.find(
        (p) => p.id === session.participant_id
      )?.display_name;
      const mentionCount = newOrbitEvents.filter((event) => {
        if (event.actor_id === session.participant_id) return false;
        const payload = event.payload as {
          created_at?: string;
          text?: string;
          reply_to?: string;
        };
        const noteCreatedAt = payload.created_at
          ? Date.parse(payload.created_at)
          : Date.parse(event.created_at);
        if (noteCreatedAt < myJoinTime) return false;
        const isMentioned = myName
          ? new RegExp(
              "@" + myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            ).test(payload.text ?? "")
          : false;
        const isReplyToMe = room.orbitNotes.some(
          (n) =>
            n.note_id === payload.reply_to &&
            n.created_by === session.participant_id
        );
        return isMentioned || isReplyToMe;
      }).length;
      if (mentionCount > 0)
        setUnreadMentions((current) => current + mentionCount);
    }
  }, [
    events,
    panelOpen,
    session.participant_id,
    peopleParticipants,
    room.orbitNotes,
  ]);

  useEffect(() => {
    if (panelOpen) {
      setUnreadOrbit(0);
      setUnreadMentions(0);
    }
  }, [panelOpen]);

  useEffect(() => {
    typingControllerRef.current?.dispose();
    typingControllerRef.current = createTypingActivityController({
      startTyping: () => {
        void startTyping(session).catch(() => {});
      },
      stopTyping: () => {
        void stopTyping(session).catch(() => {});
      },
    });
    void updatePresence(session, "online").catch(() => {});
    return () => {
      typingControllerRef.current?.dispose();
    };
  }, [session]);

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
    const newEvents = events.filter(
      (e) => !prevEvents.some((pe) => pe.event_id === e.event_id)
    );
    const grew = newEvents.length > 0;
    prevEventsRef.current = events;

    if (grew) {
      window.clearTimeout(growthTimerRef.current);
      if (!initialLoadCompleteRef.current) {
        const hasRecent = newEvents.some(
          (e) => Date.now() - Date.parse(e.created_at) < 10000
        );
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
          if (
            shouldPlayCueForMessage({
              actorId: event.actor_id,
              currentParticipantId: session.participant_id,
            })
          ) {
            const kind =
              typeof event.payload.kind === "string"
                ? event.payload.kind
                : "human";
            soundControllerRef.current.play(
              kind === "agent" ? "message" : "message"
            );
          }
          break;
        }
        case "orbit.note.created": {
          const orbitText =
            typeof event.payload.text === "string" ? event.payload.text : "";
          const orbitReplyTo =
            typeof event.payload.reply_to === "string"
              ? event.payload.reply_to
              : undefined;
          const attachmentCount = Array.isArray(event.payload.attachments)
            ? event.payload.attachments.length
            : 0;
          const orbitSummary =
            orbitText.trim() ||
            String(
              t("orbit.attachmentSummary", {
                count: String(attachmentCount),
              })
            );
          const myName = peopleParticipants.find(
            (p) => p.id === session.participant_id
          )?.display_name;
          const isMentioned = myName
            ? new RegExp(
                "@" + myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              ).test(orbitText)
            : false;
          const isReplyToMe = room.orbitNotes.some(
            (n) =>
              n.note_id === orbitReplyTo &&
              n.created_by === session.participant_id
          );
          const isDirectedAtMe = isMentioned || isReplyToMe;

          if (
            shouldPlayCueForMessage({
              actorId: event.actor_id,
              currentParticipantId: session.participant_id,
            })
          ) {
            soundControllerRef.current.play(
              isDirectedAtMe ? "mention" : "message"
            );
          }

          // Browser notification for @mention / reply when page not focused
          if (
            isDirectedAtMe &&
            event.actor_id !== session.participant_id &&
            document.visibilityState === "hidden"
          ) {
            const senderName = actorNames.get(event.actor_id) || event.actor_id;
            const actionLabel = isReplyToMe
              ? t("notification.replyToYou")
              : t("notification.mentionedYou");
            const bodyText =
              orbitSummary.slice(0, 60) + (orbitSummary.length > 60 ? "…" : "");
            if (
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              const notification = new Notification(
                `${senderName} ${actionLabel}`,
                { body: bodyText }
              );
              notification.onclick = () => {
                window.focus();
                setPanelOpen(true);
                notification.close();
              };
            } else if (
              typeof Notification !== "undefined" &&
              Notification.permission === "default"
            ) {
              void Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                  const notification = new Notification(
                    `${senderName} ${actionLabel}`,
                    { body: bodyText }
                  );
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
          if (
            event.actor_id !== session.participant_id &&
            !panelOpenRef.current &&
            typeof event.payload.note_id === "string" &&
            (orbitText.length > 0 || attachmentCount > 0)
          ) {
            const avatarId = event.actor_id;
            const text = orbitSummary;
            const bubbleId = `${avatarId}-${Date.now()}`;
            setOrbitBubbles((prev) => {
              const next = new Map(prev);
              next.set(avatarId, {
                text,
                id: bubbleId,
                noteId: event.payload.note_id as string,
              });
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
  }, [
    events,
    session.room_id,
    session.participant_id,
    peopleParticipants,
    room.orbitNotes,
    actorNames,
    t,
  ]);

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
      const targets = gsap.utils.toArray<HTMLElement>(
        ".workspace-header, .thread, .main-composer"
      );
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

  const myDisplayName = peopleParticipants.find(
    (p) => p.id === session.participant_id
  )?.display_name;

  const serverUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3737";

  const agentReadiness = computeAgentReadiness(room, activeAgentProvider);
  const agentReady = agentReadiness === "ready";

  const needsClaudeSessionSelection =
    permissions.canManageControls &&
    room.activeAgentId &&
    room.claudeSessionCatalog &&
    room.claudeSessionCatalog.agent_id === room.activeAgentId &&
    !claudeSelectionIsReady(
      room.activeAgentId,
      room.claudeSessionSelection,
      room.claudeSessionReady
    );

  const needsGenericSessionSelection =
    permissions.canManageControls &&
    room.activeAgentId &&
    activeAgentProvider &&
    room.agentSessionCatalog &&
    room.agentSessionCatalog.agent_id === room.activeAgentId &&
    room.agentSessionCatalog.provider === activeAgentProvider &&
    !agentSelectionIsReady(
      room.activeAgentId,
      activeAgentProvider,
      room.agentSessionSelection,
      room.agentSessionReady
    );

  const canPromoteOrbit = permissions.canManageControls;
  const canClearOrbit = permissions.canManageControls;
  const promotableOrbitNotes = room.orbitNotes.filter((note) => !note.quoted);

  const replyToNote = replyToNoteId
    ? room.orbitNotes.find((n) => n.note_id === replyToNoteId)
    : undefined;

  const orbitPanel = panelOpen ? (
    <div className="orbit-panel" hidden={workspaceMode !== "conversation"}>
      <OrbitLayer
        notes={room.orbitNotes}
        currentParticipantId={session.participant_id}
        currentDisplayName={myDisplayName}
        actorNames={actorNames}
        actorKinds={actorKinds}
        canReact={permissions.canSendOrbitNotes}
        onLike={(noteId) => {
          void likeOrbitNote(session, noteId).catch(() => {});
        }}
        onUnlike={(noteId) => {
          void unlikeOrbitNote(session, noteId).catch(() => {});
        }}
        onReply={(noteId) => setReplyToNoteId(noteId)}
        canPromote={canPromoteOrbit}
        hasPromotable={promotableOrbitNotes.length > 0}
        onPromoteClick={() => setPromoteModalOpen(true)}
        canClear={canClearOrbit}
        onClearClick={() => setClearDialogOpen(true)}
        loadAttachment={loadAttachment}
        focusNoteId={focusedOrbitNoteId}
      />
      <OrbitPromoteModal
        open={promoteModalOpen}
        notes={promotableOrbitNotes}
        canPromote={canPromoteOrbit}
        onPromote={(noteIds, attachmentIds, instruction) => {
          void promoteOrbitNotes(
            session,
            noteIds,
            attachmentIds,
            instruction
          ).catch(() => {});
        }}
        onClose={() => setPromoteModalOpen(false)}
      />
      <OrbitComposer
        role={session.role}
        members={peopleParticipants}
        attachmentUsage={attachmentUsage}
        onUploadAttachment={
          session.role === "owner" ||
          session.role === "admin" ||
          session.role === "member"
            ? (file, options) => uploadAttachment(session, file, options)
            : undefined
        }
        onDeleteAttachment={(attachment) =>
          deleteAttachment(session, attachment.attachment_id)
        }
        onAttachmentUsageChanged={refreshAttachmentUsage}
        onSendOrbitNote={async (text, attachments, replyTo) => {
          await sendOrbitNote(
            session,
            text,
            attachments.map((attachment) => attachment.attachment_id),
            replyTo
          );
          setReplyToNoteId(undefined);
        }}
        onTypingInput={(value) =>
          typingControllerRef.current?.inputChanged(value)
        }
        onStopTyping={() => typingControllerRef.current?.stopNow()}
        replyTo={
          replyToNote
            ? {
                noteId: replyToNote.note_id,
                authorName:
                  actorNames.get(replyToNote.created_by) ||
                  replyToNote.created_by,
                text:
                  replyToNote.text ||
                  String(
                    t("orbit.attachmentSummary", {
                      count: String(replyToNote.attachments?.length ?? 0),
                    })
                  ),
              }
            : undefined
        }
        onCancelReply={() => setReplyToNoteId(undefined)}
      />
    </div>
  ) : null;

  return (
    <div className="workspace-shell" ref={shellRef}>
      {workspaceMode === "conversation" && (
        <>
          <div
            className="workspace-orb workspace-orb--primary"
            aria-hidden="true"
          />
          <div
            className="workspace-orb workspace-orb--secondary"
            aria-hidden="true"
          />
          <AgentRippleOverlay
            avatarStatuses={room.avatarStatuses}
            turnInFlight={turnInFlight}
          />
        </>
      )}
      <div
        className={`workspace-grid${
          workspaceMode === "conversation" && panelOpen
            ? " workspace-grid--with-orbit"
            : ""
        }`}
      >
        <div className="chat-panel">
          <Header
            roomName={room.roomName ?? session.room_id}
            roomId={session.room_id}
            userDisplayName={myDisplayName}
            userRole={session.role}
            isOwner={isOwner}
            avatarStatuses={room.avatarStatuses}
            onCopyRoomId={(roomId) =>
              void navigator.clipboard.writeText(roomId).catch(() => {})
            }
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
            orbitBubbles={
              workspaceMode === "conversation"
                ? new Map(
                    Array.from(orbitBubbles.entries()).map(([k, v]) => [
                      k,
                      v.text,
                    ])
                  )
                : undefined
            }
            onOrbitBubbleClick={
              workspaceMode === "conversation"
                ? (avatarId) => {
                    const bubble = orbitBubbles.get(avatarId);
                    if (!bubble) return;
                    setFocusedOrbitNoteId(bubble.noteId);
                    setPanelOpen(true);
                    const timer = orbitBubbleTimersRef.current.get(avatarId);
                    if (timer) window.clearTimeout(timer);
                    orbitBubbleTimersRef.current.delete(avatarId);
                    setOrbitBubbles((current) => {
                      const next = new Map(current);
                      next.delete(avatarId);
                      return next;
                    });
                  }
                : undefined
            }
            workspaceMode={workspaceMode}
            onWorkspaceModeChange={
              canUseWhiteboard ? handleWorkspaceModeChange : undefined
            }
            whiteboardActiveEditorCount={whiteboardActiveEditorCount}
            hasWhiteboardActivity={hasWhiteboardActivity}
            hasConversationActivity={hasConversationActivity}
          />

          <div
            id="conversation-workspace-panel"
            className="conversation-workspace"
            role={canUseWhiteboard ? "tabpanel" : undefined}
            aria-labelledby={
              canUseWhiteboard ? "conversation-workspace-tab" : undefined
            }
            hidden={workspaceMode !== "conversation"}
          >
            <AgentStatusBanner
              status={agentReadiness}
              isOwner={isOwner}
              providerLabel={activeAgent ? activeAgent.name : undefined}
            />

            <Thread
              currentParticipantId={session.participant_id}
              messages={room.messages}
              streamingTurns={room.streamingTurns}
              agentRuns={room.agentRuns}
              agents={room.agents}
              actorNames={actorNames}
              claudeImports={room.claudeImports}
              agentImports={room.agentImports}
              pendingAgentName={pendingAgentName}
              loadAttachment={loadAttachment}
              onResolveApproval={(runId, nodeId, decision, reason) => {
                void resolveAgentRunApproval({
                  serverUrl,
                  roomId: session.room_id,
                  token: session.token,
                  runId,
                  nodeId,
                  decision,
                  reason,
                }).catch(() => {});
              }}
              onResolveElicitation={(runId, nodeId, action, content) => {
                void resolveAgentRunElicitation({
                  serverUrl,
                  roomId: session.room_id,
                  token: session.token,
                  runId,
                  nodeId,
                  action,
                  content,
                }).catch(() => {});
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
              agentReady={agentReady}
              attachmentCapabilities={activeAgent?.input_capabilities}
              attachmentUsage={attachmentUsage}
              onUploadAttachment={
                session.role === "owner" || session.role === "admin"
                  ? (file, options) => uploadAttachment(session, file, options)
                  : undefined
              }
              onDeleteAttachment={(attachment) =>
                deleteAttachment(session, attachment.attachment_id)
              }
              onAttachmentUsageChanged={refreshAttachmentUsage}
              onSendMainInput={async (text, attachments) => {
                const agent = room.agents.find(
                  (a) => a.agent_id === room.activeAgentId
                );
                if (!turnInFlight) {
                  setPendingAgentName(agent?.name ?? t("message.ai"));
                }
                try {
                  await sendMainInput(
                    session,
                    text,
                    attachments.map((attachment) => attachment.attachment_id)
                  );
                } catch (cause) {
                  if (!turnInFlight) setPendingAgentName(undefined);
                  throw cause;
                }
              }}
              onTypingInput={(value) =>
                typingControllerRef.current?.inputChanged(value)
              }
              onStopTyping={() => typingControllerRef.current?.stopNow()}
            />

            {needsClaudeSessionSelection &&
              room.activeAgentId &&
              room.claudeSessionCatalog && (
                <div className="agent-session-inline">
                  <AgentSessionRequiredModal
                    agentId={room.activeAgentId}
                    provider="claude-code"
                    inline
                    catalog={room.claudeSessionCatalog}
                    previews={room.claudeSessionPreviews}
                    onRequestPreview={(sessionId) =>
                      requestClaudeSessionPreview({
                        serverUrl,
                        roomId: session.room_id,
                        token: session.token,
                        agentId: room.activeAgentId!,
                        sessionId,
                      })
                    }
                    onSelect={(selection) =>
                      selectClaudeSession({
                        serverUrl,
                        roomId: session.room_id,
                        token: session.token,
                        agentId: room.activeAgentId!,
                        ...selection,
                      })
                    }
                  />
                </div>
              )}

            {needsGenericSessionSelection &&
              room.activeAgentId &&
              room.agentSessionCatalog &&
              activeAgentProvider && (
                <div className="agent-session-inline">
                  <AgentSessionRequiredModal
                    agentId={room.activeAgentId}
                    provider={activeAgentProvider}
                    inline
                    catalog={room.agentSessionCatalog}
                    previews={room.agentSessionPreviews}
                    onRequestPreview={(sessionId) =>
                      requestAgentSessionPreview({
                        serverUrl,
                        roomId: session.room_id,
                        token: session.token,
                        agentId: room.activeAgentId!,
                        provider: activeAgentProvider,
                        sessionId,
                      })
                    }
                    onSelect={(selection) =>
                      selectAgentSession({
                        serverUrl,
                        roomId: session.room_id,
                        token: session.token,
                        agentId: room.activeAgentId!,
                        provider: activeAgentProvider,
                        ...selection,
                      })
                    }
                  />
                </div>
              )}

            {error && (
              <p
                className="error inline-error"
                style={{ padding: "0 16px 12px" }}
              >
                {error}
              </p>
            )}
          </div>

          {canUseWhiteboard && !whiteboardOpened && (
            <WhiteboardActivityObserver
              identity={{
                roomId: session.room_id,
                participantId: session.participant_id,
                token: session.token,
                role: session.role === "agent" ? "observer" : session.role,
              }}
              loadSession={loadWhiteboardSessionFactory}
              onCollaboratorsChange={handleWhiteboardCollaborators}
              onActivity={handleWhiteboardActivity}
            />
          )}

          {canUseWhiteboard && (
            <div
              id="whiteboard-workspace-panel"
              className="whiteboard-workspace"
              role="tabpanel"
              aria-labelledby="whiteboard-workspace-tab"
              hidden={workspaceMode !== "whiteboard"}
            >
              {whiteboardOpened && (
                <WhiteboardSurface
                  active={workspaceMode === "whiteboard"}
                  identity={{
                    roomId: session.room_id,
                    participantId: session.participant_id,
                    token: session.token,
                    role: session.role === "agent" ? "observer" : session.role,
                  }}
                  loadEditorAdapter={loadWhiteboardEditorAdapter}
                  loadSession={loadWhiteboardSessionFactory}
                  langCode={lang}
                  name={`${room.roomName ?? session.room_id} — ${String(
                    t("workspace.whiteboard")
                  )}`}
                  onCollaboratorsChange={handleWhiteboardCollaborators}
                  onActivity={handleWhiteboardActivity}
                />
              )}
            </div>
          )}
        </div>

        {orbitPanel}
      </div>

      <Popover
        triggerRef={railRef}
        open={peoplePopoverOpen}
        onClose={() => setPeoplePopoverOpen(false)}
      >
        <PeopleAvatarPopover
          participants={peopleParticipants}
          isOwner={isOwner}
          canRemoveParticipants={permissions.canRemoveParticipants}
          currentParticipantId={session.participant_id}
          onRemoveParticipant={onRemoveParticipant}
          onUpdateRole={onUpdateParticipantRole}
        />
      </Popover>

      <Popover
        triggerRef={railRef}
        open={agentPopoverOpen}
        onClose={() => setAgentPopoverOpen(false)}
      >
        <AgentAvatarPopover
          agents={room.agents}
          activeAgentId={room.activeAgentId}
          canManageRoom={permissions.canManageControls}
          isOwner={isOwner}
          onSelectAgent={onSelectAgent}
          onUpdateAgentThinking={onUpdateAgentThinking}
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
            requestClaudeSessionPreview({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              sessionId,
            })
          }
          onSelectClaudeSession={(selection) =>
            selectClaudeSession({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              ...selection,
            })
          }
          onRequestAgentSessionPreview={(sessionId) =>
            requestAgentSessionPreview({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              provider: activeAgentProvider ?? "claude-code",
              sessionId,
            })
          }
          onSelectAgentSession={(selection) =>
            selectAgentSession({
              serverUrl,
              roomId: session.room_id,
              token: session.token,
              agentId: room.activeAgentId ?? "",
              provider: activeAgentProvider ?? "claude-code",
              ...selection,
            })
          }
        />
      </Popover>

      {workspaceMode === "conversation" && panelOpen && (
        <button
          type="button"
          className="orbit-mobile-backdrop"
          aria-label={String(t("orbit.toggle"))}
          onClick={() => setPanelOpen(false)}
        />
      )}
      {workspaceMode === "conversation" && (
        <OrbitToggleTab
          open={panelOpen}
          unreadCount={unreadOrbit}
          hasMentions={unreadMentions > 0}
          onClick={() => setPanelOpen((open) => !open)}
        />
      )}
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
