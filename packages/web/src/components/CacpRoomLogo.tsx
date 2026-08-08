interface CacpRoomLogoProps {
  ariaLabel?: string;
  className?: string;
}

export default function CacpRoomLogo({
  ariaLabel = "CACP",
  className = "",
}: CacpRoomLogoProps) {
  return (
    <div
      className={`cacp-room-logo ${className}`.trim()}
      aria-label={ariaLabel}
      role="img"
    >
      <svg
        className="cacp-room-logo__mark"
        viewBox="0 0 96 96"
        role="img"
        aria-hidden="true"
      >
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

        <rect
          className="room-logo-draw room-logo-frame"
          x="16"
          y="16"
          width="64"
          height="64"
          rx="17"
        />
        <path
          className="room-logo-draw room-logo-orbit"
          d="M27 53c9 20 37 23 50 6"
        />
        <path
          className="room-logo-draw room-logo-orbit"
          d="M69 43c-9-20-37-23-50-6"
        />
        <path className="room-logo-draw room-logo-link" d="M48 48 33 32" />
        <path className="room-logo-draw room-logo-link" d="M48 48 69 40" />
        <path className="room-logo-draw room-logo-link" d="M48 48 43 72" />

        <circle
          className="room-logo-core room-logo-core-glow"
          cx="48"
          cy="48"
          r="20"
        />
        <circle
          className="room-logo-core room-logo-core-solid"
          cx="48"
          cy="48"
          r="7.5"
        />
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
