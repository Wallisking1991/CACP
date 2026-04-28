import { existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { dirname, resolve } from "node:path";
import { parseConnectionCode } from "@cacp/protocol";
import { z } from "zod";
import { isLlmAgentType, type LlmAgentType, type LlmProviderConfig } from "./llm/types.js";
import { validateOpenAiCompatibleConnectivity } from "./llm/openai-compatible.js";
import { validateAnthropicCompatibleConnectivity } from "./llm/anthropic-compatible.js";
import { promptForLlmApiConfig, createConsolePrompter } from "./llm/config-wizard.js";

export const AdapterConfigSchema = z.object({
  server_url: z.string().url(),
  room_id: z.string().min(1),
  token: z.string().min(1).optional(),
  registered_agent: z.object({ agent_id: z.string().min(1), agent_token: z.string().min(1) }).optional(),
  agent: z.object({
    name: z.string().min(1),
    command: z.string(),
    args: z.array(z.string()).default([]),
    working_dir: z.string().default(process.cwd()),
    capabilities: z.array(z.string()).default(["shell.oneshot"]),
    system_prompt: z.string().optional()
  }),
  llm: z.object({
    provider: z.enum(["openai-compatible", "anthropic-compatible"]),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    apiKey: z.string().min(1),
    temperature: z.number(),
    maxTokens: z.number().int()
  }).optional()
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

const PairingClaimSchema = z.object({
  room_id: z.string().min(1),
  agent_id: z.string().min(1),
  agent_token: z.string().min(1),
  agent: AdapterConfigSchema.shape.agent
});

export type ConfigureLlmAgent = (agentType: LlmAgentType) => Promise<LlmProviderConfig | undefined>;

export type AdapterArgs =
  | { mode: "file"; config_path: string; cwd?: string }
  | { mode: "pair"; server_url: string; pairing_token: string; cwd?: string }
  | { mode: "connect"; connection_code: string; cwd?: string }
  | { mode: "prompt"; cwd?: string };

export function loadConfig(path: string): AdapterConfig {
  const config = AdapterConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!config.token && !config.registered_agent) throw new Error("adapter config requires either token or registered_agent");
  return config;
}

async function promptForConnectionCode(): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  try {
    return (await rl.question("Paste CACP connection code: ")).trim();
  } finally {
    rl.close();
  }
}

export interface ConnectorProcessLike {
  argv: string[];
  cwd: () => string;
  execPath: string;
}

function extractCwdArg(args: string[]): { argsWithoutCwd: string[]; cwd?: string } {
  const next: string[] = [];
  let cwd: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--cwd") {
      const cwdValue = args[index + 1];
      if (!cwdValue) throw new Error("--cwd requires a directory path");
      cwd = cwdValue;
      index += 1;
    } else {
      next.push(value);
    }
  }
  return { argsWithoutCwd: next, cwd };
}

export function defaultConnectorWorkingDir(proc: ConnectorProcessLike = process): string {
  const launchedPath = proc.argv[1];
  const packaged = !launchedPath || launchedPath === proc.execPath || proc.execPath.toLowerCase().endsWith("cacp-local-connector.exe");
  return packaged ? dirname(proc.execPath) : proc.cwd();
}

export function resolveConnectorWorkingDir(input?: string, proc: ConnectorProcessLike = process): string {
  const candidate = input ? resolve(input) : defaultConnectorWorkingDir(proc);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`working directory does not exist: ${candidate}`);
  }
  return candidate;
}

async function claimPairing(serverUrl: string, pairingToken: string, workingDir: string, fetchImpl: typeof fetch, llm?: LlmProviderConfig): Promise<AdapterConfig> {
  const claimUrl = `${serverUrl}/agent-pairings/${encodeURIComponent(pairingToken)}/claim?server_url=${encodeURIComponent(serverUrl)}`;
  const response = await fetchImpl(claimUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ working_dir: workingDir })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const claim = PairingClaimSchema.parse(await response.json());
  const config: AdapterConfig = {
    server_url: serverUrl,
    room_id: claim.room_id,
    registered_agent: { agent_id: claim.agent_id, agent_token: claim.agent_token },
    agent: claim.agent
  };
  if (llm) config.llm = llm;
  return config;
}

export function parseAdapterArgs(args: string[]): AdapterArgs {
  const { argsWithoutCwd, cwd } = extractCwdArg(args);
  const connectIndex = argsWithoutCwd.indexOf("--connect");
  if (connectIndex >= 0) {
    const connectionCode = argsWithoutCwd[connectIndex + 1];
    if (!connectionCode) throw new Error("connect mode requires --connect <connection_code>");
    return { mode: "connect", connection_code: connectionCode, cwd };
  }
  const pairIndex = argsWithoutCwd.indexOf("--pair");
  if (pairIndex >= 0) {
    const serverIndex = argsWithoutCwd.indexOf("--server");
    const pairingToken = argsWithoutCwd[pairIndex + 1];
    const serverUrl = serverIndex >= 0 ? argsWithoutCwd[serverIndex + 1] : undefined;
    if (!pairingToken || !serverUrl) throw new Error("pair mode requires --server <url> --pair <token>");
    return { mode: "pair", server_url: serverUrl, pairing_token: pairingToken, cwd };
  }
  if (argsWithoutCwd.length === 0) return { mode: "prompt", cwd };
  return { mode: "file", config_path: argsWithoutCwd[0] ?? "docs/examples/generic-cli-agent.json", cwd };
}

export interface RuntimeConfigOptions {
  configureLlmAgent?: ConfigureLlmAgent;
}

async function defaultConfigureLlmAgent(agentType: LlmAgentType): Promise<LlmProviderConfig | undefined> {
  return await promptForLlmApiConfig(agentType, createConsolePrompter(), async (config) => {
    if (config.provider === "openai-compatible") return await validateOpenAiCompatibleConnectivity(config);
    return await validateAnthropicCompatibleConnectivity(config);
  });
}

export async function loadRuntimeConfigFromArgs(args: string[], fetchImpl: typeof fetch = fetch, options: RuntimeConfigOptions = {}): Promise<AdapterConfig> {
  const parsed = parseAdapterArgs(args);
  if (parsed.mode === "file") {
    const config = loadConfig(parsed.config_path);
    return parsed.cwd ? { ...config, agent: { ...config.agent, working_dir: resolveConnectorWorkingDir(parsed.cwd) } } : config;
  }
  const workingDir = resolveConnectorWorkingDir(parsed.cwd);
  if (parsed.mode === "prompt") {
    const payload = parseConnectionCode(await promptForConnectionCode());
    let llm: LlmProviderConfig | undefined;
    if (isLlmAgentType(payload.agent_type)) {
      llm = await (options.configureLlmAgent ?? defaultConfigureLlmAgent)(payload.agent_type);
      if (!llm) throw new Error("llm_api_configuration_cancelled");
    }
    return claimPairing(payload.server_url, payload.pairing_token, workingDir, fetchImpl, llm);
  }
  if (parsed.mode === "connect") {
    const payload = parseConnectionCode(parsed.connection_code);
    let llm: LlmProviderConfig | undefined;
    if (isLlmAgentType(payload.agent_type)) {
      llm = await (options.configureLlmAgent ?? defaultConfigureLlmAgent)(payload.agent_type);
      if (!llm) throw new Error("llm_api_configuration_cancelled");
    }
    return claimPairing(payload.server_url, payload.pairing_token, workingDir, fetchImpl, llm);
  }
  return claimPairing(parsed.server_url, parsed.pairing_token, workingDir, fetchImpl);
}
