# Homepage Logo Animation and Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the CACP web homepage into a premium animated hero with quick room creation, invite-link-only join flow, and responsive mobile polish.

**Architecture:** Keep the existing `Landing` public API and room creation/join handlers. Add a focused `CacpHeroLogo` component for the GSAP/SVG brand animation, rewrite `Landing` into a hero + console shell, and make responsive behavior CSS-driven. Preserve the current App/session/pairing flow so connection codes are still generated only after explicit room creation.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS, SVG, GSAP, pnpm workspace.

---

## File Structure

- Create `packages/web/src/components/CacpHeroLogo.tsx`
  - Owns the inline SVG logo markup and GSAP timeline lifecycle.
  - Exposes no props for this first version; uses CSS classes and reduced-motion detection internally.
- Modify `packages/web/src/components/Landing.tsx`
  - Owns homepage hero layout, quick-create form, advanced options toggle, and invite-link-only join card.
  - Continues to call `onCreate` and `onJoin` with existing shapes.
- Modify `packages/web/src/components/Header.tsx`
  - Adds class names for small-screen action visibility.
- Modify `packages/web/src/App.css`
  - Replaces the current landing styles with premium hero/console styles.
  - Adds responsive/mobile landing and light workspace mobile touch-up rules.
- Modify `packages/web/src/i18n/messages.en.json`
  - Adds homepage hero, value tags, advanced options, logo label, and invite-card copy.
  - Keeps existing create button copy to reduce churn.
- Modify `packages/web/src/i18n/messages.zh.json`
  - Adds matching keys for Chinese localization.
- Modify `packages/web/package.json` and `pnpm-lock.yaml`
  - Adds `gsap` dependency to `@cacp/web`.
- Create `packages/web/test/cacp-hero-logo.test.tsx`
  - Covers logo render, GSAP activation, and reduced-motion skip path.
- Create `packages/web/test/landing-redesign.test.tsx`
  - Covers ordinary homepage quick-create behavior and invite-link-only join behavior.
- Create `packages/web/test/landing-layout-source.test.ts`
  - Covers CSS/source-level requirements for premium layout, responsive breakpoints, reduced motion, and workspace mobile polish.
- Modify existing landing tests under `packages/web/test/`
  - Update assertions that previously expected visible join tabs or always-visible advanced controls.

---

### Task 1: Add GSAP dependency and animated logo component

**Files:**
- Create: `packages/web/test/cacp-hero-logo.test.tsx`
- Create: `packages/web/src/components/CacpHeroLogo.tsx`
- Modify: `packages/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing logo test**

Create `packages/web/test/cacp-hero-logo.test.tsx` with this content:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CacpHeroLogo from "../src/components/CacpHeroLogo.js";

const gsapMocks = vi.hoisted(() => {
  const timeline = { to: vi.fn() };
  timeline.to.mockImplementation(() => timeline);
  return {
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
    set: vi.fn(),
    timeline: vi.fn(() => timeline),
    to: vi.fn(),
    timelineTo: timeline.to,
  };
});

vi.mock("gsap", () => ({
  default: {
    context: gsapMocks.context,
    set: gsapMocks.set,
    timeline: gsapMocks.timeline,
    to: gsapMocks.to,
  },
}));

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("CacpHeroLogo", () => {
  beforeEach(() => {
    gsapMocks.context.mockClear();
    gsapMocks.set.mockClear();
    gsapMocks.timeline.mockClear();
    gsapMocks.to.mockClear();
    gsapMocks.timelineTo.mockClear();
    setReducedMotion(false);
  });

  it("renders the CACP protocol room logo with an accessible label", () => {
    render(<CacpHeroLogo />);

    expect(screen.getByLabelText("CACP protocol room logo")).toBeInTheDocument();
    expect(screen.getByText("CACP")).toBeInTheDocument();
  });

  it("starts the GSAP timeline when motion is allowed", () => {
    render(<CacpHeroLogo />);

    expect(gsapMocks.context).toHaveBeenCalledTimes(1);
    expect(gsapMocks.timeline).toHaveBeenCalledTimes(1);
    expect(gsapMocks.set).toHaveBeenCalled();
    expect(gsapMocks.to).toHaveBeenCalled();
  });

  it("skips the GSAP timeline when reduced motion is requested", () => {
    setReducedMotion(true);

    render(<CacpHeroLogo />);

    const logo = screen.getByLabelText("CACP protocol room logo") as HTMLElement;
    expect(logo.dataset.motion).toBe("reduced");
    expect(gsapMocks.context).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/protocol build
corepack pnpm --filter @cacp/web exec vitest run test/cacp-hero-logo.test.tsx
```

Expected: FAIL because `../src/components/CacpHeroLogo.js` does not exist.

- [ ] **Step 3: Add GSAP to the web package**

Run:

```powershell
corepack pnpm --filter @cacp/web add gsap
```

Expected: `packages/web/package.json` contains a `gsap` dependency and `pnpm-lock.yaml` changes.

- [ ] **Step 4: Create the animated logo component**

Create `packages/web/src/components/CacpHeroLogo.tsx` with this content:

