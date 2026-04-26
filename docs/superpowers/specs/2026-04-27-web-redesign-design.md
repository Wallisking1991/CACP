# CACP Web Redesign (Warm Editorial)

Date: 2026-04-27
Status: Draft — pending user review

## Background

`packages/web` ships a glassmorphic neon design (animated drift orbs, mint/cyan/violet gradients, ad-hoc layout, single 980px breakpoint) that the user has flagged as unfit for purpose. Controls are scattered between the header, a 340px right sidebar, and a floating "controls collapsed" dock. AI Flow Control — the highest-leverage owner action — sits as a sidebar card distant from the composer, despite being a composer-mode toggle. There is no internationalization.

This redesign is frontend-only. The server, the event protocol, and the role permission model do not change.

## Goals

1. Replace the visual system with Warm Editorial: cream surfaces, ink text, a single warm-orange accent.
2. Move AI Flow Control into the composer as an inline mode toggle that visibly tints the whole composer when collection is active.
3. Adopt L1 sidebar-always layout: chat as the dominant column, a fixed ~220px sidebar with three structured cards (Agent / People / Invite).
4. Cap-and-center responsive: content max-width 1600px; defined behavior at 1366 / 1920 / 2560 / 1024 / 768.
5. Add EN / CN i18n with persisted preference.
6. Replace the dual-card landing with a single tabbed panel (Create room / Join with invite).

## Non-goals for this iteration

- Server-side or protocol changes. Event types, REST endpoints, role permissions, agent pairing, AI Flow Control semantics all stay as-is.
- New features beyond visuals + layout + i18n. No outline/topic panel, no message threading, no avatar upload, no message editing.
- Mobile phones (<768px). Tablets at 768px+ are supported best-effort via the drawer.
- Dark mode / theme switching. Single light theme only.
- Web font dependencies. The system font stack must cover both languages.

## Confirmed product decisions

- Visual direction: **Warm Editorial** — `#faf6ee` cream base, `#1c1813` ink text, `#c2410c` warm orange accent.
- Workspace layout: **L1 — Sidebar Always** with right-side cards.
- Responsive strategy: **Cap & Center** at 1600px max width.
- Landing page: **Tabbed Single Panel** with Create / Join tabs.
- Composer in Collect mode: **Inline Mode Swap** — whole composer surface tints, Submit/Cancel as a fixed bottom action row.
- Composer when an Agent turn is in flight: **Queued state** — input dimmed, send button becomes `Queue`, mode toggle locked.
- Composer for non-owner during Collect: **Same warm tint**, owner-only controls swapped for a role-aware lock hint.
- Sidebar density: **Flat** — primary owner actions visible inline.
- i18n default: `navigator.language` on first visit (`zh-*` → CN, otherwise EN), then `localStorage.cacp.web.lang` thereafter.
- Headline font stack: `'Times New Roman', Georgia, 'Source Han Serif SC', 'Songti SC', 'SimSun', serif` — system stack, zero web font load.
- Body font stack: `Inter, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`.

## Visual system

### Color tokens

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#faf6ee` | page background, page-level cream |
| `--surface` | `#fdfaf2` | thread, default secondary surface |
| `--surface-warm` | `#fdf9f1` | composer (Live), Agent card |
| `--surface-collect` | `#fff7eb` | composer in Collect mode |
| `--surface-queued` | `#f5ede0` | composer when Agent replying; collected-message border tint |
| `--ink` | `#1c1813` | primary text, primary CTA background |
| `--ink-2` | `#4d4239` | secondary text |
| `--ink-3` | `#6b5e50` | tertiary / filled-input text |
| `--ink-4` | `#8a7a66` | hint, label, caption |
| `--ink-5` | `#a89b8a` | disabled text and disabled CTA background |
| `--invert` | `#faf6ee` | text on `--ink` |
| `--border` | `#e8dfd0` | default border |
| `--border-soft` | `#f0e9d8` | inner separators |
| `--accent` | `#c2410c` | warm orange — Collect, badges, primary warm CTA |
| `--accent-soft` | `#fef3e7` | accent background tint, status strip |
| `--accent-border` | `#f3d4ad` | accent border on warm surfaces |
| `--success` | `#15803d` | online / healthy |

### Typography

- Headline (room title, landing H1, prominent card titles): headline font stack, weight 700; H1 28–36px, H2 15–18px; letter-spacing −0.02em.
- Body: body font stack; 11/12/13px scale; line-height 1.5–1.6.
- Caption / SECTION LABEL: 8–9px, weight 700, uppercase, letter-spacing 0.10–0.12em, color `--ink-4` or `--accent`.
- Mono (room ID, invite link preview): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.

