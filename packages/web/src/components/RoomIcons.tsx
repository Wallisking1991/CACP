import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function IconFrame({ title, children, ...props }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...props}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return <IconFrame {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></IconFrame>;
}

export function GlobeIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.2 2.5 3.3 5.5 3.3 9s-1.1 6.5-3.3 9c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z" /></IconFrame>;
}

export function SendIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 12 20 5l-5 15-3-6-8-2Z" /><path d="m12 14 8-9" /></IconFrame>;
}

export function SweepIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 18c4 2 10 2 16 0" /><path d="M8 16 16 4" /><path d="m13 7 4 2" /><path d="M6 14h6" /></IconFrame>;
}

export function LiveIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="3" /><path d="M5 12a7 7 0 0 1 14 0" /><path d="M7 17a9 9 0 0 0 10 0" /></IconFrame>;
}

export function RoundtableIcon(props: IconProps) {
  return <IconFrame {...props}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="4" r="1.5" /><circle cx="19" cy="16" r="1.5" /><circle cx="5" cy="16" r="1.5" /></IconFrame>;
}

export function SoundIcon(props: IconProps) {
  return <IconFrame {...props}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16 9c1 1 1 5 0 6" /><path d="M19 7c2 3 2 7 0 10" /></IconFrame>;
}

export function LinkIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </IconFrame>
  );
}

export function InviteIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M22 6H2v12h20V6Z" />
      <path d="m22 6-10 7L2 6" />
    </IconFrame>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </IconFrame>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </IconFrame>
  );
}
