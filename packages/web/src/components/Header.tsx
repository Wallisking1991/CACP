import { useCallback, useRef, useState } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import { useContext } from "react";
import type { AvatarStatusView } from "../room-state.js";
import { GlobeIcon, LogOutIcon, SoundIcon, BellIcon } from "./RoomIcons.js";
import { RoomIdentity } from "./RoomIdentity.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";
import { Popover } from "./Popover.js";
import { SoundPanel } from "./SoundPanel.js";
import { NotificationPanel } from "./NotificationPanel.js";
import { LogPanel } from "./LogPanel.js";
import type { InviteView, JoinRequestView } from "../room-state.js";

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
  roundtableRequest?: { request_id: string; display_name: string; created_at: string };
  turnInFlight?: boolean;
  onApproveJoinRequest?: (requestId: string) => void;
  onRejectJoinRequest?: (requestId: string) => void;
  onApproveRoundtableRequest?: (requestId: string) => void;
  onRejectRoundtableRequest?: (requestId: string) => void;
  // Avatar popovers
  onClickHumanAvatar?: () => void;
  onClickAgentAvatar?: () => void;
  railRef?: React.RefObject<HTMLDivElement | null>;
  // Invite
  createdInvite?: { url: string; role: string; ttl: number; max_uses: number };
  invites?: InviteView[];
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
  roundtableRequest,
  turnInFlight = false,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onApproveRoundtableRequest,
  onRejectRoundtableRequest,
  onClickHumanAvatar,
  onClickAgentAvatar,
  railRef,
  createdInvite,
  invites,
}: HeaderProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const [soundOpen, setSoundOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const soundBtnRef = useRef<HTMLButtonElement>(null);
  const notificationBtnRef = useRef<HTMLButtonElement>(null);
  const logBtnRef = useRef<HTMLButtonElement>(null);

  const handleToggleLang = useCallback(() => {
    const next: Lang = langCtx?.lang === "zh" ? "en" : "zh";
    langCtx?.setLang(next);
  }, [langCtx]);

  const closeAll = useCallback(() => {
    setSoundOpen(false);
    setNotificationOpen(false);
    setLogOpen(false);
  }, []);

  const toggleSound = useCallback(() => {
    closeAll();
    setSoundOpen((v) => !v);
  }, [closeAll]);

  const toggleNotification = useCallback(() => {
    closeAll();
    setNotificationOpen((v) => !v);
  }, [closeAll]);

  const toggleLog = useCallback(() => {
    closeAll();
    setLogOpen((v) => !v);
  }, [closeAll]);

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
      />

      <div className="header-actions">
        {onSoundEnabledChange && onSoundVolumeChange && onTestSound ? (
          <>
            <button
              ref={soundBtnRef}
              type="button"
              className={`room-icon-button${soundOpen ? " is-active" : ""}`}
              onClick={toggleSound}
              aria-label={t("room.sound")}
              title={t("room.sound")}
            >
              <SoundIcon />
            </button>
            <Popover triggerRef={soundBtnRef} open={soundOpen} onClose={() => setSoundOpen(false)}>
              <SoundPanel
                soundEnabled={soundEnabled ?? false}
                soundVolume={soundVolume ?? 0.5}
                onSoundEnabledChange={onSoundEnabledChange}
                onSoundVolumeChange={onSoundVolumeChange}
                onTestSound={onTestSound}
              />
            </Popover>
          </>
        ) : null}

        <button
          ref={notificationBtnRef}
          type="button"
          className={`room-icon-button${notificationOpen ? " is-active" : ""}${pendingNotificationCount > 0 ? " has-badge" : ""}`}
          onClick={toggleNotification}
          aria-label={t("sidebar.notificationsLabel")}
          title={t("sidebar.notificationsLabel")}
        >
          <BellIcon />
          {pendingNotificationCount > 0 ? (
            <span className="header-badge">{pendingNotificationCount}</span>
          ) : null}
        </button>
        <Popover triggerRef={notificationBtnRef} open={notificationOpen} onClose={() => setNotificationOpen(false)}>
          <NotificationPanel
            joinRequests={joinRequests}
            roundtableRequest={roundtableRequest}
            turnInFlight={turnInFlight}
            onApproveJoinRequest={onApproveJoinRequest ?? (() => {})}
            onRejectJoinRequest={onRejectJoinRequest ?? (() => {})}
            onApproveRoundtableRequest={onApproveRoundtableRequest ?? (() => {})}
            onRejectRoundtableRequest={onRejectRoundtableRequest ?? (() => {})}
          />
        </Popover>

        <button
          ref={logBtnRef}
          type="button"
          className={`room-icon-button${logOpen ? " is-active" : ""}`}
          onClick={toggleLog}
          aria-label={t("sidebar.logsLink")}
          title={t("sidebar.logsLink")}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>L</span>
        </button>
        <Popover triggerRef={logBtnRef} open={logOpen} onClose={() => setLogOpen(false)}>
          <LogPanel />
        </Popover>

        <button
          type="button"
          className="lang-toggle room-icon-button"
          onClick={handleToggleLang}
          aria-label={t("lang.toggle")}
          title={t("lang.toggle")}
        >
          <GlobeIcon />
        </button>
        {onLeaveRoom ? (
          <button
            type="button"
            className="leave-room-btn room-icon-button"
            onClick={onLeaveRoom}
            aria-label={t("room.leave")}
            title={t("room.leave")}
          >
            <LogOutIcon />
          </button>
        ) : null}
      </div>
    </header>
  );
}
