# Claude Session Picker Modal Scroll Design

**Date:** 2026-04-29
**Status:** Approved for implementation

## Problem

After room creation, Claude Code history sessions load, but clicking **查看 / Inspect** appears to do nothing and users cannot resume a selected history chat. When the session list is long, there is no internal scrollbar. The page body and chat panel are fixed-height with `overflow: hidden`, so the current inspect panel is rendered after the full list and can be pushed outside the visible viewport.

## Root Cause

`ClaudeSessionPicker` renders the transcript inspect panel inline after `ul.claude-session-list`. The picker lives above the internally scrolling thread, not inside a scroll container. With many sessions, the inline inspect panel moves below the visible area, while `body` and `.chat-panel` prevent page-level scrolling.

## Desired Behavior

- The session list should have its own vertical scrollbar when there are many sessions.
- Clicking **查看 / Inspect** should visibly open a preview dialog immediately, independent of list length.
- The preview dialog should have a scrollable transcript area.
- **选择并恢复 / Select and resume** and cancel controls should remain accessible.
- Existing preview request and resume data flow should remain unchanged.

## Design

Use a modal overlay for inspected Claude sessions. Keep the list in the picker, but give it a bounded height with `overflow-y: auto`. When `inspectedSession` is set, render a fixed-position modal overlay containing the session details, transcript preview, warning text, and actions. The modal content and preview messages use internal scroll regions so long transcripts do not push the action buttons out of reach.

## Testing

- Update `ClaudeSessionPicker` component tests to prove clicking inspect renders a modal overlay and that the dialog is outside the session list.
- Add a source/CSS regression test ensuring the session list and preview transcript have scroll styles.
- Run focused web tests and then `corepack pnpm check`.
