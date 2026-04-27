# Local Connector Working Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move working-directory selection out of the cloud web page and into the Local Connector while making the connector download visible from the homepage.

**Architecture:** The web app creates rooms and pairings without collecting local filesystem paths. The Local Connector resolves its local working directory from `--cwd`, packaged executable location, or `process.cwd()`, then sends that path during pairing claim. The server uses claim-time `working_dir` to build the agent profile while preserving existing pairing expiry and one-time-claim behavior.

**Tech Stack:** TypeScript, React 19, Vite, Fastify, Vitest, pnpm workspace, Node 20+.

---

## File Structure

- Modify `packages/server/src/server.ts`: accept optional claim-time `working_dir` and use it in `buildAgentProfile()`.
- Modify `packages/server/test/cloud-server.test.ts`: verify claim-time `working_dir` overrides the stored pairing value.
- Modify `packages/cli-adapter/src/config.ts`: parse `--cwd`, resolve default local connector directory, validate directories, and send `working_dir` during claim.
- Modify `packages/cli-adapter/test/config.test.ts`: cover `--cwd`, claim body, default resolver behavior, and invalid directory rejection.
- Modify `packages/web/src/components/Landing.tsx`: remove working-directory UI, add cloud connector download/instructions, and render localized dropdown labels.
- Modify `packages/web/src/App.tsx`: remove `workingDir` from Landing `onCreate` params and send `working_dir: "."` for pairing creation/start-local compatibility.
- Modify `packages/web/src/api.ts`: keep server API compatibility while allowing caller code to pass fixed `working_dir: "."`.
- Modify `packages/web/src/i18n/messages.en.json` and `packages/web/src/i18n/messages.zh.json`: add connector download/instruction strings and keep dropdown-label strings.
- Create `packages/web/test/landing-connector.test.tsx`: verify cloud Landing download UX and absence of browser directory picker.

---

## Task 1: Server Claim-Time Working Directory

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/cloud-server.test.ts`

- [ ] **Step 1: Add failing server test for claim-time working directory**

Add this test inside `describe("cloud server endpoints", () => { ... })` in `packages/server/test/cloud-server.test.ts`:

```ts
  it("uses connector claim working directory when building the agent profile", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const roomResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { name: "Connector Room", display_name: "Alice" }
    });
    expect(roomResponse.statusCode).toBe(201);
    const created = roomResponse.json<{ room_id: string; owner_token: string }>();

    const pairingResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${created.owner_token}` },
      payload: { agent_type: "echo", permission_level: "read_only", working_dir: "." }
    });
    expect(pairingResponse.statusCode).toBe(201);
    const pairingToken = parseConnectionCode((pairingResponse.json() as { connection_code: string }).connection_code).pairing_token;

    const localWorkingDir = "D:\\Projects\\my-app";
    const claimResponse = await app.inject({
      method: "POST",
      url: `/agent-pairings/${pairingToken}/claim`,
      payload: { adapter_name: "Local Echo", working_dir: localWorkingDir }
    });

    expect(claimResponse.statusCode).toBe(201);
    expect(claimResponse.json()).toMatchObject({
      room_id: created.room_id,
      agent: { working_dir: localWorkingDir }
    });

    await app.close();
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- cloud-server.test.ts
```

Expected: FAIL because the claim route ignores `payload.working_dir` and returns `agent.working_dir` as `.`.

- [ ] **Step 3: Add claim body schema and use claim-time path**

In `packages/server/src/server.ts`, add this schema near the existing route schemas:

```ts
const AgentPairingClaimSchema = z.object({
  adapter_name: z.string().min(1).max(100).optional(),
  working_dir: z.string().trim().min(1).max(500).optional()
});
```

Then replace the inline body parser in the claim route:

```ts
const body = z.object({ adapter_name: z.string().min(1).max(100).optional() }).parse(request.body);
```

with:

```ts
const body = AgentPairingClaimSchema.parse(request.body);
```

Inside the transaction, immediately before `const profile = buildAgentProfile({ ... })`, add:

```ts
      const workingDir = body.working_dir ?? pairing.working_dir || ".";
```

Then change the profile creation to:

```ts
      const profile = buildAgentProfile({
        agentType,
        permissionLevel,
        workingDir,
        hookUrl
      });
```

- [ ] **Step 4: Run the focused server test again**

Run:

```powershell
corepack pnpm --filter @cacp/server test -- cloud-server.test.ts
```

