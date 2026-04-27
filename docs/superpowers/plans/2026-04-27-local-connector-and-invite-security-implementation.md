# Local Connector and Invite Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable Windows Local Connector flow plus one-use invite approval, owner-controlled participant removal, and server-enforced token revocation for cloud rooms.

**Architecture:** Keep the existing Fastify + SQLite room/event model, but replace direct invite joins with pending join requests and add participant revocations enforced by auth and WebSocket handling. Move connection-code encoding into the protocol package so server, web, and CLI share one format, then make the CLI adapter accept pasted connection codes and package it as `CACP-Local-Connector.exe`.

**Tech Stack:** TypeScript, NodeNext ESM, zod, Fastify 5, `@fastify/websocket`, `better-sqlite3`, React 19, Vite, Vitest, `ws`, Node 20 SEA tooling, `esbuild`, and `postject`.

---

## Scope Check

This plan assumes the cloud room server baseline already exists: durable rooms, hashed invites, hashed agent pairings, rate limits, cloud mode config, and disabled cloud-side local launch. This plan does not add user accounts, organization membership, billing, PostgreSQL, multi-server fan-out, or persistent registered devices.

## File Structure

- Modify `packages/protocol/src/schemas.ts`: add join-request and removal event types.
- Create `packages/protocol/src/connection-code.ts`: shared `CACP-CONNECT:v1:<base64url-json>` helper.
- Modify `packages/protocol/src/index.ts`: export connection-code helpers.
- Modify `packages/server/src/ids.ts`: add AES-GCM sealing helpers for approved participant tokens.
- Modify `packages/server/src/event-store.ts`: add `join_requests` and `participant_revocations` tables and methods.
- Modify `packages/server/src/auth.ts`: reject revoked participants through the existing auth path.
- Modify `packages/server/src/server.ts`: add join-request, approval, rejection, polling, removal, socket closing, and connection-code responses.
- Modify server tests: add focused store, endpoint, revocation, and connection-code coverage.
- Modify `packages/web/src/api.ts`: add join-request and removal APIs; use `connection_code` instead of connector commands.
- Modify `packages/web/src/App.tsx`, `components/Landing.tsx`, `components/Sidebar.tsx`, `components/Workspace.tsx`, `components/MobileDrawer.tsx`, `room-state.ts`, and i18n files for waiting-room, approvals, removals, and connector download UI.
- Modify `packages/cli-adapter/src/config.ts` and `index.ts`: support `--connect`, no-arg prompt mode, and terminal exit on forced close.
- Add `scripts/build-local-connector.mjs`, `packages/web/public/downloads/.gitkeep`, and package scripts for the Windows executable.

---

### Task 1: Protocol Event Types and Connection Code Helper

**Files:**
- Modify: `packages/protocol/src/schemas.ts`
- Create: `packages/protocol/src/connection-code.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/connection-code.test.ts`

- [ ] **Step 1: Write failing connection-code tests**

Create `packages/protocol/test/connection-code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildConnectionCode, parseConnectionCode } from "../src/connection-code.js";

describe("connection code", () => {
  it("round-trips a pairing payload", () => {
    const payload = {
      server_url: "https://cacp.example.com",
      pairing_token: "cacp_pairing_secret",
      expires_at: "2026-04-27T08:15:00.000Z",
      room_id: "room_alpha",
      agent_type: "codex",
      permission_level: "read_only"
    };
    const code = buildConnectionCode(payload);
    expect(code).toMatch(/^CACP-CONNECT:v1:[A-Za-z0-9_-]+$/);
    expect(parseConnectionCode(code)).toEqual(payload);
  });

  it("rejects malformed codes", () => {
    expect(() => parseConnectionCode("bad")).toThrow("invalid_connection_code");
    expect(() => parseConnectionCode("CACP-CONNECT:v2:e30")).toThrow("invalid_connection_code");
  });
});
```

- [ ] **Step 2: Add failing event-type assertion**

Append to the same test file:

```ts
import { EventTypeSchema } from "../src/schemas.js";

it("accepts invite approval and removal event types", () => {
  for (const type of [
    "join_request.created",
    "join_request.approved",
    "join_request.rejected",
    "join_request.expired",
    "participant.removed"
  ]) {
    expect(EventTypeSchema.parse(type)).toBe(type);
  }
});
```

- [ ] **Step 3: Run protocol test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/protocol exec vitest run packages/protocol/test/connection-code.test.ts
```

Expected: FAIL because `connection-code.ts` and the new event types do not exist.

- [ ] **Step 4: Implement connection-code helper**

Create `packages/protocol/src/connection-code.ts`:

```ts
import { z } from "zod";

const Prefix = "CACP-CONNECT:v1:";

export const ConnectionCodePayloadSchema = z.object({
  server_url: z.string().url(),
  pairing_token: z.string().min(1),
  expires_at: z.string().datetime(),
  room_id: z.string().min(1).optional(),
  agent_type: z.string().min(1).optional(),
  permission_level: z.string().min(1).optional()
});

export type ConnectionCodePayload = z.infer<typeof ConnectionCodePayloadSchema>;

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildConnectionCode(payload: ConnectionCodePayload): string {
  const parsed = ConnectionCodePayloadSchema.parse(payload);
  return `${Prefix}${encodeBase64Url(JSON.stringify(parsed))}`;
}

export function parseConnectionCode(code: string): ConnectionCodePayload {
  if (!code.startsWith(Prefix)) throw new Error("invalid_connection_code");
  try {
    return ConnectionCodePayloadSchema.parse(JSON.parse(decodeBase64Url(code.slice(Prefix.length))));
  } catch {
    throw new Error("invalid_connection_code");
  }
}
```

- [ ] **Step 5: Add event types and export helper**

In `packages/protocol/src/schemas.ts`, add these values to `EventTypeSchema`:

```ts
"join_request.created", "join_request.approved", "join_request.rejected", "join_request.expired", "participant.removed",
```

In `packages/protocol/src/index.ts`, add:

```ts
export * from "./connection-code.js";
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/protocol exec vitest run packages/protocol/test/connection-code.test.ts
corepack pnpm --filter @cacp/protocol build
git add packages/protocol/src/schemas.ts packages/protocol/src/connection-code.ts packages/protocol/src/index.ts packages/protocol/test/connection-code.test.ts
git commit -m "feat(protocol): add connector codes and invite security events"
```

Expected: tests PASS and commit succeeds.

---

### Task 2: Store Join Requests, Revocations, and Sealed Approved Tokens

**Files:**
- Modify: `packages/server/src/ids.ts`
- Modify: `packages/server/src/event-store.ts`
- Test: `packages/server/test/join-request-store.test.ts`
- Test: `packages/server/test/ids.test.ts`

- [ ] **Step 1: Add failing secret sealing tests**

Append to `packages/server/test/ids.test.ts`:

```ts
import { openSecret, sealSecret } from "../src/ids.js";

