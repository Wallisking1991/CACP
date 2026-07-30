import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface OrbitBubbleProps {
  text: string;
  durationMs?: number;
  onDismiss?: () => void;
  avatarId?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

export function OrbitBubble({
  text,
  durationMs = 3500,
  onDismiss,
  avatarId,
  onClick,
  ariaLabel,
}: OrbitBubbleProps) {
  const [phase, setPhase] = useState<"enter" | "exit">("enter");
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const phaseRef = useRef(phase);
  const [style, setStyle] = useState<CSSProperties>({});

  phaseRef.current = phase;

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase("exit"), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;

    const handleEnd = (event: AnimationEvent) => {
      if (event.target === el && phaseRef.current === "exit") {
        onDismiss?.();
      }
    };

    el.addEventListener("animationend", handleEnd);
    return () => el.removeEventListener("animationend", handleEnd);
  }, [onDismiss]);

  // When anchored to an avatar, render via portal with fixed positioning
  // so the bubble is not clipped by ancestor overflow (e.g. avatar rail scroll).
  useEffect(() => {
    if (!avatarId) return;

    function updatePosition() {
      const anchor = document.querySelector(
        `[data-avatar-id="${avatarId}"]`
      ) as HTMLElement | null;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setStyle({
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [avatarId]);

  const bubble = (
    <button
      type="button"
      ref={bubbleRef}
      className={`orbit-bubble orbit-bubble--${phase}`}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      aria-label={ariaLabel}
    >
      <span className="orbit-bubble__text">{text}</span>
    </button>
  );

  if (avatarId && typeof document !== "undefined") {
    return createPortal(bubble, document.body);
  }

  return bubble;
}
