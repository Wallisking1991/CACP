export interface ConnectedBannerInput {
  roomId: string;
  chatPath: string;
  chatAvailable: boolean;
  transcriptError?: string;
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
  const chatLines = input.chatAvailable
    ? [
        "📄 聊天记录正在保存到：",
        paint(input.chatPath, "cyan", useColor)
      ]
    : [
        paint("📄 聊天记录保存失败，请检查目录权限。", "red", useColor),
        input.transcriptError ? paint(input.transcriptError, "red", useColor) : undefined
      ].filter((line): line is string => Boolean(line));

  return [
    "",
    "╔══════════════════════════════════════════════╗",
    `║  ${paint("✅ 连接成功 / CONNECTED", "green", useColor)}                     ║`,
    "╚══════════════════════════════════════════════╝",
    "",
    `🤖 本地 Agent 已连接到房间：${input.roomId}`,
    paint("⚠️  请不要关闭此窗口，否则本地 Agent 会从房间断开。", "yellow", useColor),
    "",
    ...chatLines,
    "",
    "──────────────────────────────────────────────",
    "👥 房主现在可以回到 Web 房间",
    "🚀 开启多人协同式 AI 创作",
    "──────────────────────────────────────────────",
    "",
    "        👤 房主 / 团队成员",
    "              │",
    "              ▼",
    "        🌐 CACP Web Room",
    "              │  实时讨论 / 多人协作",
    "              ▼",
    "        🤖 Local Agent",
    "              │",
    "              ▼",
    "        📄 本地聊天记录 chat.md",
    ""
  ].join("\n");
}

export function printConnectedBanner(input: ConnectedBannerInput, log: (message: string) => void = console.log): void {
  log(formatConnectedBanner(input));
}
