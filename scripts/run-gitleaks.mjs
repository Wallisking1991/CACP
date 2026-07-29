import { spawnSync } from "node:child_process";

const staged = process.argv.includes("--staged");
const args = staged
  ? ["git", "--redact", "--no-banner", "--staged"]
  : ["git", "--redact", "--no-banner"];

const result = spawnSync("gitleaks", args, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: false,
  stdio: "inherit",
});

if (result.error?.code === "ENOENT") {
  console.warn(
    "Official Gitleaks binary was not found; using Secretlint as the local cross-platform fallback."
  );
  const fallback = spawnSync("corepack", ["pnpm", "security:secrets"], {
    cwd: process.cwd(),
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  process.exit(fallback.status ?? 1);
}

process.exit(result.status ?? 1);
