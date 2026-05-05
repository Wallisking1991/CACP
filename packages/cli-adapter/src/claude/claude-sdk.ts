import type { ClaudeQuery, ClaudeQueryInput, ClaudeSdk, ClaudeSdkSessionMessage, ClaudeSdkSessionSummary } from "./types.js";

type UnknownSdkModule = Record<string | symbol, unknown>;

export interface ClaudeSdkBoundaryOptions {
  resolveClaudeCodeExecutablePath?: () => string | undefined;
}

function asRecord(value: unknown): Record<string | symbol, unknown> {
  return value && typeof value === "object" ? value as Record<string | symbol, unknown> : {};
}

function wrapQuery(rawQuery: unknown): ClaudeQuery {
  const query = asRecord(rawQuery);
  const iterator = query[Symbol.asyncIterator];
  const close = query.close;
  if (typeof iterator !== "function") {
    throw new Error("Claude Code Agent SDK query() did not return an async iterable query");
  }
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return iterator.call(rawQuery) as AsyncIterator<unknown>;
    },
    close(): void {
      if (typeof close === "function") close.call(rawQuery);
    }
  };
}

export function createClaudeSdkFromModule(module: UnknownSdkModule, options: ClaudeSdkBoundaryOptions = {}): ClaudeSdk {
  const query = module.query;
  const listSessions = module.listSessions;
  const getSessionMessages = module.getSessionMessages;
  if (typeof query !== "function") {
    throw new Error("Claude Code Agent SDK query API was not found. Install a Claude Code Agent SDK version that exposes query().");
  }

  return {
    query(input: ClaudeQueryInput): ClaudeQuery {
      const claudeCodeExecutablePath = options.resolveClaudeCodeExecutablePath?.();
      return wrapQuery(query({
        prompt: input.prompt,
        options: {
          ...input.options,
          ...(claudeCodeExecutablePath && !input.options.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: claudeCodeExecutablePath }
            : {})
        }
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
