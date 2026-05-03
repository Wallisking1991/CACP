# Header Background Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agent-state-reactive "thinking ripple" animation to the Header background, with subtle breathing glow during idle.

**Architecture:** A new `HeaderBackground` sub-component inside `Header.tsx` renders two CSS-animated breathing layers plus dynamically spawned ripple elements. State is derived from `avatarStatuses` and `turnInFlight`. Empty area detection uses `getBoundingClientRect()` on Header's content blocks. All styling lives in `App.css`.

**Tech Stack:** React, CSS animations, TypeScript, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/web/src/App.css` | Modify | Breathing layer styles, ripple styles, keyframes, state classes, reduced-motion media query |
| `packages/web/src/components/Header.tsx` | Modify | Add `HeaderBackground` sub-component + integrate into Header render |

---

### Task 1: Add CSS styles and keyframes

**Files:**
- Modify: `packages/web/src/App.css`

Add the following at the end of `App.css` (after all existing styles):

- [ ] **Step 1: Add Header background container and breathing layer styles**

```css
/* Header background animation */
.header-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: inherit;
}

.header-breathe-layer {
  position: absolute;
  border-radius: 50%;
  filter: blur(24px);
  transform-origin: center;
  will-change: transform, opacity;
}

.header-breathe-layer--1 {
  width: 160px;
  height: 160px;
  left: 18%;
  top: 50%;
  margin-top: -80px;
  background: radial-gradient(circle, rgba(249, 115, 22, 0.14), transparent 70%);
  animation: header-breathe-slow 8s ease-in-out infinite;
}

.header-breathe-layer--2 {
  width: 100px;
  height: 100px;
  left: 22%;
  top: 50%;
  margin-top: -50px;
  background: radial-gradient(circle, rgba(249, 115, 22, 0.18), transparent 70%);
  animation: header-breathe-fast 6s ease-in-out infinite;
}

/* State-driven brightness changes */
.workspace-header--studio.header--thinking .header-breathe-layer--1 {
  opacity: 1.5;
}

.workspace-header--studio.header--thinking .header-breathe-layer--2 {
  opacity: 1.33;
}

.workspace-header--studio.header--streaming .header-breathe-layer--1 {
  opacity: 2;
}

.workspace-header--studio.header--streaming .header-breathe-layer--2 {
  opacity: 1.67;
}
```

- [ ] **Step 2: Add ripple styles**

```css
.header-ripple {
  position: absolute;
  width: 60px;
  height: 60px;
  margin-left: -30px;
  margin-top: -30px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(249, 115, 22, 0.28), rgba(249, 115, 22, 0.08) 40%, transparent 70%);
  will-change: transform, opacity;
  animation: header-ripple-expand 3.5s ease-out forwards;
}

.header-ripple--streaming {
  animation-duration: 2s;
}
```

- [ ] **Step 3: Add keyframe animations**

```css
@keyframes header-breathe-slow {
  0%, 100% { transform: scale(0.9); opacity: 0.9; }
  50% { transform: scale(1.05); opacity: 1; }
}

