# Local Connector Transcript and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Local Connector onboarding upgrade: local `chat.md` transcript writing, a post-create connection-code modal, and a clear connected banner in the Connector console.

**Architecture:** Keep the protocol and server unchanged. Add two focused CLI adapter helpers for transcript writing and connected-banner rendering, then wire them into the existing WebSocket stream loop. Add one focused Web modal component and App-level state so the cloud room creation path opens the modal once when a new connection code is generated.

**Tech Stack:** TypeScript, ESM, Node 20 filesystem APIs, ws, React 19, Vite, Vitest, Testing Library, existing CACP i18n helpers.

---

## Scope Check

The approved spec touches two implementation areas that form one user-visible flow:

1. `packages/cli-adapter`: local transcript file plus connected console banner.
2. `packages/web`: cloud-create onboarding modal.

The server and protocol packages are intentionally out of scope. This is one implementation plan because the useful validation is the full room creation and connector onboarding path.

## File Structure Map

- Create `packages/cli-adapter/src/transcript.ts`
  - Owns `rooms/<room_id>/chat.md` path resolution, Markdown header creation, participant-name tracking, message formatting, de-duplicated append, and non-fatal write errors.
- Create `packages/cli-adapter/test/transcript.test.ts`
  - Covers Markdown output, participant display names, duplicate message suppression, fallback to `event_id`, and write-failure resilience.
- Create `packages/cli-adapter/src/connected-banner.ts`
  - Owns the connected console message, Unicode/ASCII flow diagram, and optional ANSI coloring.
- Create `packages/cli-adapter/test/connected-banner.test.ts`
  - Covers required Chinese/English success copy, do-not-close warning, Web-room collaboration prompt, chat path, and write-failure copy.
- Modify `packages/cli-adapter/src/index.ts`
  - Instantiates `ChatTranscriptWriter`, passes parsed events into it, and prints the connected banner in `ws.on("open")`.
- Add `packages/cli-adapter/test/index-source.test.ts`
  - Guards the lightweight wiring without needing to launch a real WebSocket server.
- Create `packages/web/src/components/ConnectionCodeModal.tsx`
  - Owns the cloud onboarding modal, download link, copy button, expiry copy, close action, and manual-code fallback on clipboard failure.
- Create `packages/web/test/connection-code-modal.test.tsx`
  - Covers modal rendering, successful copy feedback, manual fallback on copy failure, and hidden state when no pairing is present.
- Modify `packages/web/src/App.tsx`
  - Stores one-shot modal pairing state and renders `ConnectionCodeModal` after cloud create.
- Modify `packages/web/src/i18n/messages.en.json`
  - Adds English modal strings.
- Modify `packages/web/src/i18n/messages.zh.json`
  - Adds Chinese modal strings.
- Add `packages/web/test/app-connector-modal.test.tsx`
  - Verifies the cloud create path opens the modal after `createAgentPairing` returns.
- Modify `packages/web/test/i18n.test.ts`
  - Adds a key-parity guard for English and Chinese catalogs.

---

### Task 1: CLI Chat Transcript Writer

**Files:**
- Create: `packages/cli-adapter/src/transcript.ts`
- Create: `packages/cli-adapter/test/transcript.test.ts`

- [ ] **Step 1: Write failing transcript tests**

Create `packages/cli-adapter/test/transcript.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { CacpEvent, Participant } from "@cacp/protocol";
import { ChatTranscriptWriter, formatChatMessage, transcriptPathForRoom } from "../src/transcript.js";

function baseEvent(type: CacpEvent["type"], payload: Record<string, unknown>, actorId = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${type}_${Math.random().toString(16).slice(2)}`,
    room_id: "room_1",
    type,
    actor_id: actorId,
    created_at: "2026-04-28T03:30:00.000Z",
    payload
  };
}

function participant(id: string, displayName: string): Participant {
  return { id, display_name: displayName, type: "human", role: "member" };
}

