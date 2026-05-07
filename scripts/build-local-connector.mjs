import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.platform !== "win32") {
  throw new Error("build:connector:win must be run on Windows.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(root, "packages/cli-adapter/dist/connector/index.cjs");
const blob = resolve(root, "packages/cli-adapter/dist/connector/CACP-Local-Connector.blob");
const seaConfig = resolve(root, "packages/cli-adapter/dist/connector/sea-config.json");
const exe = resolve(root, "packages/web/public/downloads/CACP-Local-Connector.exe");

function run(command, args, shell = process.platform === "win32") {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function findClaudeBinaryInPnpmStore() {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("@anthropic-ai+claude-agent-sdk-win32-x64@")) {
      const candidate = join(pnpmDir, entry.name, "node_modules", "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

await mkdir(dirname(bundle), { recursive: true });
await mkdir(dirname(exe), { recursive: true });

run("corepack", ["pnpm", "--filter", "@cacp/cli-adapter", "bundle:connector"]);
await writeFile(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true
}, null, 2));

run(process.execPath, ["--experimental-sea-config", seaConfig], false);
await copyFile(process.execPath, exe);
run("corepack", [
  "pnpm", "exec", "postject",
  exe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
]);

// Copy claude.exe alongside the SEA executable so findClaudeBinary() can discover it
const claudeBinary = await findClaudeBinaryInPnpmStore();
if (claudeBinary) {
  const dest = resolve(root, "packages/web/public/downloads/claude.exe");
  await copyFile(claudeBinary, dest);
  console.log(`Copied ${claudeBinary} -> ${dest}`);
} else {
  console.warn("Warning: claude.exe not found in pnpm store. Claude Code runtime will require CACP_CLAUDE_PATH or a system-installed claude executable.");
}

console.log(`Built ${exe}`);
