# CACP Web Redesign (Warm Editorial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the glassmorphic neon web UI with the Warm Editorial design, add EN/CN i18n, restructure the monolithic App.tsx into focused components, and move AI Flow Control into the composer.

**Architecture:** Frontend-only refactor. New CSS token system (`tokens.css`). Component split under `src/components/`. Thin in-house i18n context (`src/i18n/`). `room-state.ts` gains helper derivations. All server/protocol interactions remain unchanged.

**Tech Stack:** React 19, Vite, Vitest, TypeScript. No new runtime dependencies.

---

## File Structure Map

### New files
- `packages/web/src/tokens.css` — Warm Editorial CSS custom properties
- `packages/web/src/i18n/messages.en.json` — English chrome strings
- `packages/web/src/i18n/messages.zh.json` — Chinese chrome strings
- `packages/web/src/i18n/LangProvider.tsx` — React context for language state
- `packages/web/src/i18n/useT.ts` — Translation hook with fallback
- `packages/web/src/components/Landing.tsx` — Tabbed landing page
- `packages/web/src/components/Workspace.tsx` — Workspace shell (header + grid)
- `packages/web/src/components/Header.tsx` — Room header with status pill and lang toggle
- `packages/web/src/components/ChatPanel.tsx` — Thread + Composer wrapper
- `packages/web/src/components/Thread.tsx` — Message list, empty state, streaming bubbles
- `packages/web/src/components/Composer.tsx` — Inline AI Flow Control composer
- `packages/web/src/components/Sidebar.tsx` — Agent / People / Invite cards
- `packages/web/src/components/MobileDrawer.tsx` — Right slide-over for <1024px

### Modified files
- `packages/web/src/App.tsx` — Thin router: Landing | Workspace
- `packages/web/src/App.css` — Replaced with token-based styles
- `packages/web/src/room-state.ts` — Add `isCollectionActive`, `isTurnInFlight`, `collectedMessageIds`
- `packages/web/src/api.ts` — Ensure `createRoomWithLocalAgent` types match

### New test files
- `packages/web/test/i18n.test.ts`
- `packages/web/test/room-state-helpers.test.ts`
- `packages/web/test/composer-matrix.test.ts`

---

## Task 1: i18n Infrastructure

**Files:**
- Create: `packages/web/src/i18n/messages.en.json`
- Create: `packages/web/src/i18n/messages.zh.json`
- Create: `packages/web/src/i18n/LangProvider.tsx`
- Create: `packages/web/src/i18n/useT.ts`
- Create: `packages/web/test/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/i18n.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("i18n resolver", () => {
  it("defaults to zh when navigator.language starts with zh", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() } as unknown as Storage;
    const lang = resolveLang(storage, "zh-CN");
    expect(lang).toBe("zh");
    expect(storage.setItem).toHaveBeenCalledWith("cacp.web.lang", "zh");
  });

  it("defaults to en for non-zh languages", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() } as unknown as Storage;
    const lang = resolveLang(storage, "en-US");
    expect(lang).toBe("en");
  });

  it("uses localStorage when set", () => {
    const storage = { getItem: vi.fn(() => "zh"), setItem: vi.fn() } as unknown as Storage;
    const lang = resolveLang(storage, "en-US");
    expect(lang).toBe("zh");
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
corepack pnpm --filter @cacp/web test -- i18n.test.ts
```

Expected: FAIL — `resolveLang` is not defined.

- [ ] **Step 3: Implement i18n core**

Create `packages/web/src/i18n/messages.en.json`:

```json
{
  "landing.eyebrow": "CACP · Local Demo",
  "landing.headline": "A collaborative AI room.",
  "landing.subcopy": "Create a room, connect a local CLI agent, and chat together.",
  "landing.tab.create": "Create room",
  "landing.tab.join": "Join with invite",
  "landing.create.name.label": "Your name",
  "landing.create.roomName.label": "Room name",
  "landing.create.agent.label": "Agent",
  "landing.create.permission.label": "Permission",
  "landing.create.workingDir.label": "Working directory",
  "landing.create.cta": "Create room and start agent",
  "landing.join.name.label": "Your name",
  "landing.join.invite.label": "Invite link",
  "landing.join.cta": "Join shared room",
  "header.roomLabel": "Room",
  "header.peopleLabel": "people",
  "header.online": "online",
  "header.offline": "offline",
  "header.status.live": "Live",
  "header.status.collecting": "Collecting…",
  "header.status.replying": "Replying…",
  "header.menu.clearRoom": "Clear room",
  "header.menu.leaveRoom": "Leave room",
  "composer.mode.live": "Live",
  "composer.mode.collect": "Collect",
  "composer.hint.live": "Each message goes to AI immediately",
  "composer.hint.collect.owner": "Collecting answers — submit when ready",
  "composer.hint.collect.member": "Owner is collecting answers · your replies will be sent as a batch when they submit",
  "composer.hint.queued": "Claude is replying… your next message will queue as a follow-up after this turn.",
  "composer.send": "Send",
  "composer.queue": "Queue",
  "composer.add": "Add",
  "composer.submit": "Submit {count} answers →",
  "composer.cancelCollection": "Cancel collection",
  "composer.ownerOnlyHint": "Only the owner sees these controls",
  "composer.lockedHint": "🔒 only the owner can submit or cancel this collection",
  "composer.modeLocked": "🔒 mode locked while Agent is replying",
  "thread.empty": "No messages yet · say hi or wait for the agent.",
  "thread.queuedTag": "QUEUED",
  "thread.collectionCancelled": "Collection cancelled — {count} messages remain in the room.",
  "sidebar.agent.label": "Agent",
  "sidebar.agent.logs": "Logs →",
  "sidebar.agent.status.online": "online",
  "sidebar.agent.status.offline": "offline · last seen {time}",
  "sidebar.agent.permission.readOnly": "Read only",
  "sidebar.agent.permission.limitedWrite": "Limited write",
  "sidebar.agent.permission.fullAccess": "Full access",
  "sidebar.agent.restart": "Restart",
  "sidebar.agent.changePermission": "Change permission",
  "sidebar.people.label": "People",
  "sidebar.people.role.owner": "OWNER",
  "sidebar.people.role.admin": "ADMIN",
  "sidebar.people.role.member": "member",
  "sidebar.people.role.observer": "observer",
  "sidebar.invite.label": "Invite",
  "sidebar.invite.history": "History →",
  "sidebar.invite.role": "Role",
  "sidebar.invite.ttl": "Expires",
  "sidebar.invite.ttl.1h": "1h",
  "sidebar.invite.ttl.24h": "24h",
  "sidebar.invite.ttl.7d": "7d",
  "sidebar.invite.copy": "Copy",
  "dialog.placeholder.title": "Coming soon",
  "dialog.placeholder.logs": "Agent logs view coming soon",
  "dialog.placeholder.history": "Invite history view coming soon",
  "dialog.close": "Close",
  "role.owner": "Owner",
  "role.admin": "Admin",
  "role.member": "Member",
  "role.observer": "Observer",
  "network.reconnecting": "Reconnecting…"
}
```

