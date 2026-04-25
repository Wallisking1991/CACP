# CACP — 多人协同 AI 对话协议与参考实现

CACP（Collaborative Agent Communication Protocol）是一个实验性的 **多人 AI/Agent 协同协议与本地 MVP 平台**。

这个项目想验证一个核心方向：AI 对话不应该只能是“一个人 + 一个 AI”的单人会话。一个被授权的团队应该可以进入同一个房间，共享上下文、共同讨论、共同决策，并把 Claude Code、Codex、opencode、普通脚本或自定义 Agent 接入同一套协作协议。

当前实现已经从早期的“手动创建 Agent Task 调试面板”升级为 **多人共享 AI 对话房间**：

- 一个 Web 房间可以有创建者和多个被邀请参与者。
- 参与者在不同浏览器/不同身份下加入同一个房间，并看到同一条对话时间线。
- Web 只负责发送人类消息；AI 调用由 Server 统一触发，避免多个浏览器重复调用 Agent。
- 房间内可选择一个共享的 Active Agent。
- 每条人类消息会自动触发当前 Active Agent 回复。
- Agent 输出以 `agent.output.delta` 实时流式显示，完成后保存为持久 `message.created`。
- CACP 自己用最近 20 条持久消息组装共享上下文，而不是依赖 Claude Code / Codex 自己的历史会话。
- 旧的 `task.created` Agent 任务接口仍保留，但它不是当前 Web 主流程。

> 当前项目是本地 MVP / 协议实验，不是生产级系统。

---

## 1. 当前可以演示什么

### 单人 + AI

创建者进入 Web 房间，启动一个 CLI Agent，选择 Active Agent 后直接聊天。

### 多人 + AI

创建者生成 invite token，另一个人用另一个浏览器/无痕窗口加入同一房间。双方都能看到彼此和 AI 的消息，并且都可以继续参与讨论。

### Server 统一编排 Agent

当人类发送消息时，Server 会：

1. 追加一条 human `message.created`；
2. 查找房间当前选中的 Active Agent；
3. 用最近 20 条持久消息组装 `context_prompt`；
4. 追加 `agent.turn.requested`；
5. Adapter 收到事件后调用本地 CLI；
6. CLI 输出通过 `agent.output.delta` 流式写回；
7. 完成后 Server 追加 `agent.turn.completed` 和 agent `message.created`。

如果当前 Agent 正在回复，新的用户消息不会并发触发第二个同 Agent 进程，而是追加：

```text
agent.turn.followup_queued
```

当前回复完成后，Server 会再创建一轮 follow-up turn。

---

## 2. 仓库结构

```text
.
|-- docs/
|   |-- examples/
|   |   |-- generic-cli-agent.json        # Echo/通用 CLI Agent 模板
|   |   `-- claude-code-agent.json        # Claude Code CLI Agent 模板
|   |-- protocol/
|   |   `-- cacp-v0.1.md                  # 协议草案
|   `-- superpowers/
|       |-- plans/
|       `-- specs/
|-- packages/
|   |-- protocol/      # @cacp/protocol：事件、参与者、策略等 Schema
|   |-- server/        # @cacp/server：Fastify + WebSocket + SQLite 事件服务器
|   |-- cli-adapter/   # @cacp/cli-adapter：把本地命令桥接成 Agent
|   `-- web/           # @cacp/web：React/Vite 多人 AI 房间 UI
|-- package.json
|-- pnpm-workspace.yaml
`-- tsconfig.base.json
```

---

## 3. 核心架构

```text
多人 Web 客户端 / 未来 CLI 或 IDE 客户端
        |
        | HTTP + WebSocket
        v
CACP Server
  room / participant / invite / event log
  active agent / context prompt / agent turn
        |
        | CACP event stream + lifecycle endpoints
        v
CLI Adapter
        |
        | stdin / stdout / stderr
        v
Claude Code / Codex / opencode / 本地脚本 / 自定义 Agent
```

设计原则：

