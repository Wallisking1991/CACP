# CACP MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first CACP MVP where multiple people join one room, discuss with shared context, create questions/decisions/proposals, and drive a generic local CLI agent through a shared event stream.

**Architecture:** Use a TypeScript monorepo with a reusable protocol package, a Fastify protocol server backed by SQLite, a generic Node CLI adapter, and a minimal React Web Room reference client. The protocol server owns rooms, participants, tokens, event persistence, WebSocket broadcast, policy evaluation, and task lifecycle events.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, Zod, Fastify, @fastify/websocket, better-sqlite3, ws, React, Vite.

---

## Scope Check

The approved spec contains four integrated components: protocol, server, web room, and CLI adapter. They are implemented in one MVP plan because the first useful validation is an integrated vertical slice: shared room → collaborative discussion → decision/proposal → CLI agent task → streamed output.

## File Structure Map

Create this repository structure:

```text
.
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  docs/
    protocol/cacp-v0.1.md
    examples/generic-cli-agent.json
  packages/
    protocol/
      package.json
      tsconfig.json
      src/index.ts
      src/schemas.ts
      src/policy-engine.ts
      test/protocol.test.ts
    server/
      package.json
      tsconfig.json
      src/index.ts
      src/server.ts
      src/event-store.ts
      src/event-bus.ts
      src/auth.ts
      src/ids.ts
      test/server.test.ts
    cli-adapter/
      package.json
      tsconfig.json
      src/index.ts
      src/config.ts
      src/runner.ts
      test/runner.test.ts
    web/
      package.json
      tsconfig.json
      index.html
      vite.config.ts
      src/main.tsx
      src/App.tsx
      src/api.ts
      src/event-log.ts
      src/App.css
      test/event-log.test.ts
```

---

### Task 0: Initialize Git and workspace tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git if needed**

```powershell
if (-not (Test-Path .git)) { git init }
```

Expected: a `.git` directory exists.

- [ ] **Step 2: Create root workspace files**

Create `package.json`:

```json
{
  "name": "cacp",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev:server": "pnpm --filter @cacp/server dev",
    "dev:web": "pnpm --filter @cacp/web dev",
    "dev:adapter": "pnpm --filter @cacp/cli-adapter dev docs/examples/generic-cli-agent.json",
    "check": "pnpm test && pnpm build"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
.vite/
*.db
*.db-shm
*.db-wal
.env
.DS_Store
```

- [ ] **Step 3: Install tooling**

```powershell
corepack enable
pnpm install
```

Expected: install exits with code 0 and creates `pnpm-lock.yaml`.

- [ ] **Step 4: Commit workspace setup**

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: initialize cacp workspace"
```

Expected: commit succeeds.

---

### Task 1: Protocol schemas and policy engine

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/schemas.ts`
- Create: `packages/protocol/src/policy-engine.ts`
- Create: `packages/protocol/test/protocol.test.ts`

- [ ] **Step 1: Create protocol package and failing tests**

Create `packages/protocol/package.json`:

```json
{
  "name": "@cacp/protocol",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.24.1" },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/protocol/test/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CacpEventSchema, evaluatePolicy, type Participant, type Policy, type VoteRecord } from "../src/index.js";

const participants: Participant[] = [
  { id: "u_owner", type: "human", display_name: "Owner", role: "owner" },
  { id: "u_admin", type: "human", display_name: "Admin", role: "admin" },
  { id: "u_member", type: "human", display_name: "Member", role: "member" },
  { id: "u_observer", type: "observer", display_name: "Observer", role: "observer" }
];

describe("CACP event schema", () => {
  it("accepts a valid event and rejects unknown event types", () => {
    expect(CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.1.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "message.created",
      actor_id: "u_owner",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: { text: "hello" }
    }).type).toBe("message.created");

    expect(() => CacpEventSchema.parse({
      protocol: "cacp",
      version: "0.1.0",
      event_id: "evt_1",
      room_id: "room_1",
      type: "unknown.event",
      actor_id: "u_owner",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: {}
    })).toThrow();
  });
});

describe("policy engine", () => {
  it("approves owner approval, majority, role quorum, and no approval policies", () => {
    expect(evaluatePolicy({ type: "owner_approval" }, participants, [{ voter_id: "u_owner", vote: "approve" }]).status).toBe("approved");
    expect(evaluatePolicy({ type: "majority" }, participants, [
      { voter_id: "u_owner", vote: "approve" },
      { voter_id: "u_admin", vote: "approve" }
    ]).status).toBe("approved");
    expect(evaluatePolicy({ type: "role_quorum", required_roles: ["owner", "admin"], min_approvals: 1 }, participants, [
      { voter_id: "u_admin", vote: "approve" }
    ]).status).toBe("approved");
    expect(evaluatePolicy({ type: "no_approval" }, participants, []).status).toBe("approved");
  });

  it("rejects unanimous on rejection and expires old policies", () => {
    const votes: VoteRecord[] = [
      { voter_id: "u_owner", vote: "approve" },
      { voter_id: "u_admin", vote: "reject" }
    ];
    const expired: Policy = { type: "majority", expires_at: "2026-04-25T00:00:00.000Z" };

    expect(evaluatePolicy({ type: "unanimous" }, participants, votes).status).toBe("rejected");
    expect(evaluatePolicy(expired, participants, [], new Date("2026-04-25T00:01:00.000Z")).status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm install
pnpm --filter @cacp/protocol test
```

Expected: FAIL because `packages/protocol/src/index.ts` does not exist.

- [ ] **Step 3: Implement protocol schemas**

Create `packages/protocol/src/schemas.ts`:

