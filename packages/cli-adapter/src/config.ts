import { readFileSync } from "node:fs";
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
    capabilities: z.array(z.string()).default(["shell.oneshot"])
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
  | { mode: "pair"; server_url: string; pairing_token: string };

export function loadConfig(path: string): AdapterConfig {
  const config = AdapterConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!config.token && !config.registered_agent) throw new Error("adapter config requires either token or registered_agent");
  return config;
}

export function parseAdapterArgs(args: string[]): AdapterArgs {
  const pairIndex = args.indexOf("--pair");
  if (pairIndex >= 0) {
    const serverIndex = args.indexOf("--server");
    const pairingToken = args[pairIndex + 1];
    const serverUrl = serverIndex >= 0 ? args[serverIndex + 1] : undefined;
    if (!pairingToken || !serverUrl) throw new Error("pair mode requires --server <url> --pair <token>");
    return { mode: "pair", server_url: serverUrl, pairing_token: pairingToken };
  }
  return { mode: "file", config_path: args[0] ?? "docs/examples/generic-cli-agent.json" };
}

export async function loadRuntimeConfigFromArgs(args: string[], fetchImpl: typeof fetch = fetch): Promise<AdapterConfig> {
  const parsed = parseAdapterArgs(args);
  if (parsed.mode === "file") return loadConfig(parsed.config_path);
  const claimUrl = `${parsed.server_url}/agent-pairings/${encodeURIComponent(parsed.pairing_token)}/claim?server_url=${encodeURIComponent(parsed.server_url)}`;
  const response = await fetchImpl(claimUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const claim = PairingClaimSchema.parse(await response.json());
  return {
    server_url: parsed.server_url,
    room_id: claim.room_id,
    registered_agent: { agent_id: claim.agent_id, agent_token: claim.agent_token },
    agent: claim.agent
  };
}
