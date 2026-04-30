import { useMemo, useRef, useState } from "react";
import CacpHeroLogo from "./CacpHeroLogo.js";

export interface FloatingLogoControlProps {
  active: boolean;
  pendingCount: number;
  onOpen: () => void;
  storageKey?: string;
}

function readY(storageKey: string): number {
  if (typeof localStorage === "undefined") return 50;
  const raw = localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : 50;
  return Number.isFinite(parsed) ? Math.min(85, Math.max(15, parsed)) : 50;
}

export function FloatingLogoControl({ active, pendingCount, onOpen, storageKey = "cacp.room.logoControl.y" }: FloatingLogoControlProps) {
  const initialY = useMemo(() => readY(storageKey), [storageKey]);
  const [y, setY] = useState(initialY);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartTopRef = useRef(0);

  function persist(next: number): void {
    const clamped = Math.min(85, Math.max(15, next));
    setY(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    draggingRef.current = true;
    dragStartYRef.current = event.clientY;
    dragStartTopRef.current = y;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!draggingRef.current) return;
    const deltaPx = event.clientY - dragStartYRef.current;
    const deltaPercent = (deltaPx / window.innerHeight) * 100;
    persist(dragStartTopRef.current + deltaPercent);
  }

  function handlePointerUp(): void {
    draggingRef.current = false;
  }

  return (
    <button
      type="button"
      className={`floating-logo-control ${active ? "is-active" : ""}`}
      style={{ top: `${y}%` }}
      onClick={onOpen}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") persist(y + 2);
        if (event.key === "ArrowUp") persist(y - 2);
      }}
      aria-label="Room controls"
      title="Room controls"
    >
      <span className="floating-logo-control__mark" aria-hidden="true"><CacpHeroLogo ariaLabel="" /></span>
      {pendingCount > 0 ? <span className="floating-logo-control__badge">{pendingCount}</span> : null}
    </button>
  );
}
