import { useT } from "../i18n/useT.js";
import type { AvatarStatusView } from "../room-state.js";
import { humanColors, agentColors } from "../avatar-colors.js";
import { OrbitBubble } from "./OrbitBubble.js";

export interface RoleAvatarRailProps {
  avatars: AvatarStatusView[];
  maxVisible?: number;
  isOwner?: boolean;
  currentParticipantId?: string;
  onRemoveAvatar?: (id: string) => void;
  onClickHumanAvatar?: () => void;
  onClickAgentAvatar?: () => void;
  railRef?: React.RefObject<HTMLDivElement | null>;
  orbitBubbles?: Map<string, string>;
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

export function RoleAvatarRail({ avatars, maxVisible = 10, isOwner, currentParticipantId, onRemoveAvatar, onClickHumanAvatar, onClickAgentAvatar, railRef, orbitBubbles }: RoleAvatarRailProps) {
  const t = useT();

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
  const { visible, hiddenCount } = splitVisible([...agents, ...humans], maxVisible);

  return (
    <div className="role-avatar-rail" ref={railRef} aria-label={t("room.controls")}>
      {visible.filter((avatar) => avatar.group === "agents").map((avatar) => {
        const colors = agentColors(avatar.id);
        return (
          <div
            key={avatar.id}
            className="role-avatar-stack"
            data-avatar-id={avatar.id}
            data-agent-active={avatar.status === "working" || avatar.status === "typing" ? "true" : undefined}
            title={avatarLabel(avatar)}
            onClick={onClickAgentAvatar}
            style={{ cursor: onClickAgentAvatar ? "pointer" : undefined }}
          >
            <span
              className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`}
              aria-label={avatarLabel(avatar)}
              style={{ background: colors.gradient, color: colors.text, borderColor: colors.border }}
            >
              <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
              <span className="role-avatar__icon" aria-hidden="true">🤖</span>
              <span className="role-avatar__halo" aria-hidden="true" />
            </span>
            <span className="role-avatar__name" style={{ color: colors.bar }}>{avatar.display_name}</span>
            {isOwner && currentParticipantId !== avatar.id && onRemoveAvatar && (
              <button
                type="button"
                className="role-avatar__delete"
                onClick={(e) => { e.stopPropagation(); onRemoveAvatar(avatar.id); }}
                aria-label={t("avatar.remove", { name: avatar.display_name })}
                title={t("avatar.remove", { name: avatar.display_name })}
              >
                ×
              </button>
            )}
            {orbitBubbles?.get(avatar.id) ? (
              <OrbitBubble text={orbitBubbles.get(avatar.id)!} avatarId={avatar.id} />
            ) : null}
          </div>
        );
      })}
      {visible.filter((avatar) => avatar.group === "humans").map((avatar) => {
        const colors = humanColors(avatar.id);
        return (
          <div
            key={avatar.id}
            className="role-avatar-stack"
            data-avatar-id={avatar.id}
            title={avatarLabel(avatar)}
            onClick={onClickHumanAvatar}
            style={{ cursor: onClickHumanAvatar ? "pointer" : undefined }}
          >
            <span
              className={`role-avatar role-avatar--${avatar.kind} role-avatar--${avatar.status}`}
              aria-label={avatarLabel(avatar)}
              style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
            >
              <span className="role-avatar__initials">{initials(avatar.display_name)}</span>
              <span className="role-avatar__halo" aria-hidden="true" />
            </span>
            <span className="role-avatar__name" style={{ color: colors.bar }}>{avatar.display_name}</span>
            {isOwner && currentParticipantId !== avatar.id && onRemoveAvatar && (
              <button
                type="button"
                className="role-avatar__delete"
                onClick={(e) => { e.stopPropagation(); onRemoveAvatar(avatar.id); }}
                aria-label={t("avatar.remove", { name: avatar.display_name })}
                title={t("avatar.remove", { name: avatar.display_name })}
              >
                ×
              </button>
            )}
            {orbitBubbles?.get(avatar.id) ? (
              <OrbitBubble text={orbitBubbles.get(avatar.id)!} avatarId={avatar.id} />
            ) : null}
          </div>
        );
      })}
      {hiddenCount > 0 ? <span className="role-avatar-overflow">+{hiddenCount}</span> : null}
    </div>
  );
}
