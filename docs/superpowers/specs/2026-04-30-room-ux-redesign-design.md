# Room UX Redesign: Content-first AI Roundtable Studio

Date: 2026-04-30
Status: Approved for specification review
Scope: Full implementation in one pass

## Context

CACP is a local-first collaborative AI room. The public room server coordinates rooms, participants, governance, invites, pairing, and event flow, while agent execution stays local through the Local Connector. The current landing page already has a refined warm-paper visual language, but the post-entry room UI feels sparse and closer to an unfinished admin panel than a live collaboration space.

The redesigned room should make the conversation feel like the primary product surface while making room participants, AI agents, and local Claude Code activity visible at a glance.

## Product Direction

The new room experience is a **Content-first AI Roundtable Studio**:

- Maximize the visible conversation area.
- Preserve the refined landing-page mood: warm paper, grid/geometry, tasteful motion, and high-quality typography.
- Present all humans and AI agents as visible room roles through an avatar status rail.
- Make human messages, AI output, system events, Claude imports, and Roundtable collection states visually distinct.
- Move operational controls out of the header into a branded floating logo control and centered Room Control Center.
- Add real presence and typing events so avatar states reflect room activity, not decorative animation.
- Add default-on but subtle sound cues for important room events, with a control-center mute option.

## Goals

1. Give most of the viewport to conversation content.
2. Keep room identity visible without letting it dominate the page.
3. Let users instantly see who is in the room and what each role is doing.
4. Distinguish people, AI agents, system events, imported Claude history, and Roundtable states by layout and visual treatment.
5. Use icon-first controls where possible, with text moved to tooltips, aria labels, or modal descriptions.
6. Keep dangerous actions discoverable but safer; the clear-conversation action moves to the composer area and requires confirmation.
7. Preserve local-first security boundaries: do not expose provider secrets, connection codes, invite tokens, or sensitive local details unnecessarily.
8. Support desktop and mobile as first-class layouts.

## Non-goals

- Do not reintroduce a generic command-agent product surface as the main room metaphor.
- Do not make the room page a permanent dashboard with always-visible side panels.
- Do not expose API keys, provider credentials, unmasked pairing codes, or invite tokens in screenshots by default.
- Do not rely only on color to communicate room role or activity status.

## Page Architecture

### 1. Slim Room Header

A thin top bar that identifies the room and shows live role activity.

- Left: room identity.
  - Room title remains visible.
  - Current user and role are shown in a compact form such as `Wei · Owner`.
  - Room ID is shown as a short chip, for example `room_jPNC…Ovncw`, with icon-only copy affordance.
- Center: grouped role avatar rail.
  - Humans and Agents are distinct groups.
  - Active roles are prioritized.
  - Overflow becomes `+N`.
- Right: language toggle only.
  - Clear room, leave room, invites, agent controls, and other operations are removed from the header.

### 2. Conversation Canvas

The primary content area. It occupies the majority of available height and width.

- Empty state becomes a compact starter prompt instead of a large empty panel.
- New messages use a subtle arrival animation.
- AI streaming cards use a restrained breathing or scan-line treatment.
- System and protocol events are thin timeline markers, not large panels.

### 3. Composer Dock

A refined bottom input area.

- Left: icon-first Live/Roundtable mode switch.
- Center: message textarea.
- Right: send affordance, preferably icon-forward while remaining understandable.
- Composer top-right: owner-only clear-conversation icon.
  - Uses a refined sweep/eraser/reset-history icon rather than a harsh trash icon.
  - Requires a second confirmation.
- Typing debounce is emitted from composer input changes.

### 4. Floating Logo Control

A branded control puck based on the landing-page logo language.

- Sits at the right side of the viewport around the vertical midpoint.
- Defaults to half-hidden against the right edge.
- Slides out on hover or focus.
- Can be dragged vertically to avoid covering content.
- Persists its vertical position in local storage.
- Opens the centered Room Control Center.
- Shows subtle state: active AI work, pending requests, or connection trouble.

### 5. Room Control Center

A centered modal for all non-message controls.

