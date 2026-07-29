import { useState } from "react";
import { useT } from "../i18n/useT.js";
import type { ParticipantView } from "../room-state.js";
import {
  RoleChangeConfirmDialog,
  type ParticipantRole,
} from "./RoleChangeConfirmDialog.js";

export interface PeopleAvatarPopoverProps {
  participants: ParticipantView[];
  isOwner: boolean;
  canRemoveParticipants?: boolean;
  currentParticipantId?: string;
  onRemoveParticipant?: (participantId: string) => void;
  onUpdateRole?: (participantId: string, role: string) => void;
}

interface PendingRoleChange {
  participantId: string;
  participantName: string;
  oldRole: ParticipantRole;
  newRole: ParticipantRole;
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
  const [pending, setPending] = useState<PendingRoleChange | null>(null);

  function roleLabel(role: ParticipantRole): string {
    return String(t(`role.${role}` as Parameters<typeof t>[0]) ?? role);
  }

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
              {roleLabel(participant.role as ParticipantRole)}
            </span>
            {isOwner &&
            participant.id !== currentParticipantId &&
            onUpdateRole &&
            participant.role !== "owner" ? (
              <select
                className="role-select"
                value={participant.role}
                onChange={(e) => {
                  setPending({
                    participantId: participant.id,
                    participantName: participant.display_name,
                    oldRole: participant.role as ParticipantRole,
                    newRole: e.target.value as ParticipantRole,
                  });
                }}
                aria-label={t("sidebar.changeRole", {
                  name: participant.display_name,
                })}
              >
                <option value="admin">{t("role.admin")}</option>
                <option value="member">{t("role.member")}</option>
                <option value="observer">{t("role.observer")}</option>
              </select>
            ) : null}
            {(isOwner || canRemoveParticipants) &&
            participant.id !== currentParticipantId &&
            onRemoveParticipant &&
            participant.role !== "owner" &&
            (!canRemoveParticipants || participant.role !== "admin") ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onRemoveParticipant(participant.id)}
                aria-label={t("sidebar.removeAvatar", {
                  name: participant.display_name,
                })}
              >
                {t("sidebar.removeParticipant")}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <RoleChangeConfirmDialog
        open={pending !== null}
        participantName={pending?.participantName ?? ""}
        oldRole={pending?.oldRole ?? "member"}
        newRole={pending?.newRole ?? "member"}
        onConfirm={() => {
          if (pending && onUpdateRole) {
            onUpdateRole(pending.participantId, pending.newRole);
          }
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
