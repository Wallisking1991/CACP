import type {
  ClaudePersistentSession,
  ClaudeSdk,
  ClaudeSdkSessionMessage,
  ClaudeSdkSessionSummary
} from "./types.js";

type UnknownSdkModule = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function wrapSession(rawSession: unknown): ClaudePersistentSession {
  const session = asRecord(rawSession);
  const send = session.send;
  const stream = session.stream;
  const close = session.close;
  if (typeof send !== "function") {
    throw new Error("Claude Code Agent SDK session object does not expose send");
  }
  if (typeof stream !== "function") {
    throw new Error("Claude Code Agent SDK session object does not expose stream");
  }
  function readSessionId(): string | undefined {
    try {
      const id = session.sessionId ?? session.session_id;
      return typeof id === "string" ? id : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    get sessionId(): string | undefined {
      return readSessionId();
    },
    async send(prompt: string): Promise<void> {
      await send.call(rawSession, prompt);
    },
    stream(): AsyncIterable<unknown> {
      return stream.call(rawSession) as AsyncIterable<unknown>;
    },
    async close(): Promise<void> {
      if (typeof close === "function") await close.call(rawSession);
    }
  };
}

export function createClaudeSdkFromModule(module: UnknownSdkModule): ClaudeSdk {
  const createSession = module.unstable_v2_createSession;
  const resumeSession = module.unstable_v2_resumeSession;
  const listSessions = module.listSessions;
  const getSessionMessages = module.getSessionMessages;
  if (typeof createSession !== "function" || typeof resumeSession !== "function") {
    throw new Error("Claude Code Agent SDK session APIs were not found. Install a Claude Code Agent SDK version that exposes v2 create/resume session APIs.");
  }
  return {
    async createSession(input) {
      return wrapSession(await createSession({
        cwd: input.workingDir,
        permissionMode: input.permissionMode,
        model: input.model,
        ...(input.settingSources ? { settingSources: input.settingSources } : {}),
        ...(input.includePartialMessages ? { includePartialMessages: true } : {}),
        ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
        ...(input.disallowedTools ? { disallowedTools: input.disallowedTools } : {}),
        ...(input.allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {})
      }));
    },
    async resumeSession(input) {
      return wrapSession(await resumeSession(input.sessionId, {
        cwd: input.workingDir,
        permissionMode: input.permissionMode,
        model: input.model,
        ...(input.settingSources ? { settingSources: input.settingSources } : {}),
        ...(input.includePartialMessages ? { includePartialMessages: true } : {}),
        ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
        ...(input.disallowedTools ? { disallowedTools: input.disallowedTools } : {}),
        ...(input.allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {})
      }));
    },
    async listSessions(input): Promise<ClaudeSdkSessionSummary[]> {
      if (typeof listSessions !== "function") return [];
      return await listSessions({ dir: input.dir }) as ClaudeSdkSessionSummary[];
    },
    async getSessionMessages(sessionId, input): Promise<ClaudeSdkSessionMessage[]> {
      if (typeof getSessionMessages !== "function") return [];
      return await getSessionMessages(sessionId, {
        dir: input.dir,
        ...(input.includeSystemMessages ? { includeSystemMessages: true } : {})
      }) as ClaudeSdkSessionMessage[];
    }
  };
}

export async function loadClaudeSdk(): Promise<ClaudeSdk> {
  const module = await import("@anthropic-ai/claude-agent-sdk") as UnknownSdkModule;
  return createClaudeSdkFromModule(module);
}