```ts
import { z } from "zod";

export const ParticipantTypeSchema = z.enum(["human", "agent", "system", "observer"]);
export const ParticipantRoleSchema = z.enum(["owner", "admin", "member", "observer", "agent"]);
export const ParticipantSchema = z.object({
  id: z.string().min(1),
  type: ParticipantTypeSchema,
  display_name: z.string().min(1),
  role: ParticipantRoleSchema
});

export const EventTypeSchema = z.enum([
  "room.created", "participant.joined", "participant.left", "participant.role_updated", "invite.created",
  "message.created",
  "question.created", "question.response_submitted", "question.closed",
  "decision.created", "decision.finalized",
  "proposal.created", "proposal.vote_cast", "proposal.approved", "proposal.rejected", "proposal.expired",
  "agent.registered", "agent.unregistered", "agent.disconnected",
  "task.created", "task.started", "task.output", "task.completed", "task.failed", "task.cancelled",
  "artifact.created", "context.updated"
]);

export const CacpEventSchema = z.object({
  protocol: z.literal("cacp"),
  version: z.literal("0.1.0"),
  event_id: z.string().min(1),
  room_id: z.string().min(1),
  type: EventTypeSchema,
  actor_id: z.string().min(1),
  created_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown())
});

export const VoteValueSchema = z.enum(["approve", "reject", "abstain", "request_changes"]);
export const VoteRecordSchema = z.object({
  voter_id: z.string().min(1),
  vote: VoteValueSchema,
  comment: z.string().optional()
});

export const PolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("owner_approval"), expires_at: z.string().datetime().optional() }),
  z.object({ type: z.literal("majority"), expires_at: z.string().datetime().optional() }),
  z.object({
    type: z.literal("role_quorum"),
    required_roles: z.array(ParticipantRoleSchema).min(1),
    min_approvals: z.number().int().positive(),
    expires_at: z.string().datetime().optional()
  }),
  z.object({ type: z.literal("unanimous"), expires_at: z.string().datetime().optional() }),
  z.object({ type: z.literal("no_approval"), expires_at: z.string().datetime().optional() })
]);

export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type CacpEvent = z.infer<typeof CacpEventSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteRecord = z.infer<typeof VoteRecordSchema>;
export type Policy = z.infer<typeof PolicySchema>;
```

- [ ] **Step 4: Implement policy engine**

Create `packages/protocol/src/policy-engine.ts`:

```ts
import type { Participant, ParticipantRole, Policy, VoteRecord } from "./schemas.js";

export type PolicyStatus = "pending" | "approved" | "rejected" | "expired";
export interface PolicyEvaluation {
  status: PolicyStatus;
  reason: string;
  approvals: number;
  rejections: number;
  eligible_voters: number;
}

function canVote(participant: Participant): boolean {
  return participant.role !== "observer" && participant.role !== "agent";
}

function latestVote(votes: VoteRecord[], participantId: string): VoteRecord | undefined {
  return [...votes].reverse().find((vote) => vote.voter_id === participantId);
}

function count(participants: Participant[], votes: VoteRecord[], roles?: ParticipantRole[]) {
  const eligible = participants.filter((participant) => canVote(participant) && (!roles || roles.includes(participant.role)));
  const latest = eligible.map((participant) => latestVote(votes, participant.id)).filter((vote): vote is VoteRecord => Boolean(vote));
  return {
    eligible,
    approvals: latest.filter((vote) => vote.vote === "approve").length,
    rejections: latest.filter((vote) => vote.vote === "reject").length
  };
}

export function evaluatePolicy(policy: Policy, participants: Participant[], votes: VoteRecord[], now = new Date()): PolicyEvaluation {
  if (policy.expires_at && new Date(policy.expires_at).getTime() <= now.getTime()) {
    return { status: "expired", reason: "policy expired", approvals: 0, rejections: 0, eligible_voters: participants.filter(canVote).length };
  }
  if (policy.type === "no_approval") {
    return { status: "approved", reason: "policy does not require approval", approvals: 0, rejections: 0, eligible_voters: participants.filter(canVote).length };
  }
  if (policy.type === "owner_approval") {
    const owners = participants.filter((participant) => participant.role === "owner");
    const result = count(owners, votes);
    if (result.approvals >= 1) return { status: "approved", reason: "owner approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
    if (result.rejections >= 1) return { status: "rejected", reason: "owner rejected", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
    return { status: "pending", reason: "waiting for owner approval", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
  }
  if (policy.type === "majority") {
    const result = count(participants, votes);
    const required = Math.floor(result.eligible.length / 2) + 1;
    if (result.approvals >= required) return { status: "approved", reason: "majority approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    if (result.rejections >= required) return { status: "rejected", reason: "majority rejected", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    return { status: "pending", reason: `waiting for ${required} approvals`, approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  }
  if (policy.type === "role_quorum") {
    const result = count(participants, votes, policy.required_roles);
    if (result.approvals >= policy.min_approvals) return { status: "approved", reason: "role quorum reached", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    return { status: "pending", reason: `waiting for ${policy.min_approvals} role approvals`, approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  }
  const result = count(participants, votes);
  if (result.rejections > 0) return { status: "rejected", reason: "unanimous policy received a rejection", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  if (result.eligible.length > 0 && result.approvals === result.eligible.length) return { status: "approved", reason: "all eligible voters approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  return { status: "pending", reason: "waiting for unanimous approval", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
}
```

Create `packages/protocol/src/index.ts`:

```ts
export * from "./schemas.js";
export * from "./policy-engine.js";
```

- [ ] **Step 5: Run protocol tests and build**

```powershell
pnpm --filter @cacp/protocol test
pnpm --filter @cacp/protocol build
```

Expected: tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit protocol package**

```powershell
git add packages/protocol package.json pnpm-lock.yaml
git commit -m "feat: add cacp protocol schemas and policy engine"
```

