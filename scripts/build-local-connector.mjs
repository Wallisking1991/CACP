import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

console.log(`Built ${exe}`);
