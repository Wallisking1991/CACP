# CACP v0.2 Decision Protocol

CACP v0.2 把协作房间里的“需要大家做决定”从旧的 `question.*` 概念升级为一组一等协议事件：`decision.*`。它的目标是让 AI/CLI Agent 可以在主聊天中提出明确决策点，所有成员在主聊天中自然回复，服务器用房间策略自动收敛结果，并把当前决策与历史决策保留为可审计记录。

> v0.2 仍保留 v0.1 的事件信封、房间、成员、Agent pairing、Active Agent、消息流等基础能力；本文只聚焦决策协议与清空房间边界。

---

## `decision.*` 的用途

`decision.*` 用于表达会阻塞协作流程的选择、审批或确认，例如：

- 选择下一步优先做哪个方案；
- 批准 Agent 执行某个敏感动作；
- 在多个实现路径之间达成一致；
- 记录谁在何时如何响应，以及策略为什么认为决策已完成。

Web UI 的 `Decisions` 面板不是主要输入入口，而是审计与状态视图：

- `Current Decision` 显示当前仍在等待响应或策略收敛的决策；
- `Decision History` 显示已经 resolved/cancelled 的决策；
- 用户通过主聊天输入答案，服务器把可识别答案记录为 `decision.response_recorded`。

---

## 事件列表

### `decision.requested`

当 Agent 或系统明确提出一个决策时创建。典型 payload：

```json
{
  "decision_id": "dec_123",
  "title": "Choose first CLI integration",
  "description": "We need to decide which CLI agent to validate first.",
  "kind": "single_choice",
  "options": [
    { "id": "A", "label": "Claude Code CLI" },
    { "id": "B", "label": "Codex CLI" },
    { "id": "C", "label": "opencode CLI" }
  ],
  "policy": { "type": "majority" },
  "blocking": true,
  "source_turn_id": "turn_123",
  "source_message_id": "msg_456"
}
```

当前实现重点支持：

- `kind: "single_choice"`
- `kind: "approval"`

协议 schema 还为未来的 `multiple_choice`、`ranking`、`free_text_confirmation` 预留了扩展空间。

### `decision.response_recorded`

当 eligible participant 在主聊天中回答当前决策，且服务器可以保守地解释该回答时创建。典型 payload：

```json
{
  "decision_id": "dec_123",
  "respondent_id": "pt_alice",
  "response": "A",
  "response_label": "Claude Code CLI",
  "source_message_id": "msg_789",
  "interpretation": {
    "method": "deterministic",
    "confidence": 1
  }
}
```

同一参与者可以修改答案：服务器追加新的 `decision.response_recorded`，派生状态以该参与者的最新答案为准。

### `decision.resolved`

当房间策略满足后自动创建。典型 payload：

```json
{
  "decision_id": "dec_123",
  "result": "A",
  "result_label": "Claude Code CLI",
  "decided_by": ["pt_alice", "pt_bob"],
  "policy_evaluation": {
    "status": "resolved",
    "reason": "majority policy satisfied"
  }
}
```

当前策略主要包括：

- `owner_approval`：owner 的有效响应即可关闭；
- `majority`：eligible voters 中超过半数选择同一响应；
- `unanimous`：所有 eligible voters 给出同一响应。

Eligible voters 是 human participant 中的 `owner`、`admin`、`member`。`observer` 和 `agent` 不参与投票。

### `decision.cancelled`

owner/admin 可以取消卡住或不再需要的当前决策。典型 payload：

```json
{
  "decision_id": "dec_123",
  "reason": "Cancelled from the web room controls",
  "cancelled_by": "pt_owner"
}
```

取消后的决策进入 Decision History。

### `room.history_cleared`

owner/admin 清空房间消息与决策历史时创建。典型 payload：

```json
{
  "cleared_by": "pt_owner",
  "cleared_at": "2026-04-26T00:00:00.000Z",
  "scope": "messages_and_decisions"
}
```

这是一个边界事件：边界之前的消息、streaming turn 和 decision 不再用于当前 UI 派生状态，也不再进入后续 Agent 上下文；参与者、Agent、Invite 等房间结构信息不因该边界被清除。