Expected: commit succeeds.

---

### Task 2: Server room, identity, persistence, collaboration, and task API

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/ids.ts`
- Create: `packages/server/src/event-store.ts`
- Create: `packages/server/src/event-bus.ts`
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/test/server.test.ts`

- [ ] **Step 1: Create server package and failing integration tests**

Create `packages/server/package.json`:

```json
{
  "name": "@cacp/server",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/server.ts" },
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@cacp/protocol": "workspace:*",
    "@fastify/websocket": "^11.0.1",
    "better-sqlite3": "^11.8.1",
    "fastify": "^5.2.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/server/test/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "MVP Room", display_name: "Alice" }
  });
  return { app, created: response.json() as { room_id: string; owner_id: string; owner_token: string } };
}

describe("CACP server", () => {
  it("runs the full room, collaboration, proposal, agent, and task event flow", async () => {
    const { app, created } = await createRoom();
    const ownerAuth = { authorization: `Bearer ${created.owner_token}` };

    const inviteResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/invites`,
      headers: ownerAuth,
      payload: { role: "member", display_name: "Bob" }
    });
    expect(inviteResponse.statusCode).toBe(201);

    const joinResponse = await app.inject({
      method: "POST",
      url: `/rooms/${created.room_id}/join`,
      payload: { invite_token: inviteResponse.json().invite_token }
    });
    expect(joinResponse.statusCode).toBe(201);
    const bob = joinResponse.json();

    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/messages`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { text: "Protocol first." } })).statusCode).toBe(201);
    const question = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/questions`, headers: ownerAuth, payload: { question: "Which MVP path?", expected_response: "single_choice", options: ["API", "Web"] } })).json();
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/questions/${question.question_id}/responses`, headers: { authorization: `Bearer ${bob.participant_token}` }, payload: { response: "API", comment: "Standard first." } })).statusCode).toBe(201);

    const proposal = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals`, headers: ownerAuth, payload: { title: "Adopt protocol-first MVP", proposal_type: "decision", policy: { type: "owner_approval" } } })).json();
    const voteResponse = await app.inject({ method: "POST", url: `/rooms/${created.room_id}/proposals/${proposal.proposal_id}/votes`, headers: ownerAuth, payload: { vote: "approve", comment: "Approved." } });
    expect(voteResponse.json().evaluation.status).toBe("approved");

    const agent = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Local Echo Agent", capabilities: ["shell.oneshot"] } })).json();
    const task = (await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks`, headers: ownerAuth, payload: { target_agent_id: agent.agent_id, prompt: "Say hello", mode: "oneshot" } })).json();
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/start`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/output`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: { stream: "stdout", chunk: "hello\n" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/rooms/${created.room_id}/tasks/${task.task_id}/complete`, headers: { authorization: `Bearer ${agent.agent_token}` }, payload: { exit_code: 0 } })).statusCode).toBe(201);

    const eventsResponse = await app.inject({ method: "GET", url: `/rooms/${created.room_id}/events`, headers: ownerAuth });
    const eventTypes = eventsResponse.json().events.map((event: { type: string }) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "room.created", "participant.joined", "invite.created", "message.created",
      "question.created", "question.response_submitted", "proposal.created", "proposal.vote_cast", "proposal.approved",
      "agent.registered", "task.created", "task.started", "task.output", "task.completed"
    ]));

    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm install
pnpm --filter @cacp/server test
```

Expected: FAIL because `packages/server/src/server.ts` does not exist.

- [ ] **Step 3: Implement server support files**

Create `packages/server/src/ids.ts`:

```ts
import { randomBytes, randomUUID } from "node:crypto";
import type { CacpEvent, EventType } from "@cacp/protocol";

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function token(): string {
  return `cacp_${randomBytes(24).toString("base64url")}`;
}

export function event(roomId: string, type: EventType, actorId: string, payload: Record<string, unknown>): CacpEvent {
  return { protocol: "cacp", version: "0.1.0", event_id: prefixedId("evt"), room_id: roomId, type, actor_id: actorId, created_at: new Date().toISOString(), payload };
}
```

Create `packages/server/src/event-bus.ts`:

```ts
import type { CacpEvent } from "@cacp/protocol";

type Listener = (event: CacpEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  subscribe(roomId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(roomId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(roomId);
    };
  }
  publish(event: CacpEvent): void {
    for (const listener of this.listeners.get(event.room_id) ?? []) listener(event);
  }
}
```

Create `packages/server/src/event-store.ts`:

```ts
import Database from "better-sqlite3";
import { CacpEventSchema, type CacpEvent, type Participant, type ParticipantRole, type ParticipantType } from "@cacp/protocol";

export interface StoredParticipant extends Participant {
  room_id: string;
  token: string;
}

