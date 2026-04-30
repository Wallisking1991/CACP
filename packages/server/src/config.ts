export type DeploymentMode = "local" | "cloud";

export interface ServerConfig {
  deploymentMode: DeploymentMode;
  enableLocalLaunch: boolean;
  publicOrigin?: string;
  tokenSecret: string;
  bodyLimitBytes: number;
  maxMessageLength: number;
  maxParticipantsPerRoom: number;
  maxAgentsPerRoom: number;
  maxSocketsPerRoom: number;
  rateLimitWindowMs: number;
  roomCreateLimit: number;
  inviteCreateLimit: number;
  joinAttemptLimit: number;
  pairingCreateLimit: number;
  messageCreateLimit: number;
  presenceChangeLimit: number;
  typingEventLimit: number;
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const deploymentModeValue = env.CACP_DEPLOYMENT_MODE;
  if (deploymentModeValue && deploymentModeValue !== "local" && deploymentModeValue !== "cloud") throw new Error("CACP_DEPLOYMENT_MODE must be local or cloud");
  const deploymentMode: DeploymentMode = deploymentModeValue === "cloud" ? "cloud" : "local";
  const publicOrigin = cleanOrigin(env.CACP_PUBLIC_ORIGIN);
  const tokenSecret = env.CACP_TOKEN_SECRET?.trim() || "local-dev-token-secret";
  if (deploymentMode === "cloud" && !publicOrigin) throw new Error("CACP_PUBLIC_ORIGIN is required in cloud mode");
  if (deploymentMode === "cloud" && tokenSecret === "local-dev-token-secret") throw new Error("CACP_TOKEN_SECRET is required in cloud mode");
  if (deploymentMode === "cloud" && tokenSecret.length < 32) throw new Error("CACP_TOKEN_SECRET must be at least 32 characters in cloud mode");
  return {
    deploymentMode,
    enableLocalLaunch: deploymentMode === "cloud" ? false : boolValue(env.CACP_ENABLE_LOCAL_LAUNCH, true),
    publicOrigin,
    tokenSecret,
    bodyLimitBytes: intValue(env.CACP_BODY_LIMIT_BYTES, 1024 * 1024),
    maxMessageLength: intValue(env.CACP_MAX_MESSAGE_LENGTH, 4000),
    maxParticipantsPerRoom: intValue(env.CACP_MAX_PARTICIPANTS_PER_ROOM, 20),
    maxAgentsPerRoom: intValue(env.CACP_MAX_AGENTS_PER_ROOM, 3),
    maxSocketsPerRoom: intValue(env.CACP_MAX_SOCKETS_PER_ROOM, 50),
    rateLimitWindowMs: intValue(env.CACP_RATE_LIMIT_WINDOW_MS, 60_000),
    roomCreateLimit: intValue(env.CACP_ROOM_CREATE_LIMIT, 20),
    inviteCreateLimit: intValue(env.CACP_INVITE_CREATE_LIMIT, 60),
    joinAttemptLimit: intValue(env.CACP_JOIN_ATTEMPT_LIMIT, 60),
    pairingCreateLimit: intValue(env.CACP_PAIRING_CREATE_LIMIT, 30),
    messageCreateLimit: intValue(env.CACP_MESSAGE_CREATE_LIMIT, 120),
    presenceChangeLimit: intValue(env.CACP_PRESENCE_CHANGE_LIMIT, 30),
    typingEventLimit: intValue(env.CACP_TYPING_EVENT_LIMIT, 60)
  };
}

export function hasAllowedOrigin(config: ServerConfig, origin: string | undefined): boolean {
  if (config.deploymentMode !== "cloud") return true;
  if (!origin || !config.publicOrigin) return false;
  try {
    return cleanOrigin(origin) === config.publicOrigin;
  } catch {
    return false;
  }
}
