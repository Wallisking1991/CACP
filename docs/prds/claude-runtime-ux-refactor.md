# Superseded design note

2026-05-06 update: the live Agent workflow UX direction is superseded by `docs/prds/agent-workflow-live-visibility-v2.md` where it conflicts with this document. The v2 decision is to display SDK-provided thinking deltas while a run is active, show the work process expanded during execution, and auto-collapse the work process after completion.

---

# Claude Runtime UX Refactor PRD

## 背景

当前 CACP 中 Agent（Claude Code）工作时，用户只看到静态的 "Thinking · Sending room message to Claude Code" 状态。`claude-agent-sdk@0.2.128` 提供了 27+ 种流式消息类型（`SDKMessage` 联合类型），但当前 `runtime.ts` 只处理了其中约 6 种，且多数是浅层利用。大量过程性信息被静默丢弃，导致用户体验与 Claude Code CLI 差距巨大。

## 目标

让用户在 Web 端实时、直观地看到 Agent 的完整工作过程，体验接近 CLI，同时结合 Web 视觉特效做优化。

## 非目标

- 不改造 Codex runtime（本次仅针对 Claude）
- 不做 thinking 内容的持久化（thinking 是过程性内容，刷新即丢失）
- 不做成本/性能分析的深度可视化（只展示基础汇总行）

---

## 一、SDK 消息映射设计

### 1.1 新增 Phase 值

扩展 `ClaudeRuntimePhaseSchema` 从 11 个值到 17 个值：

```
connecting, resuming_session, importing_session,
requesting_api, retrying_api, compacting_context, recalling_memory,
thinking, reading_files, searching, running_command,
running_subagent, executing_hook,
waiting_for_approval, generating_answer,
completed, failed
```

### 1.2 SDK → Phase 映射表

| SDK 消息类型 | `type`/`subtype` | 映射 Phase | current 文本示例 | detail 内容 |
|---|---|---|---|---|
| `SDKStatusMessage` | `system`/`status`, `status: 'requesting'` | `requesting_api` | "请求 Claude API 中..." | - |
| `SDKStatusMessage` | `system`/`status`, `status: 'compacting'` | `compacting_context` | "压缩上下文中..." | `{pre_tokens, post_tokens}` |
| `SDKAPIRetryMessage` | `system`/`api_retry` | `retrying_api` | "API 请求失败，2秒后重试 (2/3)" | `{attempt, max_retries, retry_delay_ms}` |
| `SDKMemoryRecallMessage` | `system`/`memory_recall` | `recalling_memory` | "从记忆召回 3 条相关记录" | `{mode, memory_count}` |
| `SDKPartialAssistantMessage` | `stream_event`, thinking block | `thinking` | "思考中..." | `{thinking_tokens?}` |
| `SDKPartialAssistantMessage` | `stream_event`, text block | `generating_answer` | "生成回答中..." | - |
| `SDKAssistantMessage` | `assistant` (完整消息) | `generating_answer` | "Claude Code 生成回答中" | - |
| `SDKToolProgressMessage` | `tool_progress` | 根据 tool_name | "Read foo.ts · 已运行 3s" | `{elapsed_time_seconds}` |
| `SDKTaskStartedMessage` | `system`/`task_started` | `running_subagent` | "启动子任务: code-review" | `{task_id, description}` |
| `SDKTaskProgressMessage` | `system`/`task_progress` | `running_subagent` | "子任务进度: 分析中..." | `{description, usage}` |
| `SDKHookStartedMessage` | `system`/`hook_started` | `executing_hook` | "执行 Hook: pre-commit" | `{hook_name, hook_event}` |
| `SDKHookProgressMessage` | `system`/`hook_progress` | `executing_hook` | "Hook 输出: lint passed" | `{stdout, stderr}` |
| `SDKCompactBoundaryMessage` | `system`/`compact_boundary` | `compacting_context` | "上下文已压缩: 15K → 8K tokens" | `{pre_tokens, post_tokens, duration_ms}` |
| `SDKResultMessage` | `result`/`success` | `completed` | "Claude Code 完成" | `{duration_ms, total_cost_usd, usage, num_turns}` |
| `SDKResultMessage` | `result`/`error_*` | `failed` | "Claude Code 失败" | `{errors, duration_ms}` |

### 1.3 Thinking 内容传输

新增事件类型 `claude.output.thinking_delta`，Payload：
```ts
{
  agent_id: string;
  turn_id: string;
  text: string;      // 增量文本
  done: boolean;     // 是否最后一条
}
```

