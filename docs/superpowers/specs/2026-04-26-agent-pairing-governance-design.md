# CACP Agent Pairing and Governance Design

Date: 2026-04-26
Status: Approved for implementation

## Goal

Turn the current CACP room demo into a testable first version of the intended product flow: a host creates a governed AI room, pairs a local CLI agent through a generated command, shares a single invite link, and multiple participants collaborate with the AI through shared messages, votes, and approvals.

## Confirmed product decisions

- Host pairs local CLI through a generated command, not by manually editing `.local.json`.
- Invite links contain room id and invite token; invited users only enter a display name.
- Host manually selects the Active Agent, but UI must show online/offline/new/old agents clearly.
- Stale or disconnected turns must not permanently block the room.
- Web main UI removes manual task debugging.
- First visible agent options: Claude Code CLI, Codex CLI, opencode CLI.
- Permission levels: read-only, limited write, full access.
- First deep tool-level approval target: Claude Code CLI. Codex/opencode stay connection/read-only oriented in v1.
- Governance applies to both execution actions and AI-raised structured decisions.
- Structured decisions are blocking: AI continuation waits for the room policy result.
- Room default policy is selected at creation: owner approval, majority, unanimous.
- Invite roles: participant and observer.
- Invite links expire; host chooses 1 hour, 24 hours, or 7 days.
- Invalid/expired invites show a clear error.
- Observers can see full vote/approval details but cannot vote.
- Votes can be changed before the decision closes.

## Architecture

Server remains the authority for pairing tokens, invite tokens, active agent state, online/offline events, stale turn recovery, question policy evaluation, and Claude action approval. Web becomes a host/participant room UI with a generated agent connection command and invite-link flow. CLI adapter gains `--pair` mode, claims a pairing token from Server, receives an agent profile, registers itself, and then handles conversation turns as before.

Claude Code tool approval is implemented as a server-side approval endpoint plus generated hook metadata for the adapter. The first implementation exposes the CACP action approval API and generated hook URL; full local Claude settings generation is kept minimal and documented/tested at the API level so the room governance path is verifiable without relying on a paid Claude run.

## Success criteria

- Host creates a room with policy.
- Host creates a pairing command for Claude Code/Codex/opencode profile.
- Adapter can claim pairing token and register an agent without manually editing `.local.json`.
- Web shows online/offline agents and allows manual active selection.
- Offline/stale active turns do not permanently block later messages.
- Host generates an expiring invite link; participant opens link and only enters a name.
- Participant/observer roles behave correctly.
- AI decision blocks become question cards; participants can vote/change vote; policy closes the decision.
- Claude action approval endpoint turns a tool request into a policy-governed approval and returns allow/deny.
- `corepack pnpm check` passes.