- **协议优先**：Web 只是参考 UI，Agent 也只是参考接入方式。
- **事件溯源**：房间状态由 append-only CACP events 派生。
- **Server 是协同事实源**：Active Agent、上下文组装、turn 编排都由 Server 负责。
- **多人共享上下文**：每个参与者发言都会进入同一条持久事件流。
- **CLI 可替换**：只要能从 stdin 接收 prompt、从 stdout/stderr 输出内容，就能被 Adapter 接入。

---

## 4. 重要事件流

典型 AI 对话事件顺序：

```text
room.created
room.configured
participant.joined
agent.registered
room.agent_selected
message.created              # human
agent.turn.requested
agent.turn.started
agent.output.delta            # streaming chunks
agent.turn.completed
message.created              # agent final message
```

示例：人类消息

```json
{
  "type": "message.created",
  "actor_id": "user_123",
  "payload": {
    "message_id": "msg_123",
    "text": "我们一起讨论这个方案。",
    "kind": "human"
  }
}
```

示例：Server 请求 Agent 回复

```json
{
  "type": "agent.turn.requested",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "reason": "human_message",
    "context_prompt": "...由 CACP 组装的多人共享上下文..."
  }
}
```

示例：Agent 最终消息

```json
{
  "type": "message.created",
  "actor_id": "agent_123",
  "payload": {
    "message_id": "msg_456",
    "text": "这是 AI 的最终回复。",
    "kind": "agent",
    "turn_id": "turn_123"
  }
}
```

完整协议参考见：

```text
docs/protocol/cacp-v0.1.md
```

---

## 5. 环境要求

推荐：

- Node.js 20+
- Corepack
- Git
- Windows PowerShell

安装依赖：

```powershell
corepack enable
corepack pnpm install
```

如果 `corepack enable` 因权限失败，但 Corepack 已可用，可以直接执行：

```powershell
corepack pnpm install
```

---

## 6. 常用命令

在仓库根目录执行：

```powershell
# 全量测试 + 构建
corepack pnpm check

# 只运行测试
corepack pnpm test

# 只构建
corepack pnpm build

# 启动 Server：http://127.0.0.1:3737
corepack pnpm dev:server

# 启动 Web：http://127.0.0.1:5173
corepack pnpm dev:web

# 启动默认 CLI Adapter
# 默认读取 docs/examples/generic-cli-agent.local.json
corepack pnpm dev:adapter
```

单包测试：

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test
```

---

## 7. 自动化验证

最重要的验证命令：

```powershell
corepack pnpm check
```

当前测试覆盖：

- 新增 CACP event types；
- conversation helper：active agent、open turn、queued follow-up、最近消息上下文、`cacp-question` 解析；
- Server invite/join、message、agent select、agent turn lifecycle；
- Agent streaming delta 和 final AI message 持久化；
- CLI Adapter 对 `task.created` 和 `agent.turn.requested` 的兼容；
- Web room state 派生：participants、agents、active agent、messages、streaming turns、questions。

---

## 8. 本地 Echo Agent 冒烟测试

Echo Agent 不调用真实大模型，适合先验证完整链路。

### 8.1 启动 Server

新开 PowerShell：

```powershell
cd D:\Development\2
corepack pnpm dev:server
```

### 8.2 启动 Web

再开一个 PowerShell：

```powershell
cd D:\Development\2
corepack pnpm dev:web
```

浏览器打开：

```text
http://127.0.0.1:5173/
```

### 8.3 创建房间

在 Web 中创建房间：

- Room name：例如 `CACP AI Room`
- Your name：例如 `Alice`

创建后 Web 会把当前 session 存入浏览器 localStorage。

如果需要给 Adapter 配置 token，可以在浏览器控制台执行：

```js
JSON.parse(localStorage.getItem("cacp.roomSession"))
```

你会得到类似：

```json
{
  "room_id": "room_xxx",
  "token": "..."
}
```

注意：Adapter 配置里的 `token` 必须是 `cacp.roomSession.token` 这种 **房间参与者 token**，也就是 owner/admin/member 的 token。不要填右侧 Invite 区域生成的 `invite_token`；invite token 只用于让另一个人加入房间，不能用于注册 Agent。

### 8.4 准备本地 Adapter 配置

复制模板为本地配置：

```powershell
Copy-Item docs\examples\generic-cli-agent.json docs\examples\generic-cli-agent.local.json
```

编辑 `docs\examples\generic-cli-agent.local.json`：

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "替换为 room_xxx",
  "token": "替换为 owner/member token",
  "agent": {
    "name": "Echo CLI Agent",
    "command": "node",
    "args": ["-e", "process.stdin.on('data', d => process.stdout.write('agent:' + d.toString()))"],
    "working_dir": ".",
    "capabilities": ["shell.oneshot"]
  }
}
```

