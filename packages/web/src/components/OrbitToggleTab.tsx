import { useT } from "../i18n/useT.js";
import { BubbleIcon } from "./RoomIcons.js";

export interface OrbitToggleTabProps {
  open: boolean;
  unreadCount: number;
  hasMentions?: boolean;
  onClick: () => void;
}

export function OrbitToggleTab({ open, unreadCount, hasMentions, onClick }: OrbitToggleTabProps) {
  const t = useT();
  const label = String(t("orbit.toggle"));
  const displayCount = unreadCount > 9 ? "9+" : String(unreadCount);
  return (
    <button
      type="button"
      className={`orbit-toggle-tab${open ? " orbit-toggle-tab--open" : ""}`}
      aria-label={label}
      aria-pressed={open}
      onClick={onClick}
    >
      <BubbleIcon width={20} height={20} />
      {unreadCount > 0 && (
        <span className={`orbit-unread-badge${hasMentions ? " orbit-unread-badge--mention" : ""}`}>
          {displayCount}
        </span>
      )}
    </button>
  );
}
