import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT.js";

function FloatingLogoMark(): JSX.Element {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <radialGradient id="fl-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
          <stop offset="48%" stopColor="#c2410c" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="14" fill="url(#fl-core-glow)" />
      <circle cx="20" cy="20" r="5" fill="#f97316" />
      <circle cx="12" cy="11" r="3" fill="#fdba74" opacity="0.9" />
      <circle cx="30" cy="15" r="3" fill="#fdba74" opacity="0.9" />
      <circle cx="17" cy="32" r="3" fill="#fdba74" opacity="0.9" />
    </svg>
  );
}

export interface FloatingLogoControlProps {
  active: boolean;
  pendingCount: number;
  onOpen: () => void;
  storageKey?: string;
}

const DRAG_THRESHOLD_PX = 5;

function readY(storageKey: string): number {
  if (typeof localStorage === "undefined") return 50;
  const raw = localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : 50;
  return Number.isFinite(parsed) ? Math.min(85, Math.max(15, parsed)) : 50;
}

export function FloatingLogoControl({ active, pendingCount, onOpen, storageKey = "cacp.room.logoControl.y" }: FloatingLogoControlProps) {
  const t = useT();
  const initialY = useMemo(() => readY(storageKey), [storageKey]);
  const [y, setY] = useState(initialY);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartTopRef = useRef(0);
  const dragStartXRef = useRef(0);
  const hasDraggedRef = useRef(false);

  function persist(next: number): void {
    const clamped = Math.min(85, Math.max(15, next));
    setY(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    draggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartYRef.current = event.clientY;
    dragStartXRef.current = event.clientX;
    dragStartTopRef.current = y;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!draggingRef.current) return;
    const deltaY = Math.abs(event.clientY - dragStartYRef.current);
    const deltaX = Math.abs(event.clientX - dragStartXRef.current);
    if (deltaY > DRAG_THRESHOLD_PX || deltaX > DRAG_THRESHOLD_PX) {
      hasDraggedRef.current = true;
    }
    const deltaPx = event.clientY - dragStartYRef.current;
    const deltaPercent = (deltaPx / window.innerHeight) * 100;
    persist(dragStartTopRef.current + deltaPercent);
  }

  function handlePointerUp(): void {
    draggingRef.current = false;
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    if (hasDraggedRef.current) {
      event.stopPropagation();
      hasDraggedRef.current = false;
      return;
    }
    onOpen();
  }

  return (
    <button
      type="button"
      className={`floating-logo-control ${active ? "is-active" : ""}`}
      style={{ top: `${y}%` }}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") persist(y + 2);
        if (event.key === "ArrowUp") persist(y - 2);
      }}
      aria-label={t("room.controls")}
      title={t("room.controls")}
    >
      <span className="floating-logo-control__mark" aria-hidden="true"><FloatingLogoMark /></span>
      {pendingCount > 0 ? <span className="floating-logo-control__badge">{pendingCount}</span> : null}
    </button>
  );
}
