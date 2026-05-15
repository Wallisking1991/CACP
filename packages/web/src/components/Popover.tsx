import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Popover({ triggerRef, open, onClose, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const hoverTimerRef = useRef<number>(0);

  useEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const padding = 8;
    const panelWidth = 320;

    let left = rect.left;
    let top = rect.bottom + padding;

    // Boundary detection: right edge
    if (left + panelWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - panelWidth - padding);
    }

    // Boundary detection: bottom edge
    const panelHeight = panelRef.current?.offsetHeight ?? 400;
    if (top + panelHeight > window.innerHeight - padding) {
      top = Math.max(padding, rect.top - panelHeight - padding);
    }

    setStyle({
      position: "fixed",
      top,
      left,
      zIndex: 50,
    });
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, triggerRef]);

  useEffect(() => {
    if (!open) return;

    function handleMouseEnter() {
      window.clearTimeout(hoverTimerRef.current);
    }

    function handleMouseLeave() {
      hoverTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 2000);
    }

    const panel = panelRef.current;
    const trigger = triggerRef.current;

    panel?.addEventListener("mouseenter", handleMouseEnter);
    panel?.addEventListener("mouseleave", handleMouseLeave);
    trigger?.addEventListener("mouseenter", handleMouseEnter);
    trigger?.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      panel?.removeEventListener("mouseenter", handleMouseEnter);
      panel?.removeEventListener("mouseleave", handleMouseLeave);
      trigger?.removeEventListener("mouseenter", handleMouseEnter);
      trigger?.removeEventListener("mouseleave", handleMouseLeave);
      window.clearTimeout(hoverTimerRef.current);
    };
  }, [open, onClose, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      data-popover="true"
      style={style}
      className="popover-panel"
      role="dialog"
      aria-modal="false"
    >
      {children}
    </div>,
    document.body
  );
}
