function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function assignAgentColor(agentId: string): string {
  const hash = hashString(agentId);
  // Tech color range: 180 (cyan) to 320 (pink/magenta)
  const hue = 180 + (hash % 141);
  return `hsl(${hue}, 75%, 55%)`;
}
