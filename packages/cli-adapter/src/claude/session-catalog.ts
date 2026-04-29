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
  if (typeof session.lastModified === "number") {
    return new Date(session.lastModified).toISOString();
  }
  return new Date(0).toISOString();
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

export async function listClaudeSessions(input: ClaudeSessionCatalogInput & { sdk?: Pick<ClaudeSdk, "listSessions" | "getSessionMessages"> }): Promise<ClaudeSessionCatalogResult> {
  const sdk = input.sdk ?? await loadClaudeSdk();
  const rawSessions = await sdk.listSessions({ dir: input.workingDir });
  const sessions: ClaudeSessionSummary[] = [];
  for (const raw of rawSessions) {
    const normalized = normalizeClaudeSession(raw, input.workingDir);
    if (!normalized) continue;
    try {
      const messages = await sdk.getSessionMessages(normalized.session_id, { dir: input.workingDir });
      normalized.message_count = messages.length;
      normalized.importable = messages.length > 0;
    } catch {
      normalized.importable = false;
    }
    sessions.push(normalized);
  }
  sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { workingDir: input.workingDir, sessions };
}