```tsx
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function CacpHeroLogo() {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (prefersReducedMotion()) {
      root.dataset.motion = "reduced";
      return;
    }

    const ctx = gsap.context(() => {
      gsap.set(".logo-draw", { strokeDasharray: 260, strokeDashoffset: 260 });
      gsap.set(".logo-core, .logo-node, .logo-orbit-dot, .logo-wordmark", {
        opacity: 0,
        scale: 0.86,
        transformOrigin: "50% 50%",
      });

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .to(".logo-draw", { strokeDashoffset: 0, duration: 1.05, stagger: 0.08 })
        .to(".logo-core", { opacity: 1, scale: 1, duration: 0.45 }, "-=0.45")
        .to(".logo-node", { opacity: 1, scale: 1, duration: 0.36, stagger: 0.1 }, "-=0.2")
        .to(".logo-orbit-dot", { opacity: 1, scale: 1, duration: 0.28 }, "-=0.16")
        .to(".logo-wordmark", { opacity: 1, scale: 1, y: 0, duration: 0.42 }, "-=0.22");

      gsap.to(".logo-core", {
        opacity: 0.9,
        scale: 1.08,
        duration: 2.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to(".logo-node", {
        y: (index) => (index % 2 === 0 ? -3 : 3),
        duration: 3.6,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: 0.35,
      });
      gsap.to(".logo-orbit-dot", {
        rotate: 360,
        transformOrigin: "100px 100px",
        duration: 12,
        repeat: -1,
        ease: "none",
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className="cacp-hero-logo" aria-label="CACP protocol room logo">
      <svg className="cacp-hero-logo__mark" viewBox="0 0 200 200" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="cacp-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#c2410c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cacp-line" x1="30" y1="30" x2="170" y2="170">
            <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.2" />
            <stop offset="48%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#1c1813" stopOpacity="0.38" />
          </linearGradient>
        </defs>

        <rect className="logo-draw logo-frame" x="33" y="33" width="134" height="134" rx="36" />
        <path className="logo-draw logo-orbit" d="M57 111c18 42 77 48 104 12" />
        <path className="logo-draw logo-orbit" d="M143 89C125 47 66 41 39 77" />
        <path className="logo-draw logo-link" d="M100 100 68 66" />
        <path className="logo-draw logo-link" d="M100 100 144 84" />
        <path className="logo-draw logo-link" d="M100 100 90 151" />

        <circle className="logo-core logo-core-glow" cx="100" cy="100" r="36" />
        <circle className="logo-core logo-core-solid" cx="100" cy="100" r="13" />
        <circle className="logo-node" cx="68" cy="66" r="8" />
        <circle className="logo-node" cx="144" cy="84" r="8" />
        <circle className="logo-node" cx="90" cy="151" r="8" />

        <g className="logo-orbit-dot">
          <circle cx="152" cy="128" r="4" />
        </g>
      </svg>
      <div className="logo-wordmark" aria-hidden="true">
        <span>CACP</span>
        <small>AI ROOM PROTOCOL</small>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/cacp-hero-logo.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add packages/web/package.json pnpm-lock.yaml packages/web/src/components/CacpHeroLogo.tsx packages/web/test/cacp-hero-logo.test.tsx
git commit -m "feat(web): add animated CACP hero logo"
```

---

### Task 2: Redesign landing behavior for quick create and invite-link-only join

**Files:**
- Create: `packages/web/test/landing-redesign.test.tsx`
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Modify: `packages/web/test/landing-llm-agent.test.tsx`
- Modify: `packages/web/test/landing-connector.test.tsx`
- Modify: `packages/web/test/app-connector-modal.test.tsx`

- [ ] **Step 1: Write the failing landing redesign tests**

Create `packages/web/test/landing-redesign.test.tsx` with this content:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

function renderLanding(props: Partial<React.ComponentProps<typeof Landing>> = {}) {
  const onCreate = vi.fn();
  const onJoin = vi.fn();
  render(
    <LangProvider>
      <Landing onCreate={onCreate} onJoin={onJoin} loading={false} {...props} />
    </LangProvider>
  );
  return { onCreate, onJoin };
}

