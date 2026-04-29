# Claude Session Picker Modal Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude history inspection and resume usable when many history sessions are shown.

**Architecture:** Keep the existing preview/request/resume data flow, but change the inspected session UI from an inline panel after the list into a fixed modal overlay. Add bounded scroll regions for the session list and transcript preview.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS.

---

## File Structure

- Modify `packages/web/test/claude-session-picker.test.tsx`: assert inspect opens a modal outside the session list and resume still calls `onSelect`.
- Modify `packages/web/test/app-copy.test.ts`: assert CSS contains bounded scroll rules for the session list and preview messages.
- Modify `packages/web/src/components/ClaudeSessionPicker.tsx`: wrap list row title metadata and render inspect details in modal overlay.
- Modify `packages/web/src/App.css`: add scroll bounds for history list and modal/preview layout.

## Task 1: Failing UI tests

- [ ] Add a component test that renders many sessions, clicks one inspect button, expects `.claude-session-modal-overlay`, expects the dialog not to be inside `.claude-session-list`, and verifies **Select and resume** calls `onSelect`.
- [ ] Add a CSS source test that checks `.claude-session-list` has `max-height` and `overflow-y: auto`, and `.claude-session-preview-messages` has `overflow-y: auto`.
- [ ] Run `corepack pnpm --filter @cacp/web test -- claude-session-picker.test.tsx app-copy.test.ts` and verify RED.

## Task 2: Modal and scroll implementation

- [ ] Update `ClaudeSessionPicker.tsx` to render inspected session in `.claude-session-modal-overlay > .claude-session-inspect` instead of inline after the list.
- [ ] Add a row content wrapper so long titles and metadata can wrap without hiding the inspect button.
- [ ] Add CSS for `.claude-session-list`, `.claude-session-list-main`, `.claude-session-modal-overlay`, `.claude-session-inspect`, `.claude-session-preview`, and `.claude-session-preview-messages`.
- [ ] Run the focused web tests and verify GREEN.
- [ ] Commit with `fix(web): make Claude session preview modal scrollable`.

## Task 3: Validation and finish

- [ ] Run `corepack pnpm --filter @cacp/web test -- claude-session-picker.test.tsx app-copy.test.ts`.
- [ ] Run `corepack pnpm check`.
- [ ] Merge back to master after validation passes.