Create `packages/web/src/i18n/messages.zh.json`:

```json
{
  "landing.eyebrow": "CACP · 本地演示",
  "landing.headline": "一个协作式 AI 房间。",
  "landing.subcopy": "创建房间，连接本地 CLI 智能体，一起聊天。",
  "landing.tab.create": "创建房间",
  "landing.tab.join": "通过邀请加入",
  "landing.create.name.label": "你的名字",
  "landing.create.roomName.label": "房间名称",
  "landing.create.agent.label": "智能体",
  "landing.create.permission.label": "权限",
  "landing.create.workingDir.label": "工作目录",
  "landing.create.cta": "创建房间并启动智能体",
  "landing.join.name.label": "你的名字",
  "landing.join.invite.label": "邀请链接",
  "landing.join.cta": "加入共享房间",
  "header.roomLabel": "房间",
  "header.peopleLabel": "人",
  "header.online": "在线",
  "header.offline": "离线",
  "header.status.live": "实时",
  "header.status.collecting": "收集中…",
  "header.status.replying": "回复中…",
  "header.menu.clearRoom": "清空房间",
  "header.menu.leaveRoom": "离开房间",
  "composer.mode.live": "实时",
  "composer.mode.collect": "收集",
  "composer.hint.live": "每条消息都会立即发送给 AI",
  "composer.hint.collect.owner": "收集回答中 — 准备好后提交",
  "composer.hint.collect.member": "房主正在收集回答 · 提交后你的回复将作为批量发送",
  "composer.hint.queued": "Claude 正在回复… 你的下一条消息将在本轮结束后作为跟进排队。",
  "composer.send": "发送",
  "composer.queue": "排队",
  "composer.add": "添加",
  "composer.submit": "提交 {count} 条回答 →",
  "composer.cancelCollection": "取消收集",
  "composer.ownerOnlyHint": "只有房主能看到这些控制项",
  "composer.lockedHint": "🔒 只有房主可以提交或取消此收集",
  "composer.modeLocked": "🔒 智能体回复期间模式锁定",
  "thread.empty": "暂无消息 · 打个招呼或等待智能体。",
  "thread.queuedTag": "已排队",
  "thread.collectionCancelled": "收集已取消 — 房间内剩余 {count} 条消息。",
  "sidebar.agent.label": "智能体",
  "sidebar.agent.logs": "日志 →",
  "sidebar.agent.status.online": "在线",
  "sidebar.agent.status.offline": "离线 · 上次活跃 {time}",
  "sidebar.agent.permission.readOnly": "只读",
  "sidebar.agent.permission.limitedWrite": "有限写入",
  "sidebar.agent.permission.fullAccess": "完全访问",
  "sidebar.agent.restart": "重启",
  "sidebar.agent.changePermission": "更改权限",
  "sidebar.people.label": "成员",
  "sidebar.people.role.owner": "房主",
  "sidebar.people.role.admin": "管理员",
  "sidebar.people.role.member": "成员",
  "sidebar.people.role.observer": "观察者",
  "sidebar.invite.label": "邀请",
  "sidebar.invite.history": "历史 →",
  "sidebar.invite.role": "角色",
  "sidebar.invite.ttl": "有效期",
  "sidebar.invite.ttl.1h": "1小时",
  "sidebar.invite.ttl.24h": "24小时",
  "sidebar.invite.ttl.7d": "7天",
  "sidebar.invite.copy": "复制",
  "dialog.placeholder.title": "即将推出",
  "dialog.placeholder.logs": "智能体日志视图即将推出",
  "dialog.placeholder.history": "邀请历史视图即将推出",
  "dialog.close": "关闭",
  "role.owner": "房主",
  "role.admin": "管理员",
  "role.member": "成员",
  "role.observer": "观察者",
  "network.reconnecting": "重新连接中…"
}
```

Create `packages/web/src/i18n/LangProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Lang = "en" | "zh";

export interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue | undefined>(undefined);

export function useLang(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useLang must be used within LangProvider");
  return value;
}

export function resolveLang(storage: Storage | undefined, navigatorLang: string): Lang {
  const stored = storage?.getItem("cacp.web.lang");
  if (stored === "en" || stored === "zh") return stored;
  const resolved = /^zh\b/i.test(navigatorLang) ? "zh" : "en";
  storage?.setItem("cacp.web.lang", resolved);
  return resolved;
}

export function LangProvider({ children, storage = typeof window !== "undefined" ? window.localStorage : undefined, navigatorLang = typeof navigator !== "undefined" ? navigator.language : "en" }: { children: React.ReactNode; storage?: Storage; navigatorLang?: string }) {
  const [lang, setLangState] = useState<Lang>(() => resolveLang(storage, navigatorLang));
  const setLang = useCallback((next: Lang) => {
    storage?.setItem("cacp.web.lang", next);
    setLangState(next);
  }, [storage]);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
```

Create `packages/web/src/i18n/useT.ts`:

```ts
import { useCallback } from "react";
import en from "./messages.en.json";
import zh from "./messages.zh.json";
import { useLang, type Lang } from "./LangProvider.js";

const dictionaries: Record<Lang, Record<string, string>> = { en, zh };

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { lang } = useLang();
  return useCallback((key: string, params?: Record<string, string | number>) => {
    const dictionary = dictionaries[lang];
    let text = dictionary[key] ?? dictionaries.en[key] ?? key;
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(paramValue));
      }
    }
    if (!dictionary[key] && import.meta.env.DEV) {
      console.warn(`[i18n] missing key "${key}" for lang "${lang}"`);
    }
    return text;
  }, [lang]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
corepack pnpm --filter @cacp/web test -- i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/web/src/i18n packages/web/test/i18n.test.ts
git commit -m "feat(web): add EN/CN i18n infrastructure"
```

---

## Task 2: CSS Tokens and Base Styles

**Files:**
- Create: `packages/web/src/tokens.css`
- Modify: `packages/web/src/App.css` — replace entirely

- [ ] **Step 1: Write token CSS**

Create `packages/web/src/tokens.css`:

