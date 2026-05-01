import type { CodexSdk, CodexThread, CodexThreadOptions } from "./types.js";

type UnknownCodexModule = Record<string, unknown>;
type CodexConstructor = new (options?: { codexPathOverride?: string }) => CodexSdk;

function configuredCodexPath(input: { codexPath?: string }): string | undefined {
  const candidate = input.codexPath ?? process.env.CACP_CODEX_PATH;
  const trimmed = candidate?.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function wrapThread(rawThread: unknown): CodexThread {
  const thread = asRecord(rawThread);
  const runStreamed = thread.runStreamed;
  if (typeof runStreamed !== "function") {
    throw new Error("Codex SDK thread object does not expose runStreamed");
  }
  return {
    get id(): string | null {
      const id = thread.id;
      return typeof id === "string" ? id : null;
    },
    async runStreamed(input: string, options?: { signal?: AbortSignal }) {
      return await runStreamed.call(rawThread, input, options) as { events: AsyncGenerator<never> };
    }
  } as CodexThread;
}

export function createCodexSdkFromModule(module: UnknownCodexModule, input: { codexPath?: string } = {}): CodexSdk {
  const Codex = module.Codex;
  if (typeof Codex !== "function") {
    throw new Error("Codex SDK constructor was not found. Install @openai/codex-sdk.");
  }
  const codexPathOverride = configuredCodexPath(input);
  const client = new (Codex as CodexConstructor)(codexPathOverride ? { codexPathOverride } : {});
  return {
    startThread(options: CodexThreadOptions): CodexThread {
      return wrapThread(client.startThread(options));
    },
    resumeThread(id: string, options: CodexThreadOptions): CodexThread {
      return wrapThread(client.resumeThread(id, options));
    }
  };
}

export async function loadCodexSdk(input: { codexPath?: string } = {}): Promise<CodexSdk> {
  const module = await import("@openai/codex-sdk") as UnknownCodexModule;
  return createCodexSdkFromModule(module, input);
}