describe("chat transcript writer", () => {
  it("builds the per-room chat.md path under the connector directory", () => {
    expect(transcriptPathForRoom("D:\\Connector", "room_alpha")).toBe("D:\\Connector\\rooms\\room_alpha\\chat.md");
  });

  it("writes a Markdown header and appends named human and agent messages", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({
        roomId: "room_1",
        baseDir: tempDir,
        now: () => new Date("2026-04-28T03:29:00.000Z")
      });

      writer.handleEvent(baseEvent("participant.joined", { participant: participant("user_1", "Alice\nOwner") }));
      writer.handleEvent(baseEvent("participant.joined", { participant: { ...participant("agent_1", "Claude Code"), type: "agent", role: "agent" } }));
      writer.handleEvent(baseEvent("message.created", { message_id: "msg_1", text: "Hello team", kind: "human" }, "user_1"));
      writer.handleEvent(baseEvent("message.created", { message_id: "msg_2", text: "I am ready.", kind: "agent" }, "agent_1"));

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text).toContain("# CACP Room Chat");
      expect(text).toContain("Room: room_1");
      expect(text).toContain("Started: 2026-04-28 03:29:00 UTC");
      expect(text).toContain("## 2026-04-28 03:30:00 UTC - Alice Owner");
      expect(text).toContain("Hello team");
      expect(text).toContain("## 2026-04-28 03:30:00 UTC - Claude Code");
      expect(text).toContain("I am ready.");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not append duplicate message ids", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: tempDir });
      const event = baseEvent("message.created", { message_id: "msg_dup", text: "Only once", kind: "human" }, "user_1");

      writer.handleEvent(event);
      writer.handleEvent(event);

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text.match(/Only once/g)).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to event_id when message_id is absent", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: tempDir });
      const event = baseEvent("message.created", { text: "Legacy message", kind: "human" }, "user_1");

      writer.handleEvent(event);
      writer.handleEvent(event);

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text.match(/Legacy message/g)).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps connector processing alive when the transcript path cannot be written", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-blocked-"));
    const blockedBase = join(tempDir, "not-a-dir");
    const logger = { warn: vi.fn() };
    try {
      writeFileSync(blockedBase, "file blocks directory creation", "utf8");
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: blockedBase, logger });

      expect(() => writer.handleEvent(baseEvent("message.created", { message_id: "msg_1", text: "Still connected" }))).not.toThrow();
      expect(writer.isAvailable()).toBe(false);
      expect(writer.lastErrorMessage()).toContain("Unable to write chat transcript");
      expect(logger.warn).toHaveBeenCalled();
      expect(existsSync(join(blockedBase, "rooms", "room_1", "chat.md"))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("formatChatMessage", () => {
  it("uses the actor id when no display name is known", () => {
    expect(formatChatMessage({
      actorName: "user_99",
      createdAt: "2026-04-28T03:30:00.000Z",
      text: "Fallback name"
    })).toContain("## 2026-04-28 03:30:00 UTC - user_99");
  });
});
```

- [ ] **Step 2: Run the transcript tests and verify they fail**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- transcript.test.ts
```

Expected: FAIL because `../src/transcript.js` does not exist.

- [ ] **Step 3: Implement the transcript writer**

Create `packages/cli-adapter/src/transcript.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CacpEvent, Participant } from "@cacp/protocol";

export interface TranscriptLogger {
  warn: (message: string) => void;
}

export interface ChatTranscriptWriterOptions {
  roomId: string;
  baseDir: string;
  logger?: TranscriptLogger;
  now?: () => Date;
}

export interface ChatMessageFormatInput {
  actorName: string;
  createdAt: string;
  text: string;
}

function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}

function safeHeadingText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim() || "unknown";
}

export function transcriptPathForRoom(baseDir: string, roomId: string): string {
  return join(baseDir, "rooms", roomId, "chat.md");
}

export function formatChatMessage(input: ChatMessageFormatInput): string {
  return [
    `## ${formatTimestamp(input.createdAt)} - ${safeHeadingText(input.actorName)}`,
    "",
    input.text,
    ""
  ].join("\n");
}

