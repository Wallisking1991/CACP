# Room UX Polish Design

Date: 2026-04-27
Status: Draft for review
Scope: Web room UI, Landing page copy, room-state presentation

## Problem

The current cloud room UI exposes the full Local Connector connection code in the sidebar, counts Agent participants as people in some UI surfaces, shows join requests only in a sidebar section, and pre-fills user display names. These behaviors make the product feel less secure and less deliberate for a public cloud deployment.

## Goals

- Keep the Local Connector card in its current sidebar location.
- Avoid rendering the full connection code in the UI while still letting the owner copy it.
- Count only human participants as room people; show Agents separately.
- Make pending join requests obvious to the room owner with a modal prompt.
- Require users to type their display names when creating or joining a room.
- Add homepage copyright and support contact information.

## Non-Goals

- Do not change the pairing token format, expiry, or one-time claim behavior.
- Do not move Local Connector setup into the main chat area.
- Do not remove the existing sidebar Join Requests section.
- Do not redesign the entire landing page or room layout.

## Proposed UX

### Local Connector Card

The Local Connector card remains in the room sidebar. It continues to show download, copy, expiry, and safety information. The full `connection_code` must not be displayed as plain text. The preferred display is a masked preview such as:

```text
CACP-CONNECT:••••••••abcd
```

The copy button still writes the full connection code to the clipboard and gives clear feedback, for example `Copied`.

### People Count and Participant Lists

Room people counts should include only participants whose role/type is human-facing: owner, admin, member, and observer. Agents remain visible in the Agent card and agent selector, but they do not increment `header.peopleCount` and do not appear in the People list.

### Join Request Modal

When the owner has one or more pending join requests, show a modal dialog above the room UI. The modal displays the requester name and provides `Approve`, `Reject`, and `Later` actions. Closing with `Later` dismisses the modal locally for that request, but the request remains available in the sidebar. If multiple requests are pending, the modal presents the oldest pending request and indicates that more are waiting.

### Landing Page Names

The create-room owner display name and invited-user join display name fields default to empty strings. Both fields are required, and the submit buttons remain disabled until a non-empty display name is provided.

### Footer Copy

The landing page footer shows copyright and contacts in both languages:

- English: `© 2026 CACP. All rights reserved. Contact: 453043662@qq.com, 1023289914@qq.com`
- Chinese: `© 2026 CACP。保留所有权利。联系方式：453043662@qq.com，1023289914@qq.com`

## Component Changes

- `Landing.tsx`
  - Initialize `displayName` to `""`.
  - Keep display-name inputs required.
  - Add a localized footer for copyright and contacts.
- `Sidebar.tsx`
  - Replace full connection-code rendering with a masked preview or generated-status text.
  - Keep copying the full code through the existing copy action.
  - Ensure People list receives or displays only human participants.
- `Workspace.tsx` / `Header.tsx`
  - Pass human participant count to the header.
  - Keep Agent status separate from people count.
- `room-state.ts`
  - Prefer a small helper for human participant filtering so the rule is shared and testable.
- New or updated join-request modal component
  - Owner-only.
  - Driven by pending `joinRequests`.
  - Supports approve, reject, and local dismiss.
- i18n messages
  - Add copy feedback, modal labels, masked-code helper text, and footer text.

## Data and Security Notes

The full connection code remains in front-end state because the owner must copy it, but it should not be rendered as readable text. This reduces accidental exposure in screen sharing and screenshots. Clipboard copy remains an explicit owner action.

No server-side schema change is required. Join request approval and rejection continue using existing endpoints and events.

## Testing Plan

- Landing tests verify owner and join display-name inputs start empty and are required.
- Landing tests verify the footer contact copy appears in English and Chinese.
- Sidebar tests verify the full connection code is not visible, while copy writes the full value.
- Room-state or Workspace tests verify Agent participants are excluded from people count/list.
- Join-request modal tests verify owner-only display, approve/reject callbacks, and local `Later` dismissal.

## Acceptance Criteria

- Local Connector remains in the sidebar and does not show the full connection code.
- Clicking copy still copies the full connection code.
- Header and People list count humans only; Agents are displayed only in Agent-specific UI.
- Owners see a modal when a new join request is pending.
- Create and join display-name fields are empty by default and required.
- Landing footer includes both contact email addresses.