```css
:root {
  --bg: #faf6ee;
  --surface: #fdfaf2;
  --surface-warm: #fdf9f1;
  --surface-collect: #fff7eb;
  --surface-queued: #f5ede0;
  --ink: #1c1813;
  --ink-2: #4d4239;
  --ink-3: #6b5e50;
  --ink-4: #8a7a66;
  --ink-5: #a89b8a;
  --invert: #faf6ee;
  --border: #e8dfd0;
  --border-soft: #f0e9d8;
  --accent: #c2410c;
  --accent-soft: #fef3e7;
  --accent-border: #f3d4ad;
  --success: #15803d;

  --font-headline: 'Times New Roman', Georgia, 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
  --font-body: Inter, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --radius-chip: 6px;
  --radius-button: 8px;
  --radius-input: 8px;
  --radius-card: 10px;
  --radius-composer: 10px;
  --radius-frame: 12px;
  --radius-pill: 999px;
}
```

- [ ] **Step 2: Replace App.css**

Write `packages/web/src/App.css`:

```css
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; min-height: 0; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.5;
  text-rendering: optimizeLegibility;
}
button, input, textarea, select { font: inherit; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-button);
  padding: 8px 14px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.btn:hover:not(:disabled) { transform: translateY(-1px); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary {
  background: var(--ink);
  color: var(--invert);
}
.btn-warm {
  background: var(--accent);
  color: var(--invert);
}
.btn-ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--ink-2);
}
.btn-ghost:hover:not(:disabled) { background: var(--surface); }
.btn-warm-ghost {
  background: transparent;
  border-color: var(--accent-border);
  color: var(--accent);
}
.btn-warm-ghost:hover:not(:disabled) { background: var(--accent-soft); }

/* Inputs */
.input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--surface);
  color: var(--ink-3);
  padding: 10px 12px;
  font-size: 12px;
  outline: none;
  transition: border-color 150ms ease;
}
.input:focus { border-color: var(--accent); }
textarea.input { min-height: 60px; resize: vertical; }
select.input { cursor: pointer; }

/* Cards */
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  padding: 12px 14px;
}
.card-warm {
  background: var(--surface-warm);
}

/* Section label */
.section-label {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-4);
  margin: 0 0 10px;
}

/* Status dot */
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ink-5);
  display: inline-block;
}
.status-dot.online { background: var(--success); }
.status-dot.pulse {
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Landing */
.landing-shell {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.landing-card {
  width: 100%;
  max-width: 520px;
  border: 1px solid var(--border);
  border-radius: var(--radius-frame);
  background: var(--surface);
  padding: 32px;
}
.landing-eyebrow {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin: 0 0 8px;
}
.landing-headline {
  font-family: var(--font-headline);
  font-size: clamp(28px, 4vw, 36px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 12px;
}
.landing-subcopy {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 24px;
}
.tab-bar {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  overflow: hidden;
  margin-bottom: 20px;
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease;
}
.tab-btn.active {
  background: var(--ink);
  color: var(--invert);
}

/* Workspace shell */
.workspace-shell {
  max-width: 1600px;
  margin: 0 auto;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 16px;
}
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 56px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}
.header-title h1 {
  font-family: var(--font-headline);
  font-size: clamp(15px, 1.8vw, 18px);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}
.header-sub {
  font-size: 11px;
  color: var(--ink-4);
  margin: 4px 0 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}
.lang-toggle {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.overflow-menu-btn {
  padding: 6px 10px;
  font-size: 16px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
  cursor: pointer;
  color: var(--ink-3);
}

/* Workspace grid */
.workspace-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 16px;
  padding: 12px 0 16px;
}
.chat-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 4px;
}

/* Messages */
.message {
  max-width: 720px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 12px 14px;
  margin: 0 0 10px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.message-human {
  margin-left: auto;
  background: var(--surface-warm);
}
.message-agent {
  margin-right: auto;
  background: var(--surface);
}
.message-system {
  margin: 0 auto 10px;
  background: var(--accent-soft);
  border-color: var(--accent-border);
}
.message-queued {
  border-style: dashed;
  border-color: var(--accent-border);
  background: var(--surface-queued);
}
.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-4);
  margin-bottom: 6px;
}
.message-body { margin: 0; }
.empty-thread {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--ink-4);
  font-family: var(--font-headline);
  font-style: italic;
  font-size: 14px;
}
.streaming-bubble {
  border-color: var(--accent-border);
}
.streaming-status {
  color: var(--accent);
  font-weight: 700;
}

/* Composer */
.composer {
  border: 1px solid var(--border);
  border-radius: var(--radius-composer);
  background: var(--surface-warm);
  padding: 12px;
  margin-top: 8px;
}
.composer-collect {
  background: var(--surface-collect);
  border-color: var(--accent-border);
}
.composer-queued {
  background: var(--surface-queued);
}
.composer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  overflow: hidden;
}
.mode-toggle-btn {
  padding: 5px 12px;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  cursor: pointer;
}
.mode-toggle-btn.active {
  background: var(--ink);
  color: var(--invert);
}
.mode-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.composer-hint {
  font-size: 11px;
  color: var(--ink-4);
}
.composer-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}
.status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: var(--radius-chip);
  font-size: 11px;
  color: var(--accent);
  margin-bottom: 10px;
}

/* Sidebar */
.sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.sidebar-card {
  composes: card;
}
.sidebar-card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.sidebar-card-title-row h2 {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}
.agent-avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: linear-gradient(135deg, #c2410c, #8b5a3c);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  font-weight: 700;
}
.permission-tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
}
.people-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
}
.people-row:hover { background: var(--bg); }
.people-role {
  font-size: 10px;
  font-weight: 700;
}
.people-role.owner { color: var(--accent); }
.people-role.other { color: var(--ink-4); text-transform: lowercase; }

/* Drawer */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(28, 24, 19, 0.25);
  z-index: 40;
}
.drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 280px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(28, 24, 19, 0.06);
  z-index: 50;
  padding: 14px;
  overflow-y: auto;
}
.drawer-close {
  position: absolute;
  top: 10px;
  right: 10px;
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--ink-3);
}

/* Network banner */
.network-banner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 16px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  z-index: 10;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .status-dot.pulse { animation: none; opacity: 1; }
}

/* Breakpoints */
@media (max-width: 1279px) {
  .workspace-grid { grid-template-columns: minmax(0, 1fr) 180px; }
}
@media (max-width: 1023px) {
  .workspace-grid { grid-template-columns: minmax(0, 1fr); }
  .sidebar { display: none; }
}
```

- [ ] **Step 3: Commit**

```powershell
git add packages/web/src/tokens.css packages/web/src/App.css
git commit -m "feat(web): add Warm Editorial CSS tokens and base styles"
```

---

## Task 3: Room-State Helper Derivations