describe("Landing redesign", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  it("shows a focused quick-create card without ordinary invite controls", () => {
    renderLanding();

    expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create a collaborative AI room" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeRequired();
    expect(screen.getByLabelText("Room name")).toHaveValue("CACP AI Room");
    expect(screen.queryByRole("button", { name: "Join with invite" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();
  });

  it("keeps advanced agent and permission controls collapsed until requested", () => {
    renderLanding();

    expect(screen.queryByLabelText("Agent type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Advanced options: Agent type and permission" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Agent type")).toBeInTheDocument();
    expect(screen.getByLabelText("Permission")).toBeInTheDocument();
  });

  it("submits the quick-create defaults through the existing create handler", () => {
    const { onCreate } = renderLanding();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));

    expect(onCreate).toHaveBeenCalledWith({
      roomName: "CACP AI Room",
      displayName: "Owner",
      agentType: "claude-code",
      permissionLevel: "read_only",
    });
  });

  it("switches to an invite join card when opened from an invite link", () => {
    const { onJoin } = renderLandingWithInviteUrl();

    expect(screen.getByTestId("landing-invite-card")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-create-card")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join a shared AI room" })).toBeInTheDocument();
    expect(screen.getByText("Invited room: room_123")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Guest" } });
    fireEvent.click(screen.getByRole("button", { name: "Join shared room" }));

    expect(onJoin).toHaveBeenCalledWith({
      roomId: "room_123",
      inviteToken: "token_456",
      displayName: "Guest",
    });
  });
});

function renderLandingWithInviteUrl() {
  window.history.pushState({}, "", "/invite?room=room_123&token=token_456");
  return renderLanding();
}
```

- [ ] **Step 2: Run the focused landing tests to verify they fail**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-redesign.test.tsx
```

Expected: FAIL because the current landing page still renders tabs, manual invite controls, and no `landing-create-card`/`landing-invite-card` test ids.

- [ ] **Step 3: Update English homepage messages**

Modify `packages/web/src/i18n/messages.en.json` by replacing the existing landing headline/subcopy values and adding these keys in the landing section:

```json
  "landing.brand": "CACP",
  "landing.logoLabel": "CACP protocol room logo",
  "landing.headline": "Command a shared AI room from your local machine",
  "landing.subcopy": "Create a governed collaboration space, connect a local Claude Code or LLM agent, and bring teammates into the same live context.",
  "landing.value.local": "Local-first Agent",
  "landing.value.room": "Shared AI Room",
  "landing.value.governed": "Governed Collaboration",
  "landing.create.cardTitle": "Create a collaborative AI room",
  "landing.create.cardSubcopy": "Start with the essentials. Tune agent type and permissions only when you need them.",
  "landing.create.advancedToggle": "Advanced options: Agent type and permission",
  "landing.create.advancedHide": "Hide advanced options",
  "landing.create.advancedTitle": "Agent setup",
  "landing.join.cardTitle": "Join a shared AI room",
  "landing.join.cardSubcopy": "You are joining through an invite link. Enter your name to request access.",
  "landing.join.invitedRoom": "Invited room: {roomId}",
```

Keep these existing keys and values unchanged because existing handlers and tests use them:

```json
  "landing.create.cta": "Create room and start agent",
  "landing.create.cloudCta": "Create room and generate connector command",
  "landing.join.cta": "Join shared room",
```

- [ ] **Step 4: Update Chinese homepage messages**

Modify `packages/web/src/i18n/messages.zh.json` by adding the same keys with these values:

```json
  "landing.brand": "CACP",
  "landing.logoLabel": "CACP 协议房间 Logo",
  "landing.headline": "在本地机器上指挥共享 AI 房间",
  "landing.subcopy": "创建受管理的协作空间，连接本地 Claude Code 或 LLM Agent，让队友进入同一个实时上下文。",
  "landing.value.local": "本地优先 Agent",
  "landing.value.room": "共享 AI 房间",
  "landing.value.governed": "受控协作",
  "landing.create.cardTitle": "创建协作式 AI 房间",
  "landing.create.cardSubcopy": "先填写必要信息开始，需要时再调整 Agent 类型和权限。",
  "landing.create.advancedToggle": "高级选项：Agent 类型和权限",
  "landing.create.advancedHide": "收起高级选项",
  "landing.create.advancedTitle": "Agent 设置",
  "landing.join.cardTitle": "加入共享 AI 房间",
  "landing.join.cardSubcopy": "你正在通过邀请链接加入房间。输入名字后即可申请访问。",
  "landing.join.invitedRoom": "邀请房间：{roomId}",
```

- [ ] **Step 5: Replace `Landing.tsx` with the redesigned component**

Replace `packages/web/src/components/Landing.tsx` with this content:

```tsx
import { useContext, useEffect, useMemo, useState } from "react";
import { parseInviteUrl } from "../api.js";
import { LangContext } from "../i18n/LangProvider.js";
import { useT } from "../i18n/useT.js";
import { isCloudMode } from "../runtime-config.js";
import CacpHeroLogo from "./CacpHeroLogo.js";

interface LandingProps {
  onCreate: (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string }) => void;
  onJoin: (params: { roomId: string; inviteToken: string; displayName: string }) => void;
  loading?: boolean;
}

const commandAgentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode" }
] as const;

const llmAgentTypes = [
  { value: "llm-api", labelKey: "agentType.llmApi" },
  { value: "llm-openai-compatible", labelKey: "agentType.llmOpenAiCompatible" },
  { value: "llm-anthropic-compatible", labelKey: "agentType.llmAnthropicCompatible" }
] as const;
const llmAgentTypeValues = new Set<string>(llmAgentTypes.map((item) => item.value));

const permissionLevels = [
  { value: "read_only", labelKey: "permission.readOnly" },
  { value: "limited_write", labelKey: "permission.limitedWrite" },
  { value: "full_access", labelKey: "permission.fullAccess" }
] as const;

const valueTags = [
  { labelKey: "landing.value.local" },
  { labelKey: "landing.value.room" },
  { labelKey: "landing.value.governed" }
] as const;

export default function Landing({ onCreate, onJoin, loading }: LandingProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search) ?? parseInviteUrl(window.location.hash.replace(/^#/, "?")), []);
  const hasInviteInUrl = Boolean(inviteTarget);

  const [roomName, setRoomName] = useState("CACP AI Room");
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedLlmApiAgent = llmAgentTypeValues.has(agentType);
  const createValid = roomName.trim() && ownerDisplayName.trim();
  const joinValid = Boolean(inviteTarget && joinDisplayName.trim());

  useEffect(() => {
    if (hasInviteInUrl) setAdvancedOpen(false);
  }, [hasInviteInUrl]);

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!createValid || loading) return;
    onCreate({
      roomName: roomName.trim(),
      displayName: ownerDisplayName.trim(),
      agentType,
      permissionLevel: selectedLlmApiAgent ? "read_only" : permissionLevel
    });
  }

  function handleJoinSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!joinValid || loading || !inviteTarget) return;
    onJoin({
      roomId: inviteTarget.room_id,
      inviteToken: inviteTarget.invite_token,
      displayName: joinDisplayName.trim()
    });
  }

  return (
    <main className={`landing-shell ${hasInviteInUrl ? "landing-shell-invite" : ""}`}>
      <div className="landing-orb landing-orb-primary" aria-hidden="true" />
      <div className="landing-orb landing-orb-secondary" aria-hidden="true" />

      <div className="landing-topbar">
        <div className="landing-mini-brand" aria-label={t("landing.brand")}>
          <span className="landing-mini-mark">C</span>
          <span>{t("landing.brand")}</span>
        </div>
        <button
          type="button"
          className="lang-toggle"
          onClick={() => langCtx?.setLang(langCtx.lang === "en" ? "zh" : "en")}
          title={t("lang.toggle")}
          aria-label={t("lang.toggle")}
        >
          {t("lang.en")} / {t("lang.zh")}
        </button>
      </div>

      <section className="landing-hero-grid">
        <div className="landing-showcase">
          <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
          <CacpHeroLogo />
          <h1 className="landing-headline">{t("landing.headline")}</h1>
          <p className="landing-subcopy">{t("landing.subcopy")}</p>
          <div className="landing-value-tags" aria-label="CACP values">
            {valueTags.map((item) => (
              <span key={item.labelKey} className="landing-value-tag">{t(item.labelKey)}</span>
            ))}
          </div>
        </div>

        <article className="landing-card landing-console" aria-labelledby={hasInviteInUrl ? "landing-invite-title" : "landing-create-title"}>
          {hasInviteInUrl && inviteTarget ? (
            <form data-testid="landing-invite-card" className="landing-form" onSubmit={handleJoinSubmit}>
              <p className="landing-console-kicker">{t("landing.tab.join")}</p>
              <h2 id="landing-invite-title" className="landing-console-title">{t("landing.join.cardTitle")}</h2>
              <p className="landing-console-copy">{t("landing.join.cardSubcopy")}</p>

              <label className="section-label" htmlFor="landing-join-display-name">{t("landing.join.displayName")}</label>
              <input
                id="landing-join-display-name"
                className="input landing-input"
                value={joinDisplayName}
                onChange={(e) => setJoinDisplayName(e.target.value)}
                required
                autoComplete="name"
              />

              <p className="landing-room-hint">{t("landing.join.invitedRoom", { roomId: inviteTarget.room_id })}</p>

              <button type="submit" className="btn btn-primary landing-primary-action" disabled={!joinValid || loading}>
                {t("landing.join.cta")}
              </button>
            </form>
          ) : (
            <form data-testid="landing-create-card" className="landing-form" onSubmit={handleCreateSubmit}>
              <p className="landing-console-kicker">{t("room.create")}</p>
              <h2 id="landing-create-title" className="landing-console-title">{t("landing.create.cardTitle")}</h2>
              <p className="landing-console-copy">{t("landing.create.cardSubcopy")}</p>

              <label className="section-label" htmlFor="landing-display-name">{t("landing.create.displayName")}</label>
              <input
                id="landing-display-name"
                className="input landing-input"
                value={ownerDisplayName}
                onChange={(e) => setOwnerDisplayName(e.target.value)}
                required
                autoComplete="name"
              />

              <label className="section-label" htmlFor="landing-room-name">{t("landing.create.roomName")}</label>
              <input
                id="landing-room-name"
                className="input landing-input"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
              />

              <button
                type="button"
                className="landing-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="landing-advanced-options"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <span>{advancedOpen ? t("landing.create.advancedHide") : t("landing.create.advancedToggle")}</span>
                <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
              </button>

              <div id="landing-advanced-options" className="landing-advanced" hidden={!advancedOpen}>
                <p className="section-label">{t("landing.create.advancedTitle")}</p>

                <label className="section-label" htmlFor="landing-agent-type">{t("landing.create.agentType")}</label>
                <select
                  id="landing-agent-type"
                  className="input landing-input"
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                >
                  <optgroup label={t("agentType.group.localCommand")}>
                    {commandAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                  </optgroup>
                  <optgroup label={t("agentType.group.llmApi")}>
                    {llmAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                  </optgroup>
                </select>

                {!selectedLlmApiAgent && (
                  <>
                    <label className="section-label" htmlFor="landing-permission-level">{t("landing.create.permissionLevel")}</label>
                    <select
                      id="landing-permission-level"
                      className="input landing-input"
                      value={permissionLevel}
                      onChange={(e) => setPermissionLevel(e.target.value)}
                    >
                      {permissionLevels.map((item) => (
                        <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                      ))}
                    </select>
                  </>
                )}

                {selectedLlmApiAgent && (
                  <p className="landing-safe-copy">{t("landing.create.llmApiKeyLocalOnly")}</p>
                )}

                {isCloudMode() && (
                  <div className="connector-setup landing-connector-setup">
                    <a className="btn btn-ghost" href="/downloads/CACP-Local-Connector.exe" download>
                      {t("landing.connector.download")}
                    </a>
                    <p className="landing-safe-copy">
                      {selectedLlmApiAgent ? t("landing.connector.llmInstructions") : t("landing.connector.instructions")}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-warm landing-primary-action"
                disabled={!createValid || loading}
              >
                {isCloudMode() ? t("landing.create.cloudCta") : t("landing.create.cta")}
              </button>
              {isCloudMode() && (
                <p className="landing-safe-copy landing-cloud-hint">{t("landing.create.cloudAgentHint")}</p>
              )}
            </form>
          )}
        </article>
      </section>

      <footer className="landing-footer">
        <span>{t("landing.footer.copyright")}</span>
        <span>{t("landing.footer.contact")}</span>
      </footer>
    </main>
  );
}
```

- [ ] **Step 6: Update existing landing tests for collapsed advanced options and removed ordinary join tab**

In `packages/web/test/landing-llm-agent.test.tsx`, click the advanced toggle before any assertion or change involving `Agent type` or `Permission`. Use this helper inside the file:

```tsx
function openAdvancedOptions() {
  fireEvent.click(screen.getByRole("button", { name: "Advanced options: Agent type and permission" }));
}
```

Change each test body so it opens advanced options after rendering:

```tsx
render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
openAdvancedOptions();
expect(screen.getByRole("group", { name: "Local Claude Code" })).toBeInTheDocument();
```

For the submit test, keep the name input before opening advanced options:

```tsx
const onCreate = vi.fn();
render(<LangProvider><Landing onCreate={onCreate} onJoin={() => {}} /></LangProvider>);
fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
openAdvancedOptions();
fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-api" } });
fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));
expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agentType: "llm-api", permissionLevel: "read_only" }));
```

In `packages/web/test/landing-connector.test.tsx`, update the cloud connector setup test so it opens advanced options before looking for the download link:

```tsx
render(
  <LangProvider>
    <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
  </LangProvider>
);
fireEvent.click(screen.getByRole("button", { name: "Advanced options: Agent type and permission" }));
expect(screen.getByRole("link", { name: "Download Local Connector" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
```

Replace the old assertion that clicked `Join with invite` with these ordinary-homepage assertions:

```tsx
const createName = screen.getByLabelText("Your name") as HTMLInputElement;
expect(createName).toHaveValue("");
expect(createName).toBeRequired();
expect(screen.getByRole("button", { name: "Create room and generate connector command" })).toBeDisabled();
expect(screen.queryByRole("button", { name: "Join with invite" })).not.toBeInTheDocument();
expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Room ID")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();

fireEvent.change(createName, { target: { value: "Alice" } });
expect(screen.getByRole("button", { name: "Create room and generate connector command" })).not.toBeDisabled();
```

In `packages/web/test/app-connector-modal.test.tsx`, no flow change is required beyond keeping the button label assertion unchanged:

```tsx
fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
fireEvent.click(screen.getByRole("button", { name: "Create room and generate connector command" }));
```

- [ ] **Step 7: Run landing-focused tests to verify they pass**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-redesign.test.tsx test/landing-llm-agent.test.tsx test/landing-connector.test.tsx test/app-connector-modal.test.tsx test/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
git add packages/web/src/components/Landing.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/landing-redesign.test.tsx packages/web/test/landing-llm-agent.test.tsx packages/web/test/landing-connector.test.tsx packages/web/test/app-connector-modal.test.tsx
git commit -m "feat(web): redesign landing quick start flow"
```

---

### Task 3: Add premium homepage CSS and responsive landing tests

**Files:**
- Create: `packages/web/test/landing-layout-source.test.ts`
- Modify: `packages/web/src/App.css`

- [ ] **Step 1: Write the failing layout source test**

Create `packages/web/test/landing-layout-source.test.ts` with this content:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("landing redesign source", () => {
  const cssSource = () => readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
  const landingSource = () => readFileSync(resolve(process.cwd(), "src/components/Landing.tsx"), "utf8");
  const logoSource = () => readFileSync(resolve(process.cwd(), "src/components/CacpHeroLogo.tsx"), "utf8");

  it("uses the hero showcase and quick-start console classes", () => {
    const source = landingSource();
    expect(source).toContain("landing-hero-grid");
    expect(source).toContain("landing-showcase");
    expect(source).toContain("landing-console");
    expect(source).toContain("landing-advanced-toggle");
    expect(source).not.toContain("tab-bar");
  });

  it("defines a fixed desktop landing shell with internal card overflow", () => {
    const source = cssSource();
    expect(source).toMatch(/\.landing-shell\s*\{[^}]*height:\s*100dvh/s);
    expect(source).toMatch(/\.landing-shell\s*\{[^}]*overflow:\s*hidden/s);
    expect(source).toMatch(/\.landing-hero-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(340px,\s*440px\)/s);
    expect(source).toMatch(/\.landing-console\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("defines responsive mobile landing and reduced-motion rules", () => {
    const source = cssSource();
    expect(source).toContain("@media (max-width: 767px)");
    expect(source).toMatch(/@media \(max-width:\s*767px\)[\s\S]*\.landing-hero-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
    expect(source).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.landing-orb/s);
  });

  it("keeps SVG animation classes isolated in the hero logo component", () => {
    const source = logoSource();
    expect(source).toContain("logo-draw");
    expect(source).toContain("logo-core");
    expect(source).toContain("gsap.context");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });
});
```

- [ ] **Step 2: Run the layout source test to verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-layout-source.test.ts
```

Expected: FAIL because the premium landing CSS classes and breakpoint rules are not present yet.

- [ ] **Step 3: Replace the landing CSS region**

In `packages/web/src/App.css`, replace the current block from `/* Landing */` through `.tab-btn.active` with this block:

```css
/* Landing */
.landing-shell {
  position: relative;
  z-index: 1;
  width: min(1220px, calc(100% - 32px));
  height: 100dvh;
  min-height: 640px;
  margin: 0 auto;
  padding: 20px 0 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  isolation: isolate;
}

.landing-shell::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -3;
  background:
    linear-gradient(rgba(194, 65, 12, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(194, 65, 12, 0.055) 1px, transparent 1px),
    radial-gradient(circle at 18% 22%, rgba(249, 115, 22, 0.18), transparent 32%),
    radial-gradient(circle at 82% 72%, rgba(124, 45, 18, 0.12), transparent 34%),
    var(--bg);
  background-size: 42px 42px, 42px 42px, auto, auto, auto;
}

.landing-shell::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, rgba(255, 247, 237, 0.18) 45%, rgba(249, 115, 22, 0.16) 50%, transparent 56%);
  transform: translateX(-34%);
  animation: landing-sheen 14s ease-in-out infinite;
}

