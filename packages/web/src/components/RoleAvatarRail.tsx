import { useState } from "react";
import { useT } from "../i18n/useT.js";
import type { AvatarStatusView } from "../room-state.js";

export interface RoleAvatarRailProps {
  avatars: AvatarStatusView[];
  maxVisible?: number;
  isOwner?: boolean;
  currentParticipantId?: string;
  onRemoveAvatar?: (id: string) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function splitVisible(avatars: AvatarStatusView[], maxVisible: number): { visible: AvatarStatusView[]; hiddenCount: number } {
  const active = avatars.filter((avatar) => avatar.active);
  const inactive = avatars.filter((avatar) => !avatar.active);
  const visible = [...active, ...inactive].slice(0, maxVisible);
  return { visible, hiddenCount: Math.max(0, avatars.length - visible.length) };
}

export function RoleAvatarRail({ avatars, maxVisible = 10, isOwner, currentParticipantId, onRemoveAvatar }: RoleAvatarRailProps) {
  const t = useT();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  function statusLabel(status: AvatarStatusView["status"]): string {
    return t(`avatar.status.${status}` as Parameters<typeof t>[0]) ?? status;
  }

  function avatarLabel(avatar: AvatarStatusView): string {
    const role = avatar.kind === "agent"
      ? t("message.ai")
      : (t(`role.${avatar.role}` as Parameters<typeof t>[0]) ?? avatar.role);
    return `${avatar.display_name}, ${role}, ${statusLabel(avatar.status)}`;
  }

  const humans = avatars.filter((avatar) => avatar.group === "humans");
  const agents = avatars.filter((avatar) => avatar.group === "agents");
  const { visible, hiddenCount } = splitVisible([...humans, ...agents], maxVisible);

  const canDelete = (avatar: AvatarStatusView): boolean => {
    if (!isOwner || !onRemoveAvatar) return false;
    if (avatar.id === currentParticipantId) return false;
    return true;
  };

  return (
    <div className="role-avatar-rail" aria-label={t("room.controls")}>
      {humans.length > 0 ? <span className="avatar-group-label">{t("avatar.group.humans")}</span> : null}
      {visible.filter((avatar) => avatar.group === "humans").map((avatar) => (
        <div
          key={avatar.id}
          className="role-avatar-stack"
          title={avatarLabel(avatar)}
          onMouseEnter={() => setHoveredId(avatar.id)}
          onMouseLeave={() => setHoveredId((prev) => prev === avatar.id ? null : prev)}
        >
          <span className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`} aria-label={avatarLabel(avatar)}>
            <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
            <span className="role-avatar__status" aria-hidden="true" />
            {canDelete(avatar) && hoveredId === avatar.id ? (
              <button
                type="button"
                className="role-avatar__delete"
                aria-label={t("sidebar.removeAvatar", { name: avatar.display_name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAvatar!(avatar.id);
                }}
              >
                ×
              </button>
            ) : null}
          </span>
          <span className="role-avatar__name">{avatar.display_name}</span>
        </div>
      ))}
      {agents.length > 0 ? <span className="avatar-group-label">{t("avatar.group.agents")}</span> : null}
      {visible.filter((avatar) => avatar.group === "agents").map((avatar) => (
        <div
          key={avatar.id}
          className="role-avatar-stack"
          title={avatarLabel(avatar)}
          onMouseEnter={() => setHoveredId(avatar.id)}
          onMouseLeave={() => setHoveredId((prev) => prev === avatar.id ? null : prev)}
        >
          <span className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`} aria-label={avatarLabel(avatar)}>
            <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
            <span className="role-avatar__status" aria-hidden="true" />
            {canDelete(avatar) && hoveredId === avatar.id ? (
              <button
                type="button"
                className="role-avatar__delete"
                aria-label={t("sidebar.removeAvatar", { name: avatar.display_name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAvatar!(avatar.id);
                }}
              >
                ×
              </button>
            ) : null}
          </span>
          <span className="role-avatar__name">{avatar.display_name}</span>
        </div>
      ))}
      {hiddenCount > 0 ? <span className="role-avatar-overflow">+{hiddenCount}</span> : null}
    </div>
  );
}
