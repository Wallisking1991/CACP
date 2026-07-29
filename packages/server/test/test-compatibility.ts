import {
  RequiredAgentAdapterCompatibility,
  type ConnectorCompatibility,
} from "@cacp/protocol";
import type { FastifyInstance } from "fastify";

export const testConnectorCompatibility = {
  protocol_version: "0.3.0",
  connector_version: "0.5.0-test",
  adapters: RequiredAgentAdapterCompatibility.map((adapter) => ({
    ...adapter,
    input_capabilities: { ...adapter.input_capabilities },
  })),
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
