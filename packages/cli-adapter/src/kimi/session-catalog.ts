import type { AgentSessionSummary } from "@cacp/protocol";
import { loadKimiSdk } from "./kimi-sdk.js";
import type { KimiSdk } from "./types.js";

export interface KimiSessionCatalogInput {
  workingDir: string;
  sdk?: KimiSdk;
}

export interface KimiSessionCatalogResult {
  workingDir: string;
  sessions: Array<AgentSessionSummary & { provider: "kimi-cli" }>;
}

export async function listKimiSessions(input: KimiSessionCatalogInput): Promise<KimiSessionCatalogResult> {
  const sdk = input.sdk ?? await loadKimiSdk();
  const rawSessions = await sdk.listSessions(input.workingDir);

  const sessions: Array<AgentSessionSummary & { provider: "kimi-cli" }> = rawSessions.map((session) => ({
    session_id: session.id,
    title: session.brief.trim() || `Kimi session ${session.id.slice(0, 8)}`,
    project_dir: session.workDir || input.workingDir,
    updated_at: new Date(session.updatedAt).toISOString(),
    message_count: 0,
    byte_size: 0,
    importable: false,
    provider: "kimi-cli"
  }));

  sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  return { workingDir: input.workingDir, sessions };
}
