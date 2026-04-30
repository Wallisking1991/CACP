import { useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import { useContext } from "react";
import type { AvatarStatusView } from "../room-state.js";
import { GlobeIcon } from "./RoomIcons.js";
import { RoomIdentity } from "./RoomIdentity.js";
import { RoleAvatarRail } from "./RoleAvatarRail.js";

export interface HeaderProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  avatarStatuses: AvatarStatusView[];
  onCopyRoomId: (roomId: string) => void;
}

export default function Header({
  roomName,
  roomId,
  userDisplayName,
  userRole,
  avatarStatuses,
  onCopyRoomId,
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
        onCopyRoomId={onCopyRoomId}
      />

      <RoleAvatarRail avatars={avatarStatuses} />

      <button
        type="button"
        className="lang-toggle room-icon-button"
        onClick={handleToggleLang}
        aria-label={t("lang.toggle")}
        title={t("lang.toggle")}
      >
        <GlobeIcon />
      </button>
    </header>
  );
}
