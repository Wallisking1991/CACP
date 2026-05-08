import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KimiSdk, KimiSdkSession, KimiSdkStreamEvent, KimiSdkTurn } from "./types.js";

type UnknownSdkModule = Record<string | symbol, unknown>;

function binaryName(): string {
  return process.platform === "win32" ? "kimi.exe" : "kimi";
}

function execWhich(command: string): string | undefined {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (result) {
      const first = result.split(/\r?\n/)[0].trim();
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(first)) return undefined;
      if (existsSync(first)) return first;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function scanPathEnv(name: string): string | undefined {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const pathEnv = process.env[pathKey] || process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const candidate = join(trimmed, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function scanSeaDirectory(name: string): string | undefined {
  try {
    const seaDir = dirname(process.execPath);
    const candidate = join(seaDir, name);
    if (existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }
  return undefined;
}

export function findKimiCli(): string | undefined {
  const name = binaryName();

  const envPath = process.env.CACP_KIMI_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  const fromSeaDir = scanSeaDirectory(name);
  if (fromSeaDir) return fromSeaDir;

  if (process.platform === "win32") {
    const fromWhere = execWhich("where.exe kimi.exe");
    if (fromWhere) return fromWhere;
  } else {
    const fromWhich = execWhich("which kimi");
    if (fromWhich) return fromWhich;
  }

  const fromPath = scanPathEnv(name);
  if (fromPath) return fromPath;

  return undefined;
}

function wrapTurn(rawTurn: unknown): KimiSdkTurn {
  const turn = rawTurn as Record<string, unknown>;
  const interrupt = turn.interrupt;
  const approve = turn.approve;
  const result = turn.result;
  const iterator = (turn as Record<symbol, unknown>)[Symbol.asyncIterator];

  if (typeof iterator !== "function") {
    throw new Error("Kimi SDK turn does not expose async iterator");
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<KimiSdkStreamEvent, { status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }, undefined> {
      return (iterator as () => AsyncIterator<unknown, unknown, undefined>).call(turn) as AsyncIterator<KimiSdkStreamEvent, { status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }, undefined>;
    },
    async interrupt(): Promise<void> {
      if (typeof interrupt === "function") await (interrupt as () => Promise<void>).call(turn);
    },
    async approve(requestId: string, response: "approve" | "approve_for_session" | "reject"): Promise<void> {
      if (typeof approve === "function") await (approve as (requestId: string, response: string) => Promise<void>).call(turn, requestId, response);
    },
    get result(): Promise<{ status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }> {
      return (result as Promise<{ status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }>) ?? Promise.resolve({ status: "finished" });
    }
  };
}

function wrapSession(rawSession: unknown): KimiSdkSession {
  const session = rawSession as Record<string, unknown>;
  const prompt = session.prompt;
  const close = session.close;

  if (typeof prompt !== "function") {
    throw new Error("Kimi SDK session does not expose prompt()");
  }

  return {
    get sessionId(): string {
      const id = session.sessionId;
      return typeof id === "string" ? id : "";
    },
    get workDir(): string {
      const wd = session.workDir;
      return typeof wd === "string" ? wd : "";
    },
    get state(): "idle" | "active" | "closed" {
      const s = session.state;
      return s === "idle" || s === "active" || s === "closed" ? s : "idle";
    },
    get model(): string | undefined {
      return typeof session.model === "string" ? session.model : undefined;
    },
    set model(value: string | undefined) {
      session.model = value;
    },
    get thinking(): boolean {
      return !!session.thinking;
    },
    set thinking(value: boolean) {
      session.thinking = value;
    },
    get yoloMode(): boolean {
      return !!session.yoloMode;
    },
    set yoloMode(value: boolean) {
      session.yoloMode = value;
    },
    get executable(): string {
      return typeof session.executable === "string" ? session.executable : "kimi";
    },
    set executable(value: string) {
      session.executable = value;
    },
    get env(): Record<string, string> {
      const e = session.env;
      return e && typeof e === "object" ? e as Record<string, string> : {};
    },
    set env(value: Record<string, string>) {
      session.env = value;
    },
    prompt(content: string | unknown[]): KimiSdkTurn {
      const raw = (prompt as (content: string | unknown[]) => unknown).call(session, content);
      return wrapTurn(raw);
    },
    async close(): Promise<void> {
      if (typeof close === "function") await (close as () => Promise<void>).call(session);
    }
  };
}

export function createKimiSdkFromModule(module: UnknownSdkModule): KimiSdk {
  const createSessionFn = module.createSession;
  const listSessionsFn = module.listSessions;
  const parseSessionEventsFn = module.parseSessionEvents;

  if (typeof createSessionFn !== "function") {
    throw new Error("Kimi SDK createSession was not found. Install @moonshot-ai/kimi-agent-sdk.");
  }
  if (typeof listSessionsFn !== "function") {
    throw new Error("Kimi SDK listSessions was not found.");
  }

  return {
    createSession(options): KimiSdkSession {
      const raw = (createSessionFn as (options: unknown) => unknown)(options);
      return wrapSession(raw);
    },
    async listSessions(workDir): Promise<Array<{ id: string; workDir: string; contextFile: string; updatedAt: number; brief: string }>> {
      const result = await (listSessionsFn as (workDir: string) => Promise<unknown>)(workDir);
      if (!Array.isArray(result)) return [];
      return result.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          id: typeof record.id === "string" ? record.id : String(record.id ?? ""),
          workDir: typeof record.workDir === "string" ? record.workDir : "",
          contextFile: typeof record.contextFile === "string" ? record.contextFile : "",
          updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
          brief: typeof record.brief === "string" ? record.brief : ""
        };
      });
    },
    async parseSessionEvents(workDir, sessionId): Promise<unknown[]> {
      if (typeof parseSessionEventsFn !== "function") return [];
      const result = await (parseSessionEventsFn as (workDir: string, sessionId: string) => Promise<unknown>)(workDir, sessionId);
      return Array.isArray(result) ? result : [];
    }
  };
}

export async function loadKimiSdk(): Promise<KimiSdk> {
  // @ts-ignore — optional dependency, resolved at runtime
  const module = await import("@moonshot-ai/kimi-agent-sdk") as UnknownSdkModule;
  return createKimiSdkFromModule(module);
}
