import type { ServerConfig } from "../src/config.js";

export function localTestConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    deploymentMode: "local",
    enableLocalLaunch: true,
    tokenSecret: "0123456789abcdef0123456789abcdef",
    bodyLimitBytes: 1024 * 1024,
    maxMessageLength: 4000,
    maxParticipantsPerRoom: 20,
    maxAgentsPerRoom: 3,
    maxSocketsPerRoom: 50,
    rateLimitWindowMs: 60_000,
    roomCreateLimit: 20,
    inviteCreateLimit: 60,
    joinAttemptLimit: 60,
    pairingCreateLimit: 30,
    messageCreateLimit: 120,
    presenceChangeLimit: 30,
    typingEventLimit: 60,
    ...overrides
  };
}

export function cloudTestConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    deploymentMode: "cloud",
    enableLocalLaunch: false,
    publicOrigin: "https://cacp.example.com",
    tokenSecret: "0123456789abcdef0123456789abcdef",
    bodyLimitBytes: 1024 * 1024,
    maxMessageLength: 4000,
    maxParticipantsPerRoom: 20,
    maxAgentsPerRoom: 3,
    maxSocketsPerRoom: 50,
    rateLimitWindowMs: 60_000,
    roomCreateLimit: 20,
    inviteCreateLimit: 60,
    joinAttemptLimit: 60,
    pairingCreateLimit: 30,
    messageCreateLimit: 120,
    presenceChangeLimit: 30,
    typingEventLimit: 60,
    ...overrides
  };
}
