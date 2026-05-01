import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

function targetTriple(): string | undefined {
  const { platform, arch } = process;
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
  }
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
  }
  return undefined;
}

function platformPackageName(triple: string): string | undefined {
  const map: Record<string, string> = {
    "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
    "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64"
  };
  return map[triple];
}

function binaryName(): string {
  return process.platform === "win32" ? "codex.exe" : "codex";
}

function scanForBinary(baseDir: string, triple: string, name: string): string | undefined {
  const candidate = join(baseDir, "vendor", triple, "codex", name);
  if (existsSync(candidate)) return candidate;
  return undefined;
}

function scanPnpmVirtualStore(baseDirs: string[], triple: string, name: string): string | undefined {
  for (const base of baseDirs) {
    const pnpmDir = join(base, "node_modules", ".pnpm");
    if (!existsSync(pnpmDir)) continue;
    try {
      const entries = readdirSync(pnpmDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("@openai+codex@") && entry.name.includes("win32")) {
          const candidate = scanForBinary(join(pnpmDir, entry.name, "node_modules", "@openai", "codex"), triple, name);
          if (candidate) return candidate;
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function scanNpmLocal(baseDirs: string[], triple: string, name: string): string | undefined {
  for (const base of baseDirs) {
    const candidate = scanForBinary(join(base, "node_modules", "@openai", "codex"), triple, name);
    if (candidate) return candidate;
  }
  return undefined;
}

function scanNpmGlobal(triple: string, name: string): string | undefined {
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
    const candidate = scanForBinary(join(root, "@openai", "codex"), triple, name);
    if (candidate) return candidate;
  }
  return undefined;
}

function scanPathEnv(triple: string, name: string): string | undefined {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const pathEnv = process.env[pathKey] || process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    // On Windows, avoid .cmd/.bat shims because spawn() without shell:true can't execute them
    if (process.platform === "win32") {
      const exePath = join(trimmed, name);
      if (existsSync(exePath)) return exePath;
    } else {
      const candidate = join(trimmed, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function execWhich(command: string): string | undefined {
  try {
    const result = execSync(command, { encoding: "utf8", windowsHide: true }).trim();
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

export function findCodexBinary(): string | undefined {
  const triple = targetTriple();
  if (!triple) return undefined;
  const name = binaryName();

  // Search base directories to scan for node_modules
  const baseDirs: string[] = [];
  try {
    baseDirs.push(process.cwd());
  } catch { /* ignore */ }

  // Try "which" / "where" first
  if (process.platform === "win32") {
    const fromWhere = execWhich("where.exe codex.exe");
    if (fromWhere) return fromWhere;
  } else {
    const fromWhich = execWhich("which codex");
    if (fromWhich) return fromWhich;
  }

  // Scan pnpm virtual store
  const fromPnpm = scanPnpmVirtualStore(baseDirs, triple, name);
  if (fromPnpm) return fromPnpm;

  // Scan npm local installs
  const fromNpmLocal = scanNpmLocal(baseDirs, triple, name);
  if (fromNpmLocal) return fromNpmLocal;

  // Scan npm global installs
  const fromNpmGlobal = scanNpmGlobal(triple, name);
  if (fromNpmGlobal) return fromNpmGlobal;

  // Scan PATH directories
  const fromPath = scanPathEnv(triple, name);
  if (fromPath) return fromPath;

  return undefined;
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

  // First attempt: let the SDK resolve the binary normally (works in regular node_modules installs)
  try {
    return createCodexSdkFromModule(module, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only fall back to PATH search if the error is about missing binaries
    if (!message.includes("Unable to locate Codex CLI binaries")) {
      throw error;
    }
  }

  // Second attempt: search for the binary ourselves and provide it as override
  const binaryPath = input.codexPath ?? findCodexBinary() ?? process.env.CACP_CODEX_PATH;
  if (binaryPath) {
    return createCodexSdkFromModule(module, { codexPath: binaryPath });
  }

  throw new Error(
    "Unable to locate Codex CLI binaries. " +
    "Install @openai/codex (e.g. npm install -g @openai/codex) " +
    "or set the CACP_CODEX_PATH environment variable to the codex executable."
  );
}
