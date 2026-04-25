# CACP 协同式智能体通信协议设计草案

日期：2026-04-25  
状态：设计草案 / MVP 规格  
项目定位：Protocol-first、Local-first、可升级自托管的多人 AI 协作协议与参考平台

## 1. 背景与问题

当前大多数 AI 对话产品默认是“单个人 + 单个 AI + 单条上下文线”。这种模式不适合真实项目协作，因为真实讨论往往需要多个人共同判断、补充、反驳、决策，并驱动不同 AI Agent 或工具执行任务。

CACP 要解决的问题不是再做一个 AI 聊天产品，而是定义一种新的协同模式：多人类用户、多个 AI Agent、不同客户端可以进入同一个共享协作空间，共同讨论、提问、决策、执行和沉淀产物。

## 2. 项目定位

CACP 全称暂定为 **Collaborative Agent Communication Protocol**，中文可称为 **协同式智能体通信协议**。

它的核心定位是：

> 一个让多人类用户、多种 AI Agent、不同客户端共同进入同一协作空间的通信协议与参考平台。

CACP 不替代 Codex、Claude Code、opencode、Hermes、OpenClaw、Cursor Agent 或企业内部 Agent。它提供的是这些 Agent 之上的多人协作通信层、治理层和事件标准。

## 3. 第一版目标

第一版目标是跑通“多人共同参与 AI 对话并共同驱动 Agent”的最小闭环。

MVP 需要支持：

- 多人房间
- 共享事件流
- 邀请其他人加入当前 AI 讨论
- AI 向多人提问
- 多人回答、评论、讨论
- 决策点与提案机制
- 策略化投票与审批
- 通用 CLI Agent 接入
- Agent 任务发起与输出流式回传
- 事件日志持久化与回放
- 匿名 Demo + token/role 协议模型
- Local-first 部署，并保留自托管升级路径

MVP 暂不做：

- 完整账号系统
- 商业 SaaS 多租户平台
- 深度适配所有 Agent
- 完整长期记忆系统
- 完整 MCP/A2A 桥接
- 富文本白板、视频会议、复杂文档协作
- Agent 插件市场

## 4. 总体架构

```text
Clients / 客户端
  Web Room / CLI Client / Future IDE Plugin
        ↓ WebSocket / HTTP
CACP Protocol Server
  Rooms / Events / Identity / Policy / Tasks
        ↓ CACP Event Stream
Agent Adapters
  Generic CLI Adapter first
        ↓ local process
AI Agent Tools
  Codex / Claude Code / opencode / Hermes / custom agents
```

CACP Server 是标准核心；Web Room 与 CLI Adapter 是参考实现。

### 4.1 CACP Protocol Server

负责：

- 房间管理
- 参与者管理
- 事件存储与广播
- 问题、讨论、决策、提案流程
- Agent 注册与任务生命周期
- Policy Engine 策略判断
- 权限校验
- 结果、决策、产物沉淀

### 4.2 Web Room 参考客户端

用于人类协作：

- 创建/加入房间
- 查看历史上下文
- 发消息
- 回答 AI 问题
- 发起或参与决策
- 查看提案与投票
- 发起 Agent 任务
- 查看 Agent 输出流

### 4.3 Generic CLI Agent Adapter

用于把任意本地 CLI Agent 接入 CACP。

示例配置：

```yaml
agent_id: local-agent
name: Local CLI Agent
command: your-agent-command
args: []
working_dir: .
input_mode: stdin
output_mode: stream
```

职责：

- 使用 token 连接 CACP Server
- 注册本地 Agent
- 监听 task 事件
- 启动本地命令
- 捕获 stdout/stderr
- 转换为 `task.output` 事件
- 发送 `task.completed` 或 `task.failed`

## 5. 核心协议模型

CACP 采用事件流模型：房间里发生的一切都表示为事件，并按顺序广播、存储和回放。

### 5.1 Room

多人和 Agent 协作的空间。

字段包括：

- `room_id`
- `name`
- `created_by`
- `participants`
- `agents`
- `event_log`
- `policies`

### 5.2 Participant

参与者可以是人、Agent、系统或观察者。

```json
{
  "id": "user_123",
  "type": "human",
  "display_name": "Alice",
  "role": "owner"
}
```

类型：

- `human`
- `agent`
- `system`
- `observer`

角色：