function participantFromPayload(payload: Record<string, unknown>): Participant | undefined {
  const participant = payload.participant;
  if (!participant || typeof participant !== "object") return undefined;
  const candidate = participant as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.display_name !== "string") return undefined;
  return {
    id: candidate.id,
    display_name: candidate.display_name,
    type: candidate.type === "agent" ? "agent" : candidate.type === "observer" ? "observer" : "human",
    role: candidate.role === "agent" ? "agent" : candidate.role === "owner" ? "owner" : candidate.role === "admin" ? "admin" : candidate.role === "observer" ? "observer" : "member"
  };
}

export class ChatTranscriptWriter {
  readonly chatPath: string;

  private readonly roomDir: string;
  private readonly roomId: string;
  private readonly logger: TranscriptLogger;
  private readonly now: () => Date;
  private readonly actorNames = new Map<string, string>();
  private readonly writtenKeys = new Set<string>();
  private lastError?: string;
  private reportedWriteError = false;

  constructor(options: ChatTranscriptWriterOptions) {
    this.roomId = options.roomId;
    this.roomDir = join(options.baseDir, "rooms", options.roomId);
    this.chatPath = join(this.roomDir, "chat.md");
    this.logger = options.logger ?? console;
    this.now = options.now ?? (() => new Date());
    this.ensureReady();
  }

  isAvailable(): boolean {
    return this.ensureReady();
  }

  lastErrorMessage(): string | undefined {
    return this.lastError;
  }

  handleEvent(event: CacpEvent): void {
    if (event.type === "participant.joined") {
      const participant = participantFromPayload(event.payload);
      if (participant) this.actorNames.set(participant.id, participant.display_name);
      return;
    }

    if (event.type !== "message.created") return;
    const text = event.payload.text;
    if (typeof text !== "string" || text.length === 0) return;

    const dedupeKey = typeof event.payload.message_id === "string" ? event.payload.message_id : event.event_id;
    if (this.writtenKeys.has(dedupeKey)) return;
    if (!this.ensureReady()) return;

    try {
      appendFileSync(this.chatPath, `${formatChatMessage({
        actorName: this.actorNames.get(event.actor_id) ?? event.actor_id,
        createdAt: event.created_at,
        text
      })}\n`, "utf8");
      this.writtenKeys.add(dedupeKey);
    } catch (error) {
      this.reportWriteError(error);
    }
  }

  private ensureReady(): boolean {
    try {
      mkdirSync(this.roomDir, { recursive: true });
      if (!existsSync(this.chatPath)) {
        writeFileSync(this.chatPath, [
          "# CACP Room Chat",
          "",
          `Room: ${this.roomId}`,
          `Started: ${formatTimestamp(this.now())}`,
          "",
          "---",
          ""
        ].join("\n"), "utf8");
      }
      this.lastError = undefined;
      return true;
    } catch (error) {
      this.reportWriteError(error);
      return false;
    }
  }

  private reportWriteError(error: unknown): void {
    this.lastError = `Unable to write chat transcript: ${error instanceof Error ? error.message : String(error)}`;
    if (!this.reportedWriteError) {
      this.logger.warn(this.lastError);
      this.reportedWriteError = true;
    }
  }
}
```

- [ ] **Step 4: Run transcript tests and type build**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- transcript.test.ts
corepack pnpm --filter @cacp/cli-adapter build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add packages/cli-adapter/src/transcript.ts packages/cli-adapter/test/transcript.test.ts
git commit -m "feat(cli-adapter): write local chat transcript"
```

---

### Task 2: CLI Connected Banner

**Files:**
- Create: `packages/cli-adapter/src/connected-banner.ts`
- Create: `packages/cli-adapter/test/connected-banner.test.ts`

- [ ] **Step 1: Write failing connected-banner tests**