### Spacing / radii / shadow

- Base unit 4px. Card padding 11–14px. Section gap 8–12px. Page gutter 16–24px.
- Radii: 6 (chips), 8 (buttons, inputs), 10 (cards, composer), 12 (frames, drawers), 999 (toggle/pill).
- Shadow is restrained. Cards have no resting shadow. Drawer uses `-8px 0 24px rgba(28, 24, 19, 0.06)`.
- No glow effects, no glassmorphism (no `backdrop-filter`), no gradients beyond the agent avatar circle.

## Layout

### Workspace shell (≥1024px)

```
[ Header ─────────────────────────────────────────────────── ]
[ Chat panel (1fr)                  | Sidebar (220px)        ]
[   Thread (internal scroll)        |   Agent card           ]
[   Composer (fixed at bottom)      |   People card          ]
[                                   |   Invite card          ]
```

- Outer max-width 1600px, `margin: 0 auto` with cream gutters above 1600px.
- Vertical: `100dvh` shell. Header fixed at top. The chat thread is the only internally scrolling area; the page itself never grows.
- Gap between chat panel and sidebar: 16px.

### Header

- Compact (~56px). Bottom border `--border-soft`.
- Left: Room name (headline H2) + sub-line `Room · N people · <agent name> online`.
- Right (in order): live/turn-status pill (`Live` / `Collecting…` / `Replying…`) → `EN / 中` language toggle → `⋯` overflow menu containing `Clear room`, `Leave room`.
- Header is owner-aware: `Clear room` only renders for owner.

### Breakpoints

| Width | Behavior |
|---|---|
| ≥1600px | Content centered at 1600px; cream gutters either side. |
| 1280–1600px | Full L1, sidebar 220px. |
| 1024–1280px | L1, sidebar narrows to 180px (cards remain single-column). |
| 768–1024px | Sidebar becomes a right slide-over drawer (280px). Header gains a status pill button that opens it. |
| <768px | Out of scope. Layout still degrades gracefully: composer stays full-width, drawer covers full width. No specific QA. |

### Landing page

- Single centered card on a cream page; max-width ~520px.
- Eyebrow `CACP · Local Demo`. Headline serif H1 `A collaborative AI room.`. Sub-copy.
- Pill toggle with two tabs: `Create room` (default) / `Join with invite`.
- Create form: Your name, Room name, Agent (select), Permission (select), Working directory. Primary CTA `Create room and start agent` (warm).
- Join form: Your name, Invite link. Primary CTA `Join shared room` (ink primary).
- If the URL contains an invite parameter (`?invite=…` or `#invite=…`), open with `Join with invite` tab pre-selected and the field prefilled.

## Composer

The composer carries AI Flow Control. It has three render states; each renders differently per role.

### Live (default)

- Surface: `--surface-warm` background, `--border` border.
- Top row: `Live / Collect` pill toggle (toggle is owner-only — disabled for non-owner) + hint `Each message goes to AI immediately`.
- Bottom row: textarea + `Send` button (ink primary).

### Queued (Agent turn in flight, while Live)

Triggered when `findOpenTurn(events)` is non-null and the room is not currently in a Collect session.

- Above the toggle row, a status strip appears: `--accent-soft` background, pulsing `--accent` dot, copy `Claude is replying… your next message will queue as a follow-up after this turn.`
- Composer surface darkens to `--surface-queued`.
- Input remains typable but visually muted.
- Send button label becomes `Queue`; styled with `--ink-5` background; remains clickable. Submitting appends a normal `message.created` event; the server's existing `agent.turn.followup_queued` logic governs delivery.
- Mode toggle is disabled with a `🔒 mode locked while Agent is replying` hint.
- On `agent.turn.completed` the composer reverts to Live.

### Collect (owner-activated; visible to all roles)

Triggered when `ai.collection.started` is the latest collection event without a matching `submitted`/`cancelled`.

Visual:

- Surface: `--surface-collect` background, `--accent-border` border.
- Top row: toggle (Collect on) with badge showing the live count `N` of collected messages + hint.
- Middle row: textarea + primary button labeled `Add` (replacing `Send`).
- Owner only — bottom action row, separated by a soft divider:
  - Left hint `Only the owner sees these controls`.
  - `Cancel collection` (warm-ghost) + `Submit N answers →` (warm primary).
- Member view: no bottom action row. Top hint reads `Owner is collecting answers · your replies will be sent as a batch when they submit`. Toggle disabled. Bottom shows `🔒 only the owner can submit or cancel this collection`.
- Observer view: same as Member, plus the input itself is disabled.