Expected: PASS, including the new claim-time working-directory test.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add packages/server/src/server.ts packages/server/test/cloud-server.test.ts
git commit -m "fix(server): use connector working directory on pairing claim"
```

---

## Task 2: CLI Adapter Working Directory Resolution

**Files:**
- Modify: `packages/cli-adapter/src/config.ts`
- Test: `packages/cli-adapter/test/config.test.ts`

- [ ] **Step 1: Add failing CLI adapter tests**

Update imports at the top of `packages/cli-adapter/test/config.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConnectionCode } from "@cacp/protocol";
import { defaultConnectorWorkingDir, loadRuntimeConfigFromArgs, parseAdapterArgs, resolveConnectorWorkingDir } from "../src/config.js";
```

Add these tests to `describe("adapter config arguments", () => { ... })`:

```ts
  it("parses --cwd for pairing mode", () => {
    expect(parseAdapterArgs(["--server", "http://127.0.0.1:3737", "--pair", "cacp_pair", "--cwd", "D:\\Projects\\my-app"])).toEqual({
      mode: "pair",
      server_url: "http://127.0.0.1:3737",
      pairing_token: "cacp_pair",
      cwd: "D:\\Projects\\my-app"
    });
  });

  it("sends resolved working_dir while claiming a pairing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cli-cwd-"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ working_dir: tempDir });
      return new Response(JSON.stringify({
        room_id: "room_1",
        agent_id: "agent_1",
        agent_token: "agent_token",
        agent: { name: "Echo", command: "node", args: ["-e", ""], working_dir: tempDir, capabilities: ["echo"] }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    try {
      const config = await loadRuntimeConfigFromArgs(["--server", "http://127.0.0.1:3737", "--pair", "pair_1", "--cwd", tempDir], fetchMock);
      expect(config.agent.working_dir).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses executable directory for packaged connector default cwd", () => {
    expect(defaultConnectorWorkingDir({
      argv: ["C:\\Tools\\CACP-Local-Connector.exe"],
      cwd: () => "D:\\Shell",
      execPath: "C:\\Tools\\CACP-Local-Connector.exe"
    })).toBe("C:\\Tools");
  });

  it("uses process cwd for developer CLI default cwd", () => {
    expect(defaultConnectorWorkingDir({
      argv: ["C:\\Program Files\\nodejs\\node.exe", "D:\\Development\\2\\packages\\cli-adapter\\dist\\index.js"],
      cwd: () => "D:\\Development\\2",
      execPath: "C:\\Program Files\\nodejs\\node.exe"
    })).toBe("D:\\Development\\2");
  });

  it("rejects invalid --cwd before claiming", async () => {
    const missingDir = join(tmpdir(), "cacp-missing-dir-for-test");
    const fetchMock = vi.fn();
    await expect(loadRuntimeConfigFromArgs(["--server", "http://127.0.0.1:3737", "--pair", "pair_1", "--cwd", missingDir], fetchMock as unknown as typeof fetch)).rejects.toThrow("working directory does not exist");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves explicit cwd to an existing directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cli-resolve-"));
    try {
      expect(resolveConnectorWorkingDir(tempDir)).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the focused failing CLI tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- config.test.ts
```

Expected: FAIL because `--cwd`, `defaultConnectorWorkingDir`, `resolveConnectorWorkingDir`, and claim body `working_dir` are not implemented.

- [ ] **Step 3: Implement cwd parsing and resolution**

In `packages/cli-adapter/src/config.ts`, add imports:

```ts
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
```

Replace `AdapterArgs` with:

```ts
export type AdapterArgs =
  | { mode: "file"; config_path: string; cwd?: string }
  | { mode: "pair"; server_url: string; pairing_token: string; cwd?: string }
  | { mode: "connect"; connection_code: string; cwd?: string }
  | { mode: "prompt"; cwd?: string };
```

Add these helpers below `promptForConnectionCode()`:

```ts
export interface ConnectorProcessLike {
  argv: string[];
  cwd: () => string;
  execPath: string;
}

function extractCwdArg(args: string[]): { argsWithoutCwd: string[]; cwd?: string } {
  const next: string[] = [];
  let cwd: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--cwd") {
      const cwdValue = args[index + 1];
      if (!cwdValue) throw new Error("--cwd requires a directory path");
      cwd = cwdValue;
      index += 1;
    } else {
      next.push(value);
    }
  }
  return { argsWithoutCwd: next, cwd };
}

export function defaultConnectorWorkingDir(proc: ConnectorProcessLike = process): string {
  const launchedPath = proc.argv[1];
  const packaged = !launchedPath || launchedPath === proc.execPath || proc.execPath.toLowerCase().endsWith("cacp-local-connector.exe");
  return packaged ? dirname(proc.execPath) : proc.cwd();
}

export function resolveConnectorWorkingDir(input?: string, proc: ConnectorProcessLike = process): string {
  const candidate = input ? resolve(input) : defaultConnectorWorkingDir(proc);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`working directory does not exist: ${candidate}`);
  }
  return candidate;
}
```

Update `claimPairing` signature and request body:

```ts
async function claimPairing(serverUrl: string, pairingToken: string, workingDir: string, fetchImpl: typeof fetch): Promise<AdapterConfig> {
  const claimUrl = `${serverUrl}/agent-pairings/${encodeURIComponent(pairingToken)}/claim?server_url=${encodeURIComponent(serverUrl)}`;
  const response = await fetchImpl(claimUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ working_dir: workingDir })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  const claim = PairingClaimSchema.parse(await response.json());
  return {
    server_url: serverUrl,
    room_id: claim.room_id,
    registered_agent: { agent_id: claim.agent_id, agent_token: claim.agent_token },
    agent: claim.agent
  };
}
```

Update `parseAdapterArgs` to extract `--cwd` before mode parsing:

```ts
export function parseAdapterArgs(args: string[]): AdapterArgs {
  const { argsWithoutCwd, cwd } = extractCwdArg(args);
  const connectIndex = argsWithoutCwd.indexOf("--connect");
  if (connectIndex >= 0) {
    const connectionCode = argsWithoutCwd[connectIndex + 1];
    if (!connectionCode) throw new Error("connect mode requires --connect <connection_code>");
    return { mode: "connect", connection_code: connectionCode, cwd };
  }
  const pairIndex = argsWithoutCwd.indexOf("--pair");
  if (pairIndex >= 0) {
    const serverIndex = argsWithoutCwd.indexOf("--server");
    const pairingToken = argsWithoutCwd[pairIndex + 1];
    const serverUrl = serverIndex >= 0 ? argsWithoutCwd[serverIndex + 1] : undefined;
    if (!pairingToken || !serverUrl) throw new Error("pair mode requires --server <url> --pair <token>");
    return { mode: "pair", server_url: serverUrl, pairing_token: pairingToken, cwd };
  }
  if (argsWithoutCwd.length === 0) return { mode: "prompt", cwd };
  return { mode: "file", config_path: argsWithoutCwd[0] ?? "docs/examples/generic-cli-agent.json", cwd };
}
```

Update `loadRuntimeConfigFromArgs`:

```ts
export async function loadRuntimeConfigFromArgs(args: string[], fetchImpl: typeof fetch = fetch): Promise<AdapterConfig> {
  const parsed = parseAdapterArgs(args);
  if (parsed.mode === "file") {
    const config = loadConfig(parsed.config_path);
    return parsed.cwd ? { ...config, agent: { ...config.agent, working_dir: resolveConnectorWorkingDir(parsed.cwd) } } : config;
  }
  const workingDir = resolveConnectorWorkingDir(parsed.cwd);
  if (parsed.mode === "prompt") {
    const payload = parseConnectionCode(await promptForConnectionCode());
    return claimPairing(payload.server_url, payload.pairing_token, workingDir, fetchImpl);
  }
  if (parsed.mode === "connect") {
    const payload = parseConnectionCode(parsed.connection_code);
    return claimPairing(payload.server_url, payload.pairing_token, workingDir, fetchImpl);
  }
  return claimPairing(parsed.server_url, parsed.pairing_token, workingDir, fetchImpl);
}
```

- [ ] **Step 4: Run CLI adapter tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add packages/cli-adapter/src/config.ts packages/cli-adapter/test/config.test.ts
git commit -m "feat(cli-adapter): send local working directory on pairing claim"
```

