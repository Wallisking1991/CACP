import type { ClaudeSessionSummary } from "@cacp/protocol";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudeSdk, ClaudeSdkSessionSummary, ClaudeSessionCatalogInput, ClaudeSessionCatalogResult } from "./types.js";

function sessionIdOf(session: ClaudeSdkSessionSummary): string | undefined {
  return session.sessionId;
}

function titleOf(session: ClaudeSdkSessionSummary, sessionId: string): string {
  const summary = session.summary?.trim();
  return summary ? summary.slice(0, 200) : `Claude session ${sessionId.slice(0, 8)}`;
}

function updatedAtOf(session: ClaudeSdkSessionSummary): string {
  return session.lastModified ?? new Date(0).toISOString();
}

export function normalizeClaudeSession(session: ClaudeSdkSessionSummary, workingDir: string): ClaudeSessionSummary | undefined {
  const sessionId = sessionIdOf(session);
  if (!sessionId) return undefined;
  return {
    session_id: sessionId,
    title: titleOf(session, sessionId),
    project_dir: session.cwd ?? workingDir,
    updated_at: updatedAtOf(session),
    message_count: 0,
    byte_size: typeof session.fileSize === "number" ? Math.max(0, session.fileSize) : 0,
    importable: true
  };
}

export async function listClaudeSessions(input: ClaudeSessionCatalogInput & { sdk?: Pick<ClaudeSdk, "listSessions"> }): Promise<ClaudeSessionCatalogResult> {
  const sdk = input.sdk ?? await loadClaudeSdk();
  const sessions = (await sdk.listSessions({ dir: input.workingDir }))
    .map((session) => normalizeClaudeSession(session, input.workingDir))
    .filter((session): session is ClaudeSessionSummary => Boolean(session))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { workingDir: input.workingDir, sessions };
}