Create `packages/cli-adapter/test/connected-banner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { formatConnectedBanner, printConnectedBanner } from "../src/connected-banner.js";

describe("connected banner", () => {
  it("renders the success message, warning, web-room prompt, diagram, and chat path", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: true,
      color: false
    });

    expect(banner).toContain("连接成功 / CONNECTED");
    expect(banner).toContain("请不要关闭此窗口");
    expect(banner).toContain("房主现在可以回到 Web 房间");
    expect(banner).toContain("开启多人协同式 AI 创作");
    expect(banner).toContain("CACP Web Room");
    expect(banner).toContain("Local Agent");
    expect(banner).toContain("D:\\Connector\\rooms\\room_1\\chat.md");
  });

  it("renders a clear transcript failure message without hiding the successful connection", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: false,
      transcriptError: "Unable to write chat transcript: access denied",
      color: false
    });

    expect(banner).toContain("连接成功 / CONNECTED");
    expect(banner).toContain("聊天记录保存失败");
    expect(banner).toContain("access denied");
  });

  it("prints the banner through an injectable logger", () => {
    const log = vi.fn();
    printConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: true,
      color: false
    }, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("连接成功 / CONNECTED");
  });
});
```

- [ ] **Step 2: Run the connected-banner tests and verify they fail**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- connected-banner.test.ts
```

Expected: FAIL because `../src/connected-banner.js` does not exist.

- [ ] **Step 3: Implement the connected-banner helper**

Create `packages/cli-adapter/src/connected-banner.ts`:

```ts
export interface ConnectedBannerInput {
  roomId: string;
  chatPath: string;
  chatAvailable: boolean;
  transcriptError?: string;
  color?: boolean;
}

type ColorName = "green" | "yellow" | "cyan" | "red";

const colorCodes: Record<ColorName, [string, string]> = {
  green: ["\u001b[32m", "\u001b[0m"],
  yellow: ["\u001b[33m", "\u001b[0m"],
  cyan: ["\u001b[36m", "\u001b[0m"],
  red: ["\u001b[31m", "\u001b[0m"]
};

function paint(value: string, color: ColorName, enabled: boolean): string {
  if (!enabled) return value;
  const [open, close] = colorCodes[color];
  return `${open}${value}${close}`;
}

export function formatConnectedBanner(input: ConnectedBannerInput): string {
  const useColor = input.color ?? Boolean(process.stdout.isTTY);
  const chatLines = input.chatAvailable
    ? [
        "📄 聊天记录正在保存到：",
        paint(input.chatPath, "cyan", useColor)
      ]
    : [
        paint("📄 聊天记录保存失败，请检查目录权限。", "red", useColor),
        input.transcriptError ? paint(input.transcriptError, "red", useColor) : undefined
      ].filter((line): line is string => Boolean(line));

  return [
    "",
    "╔══════════════════════════════════════════════╗",
    `║  ${paint("✅ 连接成功 / CONNECTED", "green", useColor)}                     ║`,
    "╚══════════════════════════════════════════════╝",
    "",
    `🤖 本地 Agent 已连接到房间：${input.roomId}`,
    paint("⚠️  请不要关闭此窗口，否则本地 Agent 会从房间断开。", "yellow", useColor),
    "",
    ...chatLines,
    "",
    "──────────────────────────────────────────────",
    "👥 房主现在可以回到 Web 房间",
    "🚀 开启多人协同式 AI 创作",
    "──────────────────────────────────────────────",
    "",
    "        👤 房主 / 团队成员",
    "              │",
    "              ▼",
    "        🌐 CACP Web Room",
    "              │  实时讨论 / 多人协作",
    "              ▼",
    "        🤖 Local Agent",
    "              │",
    "              ▼",
    "        📄 本地聊天记录 chat.md",
    ""
  ].join("\n");
}

export function printConnectedBanner(input: ConnectedBannerInput, log: (message: string) => void = console.log): void {
  log(formatConnectedBanner(input));
}
```

- [ ] **Step 4: Run connected-banner tests and type build**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- connected-banner.test.ts
corepack pnpm --filter @cacp/cli-adapter build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add packages/cli-adapter/src/connected-banner.ts packages/cli-adapter/test/connected-banner.test.ts
git commit -m "feat(cli-adapter): show connected onboarding banner"
```

---

### Task 3: Wire Transcript and Banner into the CLI Adapter Stream