it("seals approved participant tokens for polling retrieval", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const sealed = sealSecret("cacp_participant_token", secret);
  expect(sealed).toMatch(/^aes-256-gcm:/);
  expect(sealed).not.toContain("cacp_participant_token");
  expect(openSecret(sealed, secret)).toBe("cacp_participant_token");
  expect(() => openSecret(sealed, "wrong-secret")).toThrow("invalid_secret");
});
```

- [ ] **Step 2: Add failing store tests**

Create `packages/server/test/join-request-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

describe("join requests and participant revocations", () => {
  it("stores one pending request per consumed invite", () => {
    const store = new EventStore(":memory:");
    store.createJoinRequest({
      request_id: "join_alpha",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_alpha",
      display_name: "Alice",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:00:00.000Z",
      expires_at: "2026-04-27T08:10:00.000Z",
      requester_ip: "127.0.0.1",
      requester_user_agent: "vitest"
    });
    expect(store.getJoinRequest("join_alpha")?.display_name).toBe("Alice");
    expect(() => store.createJoinRequest({
      request_id: "join_beta",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_beta",
      display_name: "Bob",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:01:00.000Z",
      expires_at: "2026-04-27T08:11:00.000Z"
    })).toThrow();
    store.close();
  });

  it("transitions a pending request once", () => {
    const store = new EventStore(":memory:");
    store.createJoinRequest({
      request_id: "join_alpha",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_alpha",
      display_name: "Alice",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:00:00.000Z",
      expires_at: "2026-04-27T08:10:00.000Z"
    });
    const approved = store.approveJoinRequest("join_alpha", {
      decided_at: "2026-04-27T08:02:00.000Z",
      decided_by: "user_owner",
      participant_id: "user_alice",
      participant_token_sealed: "sealed_token"
    });
    expect(approved.status).toBe("approved");
    expect(() => store.rejectJoinRequest("join_alpha", "2026-04-27T08:03:00.000Z", "user_owner")).toThrow("join_request_not_pending");
    store.close();
  });

  it("marks participant tokens revoked", () => {
    const store = new EventStore(":memory:");
    store.addParticipant({ room_id: "room_alpha", id: "user_alice", token: "cacp_token", display_name: "Alice", type: "human", role: "member" });
    expect(store.getParticipantByToken("room_alpha", "cacp_token")?.id).toBe("user_alice");
    store.revokeParticipant("room_alpha", "user_alice", "user_owner", "2026-04-27T08:04:00.000Z", "removed_by_owner");
    expect(store.getParticipantByToken("room_alpha", "cacp_token")).toBeUndefined();
    expect(store.isParticipantRevoked("room_alpha", "user_alice")).toBe(true);
    store.close();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/ids.test.ts packages/server/test/join-request-store.test.ts
```

Expected: FAIL because sealing helpers and store methods do not exist.

- [ ] **Step 4: Add token sealing helpers**

In `packages/server/src/ids.ts`, extend the crypto import and add:

```ts
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

function secretKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function sealSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function openSecret(sealed: string, secret: string): string {
  const [scheme, ivValue, tagValue, encryptedValue] = sealed.split(":");
  if (scheme !== "aes-256-gcm" || !ivValue || !tagValue || !encryptedValue) throw new Error("invalid_secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("invalid_secret");
  }
}
```

Keep the existing `randomBytes` import and avoid duplicate crypto imports.

- [ ] **Step 5: Add store tables and methods**

In `packages/server/src/event-store.ts`, add interfaces:

```ts
export type JoinRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface NewJoinRequest {
  request_id: string;
  room_id: string;
  invite_id: string;
  request_token_hash: string;
  display_name: string;
  role: "member" | "observer";
  status: JoinRequestStatus;
  requested_at: string;
  expires_at: string;
  requester_ip?: string;
  requester_user_agent?: string;
}

export interface StoredJoinRequest extends NewJoinRequest {
  decided_at: string | null;
  decided_by: string | null;
  participant_id: string | null;
  participant_token_sealed: string | null;
}

export interface StoredParticipantRevocation {
  room_id: string;
  participant_id: string;
  removed_by: string;
  removed_at: string;
  reason: string | null;
}
```

Add SQL:

```sql
CREATE TABLE IF NOT EXISTS join_requests (
  request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  invite_id TEXT NOT NULL UNIQUE,
  request_token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK(length(display_name) <= 100),
  role TEXT NOT NULL CHECK(role IN ('member', 'observer')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  participant_id TEXT,
  participant_token_sealed TEXT,
  requester_ip TEXT,
  requester_user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_join_requests_room_status ON join_requests(room_id, status);
CREATE TABLE IF NOT EXISTS participant_revocations (
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  removed_by TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(room_id, participant_id)
);
```

Add methods with these names:

```ts
createJoinRequest(input: NewJoinRequest): StoredJoinRequest
getJoinRequest(requestId: string): StoredJoinRequest | undefined
getJoinRequestByTokenHash(requestTokenHash: string): StoredJoinRequest | undefined
listJoinRequests(roomId: string, status?: JoinRequestStatus): StoredJoinRequest[]
approveJoinRequest(requestId: string, input: { decided_at: string; decided_by: string; participant_id: string; participant_token_sealed: string }): StoredJoinRequest
rejectJoinRequest(requestId: string, decidedAt: string, decidedBy: string): StoredJoinRequest
expireJoinRequest(requestId: string, decidedAt: string): StoredJoinRequest
revokeParticipant(roomId: string, participantId: string, removedBy: string, removedAt: string, reason?: string): StoredParticipantRevocation
isParticipantRevoked(roomId: string, participantId: string): boolean
```

Each transition method must update only `status = 'pending'`; otherwise throw `join_request_not_found` or `join_request_not_pending`.

- [ ] **Step 6: Enforce revocation in token lookup**

In `getParticipantByToken`, after selecting the participant row, return `undefined` when `isParticipantRevoked(row.room_id, row.participant_id)` is true.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/ids.test.ts packages/server/test/join-request-store.test.ts packages/server/test/cloud-store.test.ts packages/server/test/event-store.test.ts
git add packages/server/src/ids.ts packages/server/src/event-store.ts packages/server/test/ids.test.ts packages/server/test/join-request-store.test.ts
git commit -m "feat(server): store join requests and participant revocations"
```

Expected: tests PASS and commit succeeds.

---

### Task 3: Server Join Approval Endpoints

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/join-approval.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Create `packages/server/test/join-approval.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

function cloudConfig() {
  return {
    deploymentMode: "cloud" as const,
    enableLocalLaunch: false,
    publicOrigin: "https://cacp.example.com",
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

async function owner(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  const body = created.json() as { room_id: string; owner_token: string; owner_id: string };
  return body;
}

async function invite(app: FastifyInstance, roomId: string, ownerToken: string) {
  const response = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { role: "member", expires_in_seconds: 3600 }
  });
  return response.json() as { invite_token: string };
}

describe("join approval endpoints", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("requires owner approval before returning a participant token", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);

    const pending = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests`,
      payload: { invite_token: createdInvite.invite_token, display_name: "Alice" }
    });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string; request_token: string; status: string };
    expect(request.status).toBe("pending");

    const beforeApproval = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    expect(beforeApproval.json()).toMatchObject({ status: "pending" });
    expect(beforeApproval.json()).not.toHaveProperty("participant_token");

    const approved = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(approved.statusCode).toBe(201);

    const afterApproval = await app.inject({
      method: "GET",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}`
    });
    const approvedBody = afterApproval.json() as { status: string; participant_token?: string; participant_id?: string };
    expect(approvedBody.status).toBe("approved");
    expect(approvedBody.participant_token).toMatch(/^cacp_/);
    expect(approvedBody.participant_id).toMatch(/^user_/);
  });

  it("makes each invite token single-use", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);
    const first = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Alice" } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Bob" } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "invite_use_limit_reached" });
  });

  it("rejects and expires pending requests without issuing tokens", async () => {
    app = await buildServer({ dbPath: ":memory:", config: cloudConfig() });
    const room = await owner(app);
    const createdInvite = await invite(app, room.room_id, room.owner_token);
    const pending = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: createdInvite.invite_token, display_name: "Alice" } });
    const request = pending.json() as { request_id: string; request_token: string };
    const rejected = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/reject`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(rejected.statusCode).toBe(201);
    const status = await app.inject({ method: "GET", url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
    expect(status.json()).toMatchObject({ status: "rejected" });
    const approveRejected = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(approveRejected.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/join-approval.test.ts
```

Expected: FAIL because the join-request routes do not exist.

- [ ] **Step 3: Add schemas and helpers**

In `packages/server/src/server.ts`, import:

```ts
import { openSecret, sealSecret } from "./ids.js";
```

Add schemas near existing request schemas:

```ts
const JoinRequestCreateSchema = z.object({ invite_token: z.string().min(1), display_name: z.string().min(1).max(100) });
const JoinRequestStatusQuerySchema = z.object({ request_token: z.string().min(1) });
const JoinRequestListQuerySchema = z.object({ status: z.enum(["pending", "approved", "rejected", "expired"]).optional() });
const JoinDecisionSchema = z.object({ reason: z.string().max(300).optional() });
```

Add:

```ts
function joinRequestExpiry(): string {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

function publicJoinRequest(request: { request_id: string; display_name: string; role: string; status: string; requested_at: string; expires_at: string }) {
  return {
    request_id: request.request_id,
    display_name: request.display_name,
    role: request.role,
    status: request.status,
    requested_at: request.requested_at,
    expires_at: request.expires_at
  };
}
```

- [ ] **Step 4: Make invite creation one-use by default**

In `/rooms/:roomId/invites`, change the stored invite from `max_uses: null` to:

```ts
max_uses: 1
```

Keep response shape unchanged so the web can still build unique URLs.

- [ ] **Step 5: Add public create and poll routes**

Add before the old direct join route:

```ts
app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join-requests", async (request, reply) => {
  if (!joinLimiter.allow(request.ip)) return tooMany(reply);
  const body = JoinRequestCreateSchema.parse(request.body);
  const requestId = prefixedId("join");
  const requestToken = token();
  const roomId = request.params.roomId;
  const now = new Date().toISOString();
  const expiresAt = joinRequestExpiry();
  const result = store.transaction(() => {
    const invite = store.getInviteByTokenHash(hashToken(body.invite_token, config.tokenSecret));
    if (!invite || invite.room_id !== roomId) return { ok: false as const, error: "invalid_invite" };
    if (invite.revoked_at !== null) return { ok: false as const, error: "invite_revoked" };
    if (Date.parse(invite.expires_at) <= Date.now()) return { ok: false as const, error: "invite_expired" };
    if (invite.max_uses !== null && invite.used_count >= invite.max_uses) return { ok: false as const, error: "invite_use_limit_reached", status: 409 };
    store.consumeInvite(invite.invite_id);
    const stored = store.createJoinRequest({
      request_id: requestId,
      room_id: roomId,
      invite_id: invite.invite_id,
      request_token_hash: hashToken(requestToken, config.tokenSecret),
      display_name: body.display_name,
      role: invite.role === "observer" ? "observer" : "member",
      status: "pending",
      requested_at: now,
      expires_at: expiresAt,
      requester_ip: request.ip,
      requester_user_agent: request.headers["user-agent"]
    });
    const created = store.appendEvent(event(roomId, "join_request.created", "system", publicJoinRequest(stored)));
    return { ok: true as const, stored, events: [created] };
  });
  if (!result.ok) return deny(reply, result.error, result.status);
  publishEvents(result.events);
  return reply.code(201).send({ request_id: requestId, request_token: requestToken, status: "pending", expires_at: expiresAt });
});

app.get<{ Params: { roomId: string; requestId: string }; Querystring: { request_token?: string } }>("/rooms/:roomId/join-requests/:requestId", async (request, reply) => {
  const query = JoinRequestStatusQuerySchema.parse(request.query);
  const tokenHash = hashToken(query.request_token, config.tokenSecret);
  const current = store.getJoinRequest(request.params.requestId);
  if (!current || current.room_id !== request.params.roomId || current.request_token_hash !== tokenHash) return deny(reply, "unknown_join_request", 404);
  if (current.status === "pending" && Date.parse(current.expires_at) <= Date.now()) {
    const expired = store.expireJoinRequest(current.request_id, new Date().toISOString());
    appendAndPublish(event(current.room_id, "join_request.expired", "system", publicJoinRequest(expired)));
    return { status: "expired" };
  }
  if (current.status === "approved") {
    return {
      status: "approved",
      participant_id: current.participant_id,
      participant_token: current.participant_token_sealed ? openSecret(current.participant_token_sealed, config.tokenSecret) : undefined,
      role: current.role
    };
  }
  return { status: current.status };
});
```

- [ ] **Step 6: Add owner list, approve, and reject routes**

Add:

```ts
app.get<{ Params: { roomId: string }; Querystring: { status?: string } }>("/rooms/:roomId/join-requests", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
  const query = JoinRequestListQuerySchema.parse(request.query);
  return { requests: store.listJoinRequests(request.params.roomId, query.status).map(publicJoinRequest) };
});

app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/join-requests/:requestId/approve", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
  const participantId = prefixedId("user");
  const participantToken = token();
  const decidedAt = new Date().toISOString();
  const result = store.transaction(() => {
    const current = store.getJoinRequest(request.params.requestId);
    if (!current || current.room_id !== request.params.roomId) return { ok: false as const, error: "unknown_join_request", status: 404 };
    if (current.status !== "pending") return { ok: false as const, error: "join_request_not_pending", status: 409 };
    if (Date.parse(current.expires_at) <= Date.now()) {
      const expired = store.expireJoinRequest(current.request_id, decidedAt);
      return { ok: false as const, error: "join_request_expired", status: 409, events: [store.appendEvent(event(current.room_id, "join_request.expired", "system", publicJoinRequest(expired)))] };
    }
    const humans = store.getParticipants(current.room_id).filter((p) => p.role !== "agent");
    if (humans.length >= config.maxParticipantsPerRoom) return { ok: false as const, error: "max_participants_reached", status: 409 };
    const role = current.role === "observer" ? "observer" : "member";
    const joined = store.addParticipant({ room_id: current.room_id, id: participantId, token: participantToken, display_name: current.display_name, type: role === "observer" ? "observer" : "human", role });
    const approved = store.approveJoinRequest(current.request_id, {
      decided_at: decidedAt,
      decided_by: participant.id,
      participant_id: participantId,
      participant_token_sealed: sealSecret(participantToken, config.tokenSecret)
    });
    return { ok: true as const, participant: joined, role, events: [
      store.appendEvent(event(current.room_id, "join_request.approved", participant.id, publicJoinRequest(approved))),
      store.appendEvent(event(current.room_id, "participant.joined", joined.id, { participant: publicParticipant(joined) }))
    ] };
  });
  if (!result.ok) {
    if (result.events) publishEvents(result.events);
    return deny(reply, result.error, result.status);
  }
  publishEvents(result.events);
  return reply.code(201).send({ participant_id: result.participant.id, role: result.role });
});

app.post<{ Params: { roomId: string; requestId: string } }>("/rooms/:roomId/join-requests/:requestId/reject", async (request, reply) => {
  const participant = requireParticipant(store, request.params.roomId, request);
  if (!participant) return deny(reply, "invalid_token");
  if (!hasHumanRole(participant, ["owner"])) return deny(reply, "forbidden", 403);
  JoinDecisionSchema.parse(request.body);
  const current = store.getJoinRequest(request.params.requestId);
  if (!current || current.room_id !== request.params.roomId) return deny(reply, "unknown_join_request", 404);
  const rejected = store.rejectJoinRequest(request.params.requestId, new Date().toISOString(), participant.id);
  appendAndPublish(event(request.params.roomId, "join_request.rejected", participant.id, publicJoinRequest(rejected)));
  return reply.code(201).send({ ok: true });
});
```

- [ ] **Step 7: Disable direct invite join**

Change `/rooms/:roomId/join` to avoid issuing a participant token from an invite token. Replace its handler body with:

```ts
return deny(reply, "join_requires_owner_approval", 410);
```

Update tests that used direct join to create a join request, approve it, poll status, then use the returned participant token.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/join-approval.test.ts packages/server/test/cloud-server.test.ts packages/server/test/server.test.ts
git add packages/server/src/server.ts packages/server/test/join-approval.test.ts packages/server/test/cloud-server.test.ts packages/server/test/server.test.ts
git commit -m "feat(server): require owner approval for invite joins"
```

Expected: tests PASS and commit succeeds.

---

### Task 4: Server Participant Removal and Forced Exit

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/participant-removal.test.ts`

- [ ] **Step 1: Write failing removal tests**

Create `packages/server/test/participant-removal.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { buildServer } from "../src/server.js";

function config() {
  return {
    deploymentMode: "local" as const,
    enableLocalLaunch: true,
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

describe("participant removal", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("revokes a member token and records a removal event", async () => {
    app = await buildServer({ dbPath: ":memory:", config: config() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const invite = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: { role: "member" } })).json() as { invite_token: string };
    const pending = (await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: invite.invite_token, display_name: "Alice" } })).json() as { request_id: string; request_token: string };
    await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests/${pending.request_id}/approve`, headers: { authorization: `Bearer ${room.owner_token}` }, payload: {} });
    const approved = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/join-requests/${pending.request_id}?request_token=${encodeURIComponent(pending.request_token)}` })).json() as { participant_id: string; participant_token: string };

    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${approved.participant_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { reason: "owner_removed" }
    });
    expect(removed.statusCode).toBe(201);

    const message = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/messages`,
      headers: { authorization: `Bearer ${approved.participant_token}` },
      payload: { text: "after removal" }
    });
    expect(message.statusCode).toBe(401);

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: { authorization: `Bearer ${room.owner_token}` } })).json() as { events: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(events.events.some((event) => event.type === "participant.removed" && event.payload.participant_id === approved.participant_id)).toBe(true);
  });

  it("does not allow removing the owner", async () => {
    app = await buildServer({ dbPath: ":memory:", config: config() });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string; owner_id: string };
    const removed = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/participants/${room.owner_id}/remove`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({ error: "cannot_remove_owner" });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/participant-removal.test.ts
