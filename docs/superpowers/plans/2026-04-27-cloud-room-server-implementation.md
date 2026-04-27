# Cloud Room Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cloud-safe CACP room server MVP: hosted rooms, durable invites and pairings, no cloud-side local-agent launch, connector-focused web flow, and Debian deployment artifacts.

**Architecture:** Keep the existing event-sourced room model, but add durable `rooms`, `invites`, and `agent_pairings` records in SQLite. Add a server config layer, token hashing utilities, small in-memory abuse controls, and a web runtime flag so cloud UI shows connector commands instead of starting an agent on the server.

**Tech Stack:** TypeScript, NodeNext ESM, Fastify 5, `@fastify/websocket`, `better-sqlite3`, React 19, Vite, Vitest, Caddy, systemd, Debian 12.

---

## Scope Check

This plan implements the approved cloud MVP only. It does not add account login, billing, PostgreSQL, multi-server scaling, or Windows `.exe` connector packaging. Connector distribution starts as a copied command.

## File Structure

- Create `packages/server/src/config.ts`: deployment mode, public origin, token secret, launch toggle, and limits.
- Modify `packages/server/src/ids.ts`: longer random IDs, longer tokens, HMAC token hashing.
- Create `packages/server/src/rate-limit.ts`: deterministic fixed-window limiter.
- Modify `packages/server/src/event-store.ts`: persistent rooms, invites, and pairings.
- Modify `packages/server/src/server.ts`: integrate config, durable invite/pairing flow, cloud launch block, limits, and origin checks.
- Modify `packages/server/src/index.ts`: load config once and pass it into `buildServer`.
- Add server tests: `cloud-config.test.ts`, `ids.test.ts`, `rate-limit.test.ts`, `cloud-store.test.ts`, `cloud-server.test.ts`.
- Create `packages/web/src/runtime-config.ts`: web deployment mode helper.
- Modify `packages/web/src/api.ts`, `App.tsx`, `components/Landing.tsx`, `components/Sidebar.tsx`, `components/MobileDrawer.tsx`, and i18n JSON files for connector UI.
- Add web tests: `runtime-config.test.ts`, `cloud-connector.test.tsx`.
- Add deployment artifacts: `packages/server/tsconfig.build.json`, update `packages/server/package.json`, create `deploy/cacp.env.example`, `deploy/cacp.service`, `deploy/Caddyfile`, and `docs/deploy-cloud.md`.

---

### Task 1: Server Config, Safer IDs, and Token Hashing

**Files:**
- Create: `packages/server/src/config.ts`
- Modify: `packages/server/src/ids.ts`
- Test: `packages/server/test/cloud-config.test.ts`
- Test: `packages/server/test/ids.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `packages/server/test/cloud-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasAllowedOrigin, loadServerConfig } from "../src/config.js";