---

## Task 3: Cloud Landing Connector UX

**Files:**
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Create: `packages/web/test/landing-connector.test.tsx`

- [ ] **Step 1: Add failing Landing connector tests**

Create `packages/web/test/landing-connector.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

vi.mock("../src/runtime-config.js", () => ({
  isCloudMode: () => true
}));

describe("Landing cloud connector setup", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows connector download instructions and no working directory picker in cloud mode", () => {
    const { container } = render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByRole("link", { name: "Download Local Connector" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
    expect(screen.getByText("Place the connector in your project folder, run it, then paste the room connection code.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Working directory")).not.toBeInTheDocument();
    expect(container.querySelector("input[webkitdirectory]")).toBeNull();
    expect(container.querySelector("input[directory]")).toBeNull();
  });

  it("renders localized permission labels on the Chinese landing page", () => {
    window.localStorage.setItem("cacp.web.lang", "zh");
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByRole("option", { name: "只读" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "受限写入" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "完全访问" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载本地连接器" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused failing web test**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- landing-connector.test.tsx
```

Expected: FAIL because Landing still renders Working directory controls, lacks the homepage connector download link, and still renders hardcoded dropdown labels.

- [ ] **Step 3: Update Landing params and localized option labels**

In `packages/web/src/components/Landing.tsx`, remove `useRef` from the React import and remove `dirInputRef`, `workingDir`, and `handleDirSelect`.