```

Expected: FAIL because `/participants/:participantId/remove` does not exist.

- [ ] **Step 3: Track sockets by participant**

In `buildServer`, replace the single `socketCounts` map with:

```ts
const socketCounts = new Map<string, number>();
const participantSockets = new Map<string, Set<{ close: (code?: number, reason?: string) => void }>>();

function socketKey(roomId: string, participantId: string): string {
  return `${roomId}:${participantId}`;
}

function rememberSocket(roomId: string, participantId: string, socket: { close: (code?: number, reason?: string) => void }): () => void {
  const key = socketKey(roomId, participantId);
  const sockets = participantSockets.get(key) ?? new Set();
  sockets.add(socket);
  participantSockets.set(key, sockets);
  return () => {
    sockets.delete(socket);
    if (sockets.size === 0) participantSockets.delete(key);
  };
}

function closeParticipantSockets(roomId: string, participantId: string): void {
  const sockets = participantSockets.get(socketKey(roomId, participantId));
  if (!sockets) return;
  for (const socket of sockets) socket.close(4001, "participant_removed");
}
```

In the WebSocket route, after participant auth succeeds:

```ts
const forgetSocket = rememberSocket(roomId, participant.id, socket);
```

Call `forgetSocket()` inside the existing `socket.on("close")` callback.

- [ ] **Step 4: Add removal route**

Add schema:

```ts
const RemoveParticipantSchema = z.object({ reason: z.string().max(300).optional() });
```

Add route:

```ts
app.post<{ Params: { roomId: string; participantId: string } }>("/rooms/:roomId/participants/:participantId/remove", async (request, reply) => {
  const actor = requireParticipant(store, request.params.roomId, request);
  if (!actor) return deny(reply, "invalid_token");
  if (!hasHumanRole(actor, ["owner"])) return deny(reply, "forbidden", 403);
  const body = RemoveParticipantSchema.parse(request.body);
  const target = findParticipant(request.params.roomId, request.params.participantId);
  if (!target) return deny(reply, "unknown_participant", 404);
  if (target.role === "owner") return deny(reply, "cannot_remove_owner", 409);
  if (target.id === actor.id) return deny(reply, "cannot_remove_self", 409);
  const removedAt = new Date().toISOString();
  const storedEvents = store.transaction(() => {
    store.revokeParticipant(request.params.roomId, target.id, actor.id, removedAt, body.reason ?? "removed_by_owner");
    const events = [
      store.appendEvent(event(request.params.roomId, "participant.removed", actor.id, {
        participant_id: target.id,
        removed_by: actor.id,
        removed_at: removedAt,
        reason: body.reason ?? "removed_by_owner"
      }))
    ];
    if (target.role === "agent") {
      events.push(store.appendEvent(event(request.params.roomId, "agent.status_changed", target.id, { agent_id: target.id, status: "offline" })));
    }
    return events;
  });
  publishEvents(storedEvents);
  closeParticipantSockets(request.params.roomId, target.id);
  return reply.code(201).send({ ok: true });
});
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/participant-removal.test.ts packages/server/test/join-approval.test.ts packages/server/test/server-governance.test.ts
git add packages/server/src/server.ts packages/server/test/participant-removal.test.ts
git commit -m "feat(server): enforce participant removal"
```

Expected: tests PASS and commit succeeds.

---

### Task 5: Server Connection Code Response

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/connection-code-server.test.ts`
- Modify: `packages/server/test/cloud-server.test.ts`