`.local.json` 文件已被 Git 忽略，不要提交真实 token。

### 8.5 启动 Adapter

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/generic-cli-agent.local.json
```

成功后会看到类似：

```text
Registered Echo CLI Agent as agent_xxx
Connected adapter stream for room room_xxx
```

### 8.6 选择 Agent 并聊天

回到 Web：

1. 右侧 `Active Agent` 下拉框应出现 `Echo CLI Agent`；
2. 选择它；
3. 在底部主输入框发送消息；
4. 页面应出现 streaming AI 气泡；
5. 完成后出现一条普通 AI message。

Echo Agent 会把 CACP 组装后的上下文返回，所以输出可能较长。这正好说明 Adapter 已经收到了 Server 生成的 `context_prompt`。

---

## 9. 多人协同测试

在 Alice 页面：

1. 右侧 `Invite` 选择 `member`；
2. 点击 `Create invite`；
3. 复制 `Room ID` 和 `Invite token`。

用另一个浏览器、无痕窗口，或清理 localStorage 后打开：

```text
http://127.0.0.1:5173/
```

选择 Join room：

- Room ID：Alice 复制的 room id；
- Invite token：Alice 创建的 invite token；
- Your name：例如 `Bob`。

验证：

- Alice 和 Bob 都能看到 Participants 中有两个人；
- Bob 能看到加入前的历史消息；
- Alice 发言，Bob 页面同步显示；
- Bob 发言，Alice 页面同步显示；
- 任意人类消息都会触发当前 Active Agent；
- Active Agent 是房间共享状态，不是浏览器本地状态。

---

## 10. Claude Code CLI 测试

前提：本机已经安装并登录 Claude Code CLI，并且能执行：

```powershell
claude --version
```

复制 Claude Code 模板：

```powershell
Copy-Item docs\examples\claude-code-agent.json docs\examples\claude-code-agent.local.json
```

编辑 `docs\examples\claude-code-agent.local.json`：

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "替换为 room_xxx",
  "token": "替换为 owner/member token",
  "agent": {
    "name": "Claude Code Agent",
    "command": "claude",
    "args": [
      "-p",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--max-budget-usd",
      "0.10",
      "--tools",
      "Read,LS,Grep,Glob",
      "--permission-mode",
      "dontAsk",
      "--append-system-prompt",
      "你是通过 CACP 多人协作房间调用的 Claude Code CLI Agent。请优先给出简洁、可读的中文结果。除非任务明确要求，否则不要修改文件；当前测试阶段只做只读分析。"
    ],
    "working_dir": "D:\\Development\\2",
    "capabilities": ["claude-code.print", "repo.read", "analysis"]
  }
}
```

注意：

- `token` 必须填写浏览器 localStorage 里的 `cacp.roomSession.token`，不要填写 Web 右侧生成的 `Invite token`。
- `working_dir` 请改成你希望 Claude Code 分析的目录。
- 模板默认只开放 `Read,LS,Grep,Glob`，适合只读测试。
- `--no-session-persistence` 是有意设置的：每一轮上下文由 CACP 从共享房间事件中重新组装。
- 真实 Claude Code 调用可能产生费用，建议先用短问题测试。

