# Homepage Logo, Animation, and Mobile UI Design

## Summary

This design upgrades the CACP web homepage into a premium, high-impact product entry while keeping the existing room creation and connection-code flow intact. The homepage becomes a Hero Showcase + Quick Start console: a visually rich brand area with an animated CACP logo on the left and a focused quick-create card on the right.

The implementation will not auto-create rooms or generate connection codes on page load. Users still create a room explicitly, then receive the current in-room connector/code experience. This avoids empty room creation, repeated rooms on refresh, and early exposure of connection codes.

## Goals

- Create a distinctive CACP logo that communicates an AI collaboration room and protocol hub.
- Add high-impact but tasteful animation using GSAP and SVG.
- Make the desktop homepage feel premium and avoid unnecessary page scroll on common monitor sizes.
- Simplify the default homepage flow to quick room creation only.
- Show the join flow only when the page is opened from an invite link.
- Improve mobile homepage layout and lightly improve mobile room usability.
- Preserve current room creation, join request, local connector, and connection-code behavior.

## Non-Goals

- Do not auto-create a room when a user opens the homepage.
- Do not generate an agent connection code before the room is explicitly created.
- Do not redesign the entire room workspace information architecture.
- Do not introduce Tailwind, Magic UI, Aceternity UI, Rive, or Lottie.
- Do not replace existing protocol, server, invite, pairing, or connector APIs.

## Recommended Approach

Use the Hero Showcase + Quick Start console design.

The homepage should balance visual impact with operational clarity. The left side sells the product with a dynamic protocol-core logo and brand copy. The right side lets users create a room immediately with only required inputs visible by default. Advanced options remain available but collapsed.

Compared with a minimal landing page, this better matches the requested cool presentation. Compared with a full visual experience, it keeps the product practical and avoids hiding the primary action behind extra clicks.

## Desktop Homepage Layout

### Structure

Use a two-column first-screen layout on desktop.

Left showcase area:

- Animated CACP logo.
- Brand name or protocol label.
- Main headline about a local-first collaborative AI room.
- Short supporting copy explaining the core path: create a room, connect a local agent, invite teammates.
- Three compact value tags, for example:
  - Local-first Agent
  - Shared AI Room
  - Governed Collaboration

Right quick-start console:

- Card title such as "快速创建协作房间" / "Create a collaborative AI room".
- Required fields only by default:
  - Owner display name.
  - Room name.
- Primary submit button:
  - Local mode: create room and start agent.
  - Cloud mode: create room and generate connector code.
- Collapsed advanced options for agent type and permission.

### Scrolling and Sizing

- For 1366x768 and larger displays, the main homepage should fit in one viewport whenever practical.
- The page shell should avoid global vertical scrolling on common desktop monitors.
- If advanced options or cloud connector copy exceeds available height, only the card internals may scroll lightly.
- Larger displays should gain breathing room rather than oversized forms.
- Mobile layouts may scroll naturally.

## Logo Design

The logo represents an AI collaboration protocol room.

Elements:

- Outer rounded frame or orbital track for the managed room/workspace.
- Central illuminated protocol core for shared context and room state.
- Three surrounding nodes for human user, AI agent, and local connector/teammate.
- Thin connecting lines for messages, permissions, and events flowing through the room.
- CACP wordmark using the existing premium serif direction, refined with tighter spacing and stronger hierarchy.

Style boundaries:

- Use the current warm palette: deep ink, warm paper background, burnt orange, amber glow.
- Avoid saturated cyberpunk blue/purple neon.
- Avoid fast flicker, aggressive 3D flips, or distracting motion.
- The result should feel like a premium technical product, not a game splash screen.

## Animation Design

Use GSAP with inline SVG for the logo and key hero entrance effects.

### Entrance Timeline

- Draw the outer logo frame or track from invisible to visible.
- Illuminate the central protocol core.
- Reveal the three surrounding nodes sequentially.
- Send one light pass through the connecting lines.
- Bring in the headline, value tags, and quick-start console with subtle upward motion and opacity fade.

### Ambient Motion

- The core has a slow breathing glow.
- Nodes drift subtly or orbit within a very small range.
- Connecting lines occasionally show a moving light point.
- Background glow shifts slowly.
- The primary CTA shows a refined light sweep on hover/focus.

### Motion Boundaries

- GSAP should be scoped to the homepage visual components.
- Timeline cleanup must run when the component unmounts.
- Repeating animations should be slow and low intensity.
- Avoid large DOM particle systems. If decorative particles are added, keep their count small and CSS-driven.

## Quick Create Card

### Default State

The default card prioritizes fast creation.

Fields:

- Owner display name.
- Room name, prefilled with the existing default or a refined equivalent.

Actions:

- Primary create button.
- Loading state to prevent duplicate submission.
- Error presentation near the card or existing banner area.

### Advanced Options

