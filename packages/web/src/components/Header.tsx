import { useCallback, useContext, useRef, useState } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import type { AvatarStatusView, InviteView, JoinRequestView } from "../room-state.js";
import { RoomIdentity } from "./RoomIdentity.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";
import { MoreMenu } from "./MoreMenu.js";
import { BellIcon } from "./RoomIcons.js";
import { Popover } from "./Popover.js";
import { NotificationPanel } from "./NotificationPanel.js";

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

  return (
    <header className="workspace-header workspace-header--studio">
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