- [ ] **Step 1: Write failing server connection-code test**

Create `packages/server/test/connection-code-server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseConnectionCode } from "@cacp/protocol";
import { buildServer } from "../src/server.js";

describe("agent pairing connection codes", () => {
  it("returns a connection code without exposing a raw pairing token", async () => {
    const app = await buildServer({ dbPath: ":memory:", config: {
      deploymentMode: "cloud",
      enableLocalLaunch: false,
      publicOrigin: "https://cacp.example.com",
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
    } });
    const room = (await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } })).json() as { room_id: string; owner_token: string };
    const response = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_type: "codex", permission_level: "read_only", working_dir: ".", server_url: "https://cacp.example.com" }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { connection_code: string; pairing_token?: string; download_url: string; expires_at: string };
    expect(body.pairing_token).toBeUndefined();
    expect(body.download_url).toBe("/downloads/CACP-Local-Connector.exe");
    const parsed = parseConnectionCode(body.connection_code);
    expect(parsed.server_url).toBe("https://cacp.example.com");
    expect(parsed.room_id).toBe(room.room_id);
    expect(parsed.permission_level).toBe("read_only");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/connection-code-server.test.ts
```

Expected: FAIL because `createAgentPairing` returns `pairing_token` and `command`.

- [ ] **Step 3: Return connection code**