Adapter 侧解析 `stream_event` 中的 `BetaRawMessageStreamEvent`：
- `content_block_start` + `BetaThinkingBlock` → 发送 `thinking_delta` (text: "", done: false)
- `content_block_delta` + `BetaThinkingDelta` → 发送 `thinking_delta` (text: delta.thinking, done: false)
- `content_block_stop` → 发送 `thinking_delta` (text: "", done: true)

---

## 二、Web 组件设计

### 2.1 Streaming Bubble 结构改造

当前 streaming bubble 结构：
```
<article class="message message-ai-card streaming-bubble">
  <div class="message-meta">
    <span>{agentName}</span>
    <span>AI</span>
  </div>
  <div class="streaming-status">{statusLine}</div>
  <div class="message-body">{turn.text}</div>
</article>
```

新结构：
```
<article class="message message-ai-card streaming-bubble">
  <div class="message-meta">...</div>
  <div class="streaming-status">{statusLine}</div>
  
  <!-- NEW: ThinkingAccordion -->
  <ThinkingAccordion 
    thinkingText={turn.thinkingText} 
    thinkingDone={turn.thinkingDone}
  />
  
  <!-- NEW: ToolProgressBar -->
  <ToolProgressBar 
    phase={turn.phase} 
    detail={turn.detail}
  />
  
  <!-- NEW: MemoryRecallPill -->
  <MemoryRecallPill 
    phase={turn.phase}
    detail={turn.detail}
  />
  
  <div class="message-body">{turn.text}</div>
  
  <!-- NEW: TurnSummaryFooter -->
  <TurnSummaryFooter 
    phase={turn.phase}
    detail={turn.detail}
  />
</article>
```

### 2.2 组件规格

#### ThinkingAccordion
- **触发**: `claude.output.thinking_delta` 事件到达
- **默认状态**: 折叠（显示一行 "Thinking · 482 tokens" 脉冲指示器）
- **展开内容**: 实时累积的 thinking 文本，等宽字体，浅灰色背景
- **完成状态**: thinking 完成后，指示器停止脉冲，保持可折叠

#### ToolProgressBar
- **触发**: `phase` 为 `reading_files`/`searching`/`running_command`
- **展示**: 细进度条（基于 `elapsed_time_seconds` 的脉冲动画，非真实进度）
- **文案**: "Read src/App.tsx · 已运行 3.2s"

#### APIStatusIndicator
- **触发**: `phase` 为 `requesting_api`/`retrying_api`
- **展示**: streaming-status 旁的小脉冲圆点
- **文案**: "请求 Claude API 中..." / "API 请求失败，2秒后重试 (2/3)"

#### TurnSummaryFooter
- **触发**: `phase` === `completed`
- **展示**: 消息卡片底部的一行灰色小字
- **文案**: "完成 · 2,847 tokens · 3 回合 · 12.3s · $0.0042"

#### MemoryRecallPill
- **触发**: `phase` === `recalling_memory`
- **展示**: 小的圆角标签 pill
- **文案**: "从项目记忆召回 · 3 条"

#### CompactFlash
- **触发**: `phase` === `compacting_context`
- **展示**: streaming-status 区域的短暂闪烁效果（CSS animation，1.5s）
- **文案**: "压缩上下文中: 15,234 → 8,192 tokens"

---

## 三、数据结构变更

### 3.1 Protocol Schema

```ts
// 扩展 enum
export const ClaudeRuntimePhaseSchema = z.enum([
  "connecting", "resuming_session", "importing_session",
  "requesting_api", "retrying_api", "compacting_context", "recalling_memory",
  "thinking", "reading_files", "searching", "running_command",
  "running_subagent", "executing_hook",
  "waiting_for_approval", "generating_answer",
  "completed", "failed"
]);

// 新增 detail 字段
export const ClaudeRuntimeStatusChangedPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  status_id: z.string().min(1),
  phase: ClaudeRuntimePhaseSchema,
  current: z.string().min(1).max(500),
  recent: z.array(z.string().min(1).max(500)).max(10),
  metrics: ClaudeRuntimeMetricsSchema,
  detail: z.record(z.string(), z.unknown()).optional(),  // NEW
  started_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

// 新增 thinking delta schema
export const ClaudeRuntimeThinkingDeltaPayloadSchema = z.object({
  agent_id: z.string().min(1),
  turn_id: z.string().min(1),
  text: z.string(),
  done: z.boolean().default(false)
});
```

### 3.2 Web State (StreamingTurnView)