Thread rendering during Collect:

- Each message tagged with `collection_id` renders with a dashed `--accent-border` border, `--surface-queued` background, and a `· QUEUED` meta tag (replacing the participant role suffix).
- On `ai.collection.submitted` the queued bubbles re-render as normal sent messages without animation; the next event in the timeline is the resulting `agent.turn.requested`.
- On `ai.collection.cancelled` the queued bubbles re-render as normal sent messages and a system event line appears: `Collection cancelled — N messages remain in the room.`.

### Mode-switching rules

- Mode toggle is owner-only. Member/Observer always see the toggle disabled.
- Mode toggle is disabled for everyone (including the owner) while a turn is in flight.
- Switching to Collect emits `ai.collection.started`. `Submit` emits `ai.collection.submitted`. `Cancel` emits `ai.collection.cancelled`. None of these are new events — the protocol already supports them.

## Sidebar cards

All cards live in the right column (or in the drawer below 1024px). Density is **Flat** — primary owner actions are inline.

### Agent card

- Surface: `--surface-warm`.
- Section label `Agent` + small action `Logs →` (top-right). For v1 this anchor opens a small placeholder dialog reading `Agent logs view coming soon` with a `Close` button. The anchor is rendered only for owner.
- Avatar circle: 28×28, gradient `linear-gradient(135deg, #c2410c, #8b5a3c)`, white initial of agent type (`C` for Claude Code, `X` for Codex, `O` for opencode, `E` for echo).
- Name: agent display name (e.g. `Claude Code`).
- Status row: `● online` in `--success` (or `● offline · last seen …` in `--ink-4`).
- Meta row: permission tag (`Read only`, `Limited write`, `Full access`) using `--accent-soft` background + `--accent` text + small radius; the same color treatment applies to all three levels — the label text distinguishes severity, the color does not. Followed by the working directory truncated with ellipsis.
- Owner action row: `Restart` (ghost) and `Change permission` (ghost). Hidden for member/observer.

### People card

- Section label `People` + count chip on the right.
- List form (one row per participant, not chip soup):
  - Name (own row marked `(you)`).
  - Right-aligned role label: `OWNER` in `--accent` weight 700; `member` / `observer` in `--ink-4` lowercase.
- Hover row gets `--bg` background.
- No actions in v1 (no kick, no role change).

### Invite card

- Owner-only card. Hidden for member and observer.
- Section label `Invite` + small action `History →` (right). For v1 this anchor opens a small placeholder dialog reading `Invite history view coming soon` with a `Close` button.
- Two selects in a row: role (`Member ▾` / `Observer ▾`) + TTL (`1h ▾` / `24h ▾` / `7d ▾`).
- Below: link preview (mono, truncated) + `Copy` warm CTA. Generating a link uses the existing invite endpoint; changing the role/TTL re-issues a link.

### Drawer mode (768–1024px)

Same three cards, in a right slide-over. Header gets a status pill button (e.g. `● Claude · 3`) that opens the drawer. Drawer width 280px, padding 14px, close on backdrop tap or `✕`.

## Internationalization

- Mechanism: a thin in-house React context provider over two JSON dictionaries (`messages.en.json`, `messages.zh.json`). No external i18n library is required for this scope; `react-intl` may be used if it simplifies the implementation, but is not mandated.
- Storage key: `cacp.web.lang`. Allowed values: `en`, `zh`.
- Default resolution on first load:
  1. If `localStorage.getItem('cacp.web.lang')` is set, use it.
  2. Otherwise, parse `navigator.language`. If it matches `^zh\b`, use `zh`. Otherwise `en`.
  3. Persist the resolved value back to `localStorage`.
- Switcher: `EN / 中` toggle in the header right. A click flips the value, writes to `localStorage`, and re-renders. No page reload.
- Untranslated keys fall back to the English value (and log a `console.warn` in dev).
- All visible chrome strings are translated. User-generated content (room names, message bodies, participant display names, agent display names) is never translated.
- Date and time formatting uses `Intl.DateTimeFormat` with the active locale.
- Translation coverage scope (non-exhaustive): landing page, header, all sidebar card labels and buttons, composer hints / button labels / status strip copy, system event lines, error toasts, role and permission labels, empty states.

## Component states (acceptance-bearing)

