import { useT } from "../i18n/useT.js";
import type { ParticipantView } from "../room-state.js";

export interface PeopleAvatarPopoverProps {
  participants: ParticipantView[];
  isOwner: boolean;
  currentParticipantId?: string;
  onRemoveParticipant?: (participantId: string) => void;
}

export function PeopleAvatarPopover({
  participants,
  isOwner,
  currentParticipantId,
  onRemoveParticipant,
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
            {isOwner && participant.id !== currentParticipantId && onRemoveParticipant ? (
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