- Desktop: centered large modal.
- Mobile: near-fullscreen modal.
- Uses a light refined shell with a darker embedded Agent/Claude cockpit area where appropriate.
- Uses icon-first tabs or section navigation.
- Contains Agent, People, Invite, Room, Sound, and Advanced/Logs areas.

## Header and Role Avatar Rail

### Role Groups

The avatar rail groups roles into:

- Humans: owner, admin, member, observer.
- Agents: Claude Code Agent, LLM API agents, future local runners.

### Display Priority

When there are too many roles to fit:

1. Always show roles with active states.
2. Show owner and active agent before idle members.
3. Group remaining roles into `+N` overflow.
4. Overflow details are available through the Room Control Center.

### Status Priority

A role can have multiple possible states. The visible state uses this priority:

1. AI working, streaming, or active Claude runtime.
2. Human typing.
3. Roundtable pending or collecting.
4. Online.
5. Idle.
6. Offline or removed.

### Visual States

- Online: stable status dot.
- Typing: small three-dot pulse near the avatar.
- AI working: slow outer ring breathe or rotate.
- Roundtable pending: amber waiting ring.
- Offline: muted/gray avatar.
- Permission-limited/read-only: small lock glyph.
- Owner: crown or host marker.
- Latest sender: temporary highlight for one to two seconds.

### Accessibility

- Every avatar has a specific `aria-label`, for example `Wei, owner, online` or `Claude Code Agent, AI, working`.
- State must not depend only on color; use ring shape, glyphs, dots, or motion.
- `prefers-reduced-motion` disables long-running rotation and reduces entrance/message animations to simple opacity changes.

## Message Design

### Own Human Message

- Right aligned.
- Compact bubble.
- Warm light surface.
- Own-message avatars are omitted to save space; ownership is communicated by right alignment, bubble treatment, and accessible metadata.
- New message uses a subtle slide/fade.

### Other Human Message

- Left aligned.
- Includes avatar, display name, and role marker.
- Consecutive messages from the same actor can collapse repeated avatar/name details.
- Visually distinct from own messages through alignment, background, and metadata placement.

### AI Message

- Render as a wider **AI work card**, not a normal chat bubble.
- Includes AI avatar, agent name, state, optional capability/permission glyphs, and the response body.
- Streaming state uses a subtle breathing border or top scan line.
- Claude Code output can use a restrained terminal-core accent without turning the whole room into a dark dashboard.

### System Event

- Render as thin centered timeline markers.
- Used for room cleared, agent connected, session selected, participant lifecycle, and similar events.
- Low visual weight so system events do not interrupt the conversation.

### Claude Import

- Import banner is a thin marker summarizing started/completed/failed import.
- Imported user/assistant/tool messages remain distinguishable.
- Tool messages use a lower-saturation technical-note treatment.

### Roundtable Collection

- Queued human answers render as a collecting stack or grouped cards.
- Owner submit creates a handoff marker before AI receives the collected content.
- Active collection state also appears in the avatar rail.

### Empty State

- Replace the current large empty box with a compact starter panel.
- Suggested actions are icon-first:
  - Say first message.
  - Invite collaborators.
  - Select or start Claude session.
- The empty state disappears after the first message or relevant room activity.

## Composer Design

### Mode Switch

- Live and Roundtable become an icon-first segmented switch.
- Tooltips provide full labels and explanations.
- Active mode has an intentional but restrained animated state.

### Input

- Supports Enter to send and Shift+Enter for newline.
- Sends typing started/stopped events with debounce and timeout behavior.
- Does not continue broadcasting typing after send, clear, leave, or socket close.

### Send

- The send control remains clear as a primary action.
- Visual style should feel refined rather than a generic gray disabled button.
- Disabled state keeps enough contrast and still explains availability through tooltip or aria text when needed.

### Clear Conversation

- Owner only.
- Located at the composer top-right as a small icon-only action.
- Uses a refined sweep/eraser/reset-history icon.
- Requires confirmation before calling the clear-room endpoint.
- The Room Control Center can include a secondary clear action, but the composer icon is the primary visible entry because clearing is a conversation action.

## Floating Logo Control

### Behavior