export class EventStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_room_created ON events(room_id, created_at);
      CREATE TABLE IF NOT EXISTS participants (
        room_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        type TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY(room_id, participant_id)
      );
    `);
  }
  close(): void {
    this.db.close();
  }
  appendEvent(input: CacpEvent): CacpEvent {
    const event = CacpEventSchema.parse(input);
    this.db.prepare(`INSERT INTO events (event_id, room_id, type, actor_id, created_at, event_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(event.event_id, event.room_id, event.type, event.actor_id, event.created_at, JSON.stringify(event));
    return event;
  }
  listEvents(roomId: string): CacpEvent[] {
    return (this.db.prepare(`SELECT event_json FROM events WHERE room_id = ? ORDER BY created_at ASC, event_id ASC`).all(roomId) as Array<{ event_json: string }>)
      .map((row) => CacpEventSchema.parse(JSON.parse(row.event_json)));
  }
  addParticipant(participant: StoredParticipant): StoredParticipant {
    this.db.prepare(`INSERT INTO participants (room_id, participant_id, token, display_name, type, role) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(participant.room_id, participant.id, participant.token, participant.display_name, participant.type, participant.role);
    return participant;
  }
  getParticipantByToken(roomId: string, participantToken: string): StoredParticipant | undefined {
    const row = this.db.prepare(`SELECT * FROM participants WHERE room_id = ? AND token = ?`).get(roomId, participantToken) as { room_id: string; participant_id: string; token: string; display_name: string; type: ParticipantType; role: ParticipantRole } | undefined;
    return row ? { room_id: row.room_id, id: row.participant_id, token: row.token, display_name: row.display_name, type: row.type, role: row.role } : undefined;
  }
  getParticipants(roomId: string): StoredParticipant[] {
    return (this.db.prepare(`SELECT * FROM participants WHERE room_id = ? ORDER BY participant_id ASC`).all(roomId) as Array<{ room_id: string; participant_id: string; token: string; display_name: string; type: ParticipantType; role: ParticipantRole }>)
      .map((row) => ({ room_id: row.room_id, id: row.participant_id, token: row.token, display_name: row.display_name, type: row.type, role: row.role }));
  }
}
```

Create `packages/server/src/auth.ts`:

```ts
import type { FastifyRequest } from "fastify";
import type { ParticipantRole } from "@cacp/protocol";
import type { EventStore, StoredParticipant } from "./event-store.js";

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

export function requireParticipant(store: EventStore, roomId: string, request: FastifyRequest): StoredParticipant | undefined {
  const value = bearerToken(request);
  return value ? store.getParticipantByToken(roomId, value) : undefined;
}

export function hasAnyRole(participant: StoredParticipant, roles: ParticipantRole[]): boolean {
  return roles.includes(participant.role);
}
```

- [ ] **Step 4: Implement Fastify server**

Create `packages/server/src/server.ts`:

```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { evaluatePolicy, PolicySchema, VoteRecordSchema, type CacpEvent, type Policy, type VoteRecord } from "@cacp/protocol";
import { requireParticipant, hasAnyRole } from "./auth.js";
import { EventBus } from "./event-bus.js";
import { EventStore } from "./event-store.js";
import { event, prefixedId, token } from "./ids.js";

const CreateRoomSchema = z.object({ name: z.string().min(1), display_name: z.string().min(1).default("Owner") });
const CreateInviteSchema = z.object({ role: z.enum(["admin", "member", "observer"]).default("member"), display_name: z.string().min(1) });
const JoinSchema = z.object({ invite_token: z.string().min(1) });
const MessageSchema = z.object({ text: z.string().min(1) });
const QuestionSchema = z.object({ question: z.string().min(1), expected_response: z.enum(["free_text", "single_choice", "multiple_choice"]).default("free_text"), options: z.array(z.string()).default([]) });
const QuestionResponseSchema = z.object({ response: z.unknown(), comment: z.string().optional() });
const ProposalSchema = z.object({ title: z.string().min(1), proposal_type: z.string().min(1), policy: PolicySchema });
const AgentRegisterSchema = z.object({ name: z.string().min(1), capabilities: z.array(z.string()).default([]) });
const TaskCreateSchema = z.object({ target_agent_id: z.string().min(1), prompt: z.string().min(1), mode: z.literal("oneshot").default("oneshot"), requires_approval: z.boolean().default(false) });
const TaskOutputSchema = z.object({ stream: z.enum(["stdout", "stderr"]), chunk: z.string() });
const TaskCompleteSchema = z.object({ exit_code: z.number().int() });
const TaskFailedSchema = z.object({ error: z.string().min(1), exit_code: z.number().int().optional() });

export interface BuildServerOptions { dbPath?: string }

const invites = new Map<string, { room_id: string; role: "admin" | "member" | "observer"; display_name: string }>();
const proposalVotes = new Map<string, VoteRecord[]>();
const proposalPolicies = new Map<string, Policy>();

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: false });
  const store = new EventStore(options.dbPath ?? "cacp.db");
  const bus = new EventBus();
  await app.register(websocket);
  app.addHook("onClose", async () => store.close());

  function appendAndPublish(input: CacpEvent): CacpEvent {
    const stored = store.appendEvent(input);
    bus.publish(stored);
    return stored;
  }
  function deny(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: string, status = 401) {
    return reply.code(status).send({ error });
  }

  app.get("/health", async () => ({ ok: true, protocol: "cacp", version: "0.1.0" }));

  app.post("/rooms", async (request, reply) => {
    const body = CreateRoomSchema.parse(request.body);
    const roomId = prefixedId("room");
    const ownerId = prefixedId("user");
    const ownerToken = token();
    store.addParticipant({ room_id: roomId, id: ownerId, token: ownerToken, display_name: body.display_name, type: "human", role: "owner" });
    appendAndPublish(event(roomId, "room.created", ownerId, { name: body.name, created_by: ownerId }));
    appendAndPublish(event(roomId, "participant.joined", ownerId, { participant: { id: ownerId, type: "human", display_name: body.display_name, role: "owner" } }));
    return reply.code(201).send({ room_id: roomId, owner_id: ownerId, owner_token: ownerToken });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/events", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    return { events: store.listEvents(request.params.roomId), participant };
  });

  app.get<{ Params: { roomId: string }; Querystring: { token?: string } }>("/rooms/:roomId/stream", { websocket: true }, (socket, request) => {
    const participant = request.query.token ? store.getParticipantByToken(request.params.roomId, request.query.token) : undefined;
    if (!participant) {
      socket.send(JSON.stringify({ error: "invalid_token" }));
      socket.close();
      return;
    }
    for (const existingEvent of store.listEvents(request.params.roomId)) socket.send(JSON.stringify(existingEvent));
    const unsubscribe = bus.subscribe(request.params.roomId, (nextEvent) => socket.send(JSON.stringify(nextEvent)));
    socket.on("close", unsubscribe);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/invites", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin"])) return deny(reply, "forbidden", 403);
    const body = CreateInviteSchema.parse(request.body);
    const inviteToken = token();
    invites.set(inviteToken, { room_id: request.params.roomId, role: body.role, display_name: body.display_name });
    appendAndPublish(event(request.params.roomId, "invite.created", participant.id, { role: body.role, display_name: body.display_name }));
    return reply.code(201).send({ invite_token: inviteToken, role: body.role, display_name: body.display_name });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/join", async (request, reply) => {
    const body = JoinSchema.parse(request.body);
    const invite = invites.get(body.invite_token);
    if (!invite || invite.room_id !== request.params.roomId) return deny(reply, "invalid_invite");
    const participantId = prefixedId("user");
    const participantToken = token();
    const participant = store.addParticipant({ room_id: request.params.roomId, id: participantId, token: participantToken, display_name: invite.display_name, type: invite.role === "observer" ? "observer" : "human", role: invite.role });
    appendAndPublish(event(request.params.roomId, "participant.joined", participant.id, { participant }));
    return reply.code(201).send({ participant_id: participantId, participant_token: participantToken, role: invite.role });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/messages", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role === "observer") return deny(reply, "forbidden", 403);
    return reply.code(201).send(appendAndPublish(event(request.params.roomId, "message.created", participant.id, MessageSchema.parse(request.body))));
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/questions", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role === "observer") return deny(reply, "forbidden", 403);
    const questionId = prefixedId("q");
    appendAndPublish(event(request.params.roomId, "question.created", participant.id, { question_id: questionId, ...QuestionSchema.parse(request.body) }));
    return reply.code(201).send({ question_id: questionId });
  });

  app.post<{ Params: { roomId: string; questionId: string } }>("/rooms/:roomId/questions/:questionId/responses", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role === "observer") return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "question.response_submitted", participant.id, { question_id: request.params.questionId, respondent_id: participant.id, ...QuestionResponseSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/proposals", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role === "observer") return deny(reply, "forbidden", 403);
    const body = ProposalSchema.parse(request.body);
    const proposalId = prefixedId("prop");
    proposalPolicies.set(proposalId, body.policy);
    proposalVotes.set(proposalId, []);
    appendAndPublish(event(request.params.roomId, "proposal.created", participant.id, { proposal_id: proposalId, ...body }));
    return reply.code(201).send({ proposal_id: proposalId });
  });

  app.post<{ Params: { roomId: string; proposalId: string } }>("/rooms/:roomId/proposals/:proposalId/votes", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role === "observer") return deny(reply, "forbidden", 403);
    const vote = VoteRecordSchema.parse({ ...request.body, voter_id: participant.id });
    const votes = [...(proposalVotes.get(request.params.proposalId) ?? []), vote];
    proposalVotes.set(request.params.proposalId, votes);
    appendAndPublish(event(request.params.roomId, "proposal.vote_cast", participant.id, { proposal_id: request.params.proposalId, ...vote }));
    const policy = proposalPolicies.get(request.params.proposalId);
    if (!policy) return deny(reply, "unknown_proposal", 404);
    const evaluation = evaluatePolicy(policy, store.getParticipants(request.params.roomId), votes);
    if (evaluation.status === "approved") appendAndPublish(event(request.params.roomId, "proposal.approved", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "rejected") appendAndPublish(event(request.params.roomId, "proposal.rejected", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    if (evaluation.status === "expired") appendAndPublish(event(request.params.roomId, "proposal.expired", participant.id, { proposal_id: request.params.proposalId, evaluation }));
    return reply.code(201).send({ evaluation });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agents/register", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = AgentRegisterSchema.parse(request.body);
    const agentId = prefixedId("agent");
    const agentToken = token();
    store.addParticipant({ room_id: request.params.roomId, id: agentId, token: agentToken, display_name: body.name, type: "agent", role: "agent" });
    appendAndPublish(event(request.params.roomId, "agent.registered", participant.id, { agent_id: agentId, name: body.name, capabilities: body.capabilities }));
    return reply.code(201).send({ agent_id: agentId, agent_token: agentToken });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/tasks", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (!hasAnyRole(participant, ["owner", "admin", "member"])) return deny(reply, "forbidden", 403);
    const body = TaskCreateSchema.parse(request.body);
    const taskId = prefixedId("task");
    appendAndPublish(event(request.params.roomId, "task.created", participant.id, { task_id: taskId, created_by: participant.id, ...body }));
    return reply.code(201).send({ task_id: taskId });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/start", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent") return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "task.started", participant.id, { task_id: request.params.taskId, agent_id: participant.id }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/output", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent") return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "task.output", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskOutputSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/complete", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent") return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "task.completed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskCompleteSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { roomId: string; taskId: string } }>("/rooms/:roomId/tasks/:taskId/fail", async (request, reply) => {
    const participant = requireParticipant(store, request.params.roomId, request);
    if (!participant) return deny(reply, "invalid_token");
    if (participant.role !== "agent") return deny(reply, "forbidden", 403);
    appendAndPublish(event(request.params.roomId, "task.failed", participant.id, { task_id: request.params.taskId, agent_id: participant.id, ...TaskFailedSchema.parse(request.body) }));
    return reply.code(201).send({ ok: true });
  });

  return app;
}
```

Create `packages/server/src/index.ts`:

```ts
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3737);
const host = process.env.HOST ?? "127.0.0.1";
const app = await buildServer({ dbPath: process.env.CACP_DB ?? "cacp.db" });
await app.listen({ port, host });
console.log(`CACP server listening on http://${host}:${port}`);
```

- [ ] **Step 5: Run server tests and build**

```powershell
pnpm --filter @cacp/server test
pnpm --filter @cacp/server build
```

Expected: tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit server layer**

```powershell
git add packages/server package.json pnpm-lock.yaml
git commit -m "feat: add cacp protocol server"
```

Expected: commit succeeds.

---

### Task 3: Generic CLI adapter

**Files:**
- Create: `packages/cli-adapter/package.json`
- Create: `packages/cli-adapter/tsconfig.json`
- Create: `packages/cli-adapter/src/config.ts`
- Create: `packages/cli-adapter/src/runner.ts`
- Create: `packages/cli-adapter/src/index.ts`
- Create: `packages/cli-adapter/test/runner.test.ts`

- [ ] **Step 1: Create CLI adapter package and failing runner test**

Create `packages/cli-adapter/package.json`:

```json
{
  "name": "@cacp/cli-adapter",
  "version": "0.1.0",
  "type": "module",
  "bin": { "cacp-cli-adapter": "./src/index.ts" },
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@cacp/protocol": "workspace:*",
    "ws": "^8.18.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/cli-adapter/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Create `packages/cli-adapter/test/runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runCommandForTask } from "../src/runner.js";

describe("CLI runner", () => {
  it("sends prompt to stdin and captures stdout", async () => {
    const outputs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data', d => process.stdout.write('echo:' + d.toString()))"],
      working_dir: process.cwd(),
      prompt: "hello",
      onOutput: (output) => outputs.push(output)
    });
    expect(result.exit_code).toBe(0);
    expect(outputs.map((output) => output.chunk).join("")).toContain("echo:hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm install
pnpm --filter @cacp/cli-adapter test
```

Expected: FAIL because `packages/cli-adapter/src/runner.ts` does not exist.

- [ ] **Step 3: Implement adapter config and runner**

Create `packages/cli-adapter/src/config.ts`:

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";

export const AdapterConfigSchema = z.object({
  server_url: z.string().url(),
  room_id: z.string().min(1),
  token: z.string().min(1),
  agent: z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    working_dir: z.string().default(process.cwd()),
    capabilities: z.array(z.string()).default(["shell.oneshot"])
  })
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

export function loadConfig(path: string): AdapterConfig {
  return AdapterConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
```

Create `packages/cli-adapter/src/runner.ts`:

```ts
import { spawn } from "node:child_process";

export interface RunCommandOptions {
  command: string;
  args: string[];
  working_dir: string;
  prompt: string;
  onOutput: (output: { stream: "stdout" | "stderr"; chunk: string }) => void | Promise<void>;
}

export interface RunCommandResult {
  exit_code: number;
}

export async function runCommandForTask(options: RunCommandOptions): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.working_dir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    child.stdout.on("data", (chunk: Buffer) => void options.onOutput({ stream: "stdout", chunk: chunk.toString("utf8") }));
    child.stderr.on("data", (chunk: Buffer) => void options.onOutput({ stream: "stderr", chunk: chunk.toString("utf8") }));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exit_code: code ?? 1 }));
    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
```

- [ ] **Step 4: Implement adapter entrypoint**

Create `packages/cli-adapter/src/index.ts`:

```ts
#!/usr/bin/env node
import WebSocket from "ws";
import { CacpEventSchema } from "@cacp/protocol";
import { loadConfig } from "./config.js";
import { runCommandForTask } from "./runner.js";

const configPath = process.argv[2] ?? "docs/examples/generic-cli-agent.json";
const config = loadConfig(configPath);

async function postJson<T>(path: string, participantToken: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.server_url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${participantToken}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as T;
}

const registered = await postJson<{ agent_id: string; agent_token: string }>(`/rooms/${config.room_id}/agents/register`, config.token, {
  name: config.agent.name,
  capabilities: config.agent.capabilities
});
console.log(`Registered ${config.agent.name} as ${registered.agent_id}`);

const streamUrl = new URL(`/rooms/${config.room_id}/stream`, config.server_url);
streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
streamUrl.searchParams.set("token", registered.agent_token);

const ws = new WebSocket(streamUrl);
const runningTasks = new Set<string>();

ws.on("message", (raw) => {
  void (async () => {
    const parsed = CacpEventSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success || parsed.data.type !== "task.created") return;
    const payload = parsed.data.payload as { task_id?: string; target_agent_id?: string; prompt?: string };
    if (!payload.task_id || !payload.prompt || payload.target_agent_id !== registered.agent_id || runningTasks.has(payload.task_id)) return;
    runningTasks.add(payload.task_id);
    try {
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/start`, registered.agent_token, {});
      const result = await runCommandForTask({
        command: config.agent.command,
        args: config.agent.args,
        working_dir: config.agent.working_dir,
        prompt: payload.prompt,
        onOutput: async (output) => {
          await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/output`, registered.agent_token, output);
        }
      });
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/complete`, registered.agent_token, result);
    } catch (error) {
      await postJson(`/rooms/${config.room_id}/tasks/${payload.task_id}/fail`, registered.agent_token, {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      runningTasks.delete(payload.task_id);
    }
  })();
});

ws.on("open", () => console.log(`Connected adapter stream for room ${config.room_id}`));
ws.on("close", () => console.log("Adapter stream closed"));
ws.on("error", (error) => console.error(error));
```

- [ ] **Step 5: Run adapter tests and build**

```powershell
pnpm --filter @cacp/cli-adapter test
pnpm --filter @cacp/cli-adapter build
```

Expected: tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit CLI adapter**

```powershell
git add packages/cli-adapter package.json pnpm-lock.yaml
git commit -m "feat: add generic cli agent adapter"
```

Expected: commit succeeds.

---

### Task 4: Minimal Web Room reference client

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/index.html`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/event-log.ts`
- Create: `packages/web/src/api.ts`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/App.css`
- Create: `packages/web/test/event-log.test.ts`

- [ ] **Step 1: Create web package and failing reducer test**

Create `packages/web/package.json`:

```json
{
  "name": "@cacp/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite --host 127.0.0.1 --port 5173",
    "test": "vitest run"
  },
  "dependencies": {
    "@cacp/protocol": "workspace:*",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.7",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.4",
    "@types/react-dom": "^19.0.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client", "node"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

Create `packages/web/test/event-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeEvent } from "../src/event-log.js";

describe("event log", () => {
  it("deduplicates events by event_id", () => {
    const event = {
      protocol: "cacp" as const,
      version: "0.1.0" as const,
      event_id: "evt_1",
      room_id: "room_1",
      type: "message.created" as const,
      actor_id: "user_1",
      created_at: "2026-04-25T00:00:00.000Z",
      payload: { text: "hello" }
    };
    expect(mergeEvent(mergeEvent([], event), event)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm install
pnpm --filter @cacp/web test
```

Expected: FAIL because `packages/web/src/event-log.ts` does not exist.

- [ ] **Step 3: Implement Vite, event log, and API files**

Create `packages/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>CACP Web Room</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

Create `packages/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/rooms": "http://127.0.0.1:3737",
      "/health": "http://127.0.0.1:3737"
    }
  }
});
```

Create `packages/web/src/event-log.ts`:

```ts
import type { CacpEvent } from "@cacp/protocol";

export function mergeEvent(events: CacpEvent[], next: CacpEvent): CacpEvent[] {
  if (events.some((event) => event.event_id === next.event_id)) return events;
  return [...events, next].sort((left, right) => left.created_at.localeCompare(right.created_at));
}
```

Create `packages/web/src/api.ts`:

```ts
import { CacpEventSchema, type CacpEvent } from "@cacp/protocol";

export interface RoomSession {
  room_id: string;
  token: string;
}

async function postJson<T>(path: string, token: string | undefined, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function createRoom(name: string, displayName: string): Promise<RoomSession> {
  const result = await postJson<{ room_id: string; owner_token: string }>("/rooms", undefined, { name, display_name: displayName });
  return { room_id: result.room_id, token: result.owner_token };
}

export async function sendMessage(session: RoomSession, text: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/messages`, session.token, { text });
}

export async function createQuestion(session: RoomSession, question: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/questions`, session.token, { question, expected_response: "free_text", options: [] });
}

export async function createTask(session: RoomSession, targetAgentId: string, prompt: string): Promise<void> {
  await postJson(`/rooms/${session.room_id}/tasks`, session.token, { target_agent_id: targetAgentId, prompt, mode: "oneshot" });
}

export function connectEvents(session: RoomSession, onEvent: (event: CacpEvent) => void): WebSocket {
  const url = new URL(`/rooms/${session.room_id}/stream`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session.token);
  const socket = new WebSocket(url);
  socket.addEventListener("message", (message) => {
    const parsed = CacpEventSchema.safeParse(JSON.parse(message.data));
    if (parsed.success) onEvent(parsed.data);
  });
  return socket;
}
```

- [ ] **Step 4: Implement React app and styles**

Create `packages/web/src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { connectEvents, createQuestion, createRoom, createTask, sendMessage, type RoomSession } from "./api.js";
import { mergeEvent } from "./event-log.js";
import "./App.css";

export default function App() {
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP MVP Room");
  const [session, setSession] = useState<RoomSession>();
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [agentId, setAgentId] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => socket.close();
  }, [session]);

  const agents = useMemo(() => events.filter((event) => event.type === "agent.registered").map((event) => event.payload as { agent_id: string; name: string }), [events]);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  if (!session) {
    return <main className="shell"><h1>CACP Web Room</h1><section className="card"><label>Room name</label><input value={roomName} onChange={(event) => setRoomName(event.target.value)} /><label>Your name</label><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><button onClick={() => run(async () => setSession(await createRoom(roomName, displayName)))}>Create room</button></section>{error && <p className="error">{error}</p>}</main>;
  }

  return (
    <main className="shell">
      <header><h1>CACP Room</h1><p><strong>Room:</strong> {session.room_id}</p><p><strong>Token:</strong> {session.token}</p></header>
      <section className="grid">
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await sendMessage(session, message); setMessage(""); }); }}><h2>Message</h2><textarea value={message} onChange={(event) => setMessage(event.target.value)} /><button>Send</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createQuestion(session, question); setQuestion(""); }); }}><h2>Question</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><button>Create question</button></form>
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await createTask(session, agentId, taskPrompt); setTaskPrompt(""); }); }}><h2>Agent task</h2><select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Select agent</option>{agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name} ({agent.agent_id})</option>)}</select><textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} /><button disabled={!agentId}>Create task</button></form>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="card"><h2>Event stream</h2><ol className="events">{events.map((event) => <li key={event.event_id}><code>{event.type}</code><pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></section>
    </main>
  );
}
```

Create `packages/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
```

Create `packages/web/src/App.css`:

```css
:root { color: #172033; background: #f6f8fb; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; }
.shell { max-width: 1180px; margin: 0 auto; padding: 32px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { background: white; border: 1px solid #dbe3ef; border-radius: 16px; box-shadow: 0 10px 30px rgba(21, 34, 55, 0.08); padding: 20px; margin: 16px 0; }
label { display: block; font-weight: 700; margin-top: 12px; }
input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid #bac7d8; border-radius: 10px; padding: 10px; margin: 8px 0 12px; font: inherit; }
textarea { min-height: 96px; }
button { border: 0; border-radius: 999px; background: #2458ff; color: white; cursor: pointer; font-weight: 800; padding: 10px 18px; }
button:disabled { background: #92a0b8; cursor: not-allowed; }
.error { color: #a40019; font-weight: 700; }
.events { list-style: none; padding: 0; }
.events li { border-top: 1px solid #e4eaf2; padding: 12px 0; }
pre { background: #101828; color: #d7e2ff; overflow: auto; padding: 12px; border-radius: 10px; }
```

- [ ] **Step 5: Run web tests and build**

```powershell
pnpm --filter @cacp/web test
pnpm --filter @cacp/web build
```

Expected: tests pass and Vite build exits with code 0.

- [ ] **Step 6: Commit Web Room**

```powershell
git add packages/web package.json pnpm-lock.yaml
git commit -m "feat: add minimal web room client"
```

Expected: commit succeeds.

---

### Task 5: Protocol docs, demo config, and local MVP verification

**Files:**
- Create: `docs/protocol/cacp-v0.1.md`
- Create: `docs/examples/generic-cli-agent.json`

- [ ] **Step 1: Create protocol draft document**

Create `docs/protocol/cacp-v0.1.md`:

```markdown
# CACP v0.1 Experimental Protocol

CACP v0.1 is an event-stream protocol for collaborative AI and agent rooms.

## Core concepts

- Room: a shared collaboration space.
- Participant: a human, agent, system actor, or observer.
- Event: an append-only record of room activity.
- Question: a prompt directed at the room or selected participants.
- Proposal: a formal item that can receive votes and policy evaluation.
- Task: a request for an agent to perform work.
- Artifact: a durable result produced from discussion or agent work.

## Event envelope

```json
{
  "protocol": "cacp",
  "version": "0.1.0",
  "event_id": "evt_123",
  "room_id": "room_123",
  "type": "message.created",
  "actor_id": "user_123",
  "created_at": "2026-04-25T00:00:00.000Z",
  "payload": {}
}
```

## MVP flow

1. Create a room with `POST /rooms`.
2. Invite or join participants.
3. Open `GET /rooms/:roomId/stream?token=...` as a WebSocket.
4. Create messages, questions, proposals, and tasks over HTTP.
5. Receive all room events over the WebSocket stream.
6. Connect a CLI adapter to register a local agent.
7. Create a task targeting that agent.
8. Observe `task.started`, `task.output`, and `task.completed` events.
```

- [ ] **Step 2: Create adapter config example**

Create `docs/examples/generic-cli-agent.json`:

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "replace_with_room_id",
  "token": "replace_with_owner_or_member_token",
  "agent": {
    "name": "Echo CLI Agent",
    "command": "node",
    "args": ["-e", "process.stdin.on('data', d => process.stdout.write('agent:' + d.toString()))"],
    "working_dir": ".",
    "capabilities": ["shell.oneshot"]
  }
}
```

- [ ] **Step 3: Run full test suite**

```powershell
pnpm check
```

Expected: all package tests and builds pass.

- [ ] **Step 4: Manually verify local MVP flow**

Terminal A:

```powershell
pnpm dev:server
```

Expected: `CACP server listening on http://127.0.0.1:3737`.

Terminal B:

```powershell
pnpm dev:web
```

Expected: Vite prints a local URL on port 5173.

Browser:

```text
Open http://127.0.0.1:5173
Create room named "CACP MVP Room"
Copy the displayed room_id and token
```

Edit `docs/examples/generic-cli-agent.json` so `room_id` and `token` match the browser values.

Terminal C:

```powershell
pnpm dev:adapter
```

Expected: adapter prints `Registered Echo CLI Agent as agent_...` and `Connected adapter stream for room ...`.

Browser:

```text
Select the registered Echo CLI Agent.
Create an agent task with prompt "hello from the room".
Confirm the event stream shows task.created, task.started, task.output, and task.completed.
Confirm task.output contains "agent:hello from the room".
```

- [ ] **Step 5: Commit docs and demo assets**

```powershell
git add docs package.json pnpm-lock.yaml
git commit -m "docs: add cacp protocol draft and local demo"
```

Expected: commit succeeds.

---

## Self-Review Checklist

Spec coverage:

- Multi-user room: Task 2 implements room creation, invites, joining, messages, and persisted events.
- Shared event stream: Task 2 implements `/stream` WebSocket and event replay.
- AI/multi-person questions: Task 2 implements question creation and response submission.
- Decisions/proposals/policy: Tasks 1 and 2 implement policy evaluation, proposals, votes, and approval events.
- Generic CLI Agent Adapter: Tasks 2 and 3 implement agent registration, task lifecycle, and command execution.
- Local-first deployment: Tasks 2, 3, 4, and 5 run on localhost with local commands.
- Token/role model: Task 2 implements bearer tokens and owner/admin/member/observer/agent roles.
- SQLite event persistence: Task 2 implements SQLite-backed append-only event storage.
- Web reference client: Task 4 implements a minimal room UI.
- Protocol draft: Task 5 writes `docs/protocol/cacp-v0.1.md`.

Type consistency:

- Event names match `EventTypeSchema`.
- Roles match `ParticipantRoleSchema`.
- Vote values match `VoteValueSchema`.
- Task lifecycle routes emit only event types defined in Task 1.
- CLI adapter reads `task.created` events and posts to task lifecycle routes from Task 2.

Execution order:

- Task 0 creates workspace tooling.
- Task 1 creates shared protocol code needed by server, adapter, and web.
- Task 2 creates the protocol server.
- Task 3 connects a local CLI process as an agent.
- Task 4 provides a human-facing reference client.
- Task 5 verifies the full local-first flow.