.landing-orb {
  position: fixed;
  z-index: -1;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  filter: blur(48px);
  opacity: 0.48;
  pointer-events: none;
  transform: translate3d(0, 0, 0);
}

.landing-orb-primary {
  left: max(24px, calc((100vw - 1220px) / 2));
  top: 9%;
  background: rgba(249, 115, 22, 0.32);
  animation: landing-orb-float 15s ease-in-out infinite;
}

.landing-orb-secondary {
  right: max(24px, calc((100vw - 1220px) / 2));
  bottom: 8%;
  background: rgba(124, 45, 18, 0.18);
  animation: landing-orb-float 18s ease-in-out infinite reverse;
}

.landing-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-shrink: 0;
}

.landing-mini-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: var(--ink-2);
}

.landing-mini-mark {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(194, 65, 12, 0.34);
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  background: rgba(253, 250, 242, 0.72);
  box-shadow: 0 12px 34px rgba(194, 65, 12, 0.12);
}

.landing-hero-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(340px, 440px);
  gap: clamp(24px, 5vw, 72px);
  align-items: center;
}

.landing-showcase {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.landing-card,
.landing-console {
  position: relative;
  border: 1px solid rgba(232, 223, 208, 0.82);
  border-radius: 24px;
  background: linear-gradient(145deg, rgba(253, 250, 242, 0.92), rgba(253, 249, 241, 0.82));
  padding: clamp(18px, 2.3vw, 26px);
  max-height: min(620px, calc(100dvh - 116px));
  overflow-y: auto;
  box-shadow: 0 28px 90px rgba(28, 24, 19, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(18px);
}

.landing-console::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.44), transparent 32%, rgba(28, 24, 19, 0.12));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.landing-eyebrow,
.landing-console-kicker {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent);
}

