import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CopilotSdk, CopilotSdkSession } from "./types.js";

type UnknownSdkModule = Record<string | symbol, unknown>;

function asRecord(value: unknown): Record<string | symbol, unknown> {
  return value && typeof value === "object" ? value as Record<string | symbol, unknown> : {};
}

function binaryName(): string {
  return process.platform === "win32" ? "gh.exe" : "gh";
}

function execWhich(command: string): string | undefined {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (result) {
      const first = result.split(/\r?\n/)[0].trim();
      // On Windows, reject .cmd/.bat shims
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
  // When bundled as a Node SEA, the binary may be placed next to the executable
  try {
    const seaDir = dirname(process.execPath);
    const candidate = join(seaDir, name);
    if (existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }
  return undefined;
}

export function findCopilotCli(): string | undefined {
  const name = binaryName();

  // 1. Environment variable override
  const envPath = process.env.CACP_COPILOT_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Next to the SEA executable (for bundled distributions)
  const fromSeaDir = scanSeaDirectory(name);
  if (fromSeaDir) return fromSeaDir;

  // 3. System "which" / "where"
  if (process.platform === "win32") {
    const fromWhere = execWhich("where.exe gh.exe");
    if (fromWhere) return fromWhere;
  } else {
    const fromWhich = execWhich("which gh");
    if (fromWhich) return fromWhich;
  }

  // 4. Scan PATH directories
  const fromPath = scanPathEnv(name);
  if (fromPath) return fromPath;

  return undefined;
}

function scanPnpmVirtualStoreForCopilot(baseDirs: string[]): string | undefined {
  for (const base of baseDirs) {
    const pnpmDir = join(base, "node_modules", ".pnpm");
    if (!existsSync(pnpmDir)) continue;
    try {
      const entries = readdirSync(pnpmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("@github+copilot@")) {
          const candidate = join(pnpmDir, entry.name, "node_modules", "@github", "copilot", "index.js");
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function scanNpmLocalForCopilot(baseDirs: string[]): string | undefined {
  for (const base of baseDirs) {
    const candidate = join(base, "node_modules", "@github", "copilot", "index.js");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveNpmGlobalRoot(): string | undefined {
  try {
    const result = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // ignore
  }
  return undefined;
}

function resolvePnpmGlobalRoot(): string | undefined {
  try {
    const result = execSync("pnpm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // ignore
  }
  return undefined;
}

function resolveYarnGlobalRoot(): string | undefined {
  try {
    const globalDir = execSync("yarn global dir", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (globalDir) {
      const candidate = join(globalDir, "node_modules");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function scanNpmGlobalForCopilot(): string | undefined {
  const globalRoots: string[] = [];

  // Dynamic resolution from package managers (most reliable)
  const npmRoot = resolveNpmGlobalRoot();
  if (npmRoot) globalRoots.push(npmRoot);
  const pnpmRoot = resolvePnpmGlobalRoot();
  if (pnpmRoot) globalRoots.push(pnpmRoot);
  const yarnRoot = resolveYarnGlobalRoot();
  if (yarnRoot) globalRoots.push(yarnRoot);

  // Fallback static paths
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) globalRoots.push(join(appData, "npm", "node_modules"));
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) globalRoots.push(join(localAppData, "npm", "node_modules"));
  } else {
    globalRoots.push(join(homedir(), ".npm", "lib", "node_modules"));
    globalRoots.push("/usr/local/lib/node_modules");
    globalRoots.push("/usr/lib/node_modules");
  }

  for (const root of globalRoots) {
    const candidate = join(root, "@github", "copilot", "index.js");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveCopilotViaRequire(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require.resolve("@github/copilot");
    if (existsSync(resolved)) return resolved;
  } catch {
    // ignore
  }
  return undefined;
}

function collectAncestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = start;
  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

export function findCopilotPackage(): string | undefined {
  const baseDirs: string[] = [];
  try {
    baseDirs.push(...collectAncestorDirs(process.cwd()));
  } catch { /* ignore */ }

  // 1. pnpm virtual store (walk up from cwd so monorepo subdirs work)
  const fromPnpm = scanPnpmVirtualStoreForCopilot(baseDirs);
  if (fromPnpm) return fromPnpm;

  // 2. npm local installs (walk up from cwd)
  const fromNpmLocal = scanNpmLocalForCopilot(baseDirs);
  if (fromNpmLocal) return fromNpmLocal;

  // 3. npm global installs
  const fromNpmGlobal = scanNpmGlobalForCopilot();
  if (fromNpmGlobal) return fromNpmGlobal;

  // 4. require.resolve fallback (works in unbundled environments)
  const fromRequire = resolveCopilotViaRequire();
  if (fromRequire) return fromRequire;

  return undefined;
}

function wrapSession(rawSession: unknown): CopilotSdkSession {
  const session = asRecord(rawSession);
  const sessionId = session.sessionId;
  const send = session.send;
  const abort = session.abort;
  const disconnect = session.disconnect;
  const on = session.on;

  if (typeof send !== "function") {
    throw new Error("Copilot SDK session does not expose send()");
  }
  if (typeof on !== "function") {
    throw new Error("Copilot SDK session does not expose on()");
  }

  return {
    get sessionId(): string {
      return typeof sessionId === "string" ? sessionId : "";
    },
    async send(options: { prompt: string }): Promise<string> {
      return await send.call(rawSession, options) as string;
    },
    async abort(): Promise<void> {
      if (typeof abort === "function") await abort.call(rawSession);
    },
    async disconnect(): Promise<void> {
      if (typeof disconnect === "function") await disconnect.call(rawSession);
    },
    on(event: string, handler: (event: unknown) => void): () => void {
      const unsubscribe = on.call(rawSession, event, handler);
      return typeof unsubscribe === "function" ? unsubscribe : () => { /* no-op */ };
    }
  };
}

export function createCopilotSdkFromModule(module: UnknownSdkModule, options: { cliPath?: string } = {}): CopilotSdk {
  const CopilotClient = module.CopilotClient;
  if (typeof CopilotClient !== "function") {
    throw new Error("Copilot SDK CopilotClient constructor was not found. Install @github/copilot-sdk.");
  }

  const client = new (CopilotClient as new (options?: { cliPath?: string; useStdio?: boolean; autoStart?: boolean }) => {
    createSession(config: unknown): Promise<unknown>;
    resumeSession(sessionId: string, config: unknown): Promise<unknown>;
    listSessions(): Promise<unknown>;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
  })({
    ...(options.cliPath ? { cliPath: options.cliPath } : {}),
    useStdio: true,
    autoStart: true
  });

  return {
    async createSession(config): Promise<CopilotSdkSession> {
      const session = await client.createSession(config);
      return wrapSession(session);
    },
    async resumeSession(sessionId, config): Promise<CopilotSdkSession> {
      const session = await client.resumeSession(sessionId, config);
      return wrapSession(session);
    },
    async listSessions() {
      const result = await client.listSessions();
      if (!Array.isArray(result)) return [];
      return result.map((item) => {
        const record = asRecord(item);
        return {
          sessionId: typeof record.sessionId === "string" ? record.sessionId : String(record.sessionId ?? ""),
          startTime: record.startTime instanceof Date ? record.startTime : new Date(),
          modifiedTime: record.modifiedTime instanceof Date ? record.modifiedTime : new Date(),
          summary: typeof record.summary === "string" ? record.summary : undefined
        };
      });
    },
    async start(): Promise<void> {
      await client.start();
    },
    async stop(): Promise<Error[]> {
      const result = await client.stop();
      if (Array.isArray(result)) return result.filter((e): e is Error => e instanceof Error);
      return [];
    }
  };
}

export async function loadCopilotSdk(options: { cliPath?: string } = {}): Promise<CopilotSdk> {
  // Suppress Node.js experimental SQLite warnings from gh CLI copilot subprocess
  process.env.NODE_NO_WARNINGS = "1";

  // @ts-ignore — optional dependency, resolved at runtime when @github/copilot-sdk is installed
  const module = await import("@github/copilot-sdk") as UnknownSdkModule;

  const cliPath = options.cliPath
    ?? findCopilotPackage()
    ?? findCopilotCli()
    ?? process.env.CACP_COPILOT_PATH;
  return createCopilotSdkFromModule(module, cliPath ? { cliPath } : {});
}