**Files:**
- Modify: `packages/cli-adapter/src/index.ts`
- Create: `packages/cli-adapter/test/index-source.test.ts`

- [ ] **Step 1: Write a failing source-level wiring test**

Create `packages/cli-adapter/test/index-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("cli adapter stream wiring", () => {
  const source = () => readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

  it("creates a transcript writer from the runtime room and working directory", () => {
    expect(source()).toContain("new ChatTranscriptWriter({");
    expect(source()).toContain("roomId: config.room_id");
    expect(source()).toContain("baseDir: config.agent.working_dir");
  });

  it("passes parsed stream events into the transcript writer before task handling", () => {
    expect(source()).toContain("transcript.handleEvent(parsed.data)");
  });

  it("prints the connected banner only from the websocket open handler", () => {
    expect(source()).toContain("ws.on(\"open\", () => {");
    expect(source()).toContain("printConnectedBanner({");
    expect(source()).toContain("chatPath: transcript.chatPath");
  });
});
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- index-source.test.ts
```

Expected: FAIL because `index.ts` does not import or instantiate the new helpers.

- [ ] **Step 3: Import the new helpers**

Modify the top of `packages/cli-adapter/src/index.ts`:

```ts
import { printConnectedBanner } from "./connected-banner.js";
import { ChatTranscriptWriter } from "./transcript.js";
```

Keep the existing imports for `WebSocket`, `CacpEventSchema`, config, runner, and result helpers.

- [ ] **Step 4: Instantiate the transcript writer after config load**

In `main()`, immediately after:

```ts
const config = await loadRuntimeConfigFromArgs(process.argv.slice(2));
```

add:

```ts
const transcript = new ChatTranscriptWriter({
  roomId: config.room_id,
  baseDir: config.agent.working_dir
});
```

- [ ] **Step 5: Feed all parsed events into the transcript writer**

Inside `handleMessage`, immediately after:

```ts
if (!parsed.success) return;
```

add:

```ts
transcript.handleEvent(parsed.data);
```

This is safe because `ChatTranscriptWriter` ignores non-chat events and does not throw on write failure.

- [ ] **Step 6: Replace the current open handler with the connected banner**

Replace:

```ts
ws.on("open", () => console.log(`Connected adapter stream for room ${config.room_id}`));
```

with:

```ts
ws.on("open", () => {
  printConnectedBanner({
    roomId: config.room_id,
    chatPath: transcript.chatPath,
    chatAvailable: transcript.isAvailable(),
    transcriptError: transcript.lastErrorMessage()
  });
  console.log(`Connected adapter stream for room ${config.room_id}`);
});
```

- [ ] **Step 7: Run targeted CLI adapter validation**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- transcript.test.ts connected-banner.test.ts index-source.test.ts
corepack pnpm --filter @cacp/cli-adapter build
```

Expected: all tests and build PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add packages/cli-adapter/src/index.ts packages/cli-adapter/test/index-source.test.ts
git commit -m "feat(cli-adapter): persist chat events from stream"
```

---

### Task 4: Web Connection Code Modal Component

**Files:**
- Create: `packages/web/src/components/ConnectionCodeModal.tsx`
- Create: `packages/web/test/connection-code-modal.test.tsx`

- [ ] **Step 1: Write failing modal component tests**

