export interface ConnectedBannerInput {
  roomId: string;
  agentName: string;
  workingDir: string;
  claudeSessionMode: "pending-selection" | "not-applicable";
  agentSessionLabel?: string;
  color?: boolean;
}

type ColorName = "green" | "yellow" | "cyan" | "red";

const colorCodes: Record<ColorName, [string, string]> = {
  green: ["\u001b[32m", "\u001b[0m"],
  yellow: ["\u001b[33m", "\u001b[0m"],
  cyan: ["\u001b[36m", "\u001b[0m"],
  red: ["\u001b[31m", "\u001b[0m"]
};

function paint(value: string, color: ColorName, enabled: boolean): string {
  if (!enabled) return value;
  const [open, close] = colorCodes[color];
  return `${open}${value}${close}`;
}

export function formatConnectedBanner(input: ConnectedBannerInput): string {
  const useColor = input.color ?? Boolean(process.stdout.isTTY);
  const agentSessionLabel = input.agentSessionLabel ?? "Claude Code persistent session";
  const claudeLines = input.claudeSessionMode === "pending-selection"
    ? [
        paint("Claude Code session selection is pending in the web room.", "yellow", useColor),
        "Open the CACP Web Room to select or resume a Claude session."
      ]
    : [];

  return [
    "",
    "╔══════════════════════════════════════════════╗",
    `║  ${paint("✅ CONNECTED SUCCESSFULLY", "green", useColor)}                 ║`,
    "╚══════════════════════════════════════════════╝",
    "",
    `🤖 ${input.agentName} is connected to room: ${input.roomId}`,
    paint("⚠️  Do not close this window. The Local Agent will disconnect if this window closes.", "yellow", useColor),
    "",
    `📁 Working directory: ${input.workingDir}`,
    ...claudeLines,
    "",
    "──────────────────────────────────────────────",
    "👥 The room owner can now return to the CACP Web Room",
    "🚀 Start collaborative AI creation with the team and Local Agent",
    "──────────────────────────────────────────────",
    "",
    "        👤 Room owner / team members",
    "              │",
    "              ▼",
    "        🌐 CACP Web Room",
    "              │  Live discussion / collaboration",
    "              ▼",
    "        🤖 Local Agent",
    "              │",
    "              ▼",
    `        💻 ${agentSessionLabel}`,
    ""
  ].join("\n");
}

export function printConnectedBanner(input: ConnectedBannerInput, log: (message: string) => void = console.log): void {
  log(formatConnectedBanner(input));
}