describe("server cloud config", () => {
  it("defaults to local mode", () => {
    const config = loadServerConfig({});
    expect(config.deploymentMode).toBe("local");
    expect(config.enableLocalLaunch).toBe(true);
    expect(config.publicOrigin).toBeUndefined();
    expect(config.maxMessageLength).toBe(4000);
  });

  it("forces local launch off in cloud mode", () => {
    const config = loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_ENABLE_LOCAL_LAUNCH: "true",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "0123456789abcdef0123456789abcdef"
    });
    expect(config.deploymentMode).toBe("cloud");
    expect(config.enableLocalLaunch).toBe(false);
    expect(config.publicOrigin).toBe("https://cacp.zuchongai.com");
  });

  it("rejects unsafe cloud config without token secret", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com"
    })).toThrow("CACP_TOKEN_SECRET is required in cloud mode");
  });

  it("checks allowed websocket origins", () => {
    const config = loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "0123456789abcdef0123456789abcdef"
    });
    expect(hasAllowedOrigin(config, "https://cacp.zuchongai.com")).toBe(true);
    expect(hasAllowedOrigin(config, "https://evil.example")).toBe(false);
    expect(hasAllowedOrigin(loadServerConfig({}), undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing ID/token tests**

Create `packages/server/test/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashToken, prefixedId, safeTokenEquals, token } from "../src/ids.js";

describe("ID and token helpers", () => {
  it("generates non-enumerable prefixed ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => prefixedId("room")));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^room_[A-Za-z0-9_-]{22,}$/);
  });

  it("generates long bearer tokens", () => {
    expect(token()).toMatch(/^cacp_[A-Za-z0-9_-]{32,}$/);
  });

  it("hashes tokens without exposing plaintext", () => {
    const secret = "unit-test-secret-unit-test-secret";
    const value = "cacp_example_token";
    const hash = hashToken(value, secret);
    expect(hash).toMatch(/^hmac-sha256:/);
    expect(hash).not.toContain(value);
    expect(safeTokenEquals(value, hash, secret)).toBe(true);
    expect(safeTokenEquals("wrong", hash, secret)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-config.test.ts packages/server/test/ids.test.ts
```

Expected: FAIL because `config.ts`, `hashToken`, and `safeTokenEquals` do not exist.

- [ ] **Step 4: Implement `config.ts`**

Create `packages/server/src/config.ts` with this implementation:

```ts
export type DeploymentMode = "local" | "cloud";

export interface ServerConfig {
  deploymentMode: DeploymentMode;
  enableLocalLaunch: boolean;
  publicOrigin?: string;
  tokenSecret: string;
  bodyLimitBytes: number;
  maxMessageLength: number;
  maxParticipantsPerRoom: number;
  maxAgentsPerRoom: number;
  maxSocketsPerRoom: number;
  rateLimitWindowMs: number;
  roomCreateLimit: number;
  inviteCreateLimit: number;
  joinAttemptLimit: number;
  pairingCreateLimit: number;
  messageCreateLimit: number;
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const deploymentMode: DeploymentMode = env.CACP_DEPLOYMENT_MODE === "cloud" ? "cloud" : "local";
  const publicOrigin = cleanOrigin(env.CACP_PUBLIC_ORIGIN);
  const tokenSecret = env.CACP_TOKEN_SECRET ?? "local-dev-token-secret";
  if (deploymentMode === "cloud" && !publicOrigin) throw new Error("CACP_PUBLIC_ORIGIN is required in cloud mode");
  if (deploymentMode === "cloud" && tokenSecret === "local-dev-token-secret") throw new Error("CACP_TOKEN_SECRET is required in cloud mode");
  return {
    deploymentMode,
    enableLocalLaunch: deploymentMode === "cloud" ? false : boolValue(env.CACP_ENABLE_LOCAL_LAUNCH, true),
    publicOrigin,
    tokenSecret,
    bodyLimitBytes: intValue(env.CACP_BODY_LIMIT_BYTES, 1024 * 1024),
    maxMessageLength: intValue(env.CACP_MAX_MESSAGE_LENGTH, 4000),
    maxParticipantsPerRoom: intValue(env.CACP_MAX_PARTICIPANTS_PER_ROOM, 20),
    maxAgentsPerRoom: intValue(env.CACP_MAX_AGENTS_PER_ROOM, 3),
    maxSocketsPerRoom: intValue(env.CACP_MAX_SOCKETS_PER_ROOM, 50),
    rateLimitWindowMs: intValue(env.CACP_RATE_LIMIT_WINDOW_MS, 60_000),
    roomCreateLimit: intValue(env.CACP_ROOM_CREATE_LIMIT, 20),
    inviteCreateLimit: intValue(env.CACP_INVITE_CREATE_LIMIT, 60),
    joinAttemptLimit: intValue(env.CACP_JOIN_ATTEMPT_LIMIT, 60),
    pairingCreateLimit: intValue(env.CACP_PAIRING_CREATE_LIMIT, 30),
    messageCreateLimit: intValue(env.CACP_MESSAGE_CREATE_LIMIT, 120)
  };
}

export function hasAllowedOrigin(config: ServerConfig, origin: string | undefined): boolean {
  if (config.deploymentMode !== "cloud") return true;
  if (!origin || !config.publicOrigin) return false;
  try {
    return cleanOrigin(origin) === config.publicOrigin;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Replace `ids.ts`**

Replace `packages/server/src/ids.ts` with:

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CacpEvent, EventType } from "@cacp/protocol";

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function token(): string {
  return `cacp_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(value: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(value).digest("base64url");
  return `hmac-sha256:${digest}`;
}

export function safeTokenEquals(value: string, storedHash: string, secret: string): boolean {
  const next = hashToken(value, secret);
  const left = Buffer.from(next);
  const right = Buffer.from(storedHash);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function event(roomId: string, type: EventType, actorId: string, payload: Record<string, unknown>): CacpEvent {
  return { protocol: "cacp", version: "0.2.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
}
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-config.test.ts packages/server/test/ids.test.ts
git add packages/server/src/config.ts packages/server/src/ids.ts packages/server/test/cloud-config.test.ts packages/server/test/ids.test.ts
git commit -m "feat(server): add cloud runtime config and token hashing"
```

Expected: tests PASS and commit succeeds.

---

### Task 2: Persistent Rooms, Invites, and Pairings

**Files:**
- Modify: `packages/server/src/event-store.ts`
- Test: `packages/server/test/cloud-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `packages/server/test/cloud-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

describe("cloud persistence records", () => {
  it("persists rooms", () => {
    const store = new EventStore(":memory:");
    store.createRoom({ room_id: "room_alpha", name: "Alpha", owner_participant_id: "user_owner", created_at: "2026-04-27T00:00:00.000Z", archived_at: null });
    expect(store.getRoom("room_alpha")?.name).toBe("Alpha");
    store.close();
  });

  it("persists invite usage and prevents over-use", () => {
    const store = new EventStore(":memory:");
    store.createInvite({ invite_id: "inv_alpha", room_id: "room_alpha", token_hash: "hash_alpha", role: "member", created_by: "user_owner", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-28T00:00:00.000Z", max_uses: 1 });
    expect(store.getInviteByTokenHash("hash_alpha")?.used_count).toBe(0);
    expect(store.consumeInvite("inv_alpha").used_count).toBe(1);
    expect(() => store.consumeInvite("inv_alpha")).toThrow("invite_use_limit_reached");
    store.close();
  });

  it("claims pairings once", () => {
    const store = new EventStore(":memory:");
    store.createAgentPairing({ pairing_id: "pair_alpha", room_id: "room_alpha", token_hash: "pair_hash_alpha", created_by: "user_owner", agent_type: "echo", permission_level: "read_only", working_dir: ".", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-27T00:15:00.000Z" });
    expect(store.claimAgentPairing("pair_alpha", "2026-04-27T00:01:00.000Z").claimed_at).toBe("2026-04-27T00:01:00.000Z");
    expect(() => store.claimAgentPairing("pair_alpha", "2026-04-27T00:02:00.000Z")).toThrow("pairing_claimed");
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-store.test.ts
```

Expected: FAIL because new `EventStore` methods do not exist.

- [ ] **Step 3: Add store types and tables**

In `packages/server/src/event-store.ts`, add exported interfaces for `StoredRoom`, `StoredInvite`, `NewInvite`, `StoredAgentPairing`, and `NewAgentPairing`. Add SQL tables `rooms`, `invites`, and `agent_pairings` in the constructor with the exact columns from the design spec.

Use these method signatures in `EventStore`:

```ts
createRoom(room: StoredRoom): StoredRoom
getRoom(roomId: string): StoredRoom | undefined
createInvite(invite: NewInvite): StoredInvite
getInviteById(inviteId: string): StoredInvite | undefined
getInviteByTokenHash(tokenHash: string): StoredInvite | undefined
consumeInvite(inviteId: string): StoredInvite
revokeInvite(inviteId: string, revokedAt: string): StoredInvite
createAgentPairing(pairing: NewAgentPairing): StoredAgentPairing
getAgentPairingById(pairingId: string): StoredAgentPairing | undefined
getAgentPairingByTokenHash(tokenHash: string): StoredAgentPairing | undefined
claimAgentPairing(pairingId: string, claimedAt: string): StoredAgentPairing
```

`consumeInvite` must throw `invite_not_found`, `invite_revoked`, or `invite_use_limit_reached`. `claimAgentPairing` must throw `pairing_not_found` or `pairing_claimed`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-store.test.ts packages/server/test/event-store.test.ts
git add packages/server/src/event-store.ts packages/server/test/cloud-store.test.ts
git commit -m "feat(server): persist cloud rooms invites and pairings"
```

Expected: tests PASS and commit succeeds.

---

### Task 3: Server Endpoint Integration

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/cloud-server.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Create `packages/server/test/cloud-server.test.ts` with tests for:

```ts
// Required test names:
// 1. "creates durable invite links that work after restart"
// 2. "does not expose plaintext invite tokens in events"
// 3. "creates durable single-use pairings that work after restart"
// 4. "disables start-local in cloud mode"
```

Use this config helper in the test file:

```ts
function cloudConfig() {
  return {
    deploymentMode: "cloud" as const,
    enableLocalLaunch: false,
    publicOrigin: "https://cacp.zuchongai.com",
    tokenSecret: "0123456789abcdef0123456789abcdef",
    bodyLimitBytes: 1024 * 1024,
    maxMessageLength: 4000,
    maxParticipantsPerRoom: 20,
    maxAgentsPerRoom: 3,
    maxSocketsPerRoom: 50,
    rateLimitWindowMs: 60_000,
    roomCreateLimit: 20,
    inviteCreateLimit: 60,
    joinAttemptLimit: 60,
    pairingCreateLimit: 30,
    messageCreateLimit: 120
  };
}
```

The restart tests must use a real temporary database path, close the first Fastify app, create a second app with the same database path, and then join/claim using the original token.

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-server.test.ts
```

Expected: FAIL because `buildServer` does not accept `config` and invite/pairing state is still in memory.

- [ ] **Step 3: Wire config into server**

In `packages/server/src/server.ts`, import:

```ts
import { hasAllowedOrigin, loadServerConfig, type ServerConfig } from "./config.js";
import { hashToken } from "./ids.js";
```

Change options:

```ts
export interface BuildServerOptions { dbPath?: string; localAgentLauncher?: LocalAgentLauncher; repoRoot?: string; config?: ServerConfig }
```

Create Fastify with:

```ts
  const config = options.config ?? loadServerConfig();
  const app = Fastify({ bodyLimit: config.bodyLimitBytes });
```

- [ ] **Step 4: Replace in-memory invite and pairing maps**

Delete `const invites = new Map...` and `const pairings = new Map...`. In `/rooms`, call `store.createRoom` in the same transaction that adds the owner participant and appends `room.created`.

In `/rooms/:roomId/invites`, generate `inviteId`, `inviteToken`, and `token_hash: hashToken(inviteToken, config.tokenSecret)`. Store only the hash and return the plaintext token once.

In `/rooms/:roomId/join`, look up `store.getInviteByTokenHash(hashToken(body.invite_token, config.tokenSecret))`, reject wrong room, revoked, expired, and over-used invites, then call `store.consumeInvite(invite.invite_id)` in the participant-join transaction.

In `createAgentPairing`, generate `pairingId`, plaintext pairing token, store the token hash, and return the plaintext token once.

In `/agent-pairings/:pairingToken/claim`, look up by hash, reject claimed/expired tokens, and call `store.claimAgentPairing` in the same transaction that registers the Agent participant.

- [ ] **Step 5: Disable start-local in cloud mode**

At the beginning of `/rooms/:roomId/agent-pairings/start-local`, after auth and role checks:

```ts
    if (!config.enableLocalLaunch) return deny(reply, "local_launch_disabled", 403);
```

- [ ] **Step 6: Update server URL and index entrypoint**

In pairing creation routes, prefer:

```ts
const serverUrl = body.server_url ?? config.publicOrigin ?? `${request.protocol}://${request.headers.host}`;
```

Replace `packages/server/src/index.ts` with:

```ts
import { loadServerConfig } from "./config.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3737);
const host = process.env.HOST ?? "127.0.0.1";
const config = loadServerConfig();
const app = await buildServer({ dbPath: process.env.CACP_DB ?? "cacp.db", config });
await app.listen({ port, host });
console.log(`CACP server listening on http://${host}:${port}`);
```

- [ ] **Step 7: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/cloud-server.test.ts
corepack pnpm --filter @cacp/server test
git add packages/server/src/server.ts packages/server/src/index.ts packages/server/test/cloud-server.test.ts
git commit -m "feat(server): use persistent cloud invites and pairings"
```

Expected: tests PASS and commit succeeds.

---

### Task 4: Limits, Origin Checks, and Rate Limiting

**Files:**
- Create: `packages/server/src/rate-limit.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/rate-limit.test.ts`
- Modify: `packages/server/test/cloud-server.test.ts`

- [ ] **Step 1: Write rate limiter test**

Create `packages/server/test/rate-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows only the configured count per window", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, limit: 2 });
    expect(limiter.allow("ip:a", 0)).toBe(true);
    expect(limiter.allow("ip:a", 10)).toBe(true);
    expect(limiter.allow("ip:a", 20)).toBe(false);
    expect(limiter.allow("ip:a", 1001)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement limiter**

Create `packages/server/src/rate-limit.ts`:

```ts
export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  limit: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  allow(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStart >= this.options.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (existing.count >= this.options.limit) return false;
    existing.count += 1;
    return true;
  }
}
```

- [ ] **Step 3: Add endpoint hardening tests**

Append tests to `packages/server/test/cloud-server.test.ts` for:

- message longer than configured `maxMessageLength` returns `400`;
- `roomCreateLimit: 1` causes the second `POST /rooms` to return `429` with `{ error: "rate_limited" }`;
- `maxParticipantsPerRoom: 1` rejects a second human join with `409`;
- `maxAgentsPerRoom: 1` rejects a second pairing claim or direct agent register with `409`.

- [ ] **Step 4: Wire server hardening**

In `server.ts`, import `FixedWindowRateLimiter`, create one limiter each for rooms, invites, joins, pairings, and messages, and add a helper:

```ts
function tooMany(reply: FastifyReply) {
  return reply.code(429).send({ error: "rate_limited" });
}
```

Add rate checks at the start of the relevant handlers. Change `MessageSchema` to `z.object({ text: z.string().min(1).max(config.maxMessageLength) })` inside the messages handler. Add WebSocket origin checks using `hasAllowedOrigin(config, request.headers.origin)` and track `socketCounts` by room ID to enforce `maxSocketsPerRoom`.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/rate-limit.test.ts packages/server/test/cloud-server.test.ts packages/server/test/server-hardening.test.ts
git add packages/server/src/rate-limit.ts packages/server/src/server.ts packages/server/test/rate-limit.test.ts packages/server/test/cloud-server.test.ts
git commit -m "feat(server): add cloud rate limits and connection guards"
```

Expected: tests PASS and commit succeeds.

---

### Task 5: Web Cloud Connector Flow

**Files:**
- Create: `packages/web/src/runtime-config.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/components/Workspace.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/MobileDrawer.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Test: `packages/web/test/runtime-config.test.ts`
- Test: `packages/web/test/cloud-connector.test.tsx`

- [ ] **Step 1: Add runtime config helper and test**

Create `packages/web/src/runtime-config.ts`:

```ts
export type WebDeploymentMode = "local" | "cloud";

export function deploymentModeFromEnv(env: Record<string, string | undefined>): WebDeploymentMode {
  return env.VITE_CACP_DEPLOYMENT_MODE === "cloud" ? "cloud" : "local";
}

export function isCloudMode(env: Record<string, string | undefined> = import.meta.env): boolean {
  return deploymentModeFromEnv(env) === "cloud";
}
```

Create `packages/web/test/runtime-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deploymentModeFromEnv, isCloudMode } from "../src/runtime-config.js";

describe("web runtime config", () => {
  it("detects cloud mode", () => {
    expect(deploymentModeFromEnv({ VITE_CACP_DEPLOYMENT_MODE: "cloud" })).toBe("cloud");
    expect(isCloudMode({ VITE_CACP_DEPLOYMENT_MODE: "cloud" })).toBe(true);
  });
  it("defaults to local mode", () => {
    expect(deploymentModeFromEnv({})).toBe("local");
    expect(isCloudMode({})).toBe(false);
  });
});
```

- [ ] **Step 2: Add API pairing type**

In `api.ts`, add:

```ts
export interface AgentPairingResult {
  pairing_token: string;
  expires_at: string;
  command: string;
}
```

Change `createAgentPairing` return type to `Promise<AgentPairingResult>`.

- [ ] **Step 3: Update App cloud behavior**

In `App.tsx`, when `isCloudMode()` is true, `handleCreate` must:

1. call `createRoom`;
2. activate the session;
3. call `createAgentPairing`;
4. store `{ command, expires_at, permission_level }`;
5. never call `createLocalAgentLaunch` or `/start-local`.

Preserve current local-demo behavior when cloud mode is false.

- [ ] **Step 4: Add connector UI**

In `Sidebar.tsx`, add optional props:

```ts
cloudMode?: boolean;
createdPairing?: { command: string; expires_at: string; permission_level: string };
```

When `cloudMode && isOwner && createdPairing`, render a `Local Connector` section with the command, expiry, permission level, safety text, and a button that copies `createdPairing.command` through `navigator.clipboard.writeText`.

Pass the props through `Workspace.tsx` and `MobileDrawer.tsx`.

- [ ] **Step 5: Add landing and i18n copy**

In `Landing.tsx`, show the cloud CTA key `landing.create.cloudCta` and the hint key `landing.create.cloudAgentHint` when `isCloudMode()` is true.

Add these English keys:

```json
"landing.create.cloudCta": "Create room and generate connector command",
"landing.create.cloudAgentHint": "The cloud server will not run the agent. Run the connector command on your own computer.",
"sidebar.connectorLabel": "Local Connector",
"sidebar.connectorHelp": "Run this command locally. Permission: {{permission}}. Expires: {{expiresAt}}.",
"sidebar.copyConnectorCommand": "Copy connector command",
"sidebar.connectorSafety": "For limited write or full access, confirm permissions locally before connecting."
```

Add these Chinese keys:

```json
"landing.create.cloudCta": "创建房间并生成本地连接命令",
"landing.create.cloudAgentHint": "云端服务器不会运行 Agent。请在你自己的电脑上运行连接命令。",
"sidebar.connectorLabel": "本地连接器",
"sidebar.connectorHelp": "在本地电脑运行此命令。权限：{{permission}}。过期时间：{{expiresAt}}。",
"sidebar.copyConnectorCommand": "复制连接命令",
"sidebar.connectorSafety": "如果选择 limited write 或 full access，请在本地连接前确认权限。"
```

- [ ] **Step 6: Add connector UI test**

Create `packages/web/test/cloud-connector.test.tsx` that renders `Sidebar` with `cloudMode={true}` and `createdPairing.command` set to `cacp-connector --server https://cacp.zuchongai.com --pair cacp_pair`. Assert that `Local Connector` and the command are visible.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run packages/web/test/runtime-config.test.ts packages/web/test/cloud-connector.test.tsx packages/web/test/app-copy.test.ts
git add packages/web/src/runtime-config.ts packages/web/src/api.ts packages/web/src/App.tsx packages/web/src/components/Landing.tsx packages/web/src/components/Workspace.tsx packages/web/src/components/Sidebar.tsx packages/web/src/components/MobileDrawer.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/runtime-config.test.ts packages/web/test/cloud-connector.test.tsx
git commit -m "feat(web): show cloud local connector flow"
```

Expected: tests PASS and commit succeeds.

---

### Task 6: Production Build and Deployment Artifacts

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/tsconfig.build.json`
- Create: `deploy/cacp.env.example`
- Create: `deploy/cacp.service`
- Create: `deploy/Caddyfile`
- Create: `docs/deploy-cloud.md`

- [ ] **Step 1: Add server production build**

Create `packages/server/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["test", "dist", "node_modules"]
}
```

In `packages/server/package.json`, add:

```json
"build:prod": "tsc -p tsconfig.build.json",
"start": "node dist/index.js"
```

- [ ] **Step 2: Add deployment templates**

Create `deploy/cacp.env.example`:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3737
CACP_DB=/var/lib/cacp/cacp.db
CACP_DEPLOYMENT_MODE=cloud
CACP_ENABLE_LOCAL_LAUNCH=false
CACP_PUBLIC_ORIGIN=https://cacp.zuchongai.com
CACP_TOKEN_SECRET=replace-with-at-least-32-random-characters
```

Create `deploy/cacp.service`:

```ini
[Unit]
Description=CACP cloud room server
After=network.target

[Service]
Type=simple
User=cacp
Group=cacp
WorkingDirectory=/opt/cacp
EnvironmentFile=/etc/cacp/cacp.env
ExecStart=/usr/bin/corepack pnpm --filter @cacp/server start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/cacp

[Install]
WantedBy=multi-user.target
```

Create `deploy/Caddyfile`:

```caddyfile
cacp.zuchongai.com {
  encode zstd gzip

  handle /health {
    reverse_proxy 127.0.0.1:3737
  }

  handle /rooms* {
    reverse_proxy 127.0.0.1:3737
  }

  handle /agent-pairings* {
    reverse_proxy 127.0.0.1:3737
  }

  handle {
    root * /opt/cacp/packages/web/dist
    try_files {path} /index.html
    file_server
  }
}
```

- [ ] **Step 3: Add deployment runbook**

Create `docs/deploy-cloud.md` with exact Debian commands for installing Node 20, Corepack, pnpm, Caddy, creating `/opt/cacp`, `/var/lib/cacp`, `/etc/cacp`, copying `deploy/cacp.service`, copying `deploy/Caddyfile`, generating `CACP_TOKEN_SECRET` with `openssl rand -base64 48`, enabling `cacp.service`, reloading Caddy, and smoke testing `https://cacp.zuchongai.com/health`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server build:prod
corepack pnpm --filter @cacp/web build
corepack pnpm check
git add packages/server/package.json packages/server/tsconfig.build.json deploy/cacp.env.example deploy/cacp.service deploy/Caddyfile docs/deploy-cloud.md
git commit -m "docs(deploy): add cloud deployment artifacts"
```

Expected: builds/tests PASS and commit succeeds.

---

### Task 7: Final Local and Remote Smoke Validation

**Files:**
- Modify only files involved in concrete validation defects found during this task.

- [ ] **Step 1: Run full local validation**

Run:

```powershell
corepack pnpm check
git status --short
```

Expected: `corepack pnpm check` PASS. No files from Tasks 1-6 are unstaged.

- [ ] **Step 2: Deploy to Debian 12.10**

Use the validated SSH access from `docs/Server info.md`. Follow `docs/deploy-cloud.md` exactly. The remote runtime values must include:

```env
CACP_DEPLOYMENT_MODE=cloud
CACP_ENABLE_LOCAL_LAUNCH=false
CACP_PUBLIC_ORIGIN=https://cacp.zuchongai.com
CACP_DB=/var/lib/cacp/cacp.db
```

- [ ] **Step 3: Verify remote health**

Run locally:

```powershell
curl.exe -fsS https://cacp.zuchongai.com/health
```

Expected:

```json
{"ok":true,"protocol":"cacp","version":"0.2.0"}
```

- [ ] **Step 4: Browser smoke test**

Verify in browser:

1. Open `https://cacp.zuchongai.com`.
2. Create a room.
3. Confirm the page shows a Local Connector command and no cloud local launch result.
4. Copy an invite link and join from a second browser profile.
5. Send messages across both profiles.
6. Claim a pairing through a local connector or echo connector and confirm Agent online status.

- [ ] **Step 5: Commit validation fixes if any**

If validation required a fix:

```powershell
git add <changed-files>
git commit -m "fix: complete cloud deployment validation"
```

If validation required no code or doc change, do not create a commit.

---

## Self-Review Notes

Spec coverage:

- Cloud mode and disabled server-side local launch: Tasks 1, 3, 5, 6.
- Unique room IDs and durable room records: Tasks 1, 2, 3.
- Durable, hashed invites: Tasks 1, 2, 3.
- Durable, single-use pairings: Tasks 1, 2, 3.
- Web connector command flow: Task 5.
- Server hardening: Task 4.
- Debian/Caddy/systemd deployment: Task 6.
- End-to-end smoke validation: Task 7.

Execution rule: implement tasks in order. Do not begin the next task until the current task tests pass and its commit is complete.