Create `packages/web/test/connection-code-modal.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import ConnectionCodeModal from "../src/components/ConnectionCodeModal.js";

const pairing = {
  connection_code: "CACP-CONNECT:v1:full-secret-code",
  download_url: "/downloads/CACP-Local-Connector.exe",
  expires_at: "2026-04-28T04:30:00.000Z"
};

function renderModal(writeText = vi.fn(async () => undefined), onClose = vi.fn()) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });

  render(
    <LangProvider>
      <ConnectionCodeModal pairing={pairing} onClose={onClose} />
    </LangProvider>
  );

  return { onClose, writeText };
}

describe("ConnectionCodeModal", () => {
  it("renders download and copy actions for a generated connection code", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Connect local Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CACP-Local-Connector.exe" })).toHaveAttribute("href", pairing.download_url);
    expect(screen.getByRole("button", { name: "Copy connection code" })).toBeInTheDocument();
    expect(screen.getByText(/Connection code expires at/)).toBeInTheDocument();
  });

  it("copies the full connection code and shows copied feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    renderModal(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(writeText).toHaveBeenCalledWith(pairing.connection_code);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows a manual copy field when clipboard copy fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("blocked");
    });
    renderModal(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(await screen.findByLabelText("Connection code for manual copy")).toHaveValue(pairing.connection_code);
    expect(screen.getByText("Copy failed. Select the code below and copy it manually.")).toBeInTheDocument();
  });

  it("calls onClose from the close button", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a pairing", () => {
    const { container } = render(
      <LangProvider>
        <ConnectionCodeModal pairing={undefined} onClose={() => {}} />
      </LangProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the modal component test and verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- connection-code-modal.test.tsx
```

Expected: FAIL because `ConnectionCodeModal` does not exist.

- [ ] **Step 3: Implement the modal component**

Create `packages/web/src/components/ConnectionCodeModal.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useT } from "../i18n/useT.js";

export interface ConnectionCodeModalPairing {
  connection_code: string;
  download_url: string;
  expires_at: string;
}

export interface ConnectionCodeModalProps {
  pairing?: ConnectionCodeModalPairing;
  onClose: () => void;
}

export default function ConnectionCodeModal({ pairing, onClose }: ConnectionCodeModalProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = useCallback(() => {
    if (!pairing) return;
    setCopyFailed(false);
    navigator.clipboard.writeText(pairing.connection_code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopyFailed(true);
    });
  }, [pairing]);

  if (!pairing) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("connectorModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("sidebar.connectorLabel")}</p>
        <h3>{t("connectorModal.title")}</h3>
        <p className="join-request-modal-subcopy">{t("connectorModal.body")}</p>
        <ol style={{ margin: "0 0 16px 18px", color: "var(--ink-3)", fontSize: 13 }}>
          <li>{t("connectorModal.stepDownload")}</li>
          <li>{t("connectorModal.stepCopy")}</li>
          <li>{t("connectorModal.stepPaste")}</li>
        </ol>
        <div className="join-request-modal-actions">
          <a className="btn btn-warm" href={pairing.download_url} download>
            {t("connectorModal.download")}
          </a>
          <button type="button" className="btn btn-primary" onClick={handleCopy}>
            {copied ? t("sidebar.connectionCodeCopied") : t("sidebar.copyConnectionCode")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("sidebar.close")}
          </button>
        </div>
        <p style={{ color: "var(--ink-4)", fontSize: 12, margin: "12px 0 0" }}>
          {t("connectorModal.expires", { expiresAt: new Date(pairing.expires_at).toLocaleString() })}
        </p>
        {copyFailed && (
          <div style={{ marginTop: 12 }}>
            <p className="error inline-error" style={{ marginBottom: 8 }}>{t("connectorModal.copyFailed")}</p>
            <textarea
              className="input"
              readOnly
              rows={4}
              aria-label={t("connectorModal.manualCodeLabel")}
              value={pairing.connection_code}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add English i18n keys for the component**

Modify `packages/web/src/i18n/messages.en.json` and add these keys near existing connector/sidebar keys:

```json
{
  "connectorModal.title": "Connect local Agent",
  "connectorModal.body": "Download and run the Local Connector, then paste the connection code into the Connector window.",
  "connectorModal.stepDownload": "Download and run CACP-Local-Connector.exe.",
  "connectorModal.stepCopy": "Copy the generated connection code.",
  "connectorModal.stepPaste": "Paste it into the Connector window to connect your local Agent.",
  "connectorModal.download": "Download CACP-Local-Connector.exe",
  "connectorModal.expires": "Connection code expires at {expiresAt}.",
  "connectorModal.copyFailed": "Copy failed. Select the code below and copy it manually.",
  "connectorModal.manualCodeLabel": "Connection code for manual copy"
}
```

Keep the JSON valid with commas in the surrounding object.

- [ ] **Step 5: Add Chinese i18n keys for the component**

Modify `packages/web/src/i18n/messages.zh.json` and add matching keys:

```json
{
  "connectorModal.title": "连接本地 Agent",
  "connectorModal.body": "请下载并运行本地连接器，然后把连接码粘贴到连接器窗口中。",
  "connectorModal.stepDownload": "下载并运行 CACP-Local-Connector.exe。",
  "connectorModal.stepCopy": "复制刚刚生成的连接码。",
  "connectorModal.stepPaste": "把连接码粘贴到连接器窗口，让本地 Agent 连接房间。",
  "connectorModal.download": "下载 CACP-Local-Connector.exe",
  "connectorModal.expires": "连接码有效期至：{expiresAt}。",
  "connectorModal.copyFailed": "复制失败。请选择下面的连接码并手动复制。",
  "connectorModal.manualCodeLabel": "用于手动复制的连接码"
}
```

- [ ] **Step 6: Run modal component tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- connection-code-modal.test.tsx
corepack pnpm --filter @cacp/web build
```

