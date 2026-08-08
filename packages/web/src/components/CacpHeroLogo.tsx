interface CacpHeroLogoProps {
  ariaLabel?: string;
}

export default function CacpHeroLogo({
  ariaLabel = "CACP protocol room logo",
}: CacpHeroLogoProps) {
  return (
    <div className="cacp-hero-logo" aria-label={ariaLabel} role="img">
      <svg
        className="cacp-hero-logo__mark"
        viewBox="0 0 200 200"
        role="img"
        aria-hidden="true"
      >
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

        <rect
          className="logo-draw logo-frame"
          x="33"
          y="33"
          width="134"
          height="134"
          rx="36"
        />
        <path className="logo-draw logo-orbit" d="M57 111c18 42 77 48 104 12" />
        <path className="logo-draw logo-orbit" d="M143 89C125 47 66 41 39 77" />
        <path className="logo-draw logo-link" d="M100 100 68 66" />
        <path className="logo-draw logo-link" d="M100 100 144 84" />
        <path className="logo-draw logo-link" d="M100 100 90 151" />

        <circle className="logo-core logo-core-glow" cx="100" cy="100" r="36" />
        <circle
          className="logo-core logo-core-solid"
          cx="100"
          cy="100"
          r="13"
        />
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