启动 Claude Code Adapter：

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/claude-code-agent.local.json
```

回到 Web 选择 `Claude Code Agent`，发送短问题：

```text
请用三句话概括这个仓库当前的模块结构，只做只读分析。
```

预期：

- Web 出现 streaming AI 气泡；
- 完成后出现普通 AI 消息；
- 另一个参与者的浏览器也能看到同一输出；
- 后续消息会继续由 CACP 带着共享历史触发 Claude Code。

---

## 11. AI 结构化决策卡片

Agent 可以通过 fenced block 请求房间产生结构化问题：

````text
```cacp-question
{"question":"下一步是否进入 Claude Code 实测？","options":["同意","先继续用 Echo 测试"]}
```
````

Server 在 turn complete 时会解析合法 block，并追加 `question.created`。Web 右侧 `Decisions` 区域会显示问题卡片。

当前阶段已实现：

- AI 输出中解析 `cacp-question`；
- Server 追加 `question.created`；
- Web 显示决策卡片。

尚未完成：

- Web 中对问题作答；
- 多人必须全部同意后再继续的 policy gate；
- AI 等待决策结果后自动继续。

这些属于下一阶段功能。

---

## 12. API 摘要

房间与协作：

```http
POST /rooms
GET  /rooms/:roomId/events
GET  /rooms/:roomId/stream?token=...
POST /rooms/:roomId/invites
POST /rooms/:roomId/join
POST /rooms/:roomId/messages
POST /rooms/:roomId/questions
POST /rooms/:roomId/questions/:questionId/responses
POST /rooms/:roomId/proposals
POST /rooms/:roomId/proposals/:proposalId/votes
```

Agent 注册、选择和 turn lifecycle：

```http
POST /rooms/:roomId/agents/register
POST /rooms/:roomId/agents/select
POST /rooms/:roomId/agent-turns/:turnId/start
POST /rooms/:roomId/agent-turns/:turnId/delta
POST /rooms/:roomId/agent-turns/:turnId/complete
POST /rooms/:roomId/agent-turns/:turnId/fail
```

兼容保留的旧 Task API：

```http
POST /rooms/:roomId/tasks
POST /rooms/:roomId/tasks/:taskId/start
POST /rooms/:roomId/tasks/:taskId/output
POST /rooms/:roomId/tasks/:taskId/complete
POST /rooms/:roomId/tasks/:taskId/fail
```

---

## 13. 当前实现边界

已实现：

- 多人创建/加入同一房间；
- 深色 Web command-center UI；
- 共享 Active Agent；
- 人类消息自动触发 Agent；
- Agent 输出实时 streaming；
- final AI message 持久化；
- queued follow-up；
- Echo CLI Agent 测试模板；
- Claude Code CLI Agent 测试模板；
- 旧 task API 兼容；
- 结构化 `cacp-question` 卡片展示。

暂未实现：

- 生产账号系统；
- 邀请过期、撤销和审计；
- 完整多人投票/审批 UI；
- 多 Active Agent 同时协作；
- 长上下文摘要和长期记忆；
- 对 Codex、opencode、OpenClaw、Hermes 的专用 Adapter；
- 生产级安全、部署和可观测性。

---

## 14. 推荐下一步

如果继续推进这个项目，建议下一阶段做：

1. 在 Web 中实现 `question.response_submitted` 作答 UI；
2. 基于 room policy 决定是否需要 owner / majority / unanimous 才能继续；
3. 支持 AI 在等待多人决策后自动继续；
4. 增加 Codex CLI / opencode 的专用安全配置模板；
5. 为 invite token 增加过期时间和撤销能力；
6. 引入 room summary，避免长期对话只依赖最近 20 条消息。

CACP 当前最重要的价值是：它已经把 **多人协同 + AI 对话 + CLI Agent + 事件协议 + 共享上下文** 串成了一条可运行、可测试、可继续标准化的路径。