Expected: both commands PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add packages/web/src/components/ConnectionCodeModal.tsx packages/web/test/connection-code-modal.test.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json
git commit -m "feat(web): add connector onboarding modal"
```

---

### Task 5: Wire the Modal into Cloud Room Creation

**Files:**
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/test/app-connector-modal.test.tsx`
- Modify: `packages/web/test/i18n.test.ts`

- [ ] **Step 1: Write a failing App integration test for the cloud create path**

Create `packages/web/test/app-connector-modal.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.js";

vi.mock("../src/runtime-config.js", () => ({
  isCloudMode: () => true
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    createRoom: vi.fn(async () => ({
      room_id: "room_1",
      token: "owner_secret",
      participant_id: "user_owner",
      role: "owner"
    })),
    createAgentPairing: vi.fn(async () => ({
      connection_code: "CACP-CONNECT:v1:full-secret-code",
      download_url: "/downloads/CACP-Local-Connector.exe",
      expires_at: "2026-04-28T04:30:00.000Z"
    })),
    connectEvents: vi.fn(() => ({
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn()
    })),
    clearEventSocket: vi.fn()
  };
});

describe("App connector onboarding modal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true
    });
  });

  it("opens the connector modal after cloud room creation generates a connection code", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and generate connector command" }));

    expect(await screen.findByRole("dialog", { name: "Connect local Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CACP-Local-Connector.exe" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("CACP-CONNECT:v1:full-secret-code"));
  });
});
```

- [ ] **Step 2: Add an i18n key-parity test**

Modify `packages/web/test/i18n.test.ts` by adding imports and a test:

```ts
import enMessages from "../src/i18n/messages.en.json";
import zhMessages from "../src/i18n/messages.zh.json";
```

Add this test inside the existing `describe("resolveLang", () => { ... })` block:

```ts
it("keeps English and Chinese message catalogs aligned", () => {
  expect(Object.keys(zhMessages).sort()).toEqual(Object.keys(enMessages).sort());
});
```

- [ ] **Step 3: Run the new App test and verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- app-connector-modal.test.tsx i18n.test.ts
```

Expected: `app-connector-modal.test.tsx` FAILS because `App.tsx` does not render `ConnectionCodeModal` yet. The i18n parity test should PASS after Task 4 added both catalogs.

- [ ] **Step 4: Import the modal in App**

Modify `packages/web/src/App.tsx` imports:

```ts
import ConnectionCodeModal, { type ConnectionCodeModalPairing } from "./components/ConnectionCodeModal.js";
```

- [ ] **Step 5: Add one-shot modal state**

In `App()` state declarations, after `createdPairing`, add:

```ts
const [connectorModalPairing, setConnectorModalPairing] = useState<ConnectionCodeModalPairing>();
```

Where the app clears room/session state, also clear `connectorModalPairing`:

```ts
setConnectorModalPairing(undefined);
```

Apply that in the existing participant-removed handler, `activateSession`, and `handleLeaveRoom` alongside `setCreatedPairing(undefined)`.

- [ ] **Step 6: Open the modal after cloud pairing creation**

In the `isCloudMode()` branch of `handleCreate`, replace:

```ts
setCreatedPairing({
  connection_code: pairing.connection_code,
  download_url: pairing.download_url,
  expires_at: pairing.expires_at,
});
```

with:

```ts
const modalPairing = {
  connection_code: pairing.connection_code,
  download_url: pairing.download_url,
  expires_at: pairing.expires_at,
};
setCreatedPairing(modalPairing);
setConnectorModalPairing(modalPairing);
```

- [ ] **Step 7: Render the modal next to the Workspace**

In the final `return` branch of `App()`, render the modal after `<Workspace ... />`:

```tsx
<ConnectionCodeModal
  pairing={connectorModalPairing}
  onClose={() => setConnectorModalPairing(undefined)}
