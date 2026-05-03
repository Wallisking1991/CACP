import { useT } from "../i18n/useT.js";
import type { ParticipantView } from "../room-state.js";

export interface PeopleAvatarPopoverProps {
  participants: ParticipantView[];
  isOwner: boolean;
  canRemoveParticipants?: boolean;
  currentParticipantId?: string;
  onRemoveParticipant?: (participantId: string) => void;
  onUpdateRole?: (participantId: string, role: string) => void;
}

export function PeopleAvatarPopover({
  participants,
  isOwner,
  canRemoveParticipants,
  currentParticipantId,
  onRemoveParticipant,
  onUpdateRole,
}: PeopleAvatarPopoverProps) {
  const t = useT();

  return (
    <div className="popover-content people-popover">
      <h3 className="popover-title">{t("sidebar.peopleLabel")}</h3>
      <div className="popover-list">
        {participants.map((participant) => (
          <div key={participant.id} className="popover-list-item">
            <span className="popover-list-item-name">
              {participant.display_name}
            </span>
            <span className="popover-list-item-meta">
              {t(`role.${participant.role}` as Parameters<typeof t>[0]) ?? participant.role}
            </span>
            {isOwner && participant.id !== currentParticipantId && onUpdateRole && participant.role !== "owner" ? (
              <select
                className="role-select"
                value={participant.role}
                onChange={(e) => onUpdateRole(participant.id, e.target.value)}
                aria-label={t("sidebar.changeRole", { name: participant.display_name })}
              >
                <option value="admin">{t("role.admin")}</option>
                <option value="member">{t("role.member")}</option>
                <option value="observer">{t("role.observer")}</option>
              </select>
            ) : null}
            {(isOwner || canRemoveParticipants) && participant.id !== currentParticipantId && onRemoveParticipant && participant.role !== "owner" && (!canRemoveParticipants || participant.role !== "admin") ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onRemoveParticipant(participant.id)}
                aria-label={t("sidebar.removeAvatar", { name: participant.display_name })}
              >
                {t("sidebar.removeParticipant")}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
