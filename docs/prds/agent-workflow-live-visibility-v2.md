# Agent Workflow Live Visibility v2 PRD

Date: 2026-05-06
Status: Design approved for implementation planning
Supersedes: `docs/prds/claude-runtime-ux-refactor.md` where it conflicts with this document.

## Decision Summary

The room should behave like a live agent workbench, not a compact chat-only answer card.

When an agent is running, the room should show as much observable work state and stream content as the SDK provides: thinking deltas, tool starts, tool inputs, tool progress, tool summaries, subagent/task events, hooks, memory recall, retries, compaction, approvals, elicitations, and the final answer stream. When the run completes, the work process should automatically collapse so the final answer becomes the primary readable content, while the complete process remains available for inspection.

The default UX rule is:

- Running run: work process expanded by default.
- Completed/failed run: final answer visible; work process collapsed by default.
- All agent activity for one turn stays in one card. Do not render duplicate status cards or separate legacy streaming bubbles for the same run-trace turn.

## Product Goal

Users should be able to watch an AI agent work in the room in real time, with a feeling close to Claude Code CLI or Codex CLI, but adapted to Web UI:

1. During execution, show the process, not just a spinner.
2. Show the content of process streams when the SDK exposes them.
3. Preserve readability after completion by collapsing the process.
4. Keep answer text and process trace attached to the same turn.
5. Avoid raw debug-looking rows as the default visual language.

## SDK Capability Baseline

This project currently uses `@anthropic-ai/claude-agent-sdk@0.2.128` in `packages/cli-adapter`.

Relevant local SDK type evidence:

- `Options.includePartialMessages` emits `SDKPartialAssistantMessage` stream events.
- `Options.thinking` supports `display?: "summarized" | "omitted"` for adaptive/enabled thinking.
- `SDKPartialAssistantMessage.event` is an Anthropic `BetaRawMessageStreamEvent`.
- `content_block_delta` can include:
  - `text_delta`
  - `thinking_delta`
  - `input_json_delta`
  - `signature_delta`
- `SDKToolProgressMessage` exposes `tool_use_id`, `tool_name`, `parent_tool_use_id`, `elapsed_time_seconds`, and optionally `task_id`.
- `SDKToolUseSummaryMessage` exposes `summary` plus `preceding_tool_use_ids`.
- `SDKResultSuccess` exposes `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage`, `modelUsage`, and `permission_denials`.

Official docs to keep aligned with:

- Claude Agent SDK overview: https://platform.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK streaming output: https://code.claude.com/docs/en/agent-sdk/streaming-output
- Adaptive thinking referenced by SDK types: https://docs.anthropic.com/en/docs/build-with-claude/adaptive-thinking

## Thinking Display Decision

The product should display `thinking_delta` content while the run is active.

Implementation must not invent, expand, or reconstruct hidden reasoning. It may only display the thinking stream actually provided by the SDK/API. The runtime should request displayable thinking where supported:

```ts
thinking: { type: "adaptive", display: "summarized" }
```

If the configured model or SDK run does not emit thinking deltas, the UI should still show a lightweight "Thinking..." state until another observable activity appears.

Thinking content is treated as room-visible process content:

- It is streamed to participants who can view the room.
- It is included in the run's process trace so it can be inspected after completion.
- It should not be separately exported into connector ledgers or long-term session-import transcripts unless a future design explicitly chooses that.
- It should be considered sensitive room content, equivalent to agent output/tool activity, because it passes through the room server event stream.

## Runtime Event Mapping

### Assistant text

- `content_block_delta` with `text_delta` continues to append to the answer stream.
- Full assistant messages may still be used as a safety net to synchronize final text.

### Thinking stream

- `content_block_start` with a thinking block starts or reuses an `AgentRunNode` for that content block.
- The node should use `kind: "reasoning_summary"`, title `Thinking`, and status `streaming` or `running`.
- `content_block_delta` with `thinking_delta.thinking` appends to that node with `agent.run.node.delta` and `delta_type: "text"`.
- `content_block_stop` completes the node.
- A thinking node with no text should be allowed but should render as a compact state only.

### Tool input and title enrichment

Current observed issue: Claude `Glob` nodes often render only as `Glob` because the runtime starts the tool node before complete input is available.

Required behavior:

- Track tool content blocks by stream `index` and `tool_use_id`.
- Accumulate `input_json_delta.partial_json` by block index.
- When partial JSON becomes parseable, update the node `detail.input` and user-facing title.
- On content block stop, make one final parse attempt.
- For common Claude Code tools, derive readable labels:
  - `Glob` / `Grep`: `Search files: <pattern>`
  - `Read`: `Read file: <file_path>`
  - `LS`: `List directory: <path>`
  - `Bash`: `Run command: <command>`
  - `Edit` / `MultiEdit` / `Write`: file-edit labels with path where available
- Preserve raw tool name and raw input in `detail` for technical trace.

### Tool progress and summaries

- `tool_progress` updates the existing tool node's elapsed time and status.
- It must not overwrite a richer title with a bare tool name.
- `tool_use_summary` completes or summarizes the preceding tool nodes when possible.
- If no SDK summary is available, complete the node without repeating the raw title as noisy summary text.

### System and auxiliary events

Continue capturing and rendering these as process nodes:

- memory recall
- API retry
- context compaction
- subagent task started/progress/updated/notification
- subagent assistant messages
- hooks
- approval requests and results
- elicitation requests and results
- plugin install, notifications, files persisted, mirror errors, session state changes where user-relevant