/>
```

Keep this inside the existing `<LangProvider>`.

- [ ] **Step 8: Run Web targeted tests and build**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- connection-code-modal.test.tsx app-connector-modal.test.tsx i18n.test.ts cloud-connector.test.tsx landing-connector.test.tsx
corepack pnpm --filter @cacp/web build
```

Expected: all tests and build PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```powershell
git add packages/web/src/App.tsx packages/web/test/app-connector-modal.test.tsx packages/web/test/i18n.test.ts
git commit -m "feat(web): show connector modal after cloud room creation"
```

---

### Task 6: Full Validation and Release-Ready Cleanup

**Files:**
- Verify only: no planned source edits unless validation reveals a concrete defect.

- [ ] **Step 1: Run CLI adapter targeted tests**

Run:

```powershell
corepack pnpm --filter @cacp/cli-adapter test -- transcript.test.ts connected-banner.test.ts index-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Web targeted tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- connection-code-modal.test.tsx app-connector-modal.test.tsx i18n.test.ts cloud-connector.test.tsx landing-connector.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full repository check**

Run:

```powershell
corepack pnpm check
```

Expected: PASS for all package tests and builds.

- [ ] **Step 4: Inspect the final diff**

Run:

```powershell
git status --short
git diff --stat HEAD
git diff --check
```

Expected:

- `git diff --check` reports no whitespace errors.
- Uncommitted files are only the intended implementation files if the previous task commits were intentionally deferred.

- [ ] **Step 5: Confirm the implementation branch is clean**

Run:

```powershell
git status --short
```

Expected: no output. If files remain, stop and report the exact remaining paths from `git status --short` before making any additional commits.

---

## Self-Review

### Spec coverage

- Local `rooms/<room_id>/chat.md`: Task 1.
- Only readable chat正文, no raw token or connection code persistence: Task 1 writes only `message.created` text.
- Participant display names with fallback to `actor_id`: Task 1.
- De-duplication by `message_id`, fallback to `event_id`: Task 1.
- File write failure remains non-fatal: Task 1 and Task 2 failure banner.
- Connected banner after WebSocket open: Tasks 2 and 3.
- Banner includes do-not-close warning, Web Room prompt, multi-person AI creation line, icons, and flow diagram: Task 2.
- Cloud create modal with download and copy actions: Tasks 4 and 5.
- Modal copy failure manual fallback: Task 4.
- Refresh does not re-open modal: Task 5 uses in-memory one-shot state created only after new pairing generation.
- English and Chinese i18n completeness: Tasks 4 and 5.
- No server or protocol changes: File map and tasks do not modify those packages.

### Red-flag scan

The plan uses exact paths, test commands, implementation snippets, and commit commands. It contains no deferred requirement markers.

### Type consistency

- `ConnectionCodeModalPairing` matches the existing `createdPairing` shape in `App.tsx`.
- `ChatTranscriptWriter.chatPath`, `isAvailable()`, `lastErrorMessage()`, and `handleEvent()` names are used consistently in tests and wiring.
- i18n keys referenced by `ConnectionCodeModal.tsx` are defined in both `messages.en.json` and `messages.zh.json`.