- `owner`
- `admin`
- `member`
- `observer`
- `agent`

### 5.3 Event

所有行为统一为事件。

```json
{
  "event_id": "evt_123",
  "room_id": "room_abc",
  "type": "message.created",
  "actor_id": "user_123",
  "created_at": "2026-04-25T10:00:00Z",
  "payload": {}
}
```

第一版事件类型包括：

```text
room.created
participant.joined
participant.left
participant.role_updated
invite.created

message.created

question.created
question.response_submitted
question.closed

decision.created
decision.finalized

proposal.created
proposal.vote_cast
proposal.approved
proposal.rejected
proposal.expired

agent.registered
agent.unregistered
agent.disconnected

task.created
task.started
task.output
task.completed
task.failed
task.cancelled

artifact.created
context.updated
```

## 6. 协作讨论与决策机制

CACP 的协作治理不只用于危险动作审批，也用于 AI 对话过程中的多人参与、共同判断和正式决策。

### 6.1 Open Discussion

房间成员可以共同参与同一段 AI 对话。AI 不再只接收一个人的回答，而是可以综合多个成员的观点。

示例：

```text
AI：第一版 MVP 应该优先支持哪种入口？
Alice：我觉得 Web 更适合验证。
Bob：协议标准应该 API 优先。
Charlie：Web 可以作为参考实现。
AI：我总结一下，目前有三种观点……
```

### 6.2 AI Question

AI 可以向整个房间或指定成员发起问题。

```json
{
  "type": "question.created",
  "payload": {
    "question_id": "q_123",
    "scope": "room",
    "question": "第一版 MVP 应该优先支持哪种 Agent 接入方式？",
    "expected_response": "single_choice",
    "options": ["CLI Adapter", "HTTP API", "MCP/A2A Bridge"]
  }
}
```

多人分别回答：

```json
{
  "type": "question.response_submitted",
  "payload": {
    "question_id": "q_123",
    "respondent_id": "user_bob",
    "response": "CLI Adapter",
    "comment": "最容易验证现有 Agent 工具。"
  }
}
```

### 6.3 Decision Point

当讨论需要收敛时，系统可以创建决策点。

```text
discussion
  ↓
decision.created
  ↓
成员表达意见 / 投票 / 评论
  ↓
policy engine 判断是否达成共识
  ↓
decision.finalized
```

决策可以是正式投票，也可以是非正式共识记录。

### 6.4 Proposal

Proposal 是一种正式提案机制，可以用于：

- 批准 Agent 执行命令
- 确认产品方向
- 选择技术方案
- 通过设计文档
- 确认任务拆分
- 授权某个 Agent 接管任务

Proposal 生命周期：

```text
created → voting → approved / rejected / expired
```

投票事件：

```json
{
  "type": "proposal.vote_cast",
  "payload": {
    "proposal_id": "prop_123",
    "voter_id": "user_456",
    "vote": "approve",
    "comment": "同意执行，但只允许 read-only 命令"
  }
}
```

投票值：

- `approve`
- `reject`
- `abstain`
- `request_changes`

## 7. Policy Engine

Policy Engine 判断问题、决策或提案是否达成通过条件。

第一版内置策略：

1. `owner_approval`：owner 一人批准即可
2. `majority`：有投票权成员超过半数批准
3. `role_quorum`：指定角色达到指定票数
4. `unanimous`：所有有投票权成员同意
5. `no_approval`：低风险动作自动通过

示例：

```json
{
  "policy": {
    "type": "role_quorum",
    "required_roles": ["owner", "admin"],
    "min_approvals": 1,
    "expires_in": "10m"
  }
}
```

## 8. Agent 任务模型

第一版采用混合运行模式：实现上先支持一次性任务，协议上预留 session、resume、interrupt、stream、approval 等扩展能力。

任务创建事件：

```json
{
  "type": "task.created",
  "payload": {
    "task_id": "task_123",
    "target_agent_id": "agent_local",
    "prompt": "请分析这个项目结构",
    "mode": "oneshot",
    "requires_approval": true
  }
}
```

任务生命周期：

```text
task.created
  ↓
task.started
  ↓
task.output
  ↓
task.completed / task.failed / task.cancelled
```

## 9. 身份、邀请与权限

MVP 支持匿名快速进房间，但协议层按 `identity + token + role` 设计。

