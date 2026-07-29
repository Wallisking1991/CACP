import type { ConnectorCompatibility } from "@cacp/protocol";
import type { FastifyInstance } from "fastify";

const inputCapabilities = {
  image: "native",
  pdf: "file_path",
  text: "file_path",
  office: "file_path",
  file: "file_path",
  max_attachments: 5,
} as const;

export const testConnectorCompatibility = {
  protocol_version: "0.3.0",
  connector_version: "0.5.0-test",
  adapters: [
    {
      provider: "claude-code",
      sdk_package: "@anthropic-ai/claude-agent-sdk",
      sdk_version: "0.3.220",
      input_capabilities: inputCapabilities,
    },
    {
      provider: "codex-cli",
      sdk_package: "@openai/codex-sdk",
      sdk_version: "0.146.0",
      input_capabilities: inputCapabilities,
    },
    {
      provider: "github-copilot",
      sdk_package: "@github/copilot-sdk",
      sdk_version: "1.0.8",
      input_capabilities: inputCapabilities,
    },
    {
      provider: "kimi-cli",
      sdk_package: "@moonshot-ai/kimi-agent-sdk",
      sdk_version: "0.1.8",
      input_capabilities: inputCapabilities,
    },
  ],
} satisfies ConnectorCompatibility;

export async function markTestAgentReady(
  app: FastifyInstance,
  roomId: string,
  ownerToken: string,
  agentId: string,
  agentToken: string,
  provider: "codex-cli" | "github-copilot" | "kimi-cli" = "kimi-cli"
): Promise<void> {
  const selected = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-sessions/selection`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { agent_id: agentId, provider, mode: "fresh" },
  });
  if (selected.statusCode !== 201)
    throw new Error(`failed to select test session: ${selected.body}`);
  const ready = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-sessions/ready`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: {
      agent_id: agentId,
      provider,
      mode: "fresh",
      ready_at: new Date().toISOString(),
    },
  });
  if (ready.statusCode !== 201)
    throw new Error(`failed to ready test session: ${ready.body}`);
}
