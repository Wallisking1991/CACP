import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface CacpRoomLogoProps {
  ariaLabel?: string;
  className?: string;
}

export default function CacpRoomLogo({ ariaLabel = "CACP", className = "" }: CacpRoomLogoProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (prefersReducedMotion()) {
      root.dataset.motion = "reduced";
      return;
    }

    const ctx = gsap.context(() => {
      gsap.set(".room-logo-draw", { strokeDasharray: 120, strokeDashoffset: 120 });
      gsap.set(".room-logo-core, .room-logo-node, .room-logo-orbit-dot", {
        opacity: 0,
        scale: 0.86,
        transformOrigin: "50% 50%",
      });

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .to(".room-logo-draw", { strokeDashoffset: 0, duration: 0.8, stagger: 0.06 })
        .to(".room-logo-core", { opacity: 1, scale: 1, duration: 0.35 }, "-=0.35")
        .to(".room-logo-node", { opacity: 1, scale: 1, duration: 0.28, stagger: 0.08 }, "-=0.18")
        .to(".room-logo-orbit-dot", { opacity: 1, scale: 1, duration: 0.22 }, "-=0.12");

      gsap.to(".room-logo-core", {
        opacity: 0.9,
        scale: 1.08,
        duration: 2.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to(".room-logo-node", {
        y: (index) => (index % 2 === 0 ? -2 : 2),
        duration: 3.6,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 0.35,
      });
      gsap.to(".room-logo-orbit-dot", {
        rotate: 360,
        transformOrigin: "48px 48px",
        duration: 12,
        repeat: -1,
        ease: "none",
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      className={`cacp-room-logo ${className}`.trim()}
      aria-label={ariaLabel}
      role="img"
    >
      <svg className="cacp-room-logo__mark" viewBox="0 0 96 96" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="cacp-room-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#c2410c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cacp-room-line" x1="14" y1="14" x2="82" y2="82">
            <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.65" />
            <stop offset="48%" stopColor="#f97316" stopOpacity="1" />
            <stop offset="100%" stopColor="#1c1813" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        <rect className="room-logo-draw room-logo-frame" x="16" y="16" width="64" height="64" rx="17" />
        <path className="room-logo-draw room-logo-orbit" d="M27 53c9 20 37 23 50 6" />
        <path className="room-logo-draw room-logo-orbit" d="M69 43c-9-20-37-23-50-6" />
        <path className="room-logo-draw room-logo-link" d="M48 48 33 32" />
        <path className="room-logo-draw room-logo-link" d="M48 48 69 40" />
        <path className="room-logo-draw room-logo-link" d="M48 48 43 72" />

        <circle className="room-logo-core room-logo-core-glow" cx="48" cy="48" r="20" />
        <circle className="room-logo-core room-logo-core-solid" cx="48" cy="48" r="7.5" />
        <circle className="room-logo-node" cx="33" cy="32" r="5.5" />
        <circle className="room-logo-node" cx="69" cy="40" r="5.5" />
        <circle className="room-logo-node" cx="43" cy="72" r="5.5" />

        <g className="room-logo-orbit-dot">
          <circle cx="73" cy="61" r="3" />
        </g>
      </svg>
    </div>
  );
}