- Empty thread: cream centered placeholder, headline-stack italic copy `No messages yet · say hi or wait for the agent.`
- Agent offline: status row reads `● offline · last seen <relative time>` in `--ink-4`. For owner, the `Restart` button is promoted from ghost to warm-ghost.
- Agent failed to start: status row in `--accent`. Message reads `failed to start`. Owner sees `Retry` warm-ghost.
- Connecting agent: a pulsing `--ink-4` dot with label `connecting…` in the status row.
- Network reconnecting: a 1-line top banner above the thread: `Reconnecting…`, `--accent-soft` background, dismissed automatically once connected.
- Send error: the failed bubble shows `(failed)` in `--accent` with `Retry` and `Discard` controls.
- Owner-only invite card hidden: members and observers do not see the Invite card at all (not a disabled card).

## Animation budget

- No background orbs. No drift loops. No parallax.
- Allowed: 200–250ms ease transitions for hover/active state changes; pulse animation for live indicators (1.4–1.6s); blinking caret for streaming bubbles.
- `prefers-reduced-motion: reduce` disables all pulses and blinks, replacing them with static colored dots.

## File-level expected changes (`packages/web`)

- `src/App.tsx` — restructured into `Landing`, `Workspace` (`Header`, `ChatPanel` (`Thread`, `Composer`), `Sidebar`, `MobileDrawer`) components. The current monolithic file is split.
- `src/App.css` — replaced with a token-based stylesheet (or split into `tokens.css` + per-component CSS).
- `src/room-state.ts` — no logical change; expose any new derivations needed (e.g. `isOwner`, `isCollectionActive`, `isTurnInFlight`, `collectedMessageIds`).
- `src/role-permissions.ts` — re-used as-is. No changes.
- New: `src/i18n/` directory with `LangProvider.tsx`, `useT.ts`, `messages.en.json`, `messages.zh.json`.
- New: `src/components/` directory for the component split-out above.
- Test files added alongside each new module.

Out of scope:

- `@cacp/server`, `@cacp/protocol`, `@cacp/cli-adapter`. No code changes in those packages; only types may need to be re-exported via `@cacp/protocol` as already done.

## Testing strategy

### Unit tests (vitest, `@cacp/web`)

- `room-state.ts` derivations: `isOwner`, `isCollectionActive`, `isTurnInFlight`, `collectedMessageIds`.
- `i18n` resolver default-language logic: covers cases with/without `localStorage` value and various `navigator.language` strings.
- `Composer` rendering matrix: for each `(role ∈ {owner, member, observer}) × (mode ∈ {live, collect}) × (turnInFlight ∈ {true, false})` combination, snapshot the visible button label, hint text, and disabled flags. Most combinations are degenerate but the matrix forces explicit handling.
- `SidebarCards`: invite card hidden for member/observer; Restart / Change permission hidden for non-owner; permission tag color matches level.

### End-to-end smoke (Playwright, manual)

Extend the existing manual flow to verify:

1. First visit with a `zh-CN` browser locale renders CN by default; switching to EN persists across reload.
2. Workspace renders without overflow at 1366×768, 1920×1080, 2560×1440, 1024×600.
3. Below 1024px, sidebar opens as a right drawer from the header status pill.
4. Owner activating Collect tints the composer; Member sees the same tint with a lock hint and no Submit button.
5. Sending a message during a streaming agent turn shows the queued state and the message appears as a follow-up after `agent.turn.completed`.
6. `prefers-reduced-motion: reduce` removes the pulse animation.

### Build / typecheck

- `corepack pnpm --filter @cacp/web build` succeeds.
- `corepack pnpm check` (root) passes for the whole workspace.

## Acceptance criteria

The redesign is complete when:

1. All current `@cacp/web` functionality continues to work without server-side changes (verified by the existing manual flow plus the additions above).
2. The visual system matches the Warm Editorial tokens; no glassmorphic neon styles remain in shipping CSS.
3. Workspace renders correctly at 1366×768, 1920×1080, 2560×1440, 1024×600. Below 1024px the sidebar drawer behavior works.
4. AI Flow Control is presented inline within the composer; the mode toggle is composer-local; `Submit` and `Cancel collection` are visible only to the owner during Collect.
5. The composer correctly renders the three states (Live, Collect, Queued-while-replying) and the three role views (owner, member, observer) per the matrix in the Composer section.
6. The sidebar shows Agent / People / Invite cards in Flat density. Owner sees `Restart`, `Change permission`, and `Copy invite`. Member sees no Invite card and no owner-only buttons. Observer sees no Invite card; the composer input is disabled while Collect is active.
7. The landing page is a single tabbed card; arriving with `?invite=…` opens the `Join with invite` tab with the field prefilled.
8. The language switcher works: persists across reload, defaults from `navigator.language` on first visit, all chrome strings switch. No untranslated chrome text remains in either language.
9. `prefers-reduced-motion: reduce` removes pulses and caret animations.
10. `corepack pnpm check` passes.