@keyframes header-breathe-fast {
  0%, 100% { transform: scale(0.95); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}

@keyframes header-ripple-expand {
  0% { transform: scale(0.3); opacity: 0.25; }
  100% { transform: scale(2.2); opacity: 0; }
}
```

- [ ] **Step 4: Add reduced-motion support**

```css
@media (prefers-reduced-motion: reduce) {
  .header-ripple,
  .header-breathe-layer {
    animation: none !important;
    opacity: 0.04;
  }
}
```

- [ ] **Step 5: Verify CSS compiles**

No explicit compile step needed for CSS. Do a visual scan for syntax errors (check braces, semicolons).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.css
git commit -m "feat(web): add Header background animation CSS styles"
```

---

### Task 2: Implement HeaderBackground sub-component

**Files:**
- Modify: `packages/web/src/components/Header.tsx`

- [ ] **Step 1: Add Ripple type and deriveAgentAnimationState helper**

Insert after the imports, before the `HeaderProps` interface:

```typescript
type AnimationState = "idle" | "thinking" | "streaming";

interface Ripple {
  id: number;
  x: number;
  y: number;
  mode: "thinking" | "streaming";
}

function deriveAgentAnimationState(
  avatarStatuses: AvatarStatusView[],
  turnInFlight: boolean,
): AnimationState {
  if (!turnInFlight) return "idle";
  const agent = avatarStatuses.find((a) => a.kind === "agent");
  if (!agent) return "idle";
  if (agent.status === "typing") return "streaming";
  if (agent.status === "working") return "thinking";
  return "idle";
}
```

- [ ] **Step 2: Add empty area detection helper**

Insert after `deriveAgentAnimationState`:

```typescript
function findEmptyArea(headerEl: HTMLElement): { x: number; y: number } | null {
  const brand = headerEl.querySelector(".header-brand") as HTMLElement | null;
  const identity = headerEl.querySelector(".room-identity") as HTMLElement | null;
  const rail = headerEl.querySelector(".role-avatar-rail") as HTMLElement | null;
  const actions = headerEl.querySelector(".header-actions") as HTMLElement | null;

  if (!brand || !identity || !rail || !actions) return null;

  const headerRect = headerEl.getBoundingClientRect();
  const brandRect = brand.getBoundingClientRect();
  const identityRect = identity.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const actionsRect = actions.getBoundingClientRect();

  const gapBStart = identityRect.right - headerRect.left;
  const gapBEnd = railRect.left - headerRect.left;
  const gapCStart = railRect.right - headerRect.left;
  const gapCEnd = actionsRect.left - headerRect.left;

  const gapBWidth = gapBEnd - gapBStart;
  const gapCWidth = gapCEnd - gapCStart;

  let usableStart = gapBStart;
  let usableEnd = gapBEnd;

  if (gapBWidth >= 0 && gapCWidth >= 0) {
    usableStart = gapBStart;
    usableEnd = gapCEnd;
  } else if (gapCWidth > gapBWidth) {
    usableStart = gapCStart;
    usableEnd = gapCEnd;
  }

  const usableWidth = usableEnd - usableStart;
  if (usableWidth < 80) return null;

  const centerX = usableStart + usableWidth / 2 + (Math.random() * 40 - 20);
  const centerY = headerRect.height / 2 + (Math.random() * 16 - 8);

  return { x: centerX, y: centerY };
}
```

- [ ] **Step 3: Add HeaderBackground component**

Insert after `findEmptyArea`:

```typescript
function HeaderBackground({
  avatarStatuses,
  turnInFlight,
  headerRef,
}: {
  avatarStatuses: AvatarStatusView[];
  turnInFlight: boolean;
  headerRef: React.RefObject<HTMLElement | null>;
}) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [emptyArea, setEmptyArea] = useState<{ x: number; y: number } | null>(null);
  const stateRef = useRef<AnimationState>("idle");
  const nextIdRef = useRef(0);

  const state = deriveAgentAnimationState(avatarStatuses, turnInFlight);
  stateRef.current = state;

  // Compute empty area on mount and resize
  useLayoutEffect(() => {
    function compute() {
      if (headerRef.current) {
        setEmptyArea(findEmptyArea(headerRef.current));
      }
    }
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [headerRef]);

  // Spawn ripples based on state
  useEffect(() => {
    if (state === "idle") return;

    const intervalMs = state === "streaming" ? 800 : 2500;
    const initialDelay = state === "thinking" ? 1500 : 0;

    const spawn = () => {
      const area = emptyArea;
      if (!area) return;

      setRipples((prev) => {
        const next: Ripple = {
          id: nextIdRef.current++,
          x: area.x,
          y: area.y,
          mode: stateRef.current === "streaming" ? "streaming" : "thinking",
        };
        const combined = [...prev, next];
        // Cap at 3 ripples, drop oldest
        return combined.slice(-3);
      });
    };

    let intervalId: ReturnType<typeof setInterval>;
    const initialTimer = setTimeout(() => {
      spawn();
      intervalId = setInterval(spawn, intervalMs);
    }, initialDelay);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [state, emptyArea]);

  const removeRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return (
    <div className="header-background" aria-hidden="true">
      <div className="header-breathe-layer header-breathe-layer--1" />
      <div className="header-breathe-layer header-breathe-layer--2" />
      {ripples.map((r) => (
        <div
          key={r.id}
          className={`header-ripple ${r.mode === "streaming" ? "header-ripple--streaming" : ""}`}
          style={{ left: r.x, top: r.y }}
          onAnimationEnd={() => removeRipple(r.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/Header.tsx
git commit -m "feat(web): add HeaderBackground sub-component with ripple logic"
```

---

### Task 3: Integrate HeaderBackground into Header

**Files:**
- Modify: `packages/web/src/components/Header.tsx`

- [ ] **Step 1: Add header ref and pass to HeaderBackground**

In `Header` function body, add a ref after the existing refs:

```typescript
const headerRef = useRef<HTMLElement>(null);
```

- [ ] **Step 2: Attach ref to `<header>` and insert HeaderBackground**

Change the `<header>` element from:

```tsx
<header className="workspace-header workspace-header--studio">
```

to:

```tsx
<header
  ref={headerRef}
  className={`workspace-header workspace-header--studio ${deriveAgentAnimationState(avatarStatuses, turnInFlight) !== "idle" ? `header--${deriveAgentAnimationState(avatarStatuses, turnInFlight)}` : ""}`}
>
  <HeaderBackground
    avatarStatuses={avatarStatuses}
    turnInFlight={turnInFlight}
    headerRef={headerRef}
  />
```

**Important:** The `deriveAgentAnimationState` call is used twice here — once for the className and once inside `HeaderBackground`. To avoid double computation, extract it to a variable before the return:

```typescript
const animationState = deriveAgentAnimationState(avatarStatuses, turnInFlight);
```

Then update the header className:

```tsx
className={`workspace-header workspace-header--studio ${animationState !== "idle" ? `header--${animationState}` : ""}`}
```

And pass it to HeaderBackground:

```tsx
<HeaderBackground
  avatarStatuses={avatarStatuses}
  turnInFlight={turnInFlight}
  headerRef={headerRef}
/>
```

- [ ] **Step 3: Verify the header element's existing children are unchanged**

The `<HeaderBackground />` should be the **first child** of `<header>`, before `<div className="header-brand">`. All other children stay exactly as they were.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/Header.tsx
git commit -m "feat(web): integrate HeaderBackground into Header component"
```

---

### Task 4: Verify with web package tests

**Files:**
- None modified

- [ ] **Step 1: Run web package tests**

```bash
corepack pnpm --filter @cacp/web test
```

Expected: All tests pass. The change only adds visual elements with `aria-hidden="true"` and `pointer-events: none`, so it should not affect any existing test logic.

- [ ] **Step 2: If any test fails, investigate**

Common causes:
- Snapshot tests may need updating if they capture Header markup
- Tests that query DOM structure within `<header>` may need adjustment if they assume direct children

Fix any failures by updating test expectations, not by changing the animation code.

- [ ] **Step 3: Commit (if test fixes needed)**

```bash
git add packages/web/test/...  # whichever test files needed updates
git commit -m "test(web): update snapshots for Header background animation"
```

---

## Self-Review Checklist

After completing the plan, verify:

- [ ] **Spec coverage**: Every requirement from the design spec has a corresponding task
  - Visual design (breathing layers + ripples) → Task 1
  - Component architecture → Task 2
  - Empty area detection → Task 2 Step 2
  - Ripple lifecycle → Task 2 Step 3
  - State mapping → Task 2 Step 1 + Task 3
  - Performance (transform/opacity only, will-change, auto-removal) → Task 1 + Task 2
  - Accessibility (prefers-reduced-motion) → Task 1 Step 4
  - Mobile adaptation → implicit via responsive CSS and gap detection

- [ ] **No placeholders**: All code blocks contain complete, copy-pasteable code

- [ ] **Type consistency**: `AnimationState`, `Ripple`, `deriveAgentAnimationState` used consistently across tasks