- Initial position: right edge, vertical center.
- Rest state: half-hidden to reduce visual noise.
- Hover/focus state: slides fully into view.
- Drag: vertical drag only, with clamped bounds so it remains usable.
- Click/tap: opens Room Control Center.
- Position persists per browser in local storage.

### Styling

- Uses the landing-page logo as a mini medallion.
- Outer ring echoes the CACP orbital logo.
- Center point can reflect state.
- No visible text unless tooltip is shown.

### State Indicators

- AI working: center point breathes or outer ring moves slowly.
- Pending join/Roundtable request: small badge.
- Connection problem: amber/red edge.
- Sound muted: optional mini-glyph, preferably in the modal unless the muted state becomes important.

## Room Control Center

### Sections

1. Agent
   - Active agent, online/offline status, capabilities, permissions.
   - Claude session selection/resume controls.
   - Local Connector state and pairing information.
   - Restart/change permission/remove agent owner actions.
   - Recent Claude runtime status.

2. People
   - Human participants with role and activity state.
   - Owner/admin controls for removal where permitted.
   - Join requests and request handling.

3. Invite
   - Role selector.
   - Expiration selector.
   - Copy invite action.
   - Created invite count.
   - Sensitive invite tokens should not be displayed in full by default.

4. Room
   - Room ID copy.
   - Leave room.
   - Room metadata.
   - Secondary clear conversation action with confirmation.

5. Sound
   - Sound cues on/off, default on.
   - Volume control.
   - Test sound.
   - Browser autoplay/interaction notice when needed.

6. Advanced/Logs
   - Agent logs entry point, using the existing logs affordance where available.
   - Future protocol/event diagnostics.
   - Any unavailable advanced capability must render as an intentional future-ready disabled state with clear copy and accessible labeling.

### Security

- Keep provider credentials local and out of server state.
- Mask pairing codes and invite tokens by default.
- Copy actions copy the full underlying value when authorized, but the displayed value remains masked unless the user explicitly reveals it.
- Do not add product presets or committed provider configuration.

## Presence and Typing Protocol

### Event Model

Add protocol support for real presence and typing activity.

Recommended event types:

- `participant.presence_changed`
  - `participant_id`
  - `presence`: `online | idle | offline`
  - `updated_at`

- `participant.typing_started`
  - `participant_id`
  - `scope`: `room`
  - `started_at`

- `participant.typing_stopped`
  - `participant_id`
  - `scope`: `room`
  - `stopped_at`

Implement the three separate events above for the first version. If a later refactor introduces a combined activity event, it must preserve the same external semantics and expiry behavior.

### Server Rules

- A participant can only update their own presence/typing state.
- Removed or revoked participants cannot publish activity.
- Activity events are broadcast to the room event stream.
- Typing state must not become a permanent transcript artifact.
  - Preferred: ephemeral broadcast or short-lived state.
  - Acceptable first implementation: store events but room-state derivation treats typing as expiring and does not render old typing events as transcript messages.

### Web State Rules

- Composer emits typing started after input begins, with debounce to avoid event spam.
- Continued typing refreshes local timeout but should not repeatedly flood the server.
- Typing stops after 1.5 to 3 seconds of inactivity, after send, after input clear, and when leaving or losing the socket.
- The web client expires remote typing state if no stop event arrives.
- Avatar rail consumes derived presence/activity state.

## Sound Cues

### Default Policy

- Sound cues default to enabled.
- Browser autoplay restrictions still apply; actual audio begins only after a user interaction unlocks audio.
- Users can disable sound in the Room Control Center.
- Preference persists in local storage.

### Trigger Events

- New message from someone else: soft tick.
- AI starts replying or working: soft low pulse.
- Roundtable request or collection start: slightly more noticeable cue.
- Agent online: light cue.
- Join request: owner-only cue.

### Suppression Rules

- Do not play for the current user's own message.
- Do not play repeatedly for every streaming chunk.
- Use cooldown/debounce for rapid event bursts.
- Fail silently if audio cannot play.
- Sound off means no cue plays.

### Implementation Style

- Prefer Web Audio API synthesis for subtle sounds instead of adding bulky assets.
- Sound design should feel like warm glass, paper, wood, or soft mechanical studio cues, not generic chat beeps.
- Include a test-sound action in the Sound section.

