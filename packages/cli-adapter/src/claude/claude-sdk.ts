import type {
  ClaudePersistentSession,
  ClaudeRuntimeCallbacks,
  ClaudeSdk,
  ClaudeSdkSessionMessage,
  ClaudeSdkSessionSummary
} from "./types.js";

type UnknownSdkModule = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function messageTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const record = asRecord(item);
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).filter(Boolean).join("");
  }
  const record = asRecord(value);
  return typeof record.text === "string" ? record.text : "";
}

function wrapSession(rawSession: unknown): ClaudePersistentSession {
  const session = asRecord(rawSession);
  const send = session.send;
  const stream = session.stream;
  const close = session.close;
  if (typeof send !== "function" && typeof stream !== "function") {
    throw new Error("Claude Code Agent SDK session object does not expose send or stream");
  }
  return {
    sessionId: typeof session.sessionId === "string" ? session.sessionId : typeof session.session_id === "string" ? session.session_id : undefined,
    async send(prompt: string, callbacks: ClaudeRuntimeCallbacks): Promise<string> {
      if (typeof send === "function") {
        const result = await send.call(rawSession, prompt);
        const text = messageTextFromUnknown(result);
        if (text) await callbacks.onDelta(text);
        return text;
      }
      let finalText = "";
      const iterable = stream!.call(rawSession, prompt) as AsyncIterable<unknown>;
      for await (const item of iterable) {
        const record = asRecord(item);
        const chunk = messageTextFromUnknown(record.delta ?? record.content ?? item);
        if (chunk) {
          finalText += chunk;
          await callbacks.onDelta(chunk);
        }
      }
      return finalText;
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
        systemPrompt: input.systemPrompt,
        permissionLevel: input.permissionLevel
      }));
    },
    async resumeSession(input) {
      return wrapSession(await resumeSession(input.sessionId, {
        cwd: input.workingDir,
        systemPrompt: input.systemPrompt,
        permissionLevel: input.permissionLevel
      }));
    },
    async listSessions(input): Promise<ClaudeSdkSessionSummary[]> {
      if (typeof listSessions !== "function") return [];
      return await listSessions({ cwd: input.workingDir }) as ClaudeSdkSessionSummary[];
    },
    async getSessionMessages(input): Promise<ClaudeSdkSessionMessage[]> {
      if (typeof getSessionMessages !== "function") return [];
      return await getSessionMessages({ cwd: input.workingDir, sessionId: input.sessionId }) as ClaudeSdkSessionMessage[];
    }
  };
}

export async function loadClaudeSdk(): Promise<ClaudeSdk> {
  const module = await import("@anthropic-ai/claude-agent-sdk") as UnknownSdkModule;
  return createClaudeSdkFromModule(module);
}