.landing-headline {
  font-size: clamp(40px, 6vw, 76px);
  letter-spacing: -0.06em;
  line-height: 0.95;
  max-width: 820px;
  margin-top: 18px;
}

.landing-subcopy {
  font-size: clamp(15px, 1.4vw, 18px);
  line-height: 1.7;
  color: var(--ink-2);
  max-width: 640px;
  margin-top: 18px;
}

.landing-value-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.landing-value-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(194, 65, 12, 0.2);
  border-radius: var(--radius-pill);
  padding: 7px 11px;
  color: var(--ink-2);
  background: rgba(253, 250, 242, 0.68);
  box-shadow: 0 10px 30px rgba(194, 65, 12, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.landing-value-tag::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 14px rgba(249, 115, 22, 0.85);
}

.cacp-hero-logo {
  width: min(460px, 88vw);
  display: flex;
  align-items: center;
  gap: 18px;
  color: var(--ink);
}

.cacp-hero-logo__mark {
  width: clamp(142px, 18vw, 220px);
  height: auto;
  overflow: visible;
  filter: drop-shadow(0 26px 55px rgba(194, 65, 12, 0.18));
}

.logo-frame,
.logo-orbit,
.logo-link {
  fill: none;
  stroke: url(#cacp-line);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.logo-link {
  stroke-width: 1.4;
  opacity: 0.74;
}

.logo-core-glow {
  fill: url(#cacp-core-glow);
}

.logo-core-solid,
.logo-node,
.logo-orbit-dot circle {
  fill: var(--accent);
  filter: drop-shadow(0 0 14px rgba(249, 115, 22, 0.72));
}

.logo-node {
  stroke: rgba(253, 250, 242, 0.95);
  stroke-width: 3;
}

.logo-wordmark {
  display: flex;
  flex-direction: column;
  gap: 4px;
  transform: translateY(8px);
}

.logo-wordmark span {
  font-family: var(--font-headline);
  font-size: clamp(42px, 5.4vw, 70px);
  letter-spacing: -0.07em;
  line-height: 0.9;
}

.logo-wordmark small {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  color: var(--accent);
}

.landing-console-title {
  font-size: clamp(24px, 2.6vw, 34px);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.landing-console-copy {
  margin: 10px 0 18px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.landing-form {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.landing-input {
  background: rgba(253, 250, 242, 0.82);
}

.landing-advanced-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0;
  border: 1px solid rgba(232, 223, 208, 0.9);
  border-radius: var(--radius-button);
  padding: 10px 12px;
  color: var(--ink-2);
  background: rgba(253, 249, 241, 0.72);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.landing-advanced-toggle:hover {
  color: var(--ink);
  border-color: rgba(194, 65, 12, 0.36);
}

.landing-advanced {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 12px;
  background: rgba(253, 249, 241, 0.58);
}

.landing-advanced[hidden] {
  display: none;
}

.landing-connector-setup {
  margin-top: 2px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  background: rgba(255, 247, 235, 0.72);
}

.landing-safe-copy,
.landing-room-hint {
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-3);
}

.landing-cloud-hint {
  text-align: center;
}

.landing-primary-action {
  position: relative;
  width: 100%;
  min-height: 44px;
  margin-top: 6px;
  overflow: hidden;
  box-shadow: 0 14px 34px rgba(194, 65, 12, 0.24);
}

.landing-primary-action::after {
  content: "";
  position: absolute;
  inset: -40% auto -40% -30%;
  width: 28%;
  transform: rotate(18deg) translateX(-120%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transition: transform 520ms ease;
}

.landing-primary-action:hover::after,
.landing-primary-action:focus-visible::after {
  transform: rotate(18deg) translateX(520%);
}

.landing-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 14px;
  text-align: center;
  color: var(--ink-4);
  font-size: 11px;
  line-height: 1.5;
}

@keyframes landing-sheen {
  0%, 42% { transform: translateX(-38%); opacity: 0; }
  52% { opacity: 1; }
  64%, 100% { transform: translateX(38%); opacity: 0; }
}

@keyframes landing-orb-float {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(18px, -14px, 0) scale(1.08); }
}
```

- [ ] **Step 4: Add the responsive landing CSS block**

Append this block after the landing CSS block in `packages/web/src/App.css`:

```css
@media (max-width: 1023px) {
  .landing-shell {
    width: min(760px, calc(100% - 28px));
    min-height: 100dvh;
    height: auto;
    justify-content: flex-start;
    overflow-y: auto;
    padding: 18px 0;
  }

  .landing-hero-grid {
    grid-template-columns: 1fr;
    gap: 22px;
  }

  .landing-showcase {
    align-items: center;
    text-align: center;
  }

  .landing-value-tags {
    justify-content: center;
  }

  .landing-card,
  .landing-console {
    max-height: none;
  }
}

@media (max-width: 767px) {
  .landing-shell {
    width: min(100% - 22px, 560px);
    padding: 12px 0 16px;
  }

  .landing-topbar {
    margin-bottom: 12px;
  }

  .landing-mini-brand {
    letter-spacing: 0.1em;
  }

  .landing-eyebrow {
    font-size: 9px;
    margin-bottom: 6px;
  }

  .cacp-hero-logo {
    width: min(100%, 360px);
    justify-content: center;
    gap: 10px;
  }

  .cacp-hero-logo__mark {
    width: 118px;
  }

  .logo-wordmark span {
    font-size: 42px;
  }

  .landing-headline {
    font-size: clamp(34px, 11vw, 48px);
    margin-top: 10px;
  }

  .landing-subcopy {
    font-size: 14px;
    line-height: 1.55;
    margin-top: 12px;
  }

  .landing-value-tags {
    margin-top: 16px;
    gap: 8px;
  }

  .landing-value-tag {
    padding: 6px 9px;
    font-size: 11px;
  }

  .landing-card,
  .landing-console {
    border-radius: 18px;
    padding: 16px;
  }

  .landing-console-title {
    font-size: 24px;
  }

  .landing-input,
  .landing-primary-action,
  .landing-advanced-toggle {
    min-height: 46px;
  }

  .landing-shell::after,
  .landing-orb-secondary {
    display: none;
  }

  .landing-footer {
    flex-direction: column;
    gap: 2px;
  }
}

@media (max-width: 420px) {
  .logo-wordmark small {
    display: none;
  }

  .landing-subcopy {
    max-width: 32ch;
  }

  .landing-value-tags {
    display: none;
  }
}
```

- [ ] **Step 5: Extend the existing reduced-motion block**

In the existing `@media (prefers-reduced-motion: reduce)` block, keep `.status-dot.pulse` and add these rules:

```css
  .landing-shell::after,
  .landing-orb,
  .landing-primary-action::after {
    animation: none;
    transition: none;
  }

  .landing-orb {
    opacity: 0.18;
  }
```

- [ ] **Step 6: Run the layout source test to verify it passes**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-layout-source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add packages/web/src/App.css packages/web/test/landing-layout-source.test.ts
git commit -m "feat(web): add premium responsive landing styles"
```

---

### Task 4: Add mobile room touch-ups for header and composer

**Files:**
- Modify: `packages/web/src/components/Header.tsx`
- Modify: `packages/web/src/App.css`
- Modify: `packages/web/test/landing-layout-source.test.ts`

- [ ] **Step 1: Extend the source test for workspace mobile polish**

Append this test to `packages/web/test/landing-layout-source.test.ts` inside the existing `describe` block:

```ts
  it("adds small-screen workspace header and composer polish", () => {
    const css = cssSource();
    const header = readFileSync(resolve(process.cwd(), "src/components/Header.tsx"), "utf8");

    expect(header).toContain("header-danger-action");
    expect(css).toMatch(/@media \(max-width:\s*767px\)[\s\S]*\.workspace-header/s);
    expect(css).toMatch(/@media \(max-width:\s*767px\)[\s\S]*\.header-danger-action\s*\{[\s\S]*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*767px\)[\s\S]*\.composer-bottom\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
  });
```

- [ ] **Step 2: Run the source test to verify it fails**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-layout-source.test.ts
```

Expected: FAIL because `header-danger-action` and mobile workspace CSS are not present.

- [ ] **Step 3: Add a class to the owner-only clear-room button**

In `packages/web/src/components/Header.tsx`, replace this button:

```tsx
<button
  type="button"
  className="btn btn-ghost"
  style={{ color: "var(--danger)" }}
  onClick={onClearRoom}
>
  {t("room.clear")}
</button>
```

with this button:

```tsx
<button
  type="button"
  className="btn btn-ghost header-danger-action"
  style={{ color: "var(--danger)" }}
  onClick={onClearRoom}
>
  {t("room.clear")}
</button>
```

- [ ] **Step 4: Append mobile workspace CSS inside the `@media (max-width: 767px)` block**

Add these rules to the existing `@media (max-width: 767px)` block in `packages/web/src/App.css`:

```css
  .workspace-shell {
    width: calc(100% - 16px);
    padding: 8px 0;
  }

  .workspace-header {
    min-height: 56px;
    padding: 10px 12px;
    gap: 10px;
  }

  .header-title {
    min-width: 0;
  }

  .header-title h2 {
    max-width: 52vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
  }

  .header-sub {
    max-width: 56vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-actions {
    gap: 6px;
    flex-wrap: nowrap;
  }

  .header-danger-action {
    display: none;
  }

  .status-pill,
  .lang-toggle {
    padding: 6px 8px;
    font-size: 11px;
  }

  .composer {
    padding: 10px 12px;
  }

  .composer-top {
    align-items: flex-start;
    gap: 8px;
  }

  .composer-hint {
    display: none;
  }

  .composer-bottom {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .composer-actions {
    width: 100%;
  }

  .composer-actions .btn {
    width: 100%;
    min-height: 42px;
  }
```

- [ ] **Step 5: Run the source test to verify it passes**

Run:

```powershell
corepack pnpm --filter @cacp/web exec vitest run test/landing-layout-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add packages/web/src/components/Header.tsx packages/web/src/App.css packages/web/test/landing-layout-source.test.ts
git commit -m "feat(web): improve mobile room layout"
```

---

### Task 5: Final validation and cleanup

**Files:**
- Verify all changed files from Tasks 1-4.
- Modify only files with failing validation results.

- [ ] **Step 1: Run all web tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: PASS.

- [ ] **Step 2: Run the web build**

Run:

```powershell
corepack pnpm --filter @cacp/web build
```

Expected: PASS and Vite emits a production build.

- [ ] **Step 3: Run the repository check**

Run:

```powershell
corepack pnpm check
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for scope control**

Run:

```powershell
git diff --stat HEAD~4..HEAD
git status --short
```

Expected: the diff only includes the web homepage/logo/mobile files, web tests, i18n JSON files, `packages/web/package.json`, and `pnpm-lock.yaml`; status is clean.

- [ ] **Step 5: Commit validation fixes when files changed during Task 5**

When validation changed source or test files, run:

```powershell
git add packages/web/src packages/web/test packages/web/package.json pnpm-lock.yaml
git commit -m "fix(web): finalize homepage redesign validation"
```

Expected: a commit is created only when Task 5 changed tracked files.

---

## Self-Review

- Spec coverage:
  - Animated SVG/GSAP logo: Task 1.
  - Hero Showcase + Quick Start console: Tasks 2 and 3.
  - Ordinary homepage hides join flow: Task 2.
  - Invite links show invite join card: Task 2.
  - Desktop first-screen/no global scroll intent: Task 3.
  - Mobile homepage and light room mobile polish: Tasks 3 and 4.
  - Reduced motion: Tasks 1 and 3.
  - Tests and validation: Tasks 1-5.
- Placeholder scan: no deferred markers, empty sections, or vague implementation text.
- Type consistency:
  - `LandingProps` remains unchanged.
  - `onCreate` and `onJoin` parameter shapes remain unchanged.
  - New i18n keys are present in both English and Chinese catalogs.
  - New component import uses NodeNext-compatible `.js` extension: `./CacpHeroLogo.js`.