Change the props type to:

```ts
interface LandingProps {
  onCreate: (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string }) => void;
  onJoin: (params: { roomId: string; inviteToken: string; displayName: string }) => void;
  loading?: boolean;
}
```

Change option arrays to use i18n keys:

```ts
const agentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode" },
  { value: "codex", labelKey: "agentType.codex" },
  { value: "opencode", labelKey: "agentType.opencode" },
  { value: "echo", labelKey: "agentType.echo" }
] as const;

const permissionLevels = [
  { value: "read_only", labelKey: "permission.readOnly" },
  { value: "limited_write", labelKey: "permission.limitedWrite" },
  { value: "full_access", labelKey: "permission.fullAccess" }
] as const;
```

Change validity and submit payload:

```ts
  const createValid = roomName.trim() && displayName.trim();
```

```ts
    onCreate({
      roomName: roomName.trim(),
      displayName: displayName.trim(),
      agentType,
      permissionLevel
    });
```

Render option labels with `t()`:

```tsx
              {agentTypes.map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
```

```tsx
              {permissionLevels.map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
```

Remove the entire Working directory label, text input, Browse button, and hidden file input block.

Add this cloud-mode connector block before the submit button:

```tsx
            {isCloudMode() && (
              <div className="connector-setup" style={{ marginTop: 16, padding: 12, border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", background: "var(--surface-warm)" }}>
                <a className="btn btn-ghost" href="/downloads/CACP-Local-Connector.exe" download>
                  {t("landing.connector.download")}
                </a>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>{t("landing.connector.instructions")}</p>
              </div>
            )}
```

Add `aria-label` to the language toggle button:

```tsx
            aria-label={t("lang.toggle")}
```

- [ ] **Step 4: Update App create handler**

In `packages/web/src/App.tsx`, change the `handleCreate` param type to remove `workingDir`:

```ts
  const handleCreate = useCallback(async (params: {
    roomName: string;
    displayName: string;
    agentType: string;
    permissionLevel: string;
  }) => {
```

In cloud mode, change pairing creation to send a fixed compatibility value:

```ts
        const pairing = await createAgentPairing(session, {
          agent_type: params.agentType,
          permission_level: params.permissionLevel,
          working_dir: ".",
        });
```

In local mode, change local launch to:

```ts
          {
            agent_type: params.agentType,
            permission_level: params.permissionLevel,
            working_dir: ".",
          }
```

- [ ] **Step 5: Add i18n messages**

In `packages/web/src/i18n/messages.en.json`, add:

```json
  "landing.connector.download": "Download Local Connector",
  "landing.connector.instructions": "Place the connector in your project folder, run it, then paste the room connection code.",
```

In `packages/web/src/i18n/messages.zh.json`, add:

```json
  "landing.connector.download": "下载本地连接器",
  "landing.connector.instructions": "把连接器放到你的项目文件夹中运行，然后粘贴房间连接码。",
```

Keep existing `agentType.*` and `permission.*` keys.

- [ ] **Step 6: Run focused web tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- landing-connector.test.tsx cloud-connector.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add packages/web/src/components/Landing.tsx packages/web/src/App.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/landing-connector.test.tsx
git commit -m "feat(web): move connector working directory out of landing"
```

---

## Task 4: API Compatibility and Regression Cleanup

**Files:**
- Modify: `packages/web/test/api.test.ts`
- Modify only if needed: `packages/web/src/api.ts`
- Modify only if needed: `packages/web/test/app-copy.test.ts`

- [ ] **Step 1: Run existing web tests to find stale expectations**

Run:

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: tests may fail if they assert Landing contains `Working directory`, `Browse...`, or hardcoded dropdown labels.

- [ ] **Step 2: Update API tests only when they fail on changed payload shape**

If `packages/web/test/api.test.ts` expects cloud room creation to use caller-provided working directories from Landing, replace those expectations with the fixed compatibility value `"."` in tests that represent cloud Landing behavior.

Use this expected body shape for `createAgentPairing` tests that model the cloud Landing path:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/rooms/room_1/agent-pairings",
  expect.objectContaining({
    body: JSON.stringify({
      agent_type: "claude-code",
      permission_level: "read_only",
      working_dir: ".",
      server_url: "http://localhost:3737"
    })
  })
);
```

