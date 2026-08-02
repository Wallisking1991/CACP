import { WhiteboardMaxElements } from "@cacp/protocol";

export type DeploymentMode = "local" | "cloud";

export interface ServerConfig {
  deploymentMode: DeploymentMode;
  enableLocalLaunch: boolean;
  publicOrigin?: string;
  tokenSecret: string;
  bodyLimitBytes: number;
  maxMessageLength: number;
  maxAttachmentBytes: number;
  maxAttachmentsPerMessage: number;
  maxRoomAttachmentBytes: number;
  attachmentAbandonMs: number;
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
  orbitEventLimit: number;
  whiteboardPresenceHeartbeatMs: number;
  whiteboardPresenceTtlMs: number;
  whiteboardPresenceSweepMs: number;
  whiteboardPresenceUpdateLimit: number;
  whiteboardPresenceWindowMs: number;
  whiteboardSceneUpdateLimit: number;
  whiteboardSceneWindowMs: number;
  whiteboardInboundMessageLimit: number;
  whiteboardInboundMessageWindowMs: number;
  whiteboardMaxElements: number;
  whiteboardMaxAttachments: number;
  whiteboardMaxSceneBytes: number;
  whiteboardDeduplicationLimit: number;
  whiteboardSnapshotCadenceMs: number;
  whiteboardSnapshotMaxCount: number;
  whiteboardSnapshotMaxBytes: number;
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

export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const deploymentModeValue = env.CACP_DEPLOYMENT_MODE;
  if (
    deploymentModeValue &&
    deploymentModeValue !== "local" &&
    deploymentModeValue !== "cloud"
  )
    throw new Error("CACP_DEPLOYMENT_MODE must be local or cloud");
  const deploymentMode: DeploymentMode =
    deploymentModeValue === "cloud" ? "cloud" : "local";
  const publicOrigin = cleanOrigin(env.CACP_PUBLIC_ORIGIN);
  const tokenSecret = env.CACP_TOKEN_SECRET?.trim() || "local-dev-token-secret";
  if (deploymentMode === "cloud" && !publicOrigin)
    throw new Error("CACP_PUBLIC_ORIGIN is required in cloud mode");
  if (deploymentMode === "cloud" && tokenSecret === "local-dev-token-secret")
    throw new Error("CACP_TOKEN_SECRET is required in cloud mode");
  if (deploymentMode === "cloud" && tokenSecret.length < 32)
    throw new Error(
      "CACP_TOKEN_SECRET must be at least 32 characters in cloud mode"
    );
  const config: ServerConfig = {
    deploymentMode,
    enableLocalLaunch:
      deploymentMode === "cloud"
        ? false
        : boolValue(env.CACP_ENABLE_LOCAL_LAUNCH, true),
    publicOrigin,
    tokenSecret,
    bodyLimitBytes: intValue(env.CACP_BODY_LIMIT_BYTES, 1024 * 1024),
    maxMessageLength: intValue(env.CACP_MAX_MESSAGE_LENGTH, 4000),
    maxAttachmentBytes: intValue(
      env.CACP_MAX_ATTACHMENT_BYTES,
      10 * 1024 * 1024
    ),
    maxAttachmentsPerMessage: intValue(env.CACP_MAX_ATTACHMENTS_PER_MESSAGE, 5),
    maxRoomAttachmentBytes: intValue(
      env.CACP_MAX_ROOM_ATTACHMENT_BYTES,
      50 * 1024 * 1024
    ),
    attachmentAbandonMs: intValue(
      env.CACP_ATTACHMENT_ABANDON_MS,
      15 * 60 * 1000
    ),
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
    typingEventLimit: intValue(env.CACP_TYPING_EVENT_LIMIT, 60),
    orbitEventLimit: intValue(env.CACP_ORBIT_EVENT_LIMIT, 120),
    whiteboardPresenceHeartbeatMs: intValue(
      env.CACP_WHITEBOARD_PRESENCE_HEARTBEAT_MS,
      3_000
    ),
    whiteboardPresenceTtlMs: intValue(
      env.CACP_WHITEBOARD_PRESENCE_TTL_MS,
      10_000
    ),
    whiteboardPresenceSweepMs: intValue(
      env.CACP_WHITEBOARD_PRESENCE_SWEEP_MS,
      1_000
    ),
    whiteboardPresenceUpdateLimit: intValue(
      env.CACP_WHITEBOARD_PRESENCE_UPDATE_LIMIT,
      30
    ),
    whiteboardPresenceWindowMs: intValue(
      env.CACP_WHITEBOARD_PRESENCE_WINDOW_MS,
      1_000
    ),
    whiteboardSceneUpdateLimit: intValue(
      env.CACP_WHITEBOARD_SCENE_UPDATE_LIMIT,
      20
    ),
    whiteboardSceneWindowMs: intValue(
      env.CACP_WHITEBOARD_SCENE_WINDOW_MS,
      1_000
    ),
    whiteboardInboundMessageLimit: intValue(
      env.CACP_WHITEBOARD_INBOUND_MESSAGE_LIMIT,
      60
    ),
    whiteboardInboundMessageWindowMs: intValue(
      env.CACP_WHITEBOARD_INBOUND_MESSAGE_WINDOW_MS,
      1_000
    ),
    whiteboardMaxElements: Math.min(
      intValue(env.CACP_WHITEBOARD_MAX_ELEMENTS, WhiteboardMaxElements),
      WhiteboardMaxElements
    ),
    whiteboardMaxAttachments: intValue(
      env.CACP_WHITEBOARD_MAX_ATTACHMENTS,
      100
    ),
    whiteboardMaxSceneBytes: intValue(
      env.CACP_WHITEBOARD_MAX_SCENE_BYTES,
      4 * 1024 * 1024
    ),
    whiteboardDeduplicationLimit: intValue(
      env.CACP_WHITEBOARD_DEDUPLICATION_LIMIT,
      2_000
    ),
    whiteboardSnapshotCadenceMs: intValue(
      env.CACP_WHITEBOARD_SNAPSHOT_CADENCE_MS,
      30_000
    ),
    whiteboardSnapshotMaxCount: intValue(
      env.CACP_WHITEBOARD_SNAPSHOT_MAX_COUNT,
      20
    ),
    whiteboardSnapshotMaxBytes: intValue(
      env.CACP_WHITEBOARD_SNAPSHOT_MAX_BYTES,
      8 * 1024 * 1024
    ),
  };
  if (
    config.whiteboardPresenceTtlMs <=
    config.whiteboardPresenceHeartbeatMs + config.whiteboardPresenceSweepMs
  ) {
    throw new Error(
      "CACP whiteboard presence TTL must exceed heartbeat plus sweep interval"
    );
  }
  return config;
}

export function hasAllowedOrigin(
  config: ServerConfig,
  origin: string | undefined
): boolean {
  if (config.deploymentMode !== "cloud") return true;
  if (!origin || !config.publicOrigin) return false;
  try {
    return cleanOrigin(origin) === config.publicOrigin;
  } catch {
    return false;
  }
}