Advanced options are collapsed by default behind a button such as "高级选项：Agent 类型、权限".

When expanded, show:

- Agent type:
  - Claude Code CLI.
  - LLM API Agent.
  - OpenAI-compatible API.
  - Anthropic-compatible API.
- Permission level:
  - Read only.
  - Limited write.
  - Full access.
- LLM API safety hint: API provider and key configuration stays local in the connector.
- Cloud mode connector download/help copy in a visually secondary area.

Behavior:

- The advanced section uses a smooth expand/collapse animation.
- The toggle exposes `aria-expanded`.
- LLM API selections continue to force read-only permission, matching current behavior.
- The advanced section should not dominate the first screen on desktop.

## Invite Link State

The ordinary homepage does not show a "join by invite" tab.

When URL parameters include a room and invite token, the page keeps the same hero visual language but swaps the right-side card into an invite join card.

Join card content:

- Title such as "加入共享 AI 房间" / "Join a shared AI room".
- Short copy explaining that the user is joining through an invite link.
- Display name input.
- Primary join/request button.
- A weak room ID hint at the bottom for troubleshooting. The invite token should not be emphasized.

Join behavior:

- Use the existing join request flow.
- After submit, show the existing waiting-room experience.
- On approval, enter the room.
- On rejection or expiration, show an error and allow returning to the homepage.

## Mobile Homepage Design

For screens below 768px, use a single-column layout.

Order:

1. Compact top bar with small logo/brand and language toggle.
2. Short hero section with scaled logo animation.
3. Quick create or invite join card.
4. Minimal footer with subdued copyright/contact information.

Mobile adjustments:

- Reduce headline size and keep it readable in 2-3 lines.
- Shorten vertical spacing.
- Make form fields and buttons full width with touch-friendly height.
- Keep advanced options collapsed by default.
- Move the card high enough that the user can begin input without excessive scrolling.
- Keep background effects subtle and avoid large continuous animation layers.

Invite-link mobile state:

- Use the same single-column shell.
- Shorten the hero section further.
- Prioritize the display name input and join button.

## Room Page Mobile Touch-Ups

The main scope is the homepage, but a small amount of room-page mobile polish is included to prevent a sharp experience drop after entering a room.

Adjustments:

- Reduce exposed header actions on small screens and rely more on the existing drawer.
- Keep room status and menu access visible.
- Ensure the chat panel and composer behave reliably within `100dvh`.
- Improve touch target sizing for composer actions where needed.

This is not a full room workspace redesign.

## Accessibility

- Support `prefers-reduced-motion`.
  - Skip or immediately complete GSAP entrance animations.
  - Disable looping ambient animations.
  - Keep static logo and static background.
- Maintain visible focus styles for all buttons and fields.
- Use semantic labels for inputs.
- Mark decorative SVG layers as `aria-hidden` or provide a concise `aria-label` for the main logo where appropriate.
- Ensure text contrast does not rely on glow effects.
- Use `aria-expanded` and keyboard-accessible controls for the advanced options panel.

## Performance

- Add GSAP only for SVG logo and limited hero effects.
- Prefer CSS gradients, transforms, and opacity for background effects.
- Avoid animations that trigger repeated layout work.
- Avoid large image or animation assets.
- Keep mobile animation lighter than desktop.
- Clean up GSAP timelines on unmount.

## Internationalization

Update both English and Chinese message files for:

- New hero headline/subcopy if copy changes.
- Value tags.
- Quick create card labels.
- Advanced options toggle.
- Invite join card copy.
- Any new accessibility labels.

Existing copy keys may be reused where appropriate, but obsolete homepage join-tab copy should no longer appear in the ordinary homepage.

## Testing Scope

Update or add web tests for:

- Ordinary homepage does not show the invite-join tab or manual invite fields.
- Ordinary homepage shows the quick create card.
- Advanced options are collapsed by default and reveal agent type/permission controls when expanded.
- Create form still calls the existing create handler with room name, display name, agent type, and permission level.
- Invite URL state shows the invite join card instead of the create card.
- Invite URL state requires only display name as the primary user-entered field.
- Join flow still calls the existing join handler with parsed room and token.
- Reduced-motion rendering does not fail.
- Key mobile classes/layout states are present where practical.

## Implementation Notes

Likely files involved:

- `packages/web/src/components/Landing.tsx`
- `packages/web/src/components/Header.tsx`
- `packages/web/src/components/Workspace.tsx`
- `packages/web/src/App.css`
- `packages/web/src/tokens.css` if new design tokens are needed
- `packages/web/src/i18n/messages.en.json`
- `packages/web/src/i18n/messages.zh.json`
- Relevant tests under `packages/web/test/`
- Root or web package dependency files if GSAP is added

The implementation should preserve strict TypeScript, ESM, NodeNext-compatible imports with `.js` extensions, existing two-space style, and current Vitest patterns.