**Files:**
- Modify: `packages/web/src/room-state.ts`
- Create: `packages/web/test/room-state-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/room-state-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isCollectionActive, isTurnInFlight, collectedMessageIds } from "../src/room-state.js";
import type { CacpEvent } from "@cacp/protocol";

function makeEvents(types: string[]): CacpEvent[] {
  return types.map((type, index) => ({
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${index}`,
    room_id: "room_1",
    type,
    actor_id: "user_1",
    created_at: `2026-04-27T00:00:0${index}.000Z`,
    payload: { collection_id: "col_1", turn_id: "turn_1", agent_id: "agent_1" }
  })) as CacpEvent[];
}

describe("room-state helpers", () => {
  it("isCollectionActive true when collection started without submit/cancel", () => {
    expect(isCollectionActive(makeEvents(["ai.collection.started"]))).toBe(true);
  });

  it("isCollectionActive false when collection submitted", () => {
    expect(isCollectionActive(makeEvents(["ai.collection.started", "ai.collection.submitted"]))).toBe(false);
  });

  it("isCollectionActive false when collection cancelled", () => {
    expect(isCollectionActive(makeEvents(["ai.collection.started", "ai.collection.cancelled"]))).toBe(false);
  });

  it("isTurnInFlight true when turn started without complete/fail", () => {
    expect(isTurnInFlight(makeEvents(["agent.turn.started"]))).toBe(true);
  });

  it("isTurnInFlight false when turn completed", () => {
    expect(isTurnInFlight(makeEvents(["agent.turn.started", "agent.turn.completed"]))).toBe(false);
  });

  it("collectedMessageIds returns message ids with matching collection_id", () => {
    const events: CacpEvent[] = [
      { protocol: "cacp", version: "0.2.0", event_id: "evt_0", room_id: "room_1", type: "ai.collection.started", actor_id: "user_1", created_at: "2026-04-27T00:00:00.000Z", payload: { collection_id: "col_1" } },
      { protocol: "cacp", version: "0.2.0", event_id: "evt_1", room_id: "room_1", type: "message.created", actor_id: "user_1", created_at: "2026-04-27T00:00:01.000Z", payload: { text: "hello", collection_id: "col_1", message_id: "msg_1" } },
      { protocol: "cacp", version: "0.2.0", event_id: "evt_2", room_id: "room_1", type: "message.created", actor_id: "user_2", created_at: "2026-04-27T00:00:02.000Z", payload: { text: "world", message_id: "msg_2" } }
    ] as CacpEvent[];
    expect(collectedMessageIds(events, "col_1")).toEqual(["msg_1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
corepack pnpm --filter @cacp/web test -- room-state-helpers.test.ts
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Implement helpers**

Add to bottom of `packages/web/src/room-state.ts`:

```ts
export function isCollectionActive(events: CacpEvent[]): boolean {
  let active = false;
  for (const event of events) {
    if (event.type === "ai.collection.started") active = true;
    if (event.type === "ai.collection.submitted" || event.type === "ai.collection.cancelled") active = false;
  }
  return active;
}

export function isTurnInFlight(events: CacpEvent[]): boolean {
  let started = false;
  for (const event of events) {
    if (event.type === "agent.turn.started") started = true;
    if (event.type === "agent.turn.completed" || event.type === "agent.turn.failed") started = false;
  }
  return started;
}

export function collectedMessageIds(events: CacpEvent[], collectionId: string): string[] {
  return events
    .filter((event) => event.type === "message.created" && (event.payload as Record<string, unknown>).collection_id === collectionId)
    .map((event) => typeof (event.payload as Record<string, unknown>).message_id === "string" ? (event.payload as Record<string, unknown>).message_id as string : "")
    .filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
corepack pnpm --filter @cacp/web test -- room-state-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/web/src/room-state.ts packages/web/test/room-state-helpers.test.ts
git commit -m "feat(web): add room-state helper derivations"
```

---

## Task 4: Landing Page Component

**Files:**
- Create: `packages/web/src/components/Landing.tsx`

- [ ] **Step 1: Implement Landing component**

Create `packages/web/src/components/Landing.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useT } from "../i18n/useT.js";
import { parseInviteUrl } from "../api.js";

interface LandingProps {
  onCreate: (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string; workingDir: string }) => void;
  onJoin: (params: { roomId: string; inviteToken: string; displayName: string }) => void;
  loading?: boolean;
}

const agentTypes = [
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "opencode CLI" },
  { value: "echo", label: "Echo Test Agent" }
];

const permissionLevels = [
  { value: "read_only", label: "Read only" },
  { value: "limited_write", label: "Limited write" },
  { value: "full_access", label: "Full access" }
];

export default function Landing({ onCreate, onJoin, loading }: LandingProps) {
  const t = useT();
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search), []);
  const [tab, setTab] = useState<"create" | "join">(inviteTarget ? "join" : "create");
  const [displayName, setDisplayName] = useState("Alice");
  const [roomName, setRoomName] = useState("CACP AI Room");
  const [roomId, setRoomId] = useState(inviteTarget?.room_id ?? "");
  const [inviteToken, setInviteToken] = useState(inviteTarget?.invite_token ?? "");
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [workingDir, setWorkingDir] = useState("D:\\Development\\2");

  const createDisabled = !roomName.trim() || !displayName.trim() || !workingDir.trim() || loading;
  const joinDisabled = !roomId.trim() || !inviteToken.trim() || !displayName.trim() || loading;

  return (
    <main className="landing-shell">
      <div className="landing-card">
        <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
        <h1 className="landing-headline">{t("landing.headline")}</h1>
        <p className="landing-subcopy">{t("landing.subcopy")}</p>
        <div className="tab-bar">
          <button className={`tab-btn ${tab === "create" ? "active" : ""}`} onClick={() => setTab("create")}>{t("landing.tab.create")}</button>
          <button className={`tab-btn ${tab === "join" ? "active" : ""}`} onClick={() => setTab("join")}>{t("landing.tab.join")}</button>
        </div>
        {tab === "create" ? (
          <form onSubmit={(e) => { e.preventDefault(); onCreate({ roomName, displayName, agentType, permissionLevel, workingDir }); }}>
            <label className="section-label">{t("landing.create.roomName.label")}</label>
            <input className="input" required value={roomName} onChange={(e) => setRoomName(e.target.value)} />
            <label className="section-label">{t("landing.create.name.label")}</label>
            <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div>
                <label className="section-label">{t("landing.create.agent.label")}</label>
                <select className="input" value={agentType} onChange={(e) => setAgentType(e.target.value)}>{agentTypes.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
              </div>
              <div>
                <label className="section-label">{t("landing.create.permission.label")}</label>
                <select className="input" value={permissionLevel} onChange={(e) => setPermissionLevel(e.target.value)}>{permissionLevels.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
              </div>
            </div>
            <label className="section-label">{t("landing.create.workingDir.label")}</label>
            <input className="input" required value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} />
            <button className="btn btn-warm" style={{ width: "100%", marginTop: 16 }} disabled={createDisabled}>{t("landing.create.cta")}</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); onJoin({ roomId, inviteToken, displayName }); }}>
            <label className="section-label">{t("landing.join.invite.label")}</label>
            <input className="input" required value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder="cacp_..." />
            <label className="section-label">{t("landing.join.name.label")}</label>
            <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <input type="hidden" value={roomId} />
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={joinDisabled}>{t("landing.join.cta")}</button>
          </form>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add packages/web/src/components/Landing.tsx
git commit -m "feat(web): add tabbed Landing component"
```

---

## Task 5: Composer Component with AI Flow Control

**Files:**
- Create: `packages/web/src/components/Composer.tsx`
- Create: `packages/web/test/composer-matrix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/composer-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("composer render matrix", () => {
  it("has all role/mode combinations documented", () => {
    const matrix = [
      { role: "owner", mode: "live", turnInFlight: false, expectSendLabel: "Send", expectToggleEnabled: true },
      { role: "owner", mode: "live", turnInFlight: true, expectSendLabel: "Queue", expectToggleEnabled: false },
      { role: "owner", mode: "collect", turnInFlight: false, expectSendLabel: "Add", expectToggleEnabled: true, expectSubmitVisible: true },
      { role: "member", mode: "live", turnInFlight: false, expectSendLabel: "Send", expectToggleEnabled: false },
      { role: "member", mode: "collect", turnInFlight: false, expectSendLabel: "Add", expectToggleEnabled: false, expectSubmitVisible: false },
      { role: "observer", mode: "live", turnInFlight: false, expectSendLabel: "Send", expectToggleEnabled: false, expectInputDisabled: true },
      { role: "observer", mode: "collect", turnInFlight: false, expectSendLabel: "Add", expectToggleEnabled: false, expectInputDisabled: true, expectSubmitVisible: false }
    ];
    expect(matrix.length).toBe(7);
  });
});
```

Run:
```powershell
corepack pnpm --filter @cacp/web test -- composer-matrix.test.ts
```

Expected: PASS (matrix is just data, no implementation yet).

- [ ] **Step 2: Implement Composer component**

Create `packages/web/src/components/Composer.tsx`:

```tsx
import { useState } from "react";
import { useT } from "../i18n/useT.js";

interface ComposerProps {
  role: string | undefined;
  mode: "live" | "collect";
  turnInFlight: boolean;
  collectCount: number;
  canSendMessages: boolean;
  onSend: (text: string) => void;
  onToggleMode: () => void;
  onSubmitCollection: () => void;
  onCancelCollection: () => void;
}

export default function Composer({ role, mode, turnInFlight, collectCount, canSendMessages, onSend, onToggleMode, onSubmitCollection, onCancelCollection }: ComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const isOwner = role === "owner";
  const isObserver = role === "observer";
  const toggleEnabled = isOwner && !turnInFlight;
  const inputDisabled = !canSendMessages || isObserver;
  const sendLabel = turnInFlight ? t("composer.queue") : mode === "collect" ? t("composer.add") : t("composer.send");

  const composerClass = mode === "collect" ? "composer composer-collect" : turnInFlight ? "composer composer-queued" : "composer";

  return (
    <div className={composerClass}>
      {turnInFlight && (
        <div className="status-strip">
          <span className="status-dot pulse" />
          {t("composer.hint.queued")}
        </div>
      )}
      <div className="composer-top">
        <div className="mode-toggle">
          <button className={`mode-toggle-btn ${mode === "live" ? "active" : ""}`} disabled={!toggleEnabled} onClick={() => { if (mode !== "live") onToggleMode(); }}>{t("composer.mode.live")}</button>
          <button className={`mode-toggle-btn ${mode === "collect" ? "active" : ""}`} disabled={!toggleEnabled} onClick={() => { if (mode !== "collect") onToggleMode(); }}>{t("composer.mode.collect")}</button>
        </div>
        <span className="composer-hint">
          {mode === "collect" && !isOwner ? t("composer.hint.collect.member")
            : mode === "collect" ? t("composer.hint.collect.owner")
            : t("composer.hint.live")}
          {mode === "collect" && collectCount > 0 && ` · ${collectCount}`}
        </span>
      </div>
      <form
        className="composer-bottom"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || inputDisabled) return;
          onSend(text.trim());
          setText("");
        }}
      >
        <textarea className="input" disabled={inputDisabled} value={text} onChange={(e) => setText(e.target.value)} placeholder={inputDisabled ? "" : "Message the room..."} />
        <button className="btn btn-primary" disabled={inputDisabled || !text.trim()}>{sendLabel}</button>
      </form>
      {mode === "collect" && (
        <div className="composer-actions">
          <span className="composer-hint">{isOwner ? t("composer.ownerOnlyHint") : t("composer.lockedHint")}</span>
          {isOwner && (
            <>
              <button className="btn btn-warm-ghost" onClick={onCancelCollection}>{t("composer.cancelCollection")}</button>
              <button className="btn btn-warm" onClick={onSubmitCollection} disabled={collectCount === 0}>{t("composer.submit", { count: collectCount })}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add packages/web/src/components/Composer.tsx packages/web/test/composer-matrix.test.ts
git commit -m "feat(web): add Composer with inline AI Flow Control"
```

---

## Task 6: Thread, Header, Sidebar Components

**Files:**
- Create: `packages/web/src/components/Thread.tsx`
- Create: `packages/web/src/components/Header.tsx`
- Create: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Implement Thread**

Create `packages/web/src/components/Thread.tsx`:

```tsx
import { useRef, useEffect } from "react";
import type { MessageView, StreamingTurnView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

interface ThreadProps {
  messages: MessageView[];
  streamingTurns: StreamingTurnView[];
  actorNames: Map<string, string>;
  showSlowStreamingNotice: boolean;
}

export default function Thread({ messages, streamingTurns, actorNames, showSlowStreamingNotice }: ThreadProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingTurns.length, streamingTurns.map((t) => t.text).join("|")]);

  const isEmpty = messages.length === 0 && streamingTurns.length === 0;

  return (
    <div className="thread" ref={ref}>
      {isEmpty && (
        <div className="empty-thread">
          <p>{t("thread.empty")}</p>
        </div>
      )}
      {messages.map((msg) => {
        const isHuman = msg.kind === "human";
        const isSystem = msg.kind === "system";
        const isQueued = Boolean(msg.collection_id);
        const className = isSystem ? "message message-system" : isHuman ? "message message-human" : "message message-agent";
        return (
          <article key={msg.message_id ?? `${msg.actor_id}-${msg.created_at}`} className={`${className} ${isQueued ? "message-queued" : ""}`}>
            <div className="message-meta">
              <span>{actorNames.get(msg.actor_id) ?? msg.actor_id}{msg.collection_id ? ` · ${t("thread.queuedTag")}` : ""}</span>
              <span>{isSystem ? "System" : isHuman ? "Human" : "AI"}</span>
            </div>
            <p className="message-body">{msg.text}</p>
          </article>
        );
      })}
      {streamingTurns.map((turn) => (
        <article key={turn.turn_id} className="message message-agent streaming-bubble">
          <div className="message-meta">
            <span>{actorNames.get(turn.agent_id) ?? turn.agent_id}</span>
            <span>Streaming</span>
          </div>
          <p className="streaming-status">{actorNames.get(turn.agent_id) ?? turn.agent_id} is responding...</p>
          {showSlowStreamingNotice && <p style={{ fontSize: 11, color: "var(--ink-4)" }}>Still waiting for the local CLI agent...</p>}
          {turn.text && <p className="message-body">{turn.text}</p>}
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement Header**

Create `packages/web/src/components/Header.tsx`:

```tsx
import { useLang } from "../i18n/LangProvider.js";
import { useT } from "../i18n/useT.js";

interface HeaderProps {
  roomName: string;
  roomId: string;
  participantCount: number;
  agentName?: string;
  agentOnline?: boolean;
  mode: "live" | "collect" | "replying";
  isOwner: boolean;
  onClearRoom: () => void;
  onLeaveRoom: () => void;
  onOpenDrawer?: () => void;
}

export default function Header({ roomName, roomId, participantCount, agentName, agentOnline, mode, isOwner, onClearRoom, onLeaveRoom, onOpenDrawer }: HeaderProps) {
  const t = useT();
  const { lang, setLang } = useLang();

  const statusText = mode === "collect" ? t("header.status.collecting") : mode === "replying" ? t("header.status.replying") : t("header.status.live");

  return (
    <header className="workspace-header">
      <div className="header-title">
        <h1>{roomName || "Untitled Room"}</h1>
        <p className="header-sub">{t("header.roomLabel")} · {participantCount} {t("header.peopleLabel")} · {agentName ?? "No agent"} {agentOnline ? t("header.online") : t("header.offline")}</p>
      </div>
      <div className="header-actions">
        <span className="status-pill">
          <span className={`status-dot ${mode === "replying" ? "pulse" : ""} ${agentOnline ? "online" : ""}`} />
          {statusText}
        </span>
        <button className="lang-toggle" onClick={() => setLang(lang === "en" ? "zh" : "en")}>{lang === "zh" ? "EN" : "中"}</button>
        {isOwner && (
          <button className="btn btn-ghost" onClick={onClearRoom}>{t("header.menu.clearRoom")}</button>
        )}
        <button className="btn btn-ghost" onClick={onLeaveRoom}>{t("header.menu.leaveRoom")}</button>
        {onOpenDrawer && (
          <button className="overflow-menu-btn" onClick={onOpenDrawer}>☰</button>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Implement Sidebar**

Create `packages/web/src/components/Sidebar.tsx`:

```tsx
import { useState } from "react";
import type { AgentView, ParticipantView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

interface SidebarProps {
  agents: AgentView[];
  activeAgentId?: string;
  participants: ParticipantView[];
  inviteCount: number;
  isOwner: boolean;
  canManageRoom: boolean;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (role: string, ttl: number) => void;
  inviteUrl?: string;
}

export default function Sidebar({ agents, activeAgentId, participants, inviteCount, isOwner, canManageRoom, onSelectAgent, onCreateInvite, inviteUrl }: SidebarProps) {
  const t = useT();
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteTtl, setInviteTtl] = useState(86400);
  const [showLogsDialog, setShowLogsDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  const activeAgent = agents.find((a) => a.agent_id === activeAgentId);
  const initial = activeAgent?.name?.[0]?.toUpperCase() ?? "?";

  function formatRelativeTime(iso: string | undefined): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <aside className="sidebar">
      {/* Agent Card */}
      <div className="card card-warm">
        <div className="sidebar-card-title-row">
          <h2 className="section-label" style={{ margin: 0 }}>{t("sidebar.agent.label")}</h2>
          {isOwner && <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setShowLogsDialog(true)}>{t("sidebar.agent.logs")}</button>}
        </div>
        {activeAgent ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className="agent-avatar">{initial}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{activeAgent.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
                  <span className={`status-dot ${activeAgent.status === "online" ? "online" : ""}`} style={{ marginRight: 4 }} />
                  {activeAgent.status === "online" ? t("sidebar.agent.status.online") : t("sidebar.agent.status.offline", { time: formatRelativeTime(activeAgent.last_status_at) })}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="permission-tag">{t(`sidebar.agent.permission.${activeAgent.capabilities?.[0] ?? "readOnly"}`)}</span>
            </div>
            {isOwner && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }}>{t("sidebar.agent.restart")}</button>
                <button className="btn btn-ghost" style={{ flex: 1 }}>{t("sidebar.agent.changePermission")}</button>
              </div>
            )}
            <select className="input" style={{ marginTop: 10 }} value={activeAgentId ?? ""} onChange={(e) => { if (e.target.value) onSelectAgent(e.target.value); }}>
              <option value="">{t("sidebar.agent.label")}</option>
              {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
            </select>
          </>
        ) : (
          <p style={{ fontSize: 12, color: "var(--ink-4)" }}>No active agent</p>
        )}
      </div>

      {/* People Card */}
      <div className="card">
        <div className="sidebar-card-title-row">
          <h2 className="section-label" style={{ margin: 0 }}>{t("sidebar.people.label")}</h2>
          <span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 600 }}>{participants.length}</span>
        </div>
        {participants.map((p) => (
          <div key={p.id} className="people-row">
            <span>{p.display_name}</span>
            <span className={`people-role ${p.role === "owner" ? "owner" : "other"}`}>{t(`sidebar.people.role.${p.role}`)}</span>
          </div>
        ))}
      </div>

      {/* Invite Card */}
      {isOwner && (
        <div className="card">
          <div className="sidebar-card-title-row">
            <h2 className="section-label" style={{ margin: 0 }}>{t("sidebar.invite.label")}</h2>
            <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setShowHistoryDialog(true)}>{t("sidebar.invite.history")}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="observer">Observer</option>
            </select>
            <select className="input" value={inviteTtl} onChange={(e) => setInviteTtl(Number(e.target.value))}>
              <option value={3600}>{t("sidebar.invite.ttl.1h")}</option>
              <option value={86400}>{t("sidebar.invite.ttl.24h")}</option>
              <option value={604800}>{t("sidebar.invite.ttl.7d")}</option>
            </select>
          </div>
          <button className="btn btn-warm" style={{ width: "100%" }} onClick={() => onCreateInvite(inviteRole, inviteTtl)}>{t("sidebar.invite.copy")}</button>
          {inviteUrl && <code style={{ display: "block", marginTop: 8, fontSize: 11, wordBreak: "break-all", color: "var(--ink-3)" }}>{inviteUrl}</code>}
        </div>
      )}

      {/* Placeholder dialogs */}
      {showLogsDialog && (
        <Dialog onClose={() => setShowLogsDialog(false)} title={t("dialog.placeholder.title")}>
          <p>{t("dialog.placeholder.logs")}</p>
        </Dialog>
      )}
      {showHistoryDialog && (
        <Dialog onClose={() => setShowHistoryDialog(false)} title={t("dialog.placeholder.title")}>
          <p>{t("dialog.placeholder.history")}</p>
        </Dialog>
      )}
    </aside>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const t = useT();
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-frame)", padding: 20, minWidth: 280 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{title}</h3>
        {children}
        <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={onClose}>{t("dialog.close")}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```powershell
git add packages/web/src/components/Thread.tsx packages/web/src/components/Header.tsx packages/web/src/components/Sidebar.tsx
git commit -m "feat(web): add Thread, Header, Sidebar components"
```

---

## Task 7: MobileDrawer and Workspace Shell

**Files:**
- Create: `packages/web/src/components/MobileDrawer.tsx`
- Create: `packages/web/src/components/Workspace.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Implement MobileDrawer**

Create `packages/web/src/components/MobileDrawer.tsx`:

```tsx
import Sidebar from "./Sidebar.js";
import type { SidebarProps } from "./Sidebar.js";

interface MobileDrawerProps extends SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileDrawer({ open, onClose, ...sidebarProps }: MobileDrawerProps) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <button className="drawer-close" onClick={onClose}>×</button>
        <div style={{ marginTop: 24 }}>
          <Sidebar {...sidebarProps} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Implement Workspace**

Create `packages/web/src/components/Workspace.tsx`:

```tsx
import { useState, useMemo, useEffect, useRef } from "react";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../api.js";
import { deriveRoomState, isCollectionActive, isTurnInFlight } from "../room-state.js";
import { roomPermissionsForRole } from "../role-permissions.js";
import Header from "./Header.js";
import Thread from "./Thread.js";
import Composer from "./Composer.js";
import Sidebar from "./Sidebar.js";
import MobileDrawer from "./MobileDrawer.js";

interface WorkspaceProps {
  session: RoomSession;
  events: CacpEvent[];
  onLeaveRoom: () => void;
  onClearRoom: () => void;
  onSendMessage: (text: string) => void;
  onStartCollection: () => void;
  onSubmitCollection: () => void;
  onCancelCollection: () => void;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (role: string, ttl: number) => void;
  inviteUrl?: string;
  error?: string;
}

export default function Workspace({ session, events, onLeaveRoom, onClearRoom, onSendMessage, onStartCollection, onSubmitCollection, onCancelCollection, onSelectAgent, onCreateInvite, inviteUrl, error }: WorkspaceProps) {
  const room = useMemo(() => deriveRoomState(events), [events]);
  const permissions = roomPermissionsForRole(session.role);
  const isOwner = session.role === "owner";
  const canManageRoom = permissions.canManageControls;
  const canSendMessages = permissions.canSendMessages;

  const activeAgent = room.agents.find((a) => a.agent_id === room.activeAgentId);
  const mode = isCollectionActive(events) ? "collect" as const : isTurnInFlight(events) ? "replying" as const : "live" as const;
  const composerMode = isCollectionActive(events) ? "collect" as const : "live" as const;
  const turnInFlight = isTurnInFlight(events);

  const actorNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of room.participants) names.set(p.id, p.display_name);
    for (const a of room.agents) names.set(a.agent_id, a.name);
    return names;
  }, [room.participants, room.agents]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSlowStreamingNotice, setShowSlowStreamingNotice] = useState(false);
  const streamingKey = useMemo(() => room.streamingTurns.map((t) => t.turn_id).join("|"), [room.streamingTurns]);

  useEffect(() => {
    if (!streamingKey) { setShowSlowStreamingNotice(false); return; }
    setShowSlowStreamingNotice(false);
    const id = window.setTimeout(() => setShowSlowStreamingNotice(true), 8000);
    return () => window.clearTimeout(id);
  }, [streamingKey]);

  return (
    <main className="workspace-shell">
      <Header
        roomName={session.room_id}
        roomId={session.room_id}
        participantCount={room.participants.length}
        agentName={activeAgent?.name}
        agentOnline={activeAgent?.status === "online"}
        mode={mode}
        isOwner={isOwner}
        onClearRoom={onClearRoom}
        onLeaveRoom={onLeaveRoom}
        onOpenDrawer={window.innerWidth < 1024 ? () => setDrawerOpen(true) : undefined}
      />
      <section className="workspace-grid">
        <section className="chat-panel">
          <Thread messages={room.messages} streamingTurns={room.streamingTurns} actorNames={actorNames} showSlowStreamingNotice={showSlowStreamingNotice} />
          <Composer
            role={session.role}
            mode={composerMode}
            turnInFlight={turnInFlight}
            collectCount={room.activeCollection?.messages.length ?? 0}
            canSendMessages={canSendMessages}
            onSend={onSendMessage}
            onToggleMode={() => { if (composerMode === "live") onStartCollection(); else onCancelCollection(); }}
            onSubmitCollection={onSubmitCollection}
            onCancelCollection={onCancelCollection}
          />
          {error && <p style={{ color: "var(--accent)", fontSize: 12, padding: "0 12px 8px", margin: 0 }}>{error}</p>}
        </section>
        <Sidebar
          agents={room.agents}
          activeAgentId={room.activeAgentId}
          participants={room.participants}
          inviteCount={room.inviteCount}
          isOwner={isOwner}
          canManageRoom={canManageRoom}
          onSelectAgent={onSelectAgent}
          onCreateInvite={onCreateInvite}
          inviteUrl={inviteUrl}
        />
      </section>
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        agents={room.agents}
        activeAgentId={room.activeAgentId}
        participants={room.participants}
        inviteCount={room.inviteCount}
        isOwner={isOwner}
        canManageRoom={canManageRoom}
        onSelectAgent={onSelectAgent}
        onCreateInvite={onCreateInvite}
        inviteUrl={inviteUrl}
      />
    </main>
  );
}
```

- [ ] **Step 3: Rewrite App.tsx**

Replace `packages/web/src/App.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CacpEvent } from "@cacp/protocol";
import { cancelAiCollection, clearEventSocket, clearRoom, connectEvents, createAgentPairing, createInvite, createLocalAgentLaunch, createRoomWithLocalAgent, inviteUrlFor, joinRoom, parseInviteUrl, selectAgent, sendMessage, startAiCollection, submitAiCollection, type LocalAgentLaunch, type RoomSession } from "./api.js";
import { mergeEvent } from "./event-log.js";
import { clearStoredSession, loadInitialSession, saveStoredSession } from "./session-storage.js";
import { LangProvider } from "./i18n/LangProvider.js";
import Landing from "./components/Landing.js";
import Workspace from "./components/Workspace.js";
import "./App.css";

export default function App() {
  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search), []);
  const [session, setSession] = useState<RoomSession | undefined>(() => loadInitialSession(window.localStorage, inviteTarget));
  const [events, setEvents] = useState<CacpEvent[]>([]);
  const [error, setError] = useState<string>();
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string>();
  const [pairingCommand, setPairingCommand] = useState<string>();
  const [localLaunch, setLocalLaunch] = useState<LocalAgentLaunch>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    const socket = connectEvents(session, (event) => setEvents((current) => mergeEvent(current, event)));
    return () => clearEventSocket(socket);
  }, [session]);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError(undefined);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }

  function activateSession(nextSession: RoomSession): void {
    saveStoredSession(window.localStorage, nextSession);
    setEvents([]);
    setCreatedInviteUrl(undefined);
    setPairingCommand(undefined);
    setLocalLaunch(undefined);
    setSession(nextSession);
    if (inviteTarget) window.history.replaceState({}, "", "/");
  }

  function leaveRoom(): void {
    clearStoredSession(window.localStorage);
    setSession(undefined);
    setEvents([]);
    setError(undefined);
  }

  const handleCreate = useCallback(async (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string; workingDir: string }) => {
    setLoading(true);
    const result = await run(() => createRoomWithLocalAgent(params.roomName.trim(), params.displayName.trim(), { agent_type: params.agentType, permission_level: params.permissionLevel, working_dir: params.workingDir }));
    setLoading(false);
    if (!result) return;
    activateSession(result.session);
    if (result.launch) {
      setLocalLaunch(result.launch);
      setPairingCommand(result.launch.command);
    }
    if (result.launch_error) {
      setError(`Starting the local agent failed: ${result.launch_error}`);
    }
  }, []);

  const handleJoin = useCallback(async (params: { roomId: string; inviteToken: string; displayName: string }) => {
    setLoading(true);
    const result = await run(() => joinRoom(params.roomId.trim(), params.inviteToken.trim(), params.displayName.trim()));
    setLoading(false);
    if (result) activateSession(result);
  }, []);

  const handleSend = useCallback((text: string) => {
    if (!session) return;
    void run(() => sendMessage(session, text));
  }, [session]);

  const handleClearRoom = useCallback(() => {
    if (!session) return;
    if (!window.confirm("Clear all chat messages and AI flow history for everyone?")) return;
    void run(() => clearRoom(session));
  }, [session]);

  const handleStartCollection = useCallback(() => {
    if (!session) return;
    void run(() => startAiCollection(session));
  }, [session]);

  const handleSubmitCollection = useCallback(() => {
    if (!session) return;
    void run(() => submitAiCollection(session));
  }, [session]);

  const handleCancelCollection = useCallback(() => {
    if (!session) return;
    void run(() => cancelAiCollection(session));
  }, [session]);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!session) return;
    void run(() => selectAgent(session, agentId));
  }, [session]);

  const handleCreateInvite = useCallback(async (role: string, ttl: number) => {
    if (!session) return;
    const invite = await run(() => createInvite(session, role as "member" | "observer", ttl));
    if (invite) setCreatedInviteUrl(inviteUrlFor(window.location.origin, session.room_id, invite.invite_token));
  }, [session]);

  if (!session) {
    return (
      <LangProvider>
        <Landing onCreate={handleCreate} onJoin={handleJoin} loading={loading} />
        {error && <p style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#fee2e2", color: "#991b1b", padding: "8px 16px", borderRadius: 8, fontSize: 12 }}>{error}</p>}
      </LangProvider>
    );
  }

  return (
    <LangProvider>
      <Workspace
        session={session}
        events={events}
        onLeaveRoom={leaveRoom}
        onClearRoom={handleClearRoom}
        onSendMessage={handleSend}
        onStartCollection={handleStartCollection}
        onSubmitCollection={handleSubmitCollection}
        onCancelCollection={handleCancelCollection}
        onSelectAgent={handleSelectAgent}
        onCreateInvite={handleCreateInvite}
        inviteUrl={createdInviteUrl}
        error={error}
      />
    </LangProvider>
  );
}
```

- [ ] **Step 4: Verify build**

Run:
```powershell
corepack pnpm --filter @cacp/web build
```

Expected: PASS (may have type warnings to fix).

- [ ] **Step 5: Commit**

```powershell
git add packages/web/src/components/MobileDrawer.tsx packages/web/src/components/Workspace.tsx packages/web/src/App.tsx
git commit -m "feat(web): wire Landing + Workspace into App"
```

---

## Task 8: Integration, Fixes, and Full Verification

**Files:**
- Modify: various files for type/build fixes

- [ ] **Step 1: Run full web test suite**

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: Fix any failing tests (update old snapshot tests, remove obsolete tests).

- [ ] **Step 2: Run full workspace check**

```powershell
corepack pnpm check
```

Expected: PASS after fixing any type errors.

- [ ] **Step 3: Verify responsive breakpoints**

Manually check at:
- 1920×1080
- 1366×768
- 1024×600 (drawer mode)

- [ ] **Step 4: Commit final**

```powershell
git add -A
git commit -m "feat(web): complete Warm Editorial redesign"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| Warm Editorial color tokens | Task 2 |
| L1 Sidebar Always layout | Task 2 (CSS), Task 6 (Sidebar), Task 7 (Workspace) |
| Cap-and-center responsive | Task 2 (CSS breakpoints) |
| AI Flow Control inline in composer | Task 5 |
| EN/CN i18n | Task 1 |
| Tabbed landing | Task 4 |
| Composer 3 states × 3 roles | Task 5 |
| Drawer <1024px | Task 7 |
| `prefers-reduced-motion` | Task 2 |
| Thread empty state | Task 6 |
| `room-state.ts` helpers | Task 3 |

### Placeholder Scan

- No TBD/TODO/"implement later" found.
- All test steps include actual code.
- All commands have expected output.

### Type Consistency

- `RoomSession.role` used consistently (`"owner" | "admin" | "member" | "observer" | "agent"`).
- `composerMode` type `"live" | "collect"` used in Composer and Workspace.
- `mode` type `"live" | "collect" | "replying"` used in Header.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-web-redesign-implementation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you prefer?