流程：

```text
owner 创建房间
  ↓
系统生成 owner token
  ↓
owner 创建 invite
  ↓
新成员通过 invite/token 加入
  ↓
系统分配 role
```

角色权限原则：

- `owner`：房间创建者和最终控制者
- `admin`：协助管理房间与成员
- `member`：参与讨论、回答问题、投票、发起任务
- `observer`：只读参与
- `agent`：代表 AI/工具代理

## 10. 部署形态

第一版采用 **Local-first + 可升级自托管**。

MVP 默认可以在本地跑通：

```text
localhost CACP Server
localhost Web Room
local CLI Adapter
local Agent command
```

架构上保留团队服务器部署方式：

```text
Self-hosted CACP Server
  ↓
多人浏览器加入
  ↓
各自本地 CLI Adapter 通过 token 连接
```

## 11. 技术选型

推荐使用 TypeScript/Node.js monorepo。

### 11.1 Server

推荐：

- Fastify
- `ws`
- Zod 或 JSON Schema
- SQLite

### 11.2 Web Room

推荐：

- React
- Vite
- TypeScript

### 11.3 CLI Adapter

推荐：

- Node.js
- TypeScript
- child_process spawn
- YAML/JSON config

### 11.4 Protocol Package

独立维护共享类型与 schema。

包结构建议：

```text
cacp/
  packages/
    protocol/
      src/
        events.ts
        schemas.ts
        policies.ts
    server/
      src/
        rooms.ts
        events.ts
        websocket.ts
        policy-engine.ts
        tasks.ts
    web/
      src/
        App.tsx
        room/
        components/
    cli-adapter/
      src/
        index.ts
        config.ts
        runner.ts
  docs/
    protocol/
      cacp-v0.md
    examples/
      generic-cli-agent.yaml
```

## 12. 安全边界

MVP 虽然 local-first，但要明确安全边界：

- CLI Adapter 默认只执行用户配置的命令
- Agent task 默认可要求房间策略确认
- token 决定参与者身份和角色
- observer 只能读取，不能发起任务或投票
- 所有 Agent 输出记录为事件，方便审计
- 本地命令执行风险由运行 adapter 的用户承担
- 协议预留 capabilities、permissions、audit log

协议预留字段：

```text
agent.capabilities
task.required_permissions
proposal.policy
execution.audit_log
```

## 13. 错误处理

错误应转成标准事件，便于 Web Room 展示与审计。

错误事件包括：

```text
task.failed
agent.disconnected
proposal.expired
participant.auth_failed
policy.evaluation_failed
adapter.process_error
```

## 14. 测试策略

MVP 测试重点：

- Event schema 校验
- Room 创建与加入
- token / role 权限
- invite 加入流程
- question / response 流程
- decision / proposal / vote 流程
- policy engine 判断
- task 生命周期
- CLI Adapter 子进程执行与输出流
- WebSocket 事件广播
- SQLite 事件日志持久化与回放

## 15. 协议版本控制

协议从一开始就要有版本。

```json
{
  "protocol": "cacp",
  "version": "0.1.0"
}
```

版本路线：

- `cacp-v0.1`：实验协议，跑通多人讨论 + CLI Agent MVP
- `cacp-v0.2`：加入长会话、resume、interrupt、更丰富 adapter 能力
- `cacp-v1.0`：稳定标准草案

## 16. 第一版成功标准

MVP 成功标准：

1. 一个用户可以创建 CACP 房间。
2. 多个用户可以加入同一房间并看到共享上下文。
3. AI 或用户可以创建问题，多个成员可以分别回答。
4. 房间可以形成决策或提案，并按 policy 判断结果。
5. Generic CLI Adapter 可以注册本地 Agent。
6. 房间成员可以发起 Agent task。
7. Agent 输出可以流式回传到房间事件流。
8. 讨论、决策、任务、输出都能被记录和回放。
9. 整个系统可以 local-first 运行。
10. 协议文档足够清晰，使第三方可以基于事件 schema 开发自己的客户端或 adapter。

## 17. 核心价值总结

CACP 让 AI 对话从：

> 个人临时聊天

升级为：

> 多人可参与、可讨论、可提问、可决策、可执行、可沉淀的协作过程。

它不是一个多人版 ChatGPT，而是一个面向未来 AI Agent 生态的协作通信标准。