In `packages/server/src/server.ts`, import:

```ts
import { buildConnectionCode } from "@cacp/protocol";
```

Split the existing helper into a storage helper and response builders:

```ts
function createStoredAgentPairing(roomId: string, actorId: string, body: z.infer<typeof AgentPairingCreateSchema>) {
  const pairingId = prefixedId("pair");
  const pairingToken = token();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const storedEvents = store.transaction(() => {
    store.createAgentPairing({
      pairing_id: pairingId,
      room_id: roomId,
      token_hash: hashToken(pairingToken, config.tokenSecret),
      created_by: actorId,
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      working_dir: body.working_dir,
      created_at: now,
      expires_at: expiresAt
    });
    return [store.appendEvent(event(roomId, "agent.pairing_created", actorId, {
      pairing_id: pairingId,
      agent_type: body.agent_type,
      permission_level: body.permission_level,
      expires_at: expiresAt
    }))];
  });
  publishEvents(storedEvents);
  return { pairingId, pairingToken, expiresAt };
}
```

For `/rooms/:roomId/agent-pairings`, return:

```ts
const pairing = createStoredAgentPairing(request.params.roomId, participant.id, body);
return {
  connection_code: buildConnectionCode({
    server_url: serverUrl,
    pairing_token: pairing.pairingToken,
    expires_at: pairing.expiresAt,
    room_id: roomId,
    agent_type: body.agent_type,
    permission_level: body.permission_level
  }),
  expires_at: pairing.expiresAt,
  download_url: "/downloads/CACP-Local-Connector.exe"
};
```

For `/rooms/:roomId/agent-pairings/start-local`, call `createStoredAgentPairing`, then return the existing local launch response shape with `pairing_token: pairing.pairingToken`, `expires_at: pairing.expiresAt`, and `command: pairingCommand(serverUrl, pairing.pairingToken)`.

- [ ] **Step 4: Update cloud-server tests**

In `packages/server/test/cloud-server.test.ts`, replace assertions that expect `pairing_token` or `command` from `/agent-pairings` with `connection_code`. Parse the code with `parseConnectionCode` and claim the parsed `pairing_token` through `/agent-pairings/:pairingToken/claim`.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/server exec vitest run packages/server/test/connection-code-server.test.ts packages/server/test/cloud-server.test.ts
git add packages/server/src/server.ts packages/server/test/connection-code-server.test.ts packages/server/test/cloud-server.test.ts
git commit -m "feat(server): return local connector connection codes"
```

Expected: tests PASS and commit succeeds.

---

### Task 6: Web Waiting Room, Approval Panel, and Removal UI

**Files:**
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/room-state.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/Workspace.tsx`
- Modify: `packages/web/src/components/MobileDrawer.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Test: `packages/web/test/api.test.ts`
- Test: `packages/web/test/room-state.test.ts`
- Test: `packages/web/test/invite-approval.test.tsx`
- Test: `packages/web/test/cloud-connector.test.tsx`

- [ ] **Step 1: Add failing web API tests**

Append to `packages/web/test/api.test.ts`:

```ts
import { approveJoinRequest, createJoinRequest, joinRequestStatus, rejectJoinRequest, removeParticipant } from "../src/api.js";

it("uses join request endpoints instead of direct join", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET" });
    return new Response(JSON.stringify({ request_id: "join_alpha", request_token: "cacp_request", status: "pending", expires_at: "2026-04-27T08:10:00.000Z" }), { status: 201, headers: { "content-type": "application/json" } });
  }));
  await createJoinRequest("room_alpha", "cacp_invite", "Alice");
  expect(calls[0]).toEqual({ url: "/rooms/room_alpha/join-requests", method: "POST" });
});