---

## 单一 Active Decision Gate

一个房间同一时间只能有一个 open 且 `blocking: true` 的 active decision。

规则：

1. 没有 active decision 时，Agent 可以通过 `cacp-decision` block 或 action approval API 创建新决策。
2. 已存在 active decision 时，服务器拒绝新的阻塞决策请求（`409 active_decision_exists`），并保留 Agent 原始消息。
3. 用户仍可继续围绕当前决策聊天、解释、补充意见。
4. Agent 可以解释选项、提醒缺失响应者、总结当前状态，但不应越过当前决策进入下一项。
5. 当前决策 resolved 或 cancelled 后，才允许创建下一个阻塞决策。
6. owner/admin 可以直接 cancel/skip 卡住的决策，不需要再发起一个决策来批准取消。

---

## `cacp-decision` fenced block

Agent 在最终回复中需要显式决策时，应输出独立的 fenced block：

````text
```cacp-decision
{
  "title": "Choose first CLI integration",
  "description": "We need to decide which CLI agent should be the first real validation target.",
  "kind": "single_choice",
  "options": [
    { "id": "A", "label": "Claude Code CLI" },
    { "id": "B", "label": "Codex CLI" },
    { "id": "C", "label": "opencode CLI" }
  ],
  "policy": "room_default",
  "blocking": true
}
```
````

服务器在 Agent turn complete 时解析该 block：

- 合法 block 会生成 `decision.requested`；
- `policy: "room_default"` 会展开为房间默认策略；
- malformed block 不会阻断消息保存；
- 已有 active decision 时不会创建第二个阻塞决策。

旧的 `cacp-question` block 属于 v0.1/question-centric 流程，新 Agent prompt 应使用 `cacp-decision`。

---

## 主聊天响应规则

用户不在 Decisions panel 里点击答案，而是在主聊天 composer 中回答。

当前实现采用保守的 deterministic interpretation：

- `single_choice`：识别 option id（如 `A`）、常见英文短语（如 `choose A`、`I choose A`）、中文短语（如 `选 A`）以及明确匹配的 option label。
- `approval`：识别 `approve`、`yes`、`agree`、`同意`、`可以` 为 approve；识别 `reject`、`no`、`disagree`、`不同意`、`不可以` 为 reject。
- 无法明确解释时，只保留普通聊天消息，不记录 `decision.response_recorded`。

主聊天消息本身仍以 `message.created` 保留；若它同时能回答当前决策，服务器会额外追加 `decision.response_recorded`，并在策略满足时追加 `decision.resolved`。

---

## Action approval as decisions

Agent 工具/动作审批不再作为特殊 question UI 处理，而是转换为 `kind: "approval"` 的 decision。

Agent 可调用：

```http
POST /rooms/:roomId/agent-action-approvals?token=<agent_token>&wait_ms=60000
```

服务器会：

1. 创建 `decision.requested`，通常带有 `decision_type: "agent_action_approval"` 与 `action_id`；
2. 等待房间成员在主聊天中回复 `approve` / `reject` 等可识别答案；
3. 满足策略后创建 `decision.resolved`；
4. 追加 `agent.action_approval_resolved`，让等待中的 Agent 请求获得审批结果；
5. 如果 `wait_ms` 到期且没有 resolution，则请求按未完成/超时处理。

这使工具审批、方案选择、人工确认都走同一套决策审计与策略评估路径。

---

## Clear-room 边界行为

`POST /rooms/:roomId/history/clear` 由 owner/admin 触发，并追加 `room.history_cleared`。

边界之后：

- 所有客户端同步隐藏边界之前的 messages、decision history、current decision 和 streaming turns；
- 后续 Agent context 只包含边界之后的新消息；
- 边界之前仍未完成的 Agent turn 不能再写入当前房间上下文；
- 边界之前的 active decision 不再阻塞新决策；
- participants、agents、agent selection、invites 等房间结构信息继续保留。

因此 Clear room 是“清空当前对话与决策上下文”的协作边界，而不是销毁房间或重置成员/Agent 连接。