Low-value ambient/system events may be collapsed under the technical trace, but should not disappear entirely if they explain visible latency or a failed run.

## Web UI Design

### Single run card

Each agent turn renders as exactly one `AgentRunCard`.

The card has three regions:

1. Header: provider, status, live current activity, metrics.
2. Process: thinking/tools/system activity timeline.
3. Answer: streamed/final assistant answer.

### Running state layout

Running state should show process first because the user is watching the work happen.

Example:

```text
Claude Code Agent · Working · Searching files

Thinking
  I need to inspect the current directory and identify top-level project areas...

Search files: **/*
  running · 2.1s

Search files: src/**
  completed

Answer
  当前工作目录看起来是 packages/cli-adapter...
```

Rules:

- Process timeline expanded by default.
- Thinking text streams visibly.
- Tool inputs and progress update in place.
- Answer streams in the same card once available.
- Auto-scroll should follow new activity unless the user has manually scrolled away.

### Completed state layout

Completed state should make the final answer primary and collapse the process.

Example:

```text
Claude Code Agent · Completed · 58s · 4 searches · 1,162 output tokens

当前工作目录看起来是 packages/cli-adapter...

▸ Work process · thinking, 4 searches
```

When expanded:

```text
Thinking
  ...displayed SDK thinking stream...

Search files: **/*
Search files: src/**
Search files: test/**
Search files: dist/**
```

Rules:

- Final answer remains visible without requiring expansion.
- Work process collapsed by default.
- Expanded process preserves chronological order.
- The raw technical trace remains behind a deeper disclosure if needed.

### Failed state layout

Failed state should keep process available because process details help diagnose the error.

Rules:

- Error visible near the top.
- Partial answer visible if available.
- Process collapsed by default if the failure happened after visible answer text; otherwise expanded by default.
- Failed node(s) highlighted.

## Process Timeline Rendering Rules

The main work process is not a raw event dump. It is a readable timeline backed by the full trace.

Render priorities:

1. Thinking content and current active work.
2. Tool actions with readable names and inputs.
3. Subagent/task progress.
4. Approvals/elicitations requiring human action.
5. Memory/retry/compaction/system events.
6. Raw technical details.

Repeated actions should not be hidden while running, but can be visually compacted after completion:

- Running: show individual live nodes as they happen.
- Completed collapsed summary: aggregate counts, for example `4 file searches`.
- Completed expanded process: show individual nodes.

## Metrics

The run card should use SDK result data where available:

- duration
- API duration
- num turns
- total cost USD
- input/output/cache tokens
- files read/searches/commands
- permission denials

Header metrics should stay compact. Detailed metrics can live in the expanded process footer or technical trace.

## Protocol and Storage Direction

No old-data migration is required. Existing test data and previous run traces can be cleaned or ignored.

Preferred implementation direction:

- Reuse the provider-neutral `agent.run.*` and `agent.run.node.*` protocol where possible.
- Do not reintroduce separate legacy `claude.output.thinking_delta` rendering as the primary path.
- Thinking deltas should be attached to run nodes with `agent.run.node.delta` so the single-card run trace remains coherent.
- Add protocol fields only if existing node `text_chunks`, `detail`, `summary`, and `source_refs` cannot represent the needed state cleanly.

## Cross-Provider Direction

This v2 design is driven by Claude Agent SDK thinking/tool streams.

However, the Web card behavior should remain provider-neutral where possible:

- Claude Code: display thinking deltas, tool inputs, tool progress, and SDK result metrics.
- Codex CLI: display reasoning summaries/items and command/web-search/tool-call activity using the same expanded-while-running and collapsed-when-complete UI behavior.
- LLM API agents are out of scope unless they adopt run-trace events later.

## Testing Plan

Add tests before implementation changes.

Minimum focused coverage:

1. Claude runtime unit tests
   - `thinking_delta` text appends to a reasoning node.
   - no empty `Thinking complete` summary is rendered as meaningful content.
   - `input_json_delta.partial_json` enriches a `Glob` title with the pattern.
   - `tool_progress` does not downgrade an enriched title.
   - `result` metrics are preserved.

2. Web room-state tests
   - run node deltas produce visible text chunks.
   - final `message.created(kind=agent)` merges into the existing run card.
   - completed run stays terminal and does not mark agent as working.

3. React component tests
   - running run shows expanded work process and thinking text.
   - completed run shows answer and collapsed work process.
   - expanding work process reveals thinking and individual tool nodes.
   - no duplicate legacy streaming bubble appears for a run-trace turn.

4. Browser validation
   - real Edge pass with a fresh Claude session.
   - scenario: ask a question that triggers thinking and tools.
   - verify live process expansion during run.
   - verify auto-collapse after completion.
   - verify agent presence/status returns to non-working after completion.

## Acceptance Criteria

The feature is successful when:

- During a Claude run, the user can see thinking text streaming when SDK emits `thinking_delta`.
- During a tool-heavy run, tool actions update live and include useful inputs instead of only raw names like `Glob`.
- The final answer and process are in one card.
- After completion, the work process is collapsed automatically and the final answer is easy to read.
- The process can be expanded after completion to inspect the full work history.
- Agent presence/status no longer remains stuck in `Working` after terminal run events.
- Focused tests and full repo validation pass before merge.