it("calls owner decision and removal endpoints", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } });
  }));
  const session = { room_id: "room_alpha", token: "owner_token", participant_id: "user_owner", role: "owner" as const };
  await approveJoinRequest(session, "join_alpha");
  await rejectJoinRequest(session, "join_beta");
  await removeParticipant(session, "user_alice");
  expect(calls).toEqual([
    "/rooms/room_alpha/join-requests/join_alpha/approve",
    "/rooms/room_alpha/join-requests/join_beta/reject",
    "/rooms/room_alpha/participants/user_alice/remove"
  ]);
});
```

- [ ] **Step 2: Add failing room-state tests**

Append to `packages/web/test/room-state.test.ts`:

```ts
it("tracks pending join requests and removed participants", () => {
  const state = deriveRoomState([
    event("room.created", "user_owner", { name: "Room" }),
    event("participant.joined", "user_owner", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }),
    event("participant.joined", "user_alice", { participant: { id: "user_alice", display_name: "Alice", role: "member", type: "human" } }),
    event("join_request.created", "system", { request_id: "join_bob", display_name: "Bob", role: "member", status: "pending", requested_at: "2026-04-27T08:00:00.000Z", expires_at: "2026-04-27T08:10:00.000Z" }),
    event("participant.removed", "user_owner", { participant_id: "user_alice", removed_by: "user_owner", removed_at: "2026-04-27T08:01:00.000Z" })
  ]);
  expect(state.participants.some((p) => p.id === "user_alice")).toBe(false);
  expect(state.joinRequests).toHaveLength(1);
  expect(state.joinRequests[0].display_name).toBe("Bob");
});
```

Use the existing test helper for `event`; if the helper is local to the file, extend it with the new event names.

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run packages/web/test/api.test.ts packages/web/test/room-state.test.ts
```

Expected: FAIL because API helpers and `joinRequests` state do not exist.

- [ ] **Step 4: Add API helpers and new pairing shape**

In `packages/web/src/api.ts`, add interfaces and functions:

```ts
export interface JoinRequestResult {
  request_id: string;
  request_token: string;
  status: "pending";
  expires_at: string;
}

export interface JoinRequestStatus {
  status: "pending" | "approved" | "rejected" | "expired";
  participant_id?: string;
  participant_token?: string;
  role?: RoomSession["role"];
}

export interface AgentPairingResult {
  connection_code: string;
  expires_at: string;
  download_url: string;
}

export async function createJoinRequest(roomId: string, inviteToken: string, displayName: string): Promise<JoinRequestResult> {
  return await postJson(`/rooms/${roomId}/join-requests`, undefined, { invite_token: inviteToken, display_name: displayName });
}

export async function joinRequestStatus(roomId: string, requestId: string, requestToken: string): Promise<JoinRequestStatus> {
  const response = await fetch(`/rooms/${roomId}/join-requests/${requestId}?request_token=${encodeURIComponent(requestToken)}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as JoinRequestStatus;
}

export async function approveJoinRequest(session: RoomSession, requestId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/join-requests/${requestId}/approve`, session.token, {});
}

export async function rejectJoinRequest(session: RoomSession, requestId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/join-requests/${requestId}/reject`, session.token, {});
}