```ts
export interface StreamingTurnView {
  turn_id: string;
  agent_id: string;
  text: string;
  phase?: string;
  current?: string;
  metrics?: ClaudeRuntimeMetrics;
  started_at?: string;
  detail?: Record<string, unknown>;      // NEW
  thinkingText?: string;                 // NEW
  thinkingDone?: boolean;                // NEW
}
```

---

## 四、Adapter 层重写 (runtime.ts)

核心变更：全面重写 `for await` 循环，为每种 SDK 消息类型分配正确的 phase 和 detail。

### 4.1 关键逻辑

1. **send() 后状态真空填补**
   - `SDKStatusMessage` (`requesting`) → `requesting_api`
   - `SDKAPIRetryMessage` → `retrying_api` (带 retry detail)

2. **Thinking 内容提取**
   - 解析 `stream_event` 中的 `content_block_start`/`delta`/`stop`
   - 通过 `publishThinkingDelta()` 发送到 room
   - 同时发布 `thinking` phase 状态

3. **Tool 执行进度**
   - `SDKToolProgressMessage` → 利用 `elapsed_time_seconds` 构造 current 文本
   - detail 包含 `elapsed_time_seconds`

4. **子 Agent / Hook**
   - `SDKTaskStarted/Progress/Updated` → `running_subagent`
   - `SDKHookStarted/Progress` → `executing_hook`

5. **回合结束汇总**
   - `SDKResultMessage` → `completed` phase
   - detail 包含 `duration_ms`, `total_cost_usd`, `usage`, `num_turns`

6. **移除 dead code**
   - 删除 lines 204-220（基于旧版 SDK 假设的 `record.message.phase` 读取）

---

## 五、Web 层改造

### 5.1 room-state.ts

- 处理新增事件 `claude.output.thinking_delta`
- 在 `streamingTurns` Map 中维护 `thinkingText` 和 `thinkingDone`
- `detail` 字段透传到 `StreamingTurnView`

### 5.2 Thread.tsx

- 扩展 `phaseDisplayNames` 映射（新增 6 个中文翻译）
- 修改 `formatStatusLine` 支持 detail 字段
- 在 streaming bubble 中集成 6 个新组件

### 5.3 App.css

新增样式：
- `.thinking-accordion` — 可折叠面板
- `.thinking-accordion__content` — 等宽字体 thinking 文本
- `.tool-progress-bar` — 脉冲进度条
- `.api-status-indicator` — 脉冲圆点
- `.turn-summary-footer` — 灰色汇总行
- `.memory-recall-pill` — 圆角标签
- `.compact-flash` — 闪烁动画

### 5.4 i18n

新增翻译键：
```
agent.phase.requesting_api
agent.phase.retrying_api
agent.phase.compacting_context
agent.phase.recalling_memory
agent.phase.running_subagent
agent.phase.executing_hook
agent.thinking.collapsed
agent.thinking.tokens
agent.tool.elapsed
agent.summary.tokens
agent.summary.turns
agent.summary.duration
agent.summary.cost
agent.memory.recalled
agent.compact.reduced
```

---

## 六、实施步骤

### Phase 1: Protocol (1 个文件)
1. `packages/protocol/src/schemas.ts` — 扩展 phase enum，新增 detail 字段，新增 thinking_delta schema，新增事件类型，新增类型导出

### Phase 2: Adapter (1 个文件)
2. `packages/cli-adapter/src/claude/runtime.ts` — 全面重写 stream 处理逻辑

### Phase 3: Web State (1 个文件)
3. `packages/web/src/room-state.ts` — 处理 thinking_delta 事件，维护 thinking 状态

### Phase 4: Web UI (3 个文件)
4. `packages/web/src/components/Thread.tsx` — 集成新组件
5. `packages/web/src/App.css` — 新增样式
6. `packages/web/src/i18n/` — 新增翻译键

### Phase 5: 测试 (多个文件)
7. 更新 protocol 测试
8. 更新 cli-adapter runtime 测试
9. 更新 web room-state 测试
10. 更新 web Thread 测试
11. 全量测试验证

---

## 七、验收标准

- [ ] 17 个 phase 值全部在 protocol schema 中定义
- [ ] Adapter 能正确识别并映射所有主要 SDK 消息类型到对应 phase
- [ ] Thinking 内容实时流式展示，可折叠，默认折叠
- [ ] Tool 执行时显示进度条和耗时
- [ ] API 重试时显示重试信息
- [ ] 回合结束显示 tokens/回合/时间/$成本 汇总行
- [ ] 所有新增组件有对应的 CSS 动画效果
- [ ] 全部 749+ 测试通过
