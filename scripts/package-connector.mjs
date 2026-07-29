import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(root, "packages/cli-adapter/dist/connector/index.cjs");
const downloadsDir = resolve(root, "packages/web/public/downloads");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. Read version from root package.json
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);

// 2. Bundle the connector
console.log("Bundling connector...");
run("corepack", ["pnpm", "--filter", "@cacp/cli-adapter", "bundle:connector"]);

// 3. Create temp staging directory
const staging = resolve(root, "packages/cli-adapter/dist/connector/staging");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await mkdir(downloadsDir, { recursive: true });

// 4. Copy bundle and instructions
await copyFile(bundle, resolve(staging, "index.cjs"));

// 5. Write start scripts with CLI environment checks
const windowsBat = `@echo off
setlocal

cd /d "%~dp0"

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ============================================
    echo   Node.js is not installed.
    echo.
    echo   Please download Node.js 22.12+ from:
    echo   https://nodejs.org/
    echo ============================================
    echo.
    pause
    exit /b 1
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if %errorlevel% neq 0 (
    echo ============================================
    echo   Node.js version is too old.
    echo   Node.js 22.12+ is required ^(Node.js 24 recommended^).
    echo   Please upgrade from https://nodejs.org/
    echo ============================================
    pause
    exit /b 1
)

node index.cjs --doctor

echo.

echo Starting CACP Local Connector...
node index.cjs

if errorlevel 1 (
  echo.
  echo CACP Local Connector has exited with an error.
  pause
)
`;

const macCommand = `#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
    echo "============================================"
    echo "  Node.js is not installed."
    echo ""
    echo "  Please download Node.js 22.12+ from:"
    echo "  https://nodejs.org/"
    echo "============================================"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    echo "============================================"
    echo "  Node.js version is too old ($(node --version))."
    echo "  Node.js 22.12+ is required (Node.js 24 recommended)."
    echo "  Please upgrade from https://nodejs.org/"
    echo "============================================"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

node index.cjs --doctor

echo "Starting CACP Local Connector..."
node index.cjs

if [ $? -ne 0 ]; then
    echo ""
    echo "CACP Local Connector has exited with an error."
    read -p "Press Enter to close..."
fi
`;

const linuxSh = `#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
    echo "============================================"
    echo "  Node.js is not installed."
    echo ""
    echo "  Please download Node.js 22.12+ from:"
    echo "  https://nodejs.org/"
    echo "============================================"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    echo "============================================"
    echo "  Node.js version is too old ($(node --version))."
    echo "  Node.js 22.12+ is required (Node.js 24 recommended)."
    echo "  Please upgrade from https://nodejs.org/"
    echo "============================================"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

node index.cjs --doctor

echo "Starting CACP Local Connector..."
node index.cjs

if [ $? -ne 0 ]; then
    echo ""
    echo "CACP Local Connector has exited with an error."
    read -p "Press Enter to close..."
fi
`;

await writeFile(resolve(staging, "Start.bat"), windowsBat);
await writeFile(resolve(staging, "Start.command"), macCommand);
await writeFile(resolve(staging, "start.sh"), linuxSh);
await writeFile(
  resolve(staging, "Doctor.bat"),
  `@echo off
setlocal
cd /d "%~dp0"
node index.cjs --doctor
echo.
pause
`
);
await writeFile(
  resolve(staging, "Doctor.command"),
  `#!/bin/bash
cd "$(dirname "$0")"
node index.cjs --doctor
echo ""
read -p "Press Enter to close..."
`
);
await writeFile(
  resolve(staging, "doctor.sh"),
  `#!/bin/bash
cd "$(dirname "$0")"
node index.cjs --doctor
`
);

// 6. Package into ZIP
const zipName = `CACP-Local-Connector-v${version}.zip`;
const zipPath = resolve(downloadsDir, zipName);

console.log(`Packing ${zipName}...`);

if (process.platform === "win32") {
  // Windows: use Python zipfile
  run(
    "python",
    [
      "-c",
      `import zipfile, os\nsrc = '${staging.replace(/\\/g, "/")}'\ndst = '${zipPath.replace(/\\/g, "/")}'\nwith zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:\n    for root, dirs, files in os.walk(src):\n        for f in files:\n            p = os.path.join(root, f)\n            zf.write(p, os.path.relpath(p, src))`,
    ],
    { shell: false }
  );
} else {
  // macOS/Linux: use zip command from staging directory contents
  run("zip", ["-r", zipPath, "."], { cwd: staging });
}

// 7. Clean up staging
await rm(staging, { recursive: true, force: true });

console.log(`Built ${zipPath}`);