export async function removeParticipant(session: RoomSession, participantId: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/participants/${participantId}/remove`, session.token, {});
}
```

Remove or stop using the direct `joinRoom` helper from invite UI.

- [ ] **Step 5: Update room-state derivation**

In `room-state.ts`, add:

```ts
export interface JoinRequestView {
  request_id: string;
  display_name: string;
  role: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_at: string;
  expires_at: string;
}
```

Add `joinRequests: JoinRequestView[]` to `RoomViewState`. In `deriveRoomState`, keep a `Map<string, JoinRequestView>`. On `join_request.created`, set pending request. On `join_request.approved`, `join_request.rejected`, and `join_request.expired`, remove it from the pending map or update status and filter out non-pending requests in the returned array. On `participant.removed`, delete from `participants` and set matching agent status offline when present.

- [ ] **Step 6: Make copy invite always fresh**

In `Sidebar.tsx`, remove the `matchingInvite` reuse branch. `handleCopyInvite` must always call:

```ts
void onCreateInvite(inviteRole, inviteTtl).then((url) => {
  if (url) navigator.clipboard.writeText(url).catch(() => {});
});
```

Keep rendering the latest copied URL as a confirmation only.

- [ ] **Step 7: Add waiting-room flow**

In `App.tsx`, replace direct invite join with:

```ts
const [waitingJoin, setWaitingJoin] = useState<{ room_id: string; request_id: string; request_token: string; display_name: string }>();
```

`handleJoin` should call `createJoinRequest`, store `waitingJoin`, and not activate a room session. Add an effect that polls every 1500 ms:

```ts
useEffect(() => {
  if (!waitingJoin) return;
  let cancelled = false;
  const tick = async () => {
    const status = await joinRequestStatus(waitingJoin.room_id, waitingJoin.request_id, waitingJoin.request_token);
    if (cancelled) return;
    if (status.status === "approved" && status.participant_id && status.participant_token && status.role) {
      activateSession({ room_id: waitingJoin.room_id, participant_id: status.participant_id, token: status.participant_token, role: status.role });
      setWaitingJoin(undefined);
    }
    if (status.status === "rejected" || status.status === "expired") {
      setError(status.status === "rejected" ? "Join request rejected by owner." : "Join request expired.");
      setWaitingJoin(undefined);
    }
  };
  const interval = window.setInterval(() => { void tick(); }, 1500);
  void tick();
  return () => { cancelled = true; window.clearInterval(interval); };
}, [activateSession, waitingJoin]);
```

Pass `waitingJoin` into `Landing` so invitees see a waiting screen instead of the create-room form.

- [ ] **Step 8: Add owner approval and removal handlers**

In `App.tsx`, add handlers:

```ts
const handleApproveJoinRequest = useCallback((requestId: string) => {
  if (!session) return;
  void run(async () => { await approveJoinRequest(session, requestId); });
}, [session]);

const handleRejectJoinRequest = useCallback((requestId: string) => {
  if (!session) return;
  void run(async () => { await rejectJoinRequest(session, requestId); });
}, [session]);

const handleRemoveParticipant = useCallback((participantId: string) => {
  if (!session) return;
  void run(async () => { await removeParticipant(session, participantId); });
}, [session]);
```

Pass them through `Workspace` and `MobileDrawer` into `Sidebar`.

- [ ] **Step 9: Render approval panel and remove buttons**

In `Sidebar.tsx`, add props:

```ts
joinRequests: JoinRequestView[];
onApproveJoinRequest: (requestId: string) => void;
onRejectJoinRequest: (requestId: string) => void;
onRemoveParticipant: (participantId: string) => void;
```

For owners, render a card above People:

```tsx
{isOwner && joinRequests.length > 0 && (
  <div className="card">
    <span className="section-label">{t("sidebar.pendingRequests")}</span>
    {joinRequests.map((request) => (
      <div key={request.request_id} className="people-row">
        <span>{request.display_name} · {roleDisplay(request.role, t)}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-warm" onClick={() => onApproveJoinRequest(request.request_id)}>{t("sidebar.approve")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => onRejectJoinRequest(request.request_id)}>{t("sidebar.reject")}</button>
        </span>
      </div>
    ))}
  </div>
)}
```

In People rows, show a remove button only when `isOwner`, target is not current user, and target role is not `owner`.

- [ ] **Step 10: Update connector UI**

Replace connector command display with:

```tsx
<a className="btn btn-warm" href={createdPairing.download_url} download>
  {t("sidebar.downloadConnector")}
</a>
<code>{createdPairing.connection_code}</code>
<button type="button" className="btn btn-warm" onClick={handleCopyConnector}>
  {t("sidebar.copyConnectionCode")}
</button>
```

`handleCopyConnector` must copy `createdPairing.connection_code`.

- [ ] **Step 11: Add i18n keys**

Add English keys:

```json
"landing.waitingTitle": "Waiting for owner approval",
"landing.waitingBody": "Keep this page open. You will enter the room automatically after the owner approves.",
"sidebar.pendingRequests": "Pending join requests",
"sidebar.approve": "Approve",
"sidebar.reject": "Reject",
"sidebar.remove": "Remove",
"sidebar.downloadConnector": "Download Local Connector",
"sidebar.copyConnectionCode": "Copy connection code",
"sidebar.connectorHelp": "Download once, open it, paste this connection code, and keep the window open. Expires: {{expiresAt}}."
```

Add Chinese keys with equivalent concise wording:

```json
"landing.waitingTitle": "等待房主批准",
"landing.waitingBody": "请保持此页面打开。房主批准后会自动进入房间。",
"sidebar.pendingRequests": "待批准加入请求",
"sidebar.approve": "同意",
"sidebar.reject": "拒绝",
"sidebar.remove": "移除",
"sidebar.downloadConnector": "下载本地连接器",
"sidebar.copyConnectionCode": "复制连接码",
"sidebar.connectorHelp": "只需下载一次，打开后粘贴此连接码并保持窗口运行。过期时间：{{expiresAt}}。"
```

- [ ] **Step 12: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run packages/web/test/api.test.ts packages/web/test/room-state.test.ts packages/web/test/invite-approval.test.tsx packages/web/test/cloud-connector.test.tsx packages/web/test/app-copy.test.ts
git add packages/web/src/api.ts packages/web/src/room-state.ts packages/web/src/App.tsx packages/web/src/components/Landing.tsx packages/web/src/components/Sidebar.tsx packages/web/src/components/Workspace.tsx packages/web/src/components/MobileDrawer.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/api.test.ts packages/web/test/room-state.test.ts packages/web/test/invite-approval.test.tsx packages/web/test/cloud-connector.test.tsx
git commit -m "feat(web): add invite approval and connector code UI"
```

Expected: tests PASS and commit succeeds.

---

### Task 7: CLI Adapter Connection-Code and Prompt Mode

**Files:**
- Modify: `packages/cli-adapter/src/config.ts`
- Modify: `packages/cli-adapter/src/index.ts`
- Test: `packages/cli-adapter/test/config.test.ts`

- [ ] **Step 1: Add failing CLI config tests**

Append to `packages/cli-adapter/test/config.test.ts`:

```ts
import { buildConnectionCode } from "@cacp/protocol";
import { loadRuntimeConfigFromArgs, parseAdapterArgs } from "../src/config.js";

it("parses --connect connection codes", () => {
  const code = buildConnectionCode({
    server_url: "https://cacp.example.com",
    pairing_token: "cacp_pair",
    expires_at: "2026-04-27T08:15:00.000Z"
  });
  expect(parseAdapterArgs(["--connect", code])).toEqual({ mode: "connect", connection_code: code });
});

it("uses prompt mode when double-clicked without args", () => {
  expect(parseAdapterArgs([])).toEqual({ mode: "prompt" });
});

it("claims a pairing from a connection code", async () => {
  const code = buildConnectionCode({
    server_url: "https://cacp.example.com",
    pairing_token: "cacp_pair",
    expires_at: "2026-04-27T08:15:00.000Z"
  });
  const fetchImpl = vi.fn(async (url: string) => {
    expect(url).toBe("https://cacp.example.com/agent-pairings/cacp_pair/claim?server_url=https%3A%2F%2Fcacp.example.com");
    return new Response(JSON.stringify({
      room_id: "room_alpha",
      agent_id: "agent_alpha",
      agent_token: "cacp_agent",
      agent: { name: "Codex", command: "echo", args: [], working_dir: ".", capabilities: ["shell.oneshot"] }
    }), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const config = await loadRuntimeConfigFromArgs(["--connect", code], fetchImpl);
  expect(config.registered_agent?.agent_token).toBe("cacp_agent");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter exec vitest run packages/cli-adapter/test/config.test.ts
```

Expected: FAIL because `--connect` and prompt mode do not exist.

- [ ] **Step 3: Implement parser and claim helper**

In `packages/cli-adapter/src/config.ts`, import:

```ts
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { parseConnectionCode } from "@cacp/protocol";
```

Change `AdapterArgs` to:

```ts
export type AdapterArgs =
  | { mode: "file"; config_path: string }
  | { mode: "pair"; server_url: string; pairing_token: string }
  | { mode: "connect"; connection_code: string }
  | { mode: "prompt" };
```

Update `parseAdapterArgs`:

```ts
export function parseAdapterArgs(args: string[]): AdapterArgs {
  const connectIndex = args.indexOf("--connect");
  if (connectIndex >= 0) {
    const connectionCode = args[connectIndex + 1];
    if (!connectionCode) throw new Error("connect mode requires --connect <connection_code>");
    return { mode: "connect", connection_code: connectionCode };
  }
  const pairIndex = args.indexOf("--pair");
  if (pairIndex >= 0) {
    const serverIndex = args.indexOf("--server");
    const pairingToken = args[pairIndex + 1];
    const serverUrl = serverIndex >= 0 ? args[serverIndex + 1] : undefined;
    if (!pairingToken || !serverUrl) throw new Error("pair mode requires --server <url> --pair <token>");
    return { mode: "pair", server_url: serverUrl, pairing_token: pairingToken };
  }
  if (args.length === 0) return { mode: "prompt" };
  return { mode: "file", config_path: args[0] ?? "docs/examples/generic-cli-agent.json" };
}
```

Add:

```ts
async function promptForConnectionCode(): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  try {
    return (await rl.question("Paste CACP connection code: ")).trim();
  } finally {
    rl.close();
  }
}

async function claimPairing(serverUrl: string, pairingToken: string, fetchImpl: typeof fetch): Promise<AdapterConfig> {
  const claimUrl = `${serverUrl}/agent-pairings/${encodeURIComponent(pairingToken)}/claim?server_url=${encodeURIComponent(serverUrl)}`;
  const response = await fetchImpl(claimUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
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

In `loadRuntimeConfigFromArgs`, handle:

```ts
if (parsed.mode === "prompt") {
  const payload = parseConnectionCode(await promptForConnectionCode());
  return claimPairing(payload.server_url, payload.pairing_token, fetchImpl);
}
if (parsed.mode === "connect") {
  const payload = parseConnectionCode(parsed.connection_code);
  return claimPairing(payload.server_url, payload.pairing_token, fetchImpl);
}
if (parsed.mode === "pair") return claimPairing(parsed.server_url, parsed.pairing_token, fetchImpl);
```

- [ ] **Step 4: Update help text and forced close behavior**

In `packages/cli-adapter/src/index.ts`, change help text to:

```ts
console.log("Usage: cacp-cli-adapter [config.json]\n       cacp-cli-adapter --connect <connection_code>\n       cacp-cli-adapter --server <url> --pair <pairing_token>\n\nDouble-click without arguments to paste a CACP connection code.");
```

Change close handler:

```ts
ws.on("close", (code, reason) => {
  const reasonText = reason.toString();
  console.log(`Adapter stream closed${reasonText ? `: ${reasonText}` : ""}`);
  if (code === 4001 || reasonText === "participant_removed") {
    console.log("This local Agent session was removed by the room owner.");
  }
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 25).unref();
});
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter exec vitest run packages/cli-adapter/test/config.test.ts
corepack pnpm --filter @cacp/cli-adapter build
git add packages/cli-adapter/src/config.ts packages/cli-adapter/src/index.ts packages/cli-adapter/test/config.test.ts
git commit -m "feat(cli-adapter): support local connector codes"
```

Expected: tests PASS and commit succeeds.

---

### Task 8: Windows Local Connector Build Artifact

**Files:**
- Modify: `package.json`
- Modify: `packages/cli-adapter/package.json`
- Create: `scripts/build-local-connector.mjs`
- Create: `packages/web/public/downloads/.gitkeep`
- Test: manual build on Windows

- [ ] **Step 1: Add package dependencies and scripts**

At the workspace root `package.json`, add dev dependencies:

```json
"esbuild": "^0.24.2",
"postject": "^1.0.0-alpha.6"
```

Add root script:

```json
"build:connector:win": "corepack pnpm --filter @cacp/protocol build && node scripts/build-local-connector.mjs"
```

In `packages/cli-adapter/package.json`, keep existing `bin` and add:

```json
"bundle:connector": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/connector/index.cjs"
```

- [ ] **Step 2: Add SEA build script**

Create `scripts/build-local-connector.mjs`:

```js
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(root, "packages/cli-adapter/dist/connector/index.cjs");
const blob = resolve(root, "packages/cli-adapter/dist/connector/CACP-Local-Connector.blob");
const seaConfig = resolve(root, "packages/cli-adapter/dist/connector/sea-config.json");
const exe = resolve(root, "packages/web/public/downloads/CACP-Local-Connector.exe");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
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

run(process.execPath, ["--experimental-sea-config", seaConfig]);
await copyFile(process.execPath, exe);
run("npx", [
  "postject",
  exe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
]);

console.log(`Built ${exe}`);
```

- [ ] **Step 3: Keep downloads directory tracked without committing exe**

Create `packages/web/public/downloads/.gitkeep`.

Add these `.gitignore` entries:

```gitignore
packages/web/public/downloads/CACP-Local-Connector.exe
packages/cli-adapter/dist/connector/
```

- [ ] **Step 4: Build and smoke test**

Run on Windows:

```powershell
corepack pnpm install
corepack pnpm build:connector:win
Test-Path packages\web\public\downloads\CACP-Local-Connector.exe
.\packages\web\public\downloads\CACP-Local-Connector.exe --help
```

Expected: the exe exists and prints usage including `--connect <connection_code>`.

- [ ] **Step 5: Commit scripts, not generated exe**

Run:

```powershell
git add package.json pnpm-lock.yaml packages/cli-adapter/package.json scripts/build-local-connector.mjs packages/web/public/downloads/.gitkeep .gitignore
git status --short
git commit -m "build: add Windows local connector artifact"
```

Expected: commit excludes `packages/web/public/downloads/CACP-Local-Connector.exe`.

---

### Task 9: End-to-End Validation and Deployment Notes

**Files:**
- Modify: `docs/deploy-cloud.md`
- Modify only defect-related files if validation finds a concrete bug.

- [ ] **Step 1: Update deployment runbook**

In `docs/deploy-cloud.md`, add a section named `Local Connector Artifact`:

```md
## Local Connector Artifact

Before deploying the web build, generate the Windows connector:

```powershell
corepack pnpm build:connector:win
```

Copy `packages/web/public/downloads/CACP-Local-Connector.exe` with the web `dist` assets so `/downloads/CACP-Local-Connector.exe` is available from the domain.

The room owner downloads the executable once. For each room, the Web UI generates a fresh connection code. The owner opens the executable, pastes the code, and keeps the console open until leaving the room.
```

- [ ] **Step 2: Run full local validation**

Run:

```powershell
git diff --check
corepack pnpm check
corepack pnpm build:connector:win
```

Expected: whitespace check PASS, full workspace check PASS, connector exe build PASS.

- [ ] **Step 3: Browser smoke test locally**

Run server and web:

```powershell
corepack pnpm dev:server
corepack pnpm dev:web
```

In two browser profiles:

1. Owner creates a room.
2. Owner clicks Copy invite twice and confirms the URLs differ.
3. Invitee opens the second link, enters a name, and lands in the waiting room.
4. Owner sees the pending join request, approves it, and invitee enters the room.
5. Reopen the first invite link and confirm it creates a request only once; reuse fails after consumption.
6. Owner removes the invitee; invitee is forced out and cannot send another message.
7. Owner downloads the connector, copies the connection code, runs the exe, pastes the code, and sees Agent online.
8. Owner removes the Agent; connector exits.

- [ ] **Step 4: Remote smoke test on Debian deployment**

After deployment, run:

```powershell
curl.exe -fsS https://<your-domain>/health
```

Expected:

```json
{"ok":true,"protocol":"cacp","version":"0.2.0"}
```

Repeat the browser smoke test against `https://<your-domain>`.

- [ ] **Step 5: Commit docs and validation fixes**

Run:

```powershell
git add docs/deploy-cloud.md
git commit -m "docs: document connector and invite security deployment"
```

If validation required code changes, include those exact files in the same commit and use:

```powershell
git commit -m "fix: complete connector invite security validation"
```

---

## Self-Review Notes

Spec coverage:

- One-time Windows connector download: Tasks 7, 8, 9.
- Per-room temporary connection code: Tasks 1, 5, 6, 7.
- No long-term local credentials: Task 7 keeps `agent_token` in process memory only.
- Unique one-use invite links: Tasks 3 and 6; Copy invite always creates a fresh token.
- Waiting room and owner approval: Tasks 3 and 6.
- Owner rejection and expired request handling: Task 3.
- Owner removal and forced exit: Tasks 2, 4, and 6.
- Server-side revocation enforcement: Tasks 2 and 4.
- Security controls around token hashing and sealed approved tokens: Tasks 2 and 3.

Execution rule: implement tasks in order. Do not begin the next task until the current task tests pass and its commit is complete.
