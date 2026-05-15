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

/**
 * Build the session catalog for Kimi CLI.
 *
 * `importable` is driven by whether the session has any events (messages/tools).
 * Sessions with zero events are visible but cannot be resumed, matching the
 * Codex behaviour of `messageCount > 0`.
 */
export async function listKimiSessions(input: KimiSessionCatalogInput): Promise<KimiSessionCatalogResult> {
  const sdk = input.sdk ?? await loadKimiSdk();
  const rawSessions = await sdk.listSessions(input.workingDir);

  const sessions = await Promise.all(
    rawSessions.map(async (session) => {
      const events = await sdk.parseSessionEvents(input.workingDir, session.id);
      const messageCount = events.length;

      return {
        session_id: session.id,
        title: session.brief.trim() || `Kimi session ${session.id.slice(0, 8)}`,
        project_dir: session.workDir || input.workingDir,
        updated_at: new Date(session.updatedAt).toISOString(),
        message_count: messageCount,
        byte_size: 0, // Kimi SDK does not expose session size; placeholder for UI consistency
        importable: messageCount > 0,
        provider: "kimi-cli" as const
      };
    })
  );

  sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  return { workingDir: input.workingDir, sessions };
}
