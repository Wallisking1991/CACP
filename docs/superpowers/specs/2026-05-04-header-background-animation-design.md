# Header Background Animation Design

## Overview

Add a creative, Agent-state-reactive animation to the Header background that fills empty space and reduces visual monotony. The animation takes the form of "thinking ripples" — warm orange light ripples that emanate from empty areas of the Header when the Agent is working, with a subtle breathing glow during idle.

## Goals

- Make the Header feel alive and responsive to room activity
- Visually communicate Agent working state (thinking vs streaming) through animation intensity
- Keep animations contained to empty areas — never obscure existing UI elements (logo, room name, avatar rail, buttons)
- Maintain the project's warm orange aesthetic
- Respect user motion preferences (`prefers-reduced-motion`)

## Non-Goals

- No Canvas or WebGL — keep within the existing CSS animation architecture
- No dark-mode variants (the design assumes the current warm light theme)
- No sound or haptic feedback

## Visual Design

### Base Breathing Layers (Always Present)

Two absolutely positioned `radial-gradient` circles in the empty area of the Header, left of center:

- **Layer 1**: ~160px diameter, `rgba(249, 115, 22, 0.08)`, blur 24px, 8s cycle, scale `0.9 → 1.05 → 0.9`
- **Layer 2**: ~100px diameter, `rgba(249, 115, 22, 0.12)`, blur 24px, 6s cycle, scale `0.95 → 1.08 → 0.95`, reverse phase from Layer 1

Together they create a gentle, organic breathing sensation even when idle.

### Dynamic Ripples (Agent-Triggered)

Each ripple is an absolutely positioned circular div:

- `radial-gradient(circle, rgba(249,115,22,0.28), rgba(249,115,22,0.08) 40%, transparent 70%)`
- Animation: `scale(0.3) → scale(2.2)`, `opacity` from `0.25 → 0`
- Max concurrent ripples: 3
- Ripple removes itself from DOM after animation completes

### Intensity Variations

| Mode | Ripple Size | Peak Opacity | Duration | Interval |
|------|-------------|--------------|----------|----------|
| Thinking | scale to 2.5x | 0.20 | 3.5s | 2.5s |
| Streaming | scale to 1.8x | 0.32 | 2.0s | 0.8s |

Thinking ripples are larger and softer ("deep thought"). Streaming ripples are tighter and brighter ("active output").

## Component Architecture

### `HeaderBackground` Sub-Component

Embedded inside `Header.tsx` (not a separate file — tightly coupled to Header layout):

```tsx
// Pseudocode
function HeaderBackground({
  turnInFlight,
  agentStatus, // 'idle' | 'working' | 'typing'
}) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const headerRef = useRef<HTMLElement>(null);
  const emptyAreaRef = useRef<{ x: number; y: number } | null>(null);

  // Compute empty area on mount + resize
  useLayoutEffect(() => { /* ... */ }, []);

  // Spawn ripples based on agent state
  useEffect(() => { /* setInterval logic */ }, [turnInFlight, agentStatus]);

  return (
    <div className="header-background" aria-hidden="true">
      <div className="header-breathe-layer layer-1" />
      <div className="header-breathe-layer layer-2" />
      {ripples.map(r => (
        <div
          key={r.id}
          className="header-ripple"
          style={{ left: r.x, top: r.y }}
          onAnimationEnd={() => removeRipple(r.id)}
        />
      ))}
    </div>
  );
}
```

### Empty Area Detection

The Header has four fixed content blocks in horizontal order: `header-brand` → `room-identity` → `role-avatar-rail` → `header-actions`.

1. Read `getBoundingClientRect()` for each block
2. Compute gaps:
   - Gap A: brand.right → identity.left
   - Gap B: identity.right → rail.left
   - Gap C: rail.right → actions.left
3. Usable empty area = union of Gap B and Gap C
4. If union width < 80px, fall back to whichever gap is larger
5. Ripple spawn point = horizontal center of usable area + random jitter ±20px, vertical center of Header ±8px
6. Recalculate on window resize

### Ripple Lifecycle

- `ripples` array stores `{ id, x, y, mode }`
- `setInterval` spawns new ripples based on current Agent state
- Each ripple element handles its own removal via `onAnimationEnd`
- Hard cap: max 3 concurrent ripples (drop oldest if exceeded)

## State Mapping

Agent state is derived from `avatarStatuses` and `turnInFlight`:

| State | Condition | Base Layer | Dynamic Ripples |
|-------|-----------|------------|-----------------|
| **Idle** | No Agent online, or Agent online with `turnInFlight === false` | Normal opacity | None |
| **Thinking** | `turnInFlight === true` and Agent status is `working` | Opacity +0.04 | 1 ripple every 2.5s, thinking mode |
| **Streaming** | `turnInFlight === true` and Agent status is `typing` / streaming bubble present | Opacity +0.08 | 1 ripple every 0.8s, streaming mode |

### Transitions

- **Idle → Thinking**: Base layer brightens over 600ms. First ripple appears after 1.5s delay (avoids instant popup).
- **Thinking → Streaming**: Interval gradually shortens. Existing ripples complete naturally.
- **Streaming → Idle**: Stop spawning. Existing ripples finish and fade. Base layer dims over 800ms.

## Performance

- All animations use only `transform` and `opacity` — no layout thrashing
- `will-change: transform, opacity` on ripple elements, cleared on removal
- Empty area detection runs only on mount and `resize` — no scroll/mousemove listeners
- `setInterval` for spawn control, not `requestAnimationFrame`
- DOM nodes auto-remove after animation — no leaking elements

## Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .header-ripple,
  .header-breathe-layer {
    animation: none !important;
    opacity: 0.04;
  }
}
```

When system motion reduction is enabled: all ripples stop, breathing layers become static near-invisible glow.

## Mobile Adaptation

- Mobile Header uses `grid` layout (`workspace-header--studio`). Empty area detection must handle this variant.
- Mobile typically has less horizontal space — ripple diameter scales down 30%.
- Max concurrent ripples reduced to 2.
- Base breathing layers remain but at reduced opacity.

## Edge Cases

- **No-Agent room**: Permanently idle. Only base breathing layers.
- **Extremely narrow Header** (< 80px empty space): Gracefully degrade to base layers only, no dynamic ripples.
- **Rapid state toggling**: Use a 300ms debounce on state transitions to avoid jarring interval changes.

## Files to Modify

- `packages/web/src/components/Header.tsx` — add `HeaderBackground` sub-component
- `packages/web/src/App.css` — add animation keyframes and ripple styles
