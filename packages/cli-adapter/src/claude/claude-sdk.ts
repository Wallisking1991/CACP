import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

// ── Binary discovery (mirrors Codex SDK pattern) ────────────────────────────

function binaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

function platformPackageName(): string | undefined {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32") {
    if (arch === "x64") return "@anthropic-ai/claude-agent-sdk-win32-x64";
    if (arch === "arm64") return "@anthropic-ai/claude-agent-sdk-win32-arm64";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "@anthropic-ai/claude-agent-sdk-darwin-x64";
    if (arch === "arm64") return "@anthropic-ai/claude-agent-sdk-darwin-arm64";
  }
  if (platform === "linux") {
    if (arch === "x64") return "@anthropic-ai/claude-agent-sdk-linux-x64";
    if (arch === "arm64") return "@anthropic-ai/claude-agent-sdk-linux-arm64";
  }
  return undefined;
}

function scanPnpmVirtualStore(baseDirs: string[], name: string): string | undefined {
  const platformPkg = platformPackageName();
  if (!platformPkg) return undefined;
  const platformPkgBase = platformPkg.replace("@anthropic-ai/", "@anthropic-ai+").replace("/", "@");

  for (const base of baseDirs) {
    const pnpmDir = join(base, "node_modules", ".pnpm");
    if (!existsSync(pnpmDir)) continue;
    try {
      const entries = readdirSync(pnpmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(platformPkgBase + "@")) {
          const candidate = join(pnpmDir, entry.name, "node_modules", platformPkg, name);
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function scanNpmLocal(baseDirs: string[], name: string): string | undefined {
  const platformPkg = platformPackageName();
  if (!platformPkg) return undefined;

  for (const base of baseDirs) {
    // Direct: node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe
    const direct = join(base, "node_modules", platformPkg, name);
    if (existsSync(direct)) return direct;

    // Nested inside SDK: node_modules/@anthropic-ai/claude-agent-sdk/node_modules/.../claude.exe
    const sdkDir = join(base, "node_modules", "@anthropic-ai", "claude-agent-sdk");
    if (existsSync(sdkDir)) {
      const nested = join(sdkDir, "node_modules", platformPkg, name);
      if (existsSync(nested)) return nested;
    }
  }
  return undefined;
}

function scanNpmGlobal(name: string): string | undefined {
  const globalRoots: string[] = [];
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
    const platformPkg = platformPackageName();
    if (!platformPkg) continue;
    const candidate = join(root, platformPkg, name);
    if (existsSync(candidate)) return candidate;
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

export function findClaudeBinary(): string | undefined {
  const name = binaryName();

  // 1. Environment variable override
  const envPath = process.env.CACP_CLAUDE_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Next to the SEA executable (for bundled distributions)
  const fromSeaDir = scanSeaDirectory(name);
  if (fromSeaDir) return fromSeaDir;

  // 3. System "which" / "where"
  if (process.platform === "win32") {
    const fromWhere = execWhich("where.exe claude.exe");
    if (fromWhere) return fromWhere;
  } else {
    const fromWhich = execWhich("which claude");
    if (fromWhich) return fromWhich;
  }

  // 4. Scan pnpm virtual store
  const baseDirs: string[] = [];
  try {
    baseDirs.push(process.cwd());
  } catch { /* ignore */ }
  const fromPnpm = scanPnpmVirtualStore(baseDirs, name);
  if (fromPnpm) return fromPnpm;

  // 5. Scan npm local installs
  const fromNpmLocal = scanNpmLocal(baseDirs, name);
  if (fromNpmLocal) return fromNpmLocal;

  // 6. Scan npm global installs
  const fromNpmGlobal = scanNpmGlobal(name);
  if (fromNpmGlobal) return fromNpmGlobal;

  // 7. Scan PATH directories
  const fromPath = scanPathEnv(name);
  if (fromPath) return fromPath;

  return undefined;
}

export async function loadClaudeSdk(options: { pathToClaudeCodeExecutable?: string } = {}): Promise<ClaudeSdk> {
  const module = await import("@anthropic-ai/claude-agent-sdk") as UnknownSdkModule;

  // Find the binary: explicit option > env var > auto-discovery
  const binaryPath = options.pathToClaudeCodeExecutable
    ?? process.env.CACP_CLAUDE_PATH
    ?? findClaudeBinary();

  return createClaudeSdkFromModule(module, {
    resolveClaudeCodeExecutablePath: () => binaryPath
  });
}