Keep API tests that directly pass a non-dot `working_dir` if they are testing low-level API passthrough rather than Landing behavior.

- [ ] **Step 3: Update copy/source tests only when they fail on removed UI text**

If `packages/web/test/app-copy.test.ts` checks for old Landing copy, update it to assert the new connector copy:

```ts
expect(source).toContain("Download Local Connector");
expect(source).toContain("Place the connector in your project folder");
expect(source).not.toContain("webkitdirectory");
```

- [ ] **Step 4: Run full web tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4 if files changed**

If Task 4 changed tests, run:

```powershell
git add packages/web/test/api.test.ts packages/web/test/app-copy.test.ts packages/web/src/api.ts
git commit -m "test(web): update connector landing regressions"
```

If no files changed, run:

```powershell
git status --short
```

Expected: no Task 4 changes to commit.

---

## Task 5: Build Connector and Validate Workspace

**Files:**
- No source files expected.
- Generated file expected: `packages/web/public/downloads/CACP-Local-Connector.exe`

- [ ] **Step 1: Run full validation**

Run:

```powershell
corepack pnpm check
```

Expected: PASS across protocol, server, cli-adapter, and web workspaces.

- [ ] **Step 2: Build the Windows connector binary**

Run:

```powershell
corepack pnpm build:connector:win
```

Expected: command exits 0 and prints `Built ...packages\web\public\downloads\CACP-Local-Connector.exe`.

- [ ] **Step 3: Verify connector help still works**

Run:

```powershell
.\packages\web\public\downloads\CACP-Local-Connector.exe --help
```

Expected output contains:

```text
cacp-cli-adapter --connect <connection_code>
cacp-cli-adapter --server <url> --pair <pairing_token>
```

- [ ] **Step 4: Verify web production build includes the connector download when the binary exists**

Run:

```powershell
corepack pnpm --filter @cacp/web build
Test-Path .\packages\web\dist\downloads\CACP-Local-Connector.exe
```

Expected: Vite build passes and `Test-Path` prints `True`.

- [ ] **Step 5: Commit generated connector only if the repository already tracks it**

Run:

```powershell
git ls-files packages/web/public/downloads/CACP-Local-Connector.exe
git status --short -- packages/web/public/downloads/CACP-Local-Connector.exe
```

If `git ls-files` prints the exe path and `git status` shows a modification, commit it:

```powershell
git add packages/web/public/downloads/CACP-Local-Connector.exe
git commit -m "build(connector): refresh local connector binary"
```

If `git ls-files` prints nothing, do not add the binary; deployment scripts should build or upload it.

---

## Task 6: Final Review and Deployment Readiness

**Files:**
- No new source files expected unless review finds a defect.

- [ ] **Step 1: Inspect final diff**

Run:

```powershell
git log --oneline -6
git status --short --untracked-files=all
git diff HEAD~5..HEAD --stat
```

Expected: commits are scoped to server claim working directory, cli adapter cwd claim, web connector Landing, optional web tests, and optional connector binary refresh.

- [ ] **Step 2: Confirm no browser directory picker remains**

Run:

```powershell
Select-String -Path packages\web\src\**\*.ts,packages\web\src\**\*.tsx -Pattern 'webkitdirectory|showDirectoryPicker|directory=""|browseDir' -CaseSensitive:$false
```

Expected: no matches in web source.

- [ ] **Step 3: Confirm cloud connector download path is present**

Run:

```powershell
Select-String -Path packages\web\src\**\*.tsx,packages\server\src\server.ts -Pattern 'CACP-Local-Connector.exe|landing.connector.download' -CaseSensitive:$false
```

Expected: matches in Landing, Sidebar/server pairing response, and i18n usage.

- [ ] **Step 4: Run final full validation**

Run:

```powershell
corepack pnpm check
```

Expected: PASS.

- [ ] **Step 5: Summarize for code review**

Prepare a summary containing:

```text
Implemented:
- Removed cloud web Working directory collection and browser directory picker.
- Added homepage Local Connector download/instructions.
- CLI adapter sends local working_dir on pairing claim.
- Server uses claim-time working_dir for agent profile.

Validation:
- corepack pnpm check
- corepack pnpm build:connector:win
- CACP-Local-Connector.exe --help
- corepack pnpm --filter @cacp/web build
```
