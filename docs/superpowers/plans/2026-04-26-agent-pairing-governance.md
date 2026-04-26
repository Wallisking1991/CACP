# Agent Pairing and Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first testable CACP host pairing, invite-link, agent status, stale-turn recovery, and policy-governed decision/action approval flow.

**Architecture:** Extend the protocol with pairing/status/approval events, keep Server as the authority for tokens and policy evaluation, add CLI adapter `--pair` mode, and rebuild Web around host setup plus shared room interaction. Use pure helper modules for policy, pairing profiles, and room-state derivation so behavior is unit-testable.

**Tech Stack:** TypeScript, pnpm workspaces, Zod, Fastify, WebSocket, React, Vite, Vitest, playwright-cli for manual E2E.

---

## File structure map

- Modify `packages/protocol/src/schemas.ts` and tests for new event names.
- Add `packages/server/src/policies.ts` for question policy evaluation.
- Add `packages/server/src/pairing.ts` for agent profile command generation.
- Modify `packages/server/src/server.ts` for room policy, expiring invites, pairing claim, agent status, stale turns, question closing, and Claude action approval.
- Add/modify server tests: `pairing.test.ts`, `policies.test.ts`, `server-governance.test.ts`.
- Modify `packages/cli-adapter/src/config.ts` and `index.ts` for `--pair` mode.
- Add CLI adapter tests for argument parsing/profile config.
- Modify Web `api.ts`, `room-state.ts`, `App.tsx`, `App.css` for new flow.
- Add Web tests for invite link and room state.
- Update `README.md` and `docs/protocol/cacp-v0.1.md`.

## Task 1: Protocol events

- [ ] Add failing test for `agent.status_changed`, `agent.pairing_created`, `agent.action_approval_requested`, `agent.action_approval_resolved`, and `question.closed` payload acceptance.
- [ ] Add event names to `EventTypeSchema`.
- [ ] Run `corepack pnpm --filter @cacp/protocol test` and build.

## Task 2: Server policy helpers

- [ ] Write failing tests for owner approval, majority, unanimous, observer exclusion, and vote changes.
- [ ] Implement `evaluateQuestionPolicy` returning open/closed decision result.
- [ ] Run server helper tests.

## Task 3: Server pairing and invite links

- [ ] Write failing server tests for room creation with default policy, expiring invite join, and pairing claim.
- [ ] Implement room policy payload, invite expiry, pairing token creation and claim.
- [ ] Run server tests.

## Task 4: Agent online status and stale turns

- [ ] Write failing tests for `agent.status_changed` on stream connect/disconnect and stale turn failure.
- [ ] Implement status events and stale turn handling before creating new turns.
- [ ] Run server tests.

## Task 5: Decision and Claude action approval governance

- [ ] Write failing tests for `cacp-question` becoming blocking `question.created`, vote close, and Claude action hook approval/denial.
- [ ] Implement question close evaluation and action approval endpoint.
- [ ] Run server tests.

## Task 6: CLI adapter pairing mode

- [ ] Write failing CLI tests for `--pair --server` argument parsing and claimed profile config.
- [ ] Implement pairing claim and profile-to-command config.
- [ ] Keep legacy config-file mode working.
- [ ] Run CLI adapter tests.

## Task 7: Web host and invite UX

- [ ] Write failing Web tests for room-state derivation and invite URL parsing.
- [ ] Implement create room with policy, agent connector panel, expiring invite links, join-by-link screen, online/offline agent list, decision voting UI.
- [ ] Remove main UI task-debug dependencies.
- [ ] Run Web tests and build.

## Task 8: End-to-end verification and docs

- [ ] Run `corepack pnpm check`.
- [ ] Use `playwright-cli` to verify create room, pair Echo/adapter through generated command, send message, create invite link, join as second user, and vote on a decision.
- [ ] Update README and protocol docs.
- [ ] Commit final feature.
