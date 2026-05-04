import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import type { AvatarStatusView, InviteView, JoinRequestView } from "../room-state.js";
import { RoomIdentity } from "./RoomIdentity.js";
import CacpRoomLogo from "./CacpRoomLogo.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";
import { MoreMenu } from "./MoreMenu.js";
import { BellIcon } from "./RoomIcons.js";
import { Popover } from "./Popover.js";
import { NotificationPanel } from "./NotificationPanel.js";

type AnimationState = "idle" | "thinking" | "streaming";

interface Ripple {
  id: number;
  x: number;
  y: number;
  mode: "thinking" | "streaming";
}

function deriveAgentAnimationState(
  avatarStatuses: AvatarStatusView[],
  turnInFlight: boolean,
): AnimationState {
  if (!turnInFlight) return "idle";
  const agent = avatarStatuses.find((a) => a.kind === "agent");
  if (!agent) return "idle";
  if (agent.status === "typing") return "streaming";
  if (agent.status === "working") return "thinking";
  return "idle";
}

function findEmptyArea(headerEl: HTMLElement): { x: number; y: number } | null {
  const brand = headerEl.querySelector(".header-brand") as HTMLElement | null;
  const identity = headerEl.querySelector(".room-identity") as HTMLElement | null;
  const rail = headerEl.querySelector(".role-avatar-rail") as HTMLElement | null;
  const actions = headerEl.querySelector(".header-actions") as HTMLElement | null;

  if (!brand || !identity || !rail || !actions) return null;

  const headerRect = headerEl.getBoundingClientRect();
  const brandRect = brand.getBoundingClientRect();
  const identityRect = identity.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const actionsRect = actions.getBoundingClientRect();

  const gapBStart = identityRect.right - headerRect.left;
  const gapBEnd = railRect.left - headerRect.left;
  const gapCStart = railRect.right - headerRect.left;
  const gapCEnd = actionsRect.left - headerRect.left;

  const gapBWidth = gapBEnd - gapBStart;
  const gapCWidth = gapCEnd - gapCStart;

  let usableStart = gapBStart;
  let usableEnd = gapBEnd;

  if (gapBWidth >= 0 && gapCWidth >= 0) {
    usableStart = gapBStart;
    usableEnd = gapCEnd;
  } else if (gapCWidth > gapBWidth) {
    usableStart = gapCStart;
    usableEnd = gapCEnd;
  }

  const usableWidth = usableEnd - usableStart;
  if (usableWidth < 80) return null;

  const centerX = usableStart + usableWidth / 2 + (Math.random() * 40 - 20);
  const centerY = headerRect.height / 2 + (Math.random() * 16 - 8);

  return { x: centerX, y: centerY };
}

function HeaderBackground({
  avatarStatuses,
  turnInFlight,
  headerRef,
}: {
  avatarStatuses: AvatarStatusView[];
  turnInFlight: boolean;
  headerRef: React.RefObject<HTMLElement | null>;
}) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [emptyArea, setEmptyArea] = useState<{ x: number; y: number } | null>(null);
  const stateRef = useRef<AnimationState>("idle");
  const nextIdRef = useRef(0);

  const state = deriveAgentAnimationState(avatarStatuses, turnInFlight);
  stateRef.current = state;

  useLayoutEffect(() => {
    function compute() {
      if (headerRef.current) {
        setEmptyArea(findEmptyArea(headerRef.current));
      }
    }
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [headerRef]);

  useEffect(() => {
    if (state === "idle") return;

    const intervalMs = state === "streaming" ? 800 : 2500;
    const initialDelay = state === "thinking" ? 1500 : 0;

    const spawn = () => {
      const area = emptyArea;
      if (!area) return;

      setRipples((prev) => {
        const next: Ripple = {
          id: nextIdRef.current++,
          x: area.x,
          y: area.y,
          mode: stateRef.current === "streaming" ? "streaming" : "thinking",
        };
        const combined = [...prev, next];
        return combined.slice(-3);
      });
    };

    let intervalId: ReturnType<typeof setInterval>;
    const initialTimer = setTimeout(() => {
      spawn();
      intervalId = setInterval(spawn, intervalMs);
    }, initialDelay);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [state, emptyArea]);

  const removeRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const waveStyle = emptyArea
    ? ({ "--wave-x": `${emptyArea.x}px`, "--wave-y": `${emptyArea.y}px` } as React.CSSProperties)
    : undefined;

  return (
    <div className="header-background" aria-hidden="true" style={waveStyle}>
      {state !== "idle" && (
        <>
          <div className="header-wave-layer header-wave-layer--1" />
          <div className="header-wave-layer header-wave-layer--2" />
        </>
      )}
      {ripples.map((r) => (
        <div
          key={r.id}
          className={`header-ripple ${r.mode === "streaming" ? "header-ripple--streaming" : ""}`}
          style={{ left: r.x, top: r.y }}
          onAnimationEnd={() => removeRipple(r.id)}
        />
      ))}
    </div>
  );
}

export interface HeaderProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  isOwner?: boolean;
  avatarStatuses: AvatarStatusView[];
  onCopyRoomId: (roomId: string) => void;
  onCreatePairing?: (agentType: string, permissionLevel: string) => Promise<string>;
  onCreateInvite?: (role: string, ttl: number, maxUses: number) => Promise<string | undefined>;
  onRemoveAvatar?: (id: string) => void;
  currentParticipantId?: string;
  onLeaveRoom?: () => void;
  // Sound
  soundEnabled?: boolean;
  soundVolume?: number;
  onSoundEnabledChange?: (enabled: boolean) => void;
  onSoundVolumeChange?: (volume: number) => void;
  onTestSound?: () => void;
  // Notifications
  pendingNotificationCount?: number;
  joinRequests?: JoinRequestView[];
  turnInFlight?: boolean;
  onApproveJoinRequest?: (requestId: string) => void;
  onRejectJoinRequest?: (requestId: string) => void;
  // Avatar popovers
  onClickHumanAvatar?: () => void;
  onClickAgentAvatar?: () => void;
  railRef?: React.RefObject<HTMLDivElement | null>;
  // Invite
  createdInvite?: { url: string; role: string; ttl: number; max_uses: number };
  invites?: InviteView[];
  // Orbit bubbles
  orbitBubbles?: Map<string, string>;
}

