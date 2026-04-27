import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { parseConnectionCode } from "@cacp/protocol";
import { z } from "zod";

export const AdapterConfigSchema = z.object({
  server_url: z.string().url(),
  room_id: z.string().min(1),
  token: z.string().min(1).optional(),
  registered_agent: z.object({ agent_id: z.string().min(1), agent_token: z.string().min(1) }).optional(),
  agent: z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    working_dir: z.string().default(process.cwd()),
    capabilities: z.array(z.string()).default(["shell.oneshot"]),
    system_prompt: z.string().optional()
  })
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

const PairingClaimSchema = z.object({
  room_id: z.string().min(1),
  agent_id: z.string().min(1),
  agent_token: z.string().min(1),
  agent: AdapterConfigSchema.shape.agent
});

export type AdapterArgs =
  | { mode: "file"; config_path: string }
  | { mode: "pair"; server_url: string; pairing_token: string }
  | { mode: "connect"; connection_code: string }
  | { mode: "prompt" };

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

async function claimPairing(serverUrl: string, pairingToken: string, fetchImpl: typeof fetch): Promise<AdapterConfig> {
  const claimUrl = `${serverUrl}/agent-pairings/${encodeURIComponent(pairingToken)}/claim?server_url=${encodeURIComponent(serverUrl)}`;
  const response = await fetchImpl(claimUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const claim = PairingClaimSchema.parse(await response.json());
  return {
    server_url: serverUrl,
    room_id: claim.room_id,
    registered_agent: { agent_id: claim.agent_id, agent_token: claim.agent_token },
    agent: claim.agent
  };
}

export function parseAdapterArgs(args: string[]): AdapterArgs {
  const connectIndex = args.indexOf("--connect");
  if (connectIndex >= 0) {
    const connectionCode = args[connectIndex + 1];
    if (!connectionCode) throw new Error("connect mode requires --connect <connection_code>");
    return { mode: "connect", connection_code: connectionCode };
  }
  const pairIndex = args.indexOf("--pair");
  if (pairIndex >= 0) {
    const serverIndex = args.indexOf("--server");
    const pairingToken = args[pairIndex + 1];
    const serverUrl = serverIndex >= 0 ? args[serverIndex + 1] : undefined;
    if (!pairingToken || !serverUrl) throw new Error("pair mode requires --server <url> --pair <token>");
    return { mode: "pair", server_url: serverUrl, pairing_token: pairingToken };
  }
  if (args.length === 0) return { mode: "prompt" };
  return { mode: "file", config_path: args[0] ?? "docs/examples/generic-cli-agent.json" };
}

export async function loadRuntimeConfigFromArgs(args: string[], fetchImpl: typeof fetch = fetch): Promise<AdapterConfig> {
  const parsed = parseAdapterArgs(args);
  if (parsed.mode === "file") return loadConfig(parsed.config_path);
  if (parsed.mode === "prompt") {
    const payload = parseConnectionCode(await promptForConnectionCode());
    return claimPairing(payload.server_url, payload.pairing_token, fetchImpl);
  }
  if (parsed.mode === "connect") {
    const payload = parseConnectionCode(parsed.connection_code);
    return claimPairing(payload.server_url, payload.pairing_token, fetchImpl);
  }
  return claimPairing(parsed.server_url, parsed.pairing_token, fetchImpl);
}
