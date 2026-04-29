import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface CacpHeroLogoProps {
  ariaLabel?: string;
}

export default function CacpHeroLogo({ ariaLabel = "CACP protocol room logo" }: CacpHeroLogoProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (prefersReducedMotion()) {
      root.dataset.motion = "reduced";
      return;
    }

    const ctx = gsap.context(() => {
      gsap.set(".logo-draw", { strokeDasharray: 260, strokeDashoffset: 260 });
      gsap.set(".logo-core, .logo-node, .logo-orbit-dot, .logo-wordmark", {
        opacity: 0,
        scale: 0.86,
        transformOrigin: "50% 50%",
      });

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .to(".logo-draw", { strokeDashoffset: 0, duration: 1.05, stagger: 0.08 })
        .to(".logo-core", { opacity: 1, scale: 1, duration: 0.45 }, "-=0.45")
        .to(".logo-node", { opacity: 1, scale: 1, duration: 0.36, stagger: 0.1 }, "-=0.2")
        .to(".logo-orbit-dot", { opacity: 1, scale: 1, duration: 0.28 }, "-=0.16")
        .to(".logo-wordmark", { opacity: 1, scale: 1, y: 0, duration: 0.42 }, "-=0.22");

      gsap.to(".logo-core", {
        opacity: 0.9,
        scale: 1.08,
        duration: 2.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to(".logo-node", {
        y: (index) => (index % 2 === 0 ? -3 : 3),
        duration: 3.6,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 0.35,
      });
      gsap.to(".logo-orbit-dot", {
        rotate: 360,
        transformOrigin: "100px 100px",
        duration: 12,
        repeat: -1,
        ease: "none",
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className="cacp-hero-logo" aria-label={ariaLabel} role="img">
      <svg className="cacp-hero-logo__mark" viewBox="0 0 200 200" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="cacp-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#c2410c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cacp-line" x1="30" y1="30" x2="170" y2="170">
            <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.2" />
            <stop offset="48%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#1c1813" stopOpacity="0.38" />
          </linearGradient>
        </defs>

        <rect className="logo-draw logo-frame" x="33" y="33" width="134" height="134" rx="36" />
        <path className="logo-draw logo-orbit" d="M57 111c18 42 77 48 104 12" />
        <path className="logo-draw logo-orbit" d="M143 89C125 47 66 41 39 77" />
        <path className="logo-draw logo-link" d="M100 100 68 66" />
        <path className="logo-draw logo-link" d="M100 100 144 84" />
        <path className="logo-draw logo-link" d="M100 100 90 151" />

        <circle className="logo-core logo-core-glow" cx="100" cy="100" r="36" />
        <circle className="logo-core logo-core-solid" cx="100" cy="100" r="13" />
        <circle className="logo-node" cx="68" cy="66" r="8" />
        <circle className="logo-node" cx="144" cy="84" r="8" />
        <circle className="logo-node" cx="90" cy="151" r="8" />

        <g className="logo-orbit-dot">
          <circle cx="152" cy="128" r="4" />
        </g>
      </svg>
      <div className="logo-wordmark" aria-hidden="true">
        <span>CACP</span>
        <small>AI ROOM PROTOCOL</small>
      </div>
    </div>
  );
}
