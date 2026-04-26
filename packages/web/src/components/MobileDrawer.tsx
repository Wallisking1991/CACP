import type { SidebarProps } from "./Sidebar.js";
import Sidebar from "./Sidebar.js";

export interface MobileDrawerProps extends SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileDrawer({ open, onClose, ...sidebarProps }: MobileDrawerProps) {
  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div className="drawer">
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close menu"
        >
          ×
        </button>
        <div style={{ marginTop: 44 }}>
          <Sidebar {...sidebarProps} />
        </div>
      </div>
    </>
  );
}