export default function Header({
  roomName,
  roomId,
  userDisplayName,
  userRole,
  isOwner,
  avatarStatuses,
  onCopyRoomId,
  onCreatePairing,
  onCreateInvite,
  onRemoveAvatar,
  currentParticipantId,
  onLeaveRoom,
  soundEnabled,
  soundVolume,
  onSoundEnabledChange,
  onSoundVolumeChange,
  onTestSound,
  pendingNotificationCount = 0,
  joinRequests = [],
  turnInFlight = false,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onClickHumanAvatar,
  onClickAgentAvatar,
  railRef,
  createdInvite,
  invites,
  orbitBubbles,
}: HeaderProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const handleToggleLang = useCallback(() => {
    const next: Lang = langCtx?.lang === "zh" ? "en" : "zh";
    langCtx?.setLang(next);
  }, [langCtx]);

  const currentLang = langCtx?.lang ?? "en";

  const notificationTriggerRef = useRef<HTMLButtonElement>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const animationState = deriveAgentAnimationState(avatarStatuses, turnInFlight);

  return (
    <header
      ref={headerRef}
      className={`workspace-header workspace-header--studio ${animationState !== "idle" ? `header--${animationState}` : ""}`}
    >
      <HeaderBackground
        avatarStatuses={avatarStatuses}
        turnInFlight={turnInFlight}
        headerRef={headerRef}
      />
      <div className="header-brand">
        <CacpRoomLogo className="header-brand__logo" ariaLabel="CACP Room" />
        <div className="header-brand__divider" />
      </div>
      <RoomIdentity
        roomName={roomName}
        roomId={roomId}
        userDisplayName={userDisplayName}
        userRole={userRole}
        isOwner={isOwner}
        onCopyRoomId={onCopyRoomId}
        onCreatePairing={onCreatePairing}
        onCreateInvite={onCreateInvite}
        createdInvite={createdInvite}
        invites={invites}
      />

      <RoleAvatarRail
        avatars={avatarStatuses}
        isOwner={isOwner}
        currentParticipantId={currentParticipantId}
        onRemoveAvatar={onRemoveAvatar}
        onClickHumanAvatar={onClickHumanAvatar}
        onClickAgentAvatar={onClickAgentAvatar}
        railRef={railRef}
        orbitBubbles={orbitBubbles}
      />

      <div className="header-actions">
        <button
          ref={notificationTriggerRef}
          type="button"
          className="notification-button"
          aria-label="Notifications"
          onClick={() => setNotificationOpen((v) => !v)}
        >
          <BellIcon />
          {pendingNotificationCount > 0 && (
            <span className="notification-badge">{pendingNotificationCount}</span>
          )}
        </button>
        <Popover
          triggerRef={notificationTriggerRef}
          open={notificationOpen}
          onClose={() => setNotificationOpen(false)}
        >
          <NotificationPanel
            joinRequests={joinRequests}
            turnInFlight={turnInFlight}
            onApproveJoinRequest={onApproveJoinRequest ?? (() => {})}
            onRejectJoinRequest={onRejectJoinRequest ?? (() => {})}
          />
        </Popover>
        <MoreMenu
          soundEnabled={soundEnabled}
          soundVolume={soundVolume}
          onSoundEnabledChange={onSoundEnabledChange}
          onSoundVolumeChange={onSoundVolumeChange}
          onTestSound={onTestSound}
          currentLang={currentLang}
          onToggleLang={handleToggleLang}
          onLeaveRoom={onLeaveRoom}
        />
      </div>
    </header>
  );
}
