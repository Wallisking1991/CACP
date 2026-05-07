/**
 * Deterministic color generation from participant IDs.
 * Each user gets a stable hue derived from their ID hash.
 */

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function hueFromId(id: string): number {
  return hashCode(id) % 360;
}

export interface AvatarColorSet {
  bg: string;
  text: string;
  border: string;
  gradient: string;
  bar: string;
}

export function humanColors(id: string): AvatarColorSet {
  const hue = hueFromId(id);
  return {
    bg: `hsl(${hue} 55% 88%)`,
    text: `hsl(${hue} 65% 25%)`,
    border: `hsl(${hue} 50% 75%)`,
    gradient: `linear-gradient(135deg, hsl(${hue} 55% 88%), hsl(${hue} 55% 82%))`,
    bar: `hsl(${hue} 65% 35%)`,
  };
}

export function agentColors(id: string): AvatarColorSet {
  const hue = hueFromId(id);
  return {
    bg: `hsl(${hue} 50% 22%)`,
    text: `#fff7ec`,
    border: `hsl(${hue} 45% 35%)`,
    gradient: `radial-gradient(circle at 30% 20%, hsl(${hue} 50% 28%), hsl(${hue} 60% 18%))`,
    bar: `hsl(${hue} 60% 45%)`,
  };
}