## Motion and Animation

### Room Entrance

- Stagger reveal for room identity, avatar rail, conversation canvas, composer dock, and floating logo.
- Use short durations, roughly 150 to 450 ms.
- Use refined easing and avoid bouncy effects.

### Message Motion

- New messages fade/slide in subtly.
- Latest sender avatar briefly highlights.
- AI streaming card has a restrained animated border or scan line.
- Roundtable queued messages can use a light stacked-card motion.

### Floating Logo Motion

- Half-hidden rest state.
- Smooth slide-out on hover/focus.
- Drag state increases shadow/contrast.
- Opening the modal should feel visually connected to the logo control.

### Reduced Motion

- Respect `prefers-reduced-motion`.
- Remove continuous rotation and heavy transitions.
- Keep state visible through static icon, border, and label affordances.

## Mobile Design

### Header

- First row: room title and language icon.
- Second row: avatar rail.
- Room ID collapses into a short copy chip.
- Active roles remain prioritized.

### Conversation

- Human bubbles keep left/right distinction but use more of the width.
- AI cards span most of the viewport.
- System events remain compact.
- Empty state is smaller than desktop.

### Composer

- Fixed at the bottom and keyboard-safe.
- Mode switch is icon-first.
- Clear icon remains owner-only at composer top-right.
- Send remains reachable and not blocked by floating controls.

### Floating Logo and Control Center

- Floating logo sits at right middle/lower-middle and remains half-hidden when idle.
- Touch drag target is larger than desktop.
- Control Center becomes near-fullscreen.
- Tabs can be horizontal icon tabs or compact top navigation.

## Testing and Validation

### Protocol and Server Tests

- Presence/typing schemas validate expected payloads and reject invalid participants/scopes.
- Participants can only update their own activity.
- Removed/revoked participants cannot send activity events.
- Activity events broadcast to the room.
- Typing expiry prevents stale typing indicators.

### Web State Tests

- Derived room state includes participant presence and typing state.
- AI working state derives from streaming turns and Claude runtime status.
- Avatar ordering prioritizes active roles and groups Humans/Agents.
- Typing state clears after stop event, send, timeout, and room leave.

### UI Tests

- Header renders room title, room ID chip, avatar rail, and language toggle.
- Header does not render Clear room or Leave room buttons.
- Owner sees clear-conversation icon at composer top-right; non-owner does not.
- Clear conversation requires confirmation.
- Floating logo control is present, opens the Room Control Center, and can persist drag position.
- Room Control Center includes Agent, People, Invite, Room, Sound, and Advanced/Logs sections.
- Sound cues default enabled and can be disabled.
- Own messages, other human messages, AI messages, system events, Claude import messages, and Roundtable queued messages have distinct class/semantic treatments.

### Manual Playwright Validation

Desktop 1440 x 1000:
- Conversation area is visibly larger than the current room UI.
- Header is slim and contains only room identity, avatar rail, and language control.
- Floating logo is half-hidden, slides out, and opens the centered modal.
- AI, human, system, and Roundtable messages are visually distinct.

Mobile 390 x 844:
- Header does not crowd the viewport.
- Avatar rail remains usable.
- Composer stays keyboard-safe.
- Floating logo does not block send.
- Control Center is usable as a near-fullscreen modal.

Multi-role scenario:
- Human typing appears in avatar rail.
- AI streaming appears in avatar rail and AI work card.
- Roundtable state appears in avatar rail and composer mode.

Sound scenario:
- New messages from others play a cue after audio unlock.
- Own messages do not play a cue.
- Disabling sound stops future cues.
- Rapid event bursts do not produce excessive sound.

## Implementation Notes

- Keep components small and testable; split header identity, avatar rail, message variants, floating logo, Room Control Center, sound manager, and activity client logic into separate modules.
- Keep protocol schema changes centralized in `packages/protocol/src/schemas.ts`.
- Update server routes/event handling for activity events.
- Update `deriveRoomState` for activity, avatar status, and message variant data.
- Preserve local-first connector boundaries and do not move secrets into committed config or server state.
- Use icon-only controls carefully: every icon control needs an accessible name and hover/focus tooltip or visible label in modal contexts.
