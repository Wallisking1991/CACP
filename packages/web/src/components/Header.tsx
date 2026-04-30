import { useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import { useContext } from "react";
import type { AvatarStatusView } from "../room-state.js";
import { GlobeIcon, LogOutIcon } from "./RoomIcons.js";
import { RoomIdentity } from "./RoomIdentity.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";

export interface HeaderProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  isOwner?: boolean;
  avatarStatuses: AvatarStatusView[];
  onCopyRoomId: (roomId: string) => void;
  onCreatePairing?: (agentType: string, permissionLevel: string) => Promise<string>;
  onLeaveRoom?: () => void;
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
  onLeaveRoom,
}: HeaderProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const handleToggleLang = useCallback(() => {
    const next: Lang = langCtx?.lang === "zh" ? "en" : "zh";
    langCtx?.setLang(next);
  }, [langCtx]);

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
      />

      <RoleAvatarRail avatars={avatarStatuses} />

      <div className="header-actions">
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
