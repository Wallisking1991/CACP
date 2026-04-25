# CACP — 协作式 Agent 通信协议

CACP（Collaborative Agent Communication Protocol）是一个实验性的 **多人 AI/Agent 协同协议与 MVP 参考平台**。

它要验证的核心想法是：AI 对话不应该只能是“一个人与一个 AI”的单线交互，而应该允许多个被授权的人进入同一个共享房间，一起讨论、补充上下文、提出问题、做决策，并共同驱动一个或多个 CLI/AI Agent。

当前版本已经从“手动创建 Agent Task 的调试面板”升级为一个更接近真实产品形态的 **多人共享 AI 对话房间**：

- 创建者可以单独和 AI 聊；
- 被邀请的人可以从另一个浏览器/会话加入同一房间；
- 所有人看到同一条事件流和同一段对话历史；
- 人类发送消息后，由 Server 统一触发当前选中的 Agent 回复；
- Agent 输出会实时流式显示，完成后保存为持久 `message.created`；
- CACP 自己从最近 20 条持久消息组装上下文，不依赖 Claude Code / Codex 自己的会话记忆；
- 旧的 `task.created` Agent 任务接口仍保留，但它不再是 Web 主流程。

> 当前项目仍是本地 MVP / 协议实验，不是生产级系统。

---

## 1. 项目包含什么

```text
.
|-- docs/
|   |-- examples/
|   |   |-- generic-cli-agent.json        # Echo/通用 CLI Agent 模板
|   |   `-- claude-code-agent.json        # Claude Code CLI Agent 模板，不含真实 token
|   |-- protocol/
|   |   `-- cacp-v0.1.md                  # 协议草案
|   `-- superpowers/
|       |-- plans/
|       `-- specs/
|-- packages/
|   |-- protocol/      # @cacp/protocol：事件、参与者、策略等 Zod Schema
|   |-- server/        # @cacp/server：Fastify + WebSocket + SQLite 事件服务器
|   |-- cli-adapter/   # @cacp/cli-adapter：把任意本地命令桥接成 Agent
|   `-- web/           # @cacp/web：React/Vite 多人 AI 房间参考 UI
|-- package.json
|-- pnpm-workspace.yaml
`-- tsconfig.base.json
```

主要模块：

- **Protocol**：定义 CACP 事件名、参与者角色、投票与策略 Schema。
- **Server**：房间、参与者、邀请、事件日志、WebSocket 事件流、Agent 注册、主动 Agent 选择、Agent Turn 编排、旧 Task 生命周期。
- **CLI Adapter**：注册本地 CLI 为 Agent，同时支持旧 `task.created` 和新 `agent.turn.requested` 两种路径。
- **Web**：深色 command-center 风格的多人 AI 对话房间。主界面只有共享对话，而不是调试表单。

---

## 2. 当前核心架构

```text
多人 Web 客户端 / 未来 CLI 或 IDE 客户端
        |
        | HTTP + WebSocket
        v
CACP Server
  rooms / participants / invites / event log
  active agent / conversation context / agent turns
        |
        | CACP event stream + lifecycle endpoints
        v
CLI Adapter
        |
        | stdin / stdout / stderr
        v
Claude Code / Codex / opencode / 任意本地脚本或自定义 Agent
```

关键原则：

1. **Server 是协同事实源**：所有客户端都从同一事件流恢复状态。
2. **Web 不直接调用 AI**：Web 只发送人类消息和选择 active agent，避免多个浏览器重复触发 AI。
3. **Agent Turn 由 Server 编排**：人类消息进入房间后，Server 根据当前 active agent 生成 `agent.turn.requested`。
4. **上下文由 CACP 组装**：当前版本取最近 20 条持久 `message.created`，未来可加入摘要、artifact、权限过滤等。
5. **CLI 工具可替换**：Claude Code、Codex、opencode、普通脚本都可以通过同一 adapter 协议接入。

---

## 3. 多人 AI 对话主流程

```text
Alice 打开 Web -> 创建房间
Alice 启动 Claude Code / Echo CLI Adapter -> Agent 注册到房间
Alice 在 Web 右侧选择 Active Agent
Alice 发送消息
Server 追加 human message.created
Server 生成 agent.turn.requested
Adapter 调用本地 CLI，并把输出以 agent.output.delta 流式写回
Server 在完成时追加 agent.turn.completed + agent message.created

Alice 创建 member invite
Bob 在另一个浏览器/无痕窗口输入 room_id + invite_token + 自己的名字加入
Alice 和 Bob 都能看到同一段对话，并且都可以继续发言
Bob 发言时，仍由同一个 Active Agent 基于共享上下文回复
```

如果某个 Agent Turn 正在运行，同时又有人发送了新的消息，Server 不会并发启动第二个同 Agent 调用，而是追加：

```text
agent.turn.followup_queued
```

当前 Turn 完成后，再自动生成下一轮 `agent.turn.requested`。

---

## 4. 重要事件

典型对话事件顺序：

```text
room.created
room.configured
participant.joined
agent.registered
room.agent_selected
message.created              # human
agent.turn.requested
agent.turn.started
agent.output.delta            # 0..n streaming chunks
agent.turn.completed
message.created              # agent final message
```

常见 payload 示例：

```json
{
  "type": "message.created",
  "actor_id": "user_123",
  "payload": {
    "message_id": "msg_123",
    "text": "我们来讨论这个方案。",
    "kind": "human"
  }
}
```

```json
{
  "type": "agent.turn.requested",
  "payload": {
    "turn_id": "turn_123",
    "agent_id": "agent_123",
    "reason": "human_message",
    "context_prompt": "...CACP 组装后的共享上下文..."
  }
}
```

---

## 5. 环境要求

推荐环境：

- Node.js 20+
- Corepack
- Git
- Windows PowerShell 可直接使用本文命令

安装依赖：

```powershell
corepack enable
corepack pnpm install
```

---

## 6. 常用命令

在仓库根目录执行：

```powershell
# 运行全部测试和构建
corepack pnpm check

# 只运行测试
corepack pnpm test

# 只构建全部 package
corepack pnpm build

# 启动协议服务器：http://127.0.0.1:3737
corepack pnpm dev:server

# 启动 Web：http://127.0.0.1:5173
corepack pnpm dev:web

# 启动默认 adapter。注意：默认读取 docs/examples/generic-cli-agent.local.json
corepack pnpm dev:adapter
```

也可以分别运行单个包：

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test
```

---

## 7. 如何测试：自动化验证

最重要的完整检查：

```powershell
corepack pnpm check
```

它会执行：

1. `@cacp/protocol` build；
2. 全部 package tests；
3. 全部 package build。

本次多人 AI 房间相关测试覆盖点包括：

- 新事件类型 Schema；
- active agent 派生；
- open turn / queued follow-up；
- 最近消息上下文组装；
- `cacp-question` block 解析；
- invite/join 新 payload；
- human message 自动触发 `agent.turn.requested`；
- agent turn start/delta/complete/fail 生命周期；
- final AI message 持久化；
- Web 从事件流派生 participants、agents、active agent、messages、streaming turns、questions。

---

## 8. 如何测试：本地 Echo Agent 冒烟测试

这个测试不调用真实大模型，适合先验证完整协议链路。

### 8.1 启动 Server

新开 PowerShell：

```powershell
cd D:\Development\2\.worktrees\multi-user-ai-room
corepack pnpm dev:server
```

### 8.2 启动 Web

再开一个 PowerShell：

```powershell
cd D:\Development\2\.worktrees\multi-user-ai-room
corepack pnpm dev:web
```

浏览器打开：

```text
http://127.0.0.1:5173/
```

### 8.3 创建房间

在 Web 左侧创建房间：

- Room name：任意，例如 `CACP AI Room`
- Your name：例如 `Alice`

创建后复制 `room_id`。Web 会把 session 存在 localStorage，刷新后应能恢复房间。

### 8.4 准备本地 Agent 配置

复制模板为本地配置，`.local.json` 已被 Git 忽略，不要提交：

```powershell
Copy-Item docs\examples\generic-cli-agent.json docs\examples\generic-cli-agent.local.json
```

编辑 `docs\examples\generic-cli-agent.local.json`：

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "替换为刚才创建的 room_id",
  "token": "替换为当前房间 owner/member token",
  "agent": {
    "name": "Echo CLI Agent",
    "command": "node",
    "args": ["-e", "process.stdin.on('data', d => process.stdout.write('agent:' + d.toString()))"],
    "working_dir": ".",
    "capabilities": ["shell.oneshot"]
  }
}
```

> token 可以从创建房间接口返回值、浏览器 localStorage、或你自己的测试脚本中取得。Web 参考 UI 当前不会把 token 明文展示出来，这是为了避免误复制到截图/日志。

### 8.5 启动 Adapter

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/generic-cli-agent.local.json
```

成功后会看到类似：

```text
Registered Echo CLI Agent as agent_xxx
Connected adapter stream for room room_xxx
```

### 8.6 在 Web 中选择 Agent 并聊天

回到 Web：

1. 右侧 `Active Agent` 下拉框应出现 `Echo CLI Agent`；
2. 选择它；
3. 在底部输入框发送消息；
4. 应看到 streaming 气泡，然后看到最终 AI message。

Echo Agent 会把 CACP 组装后的上下文原样返回，所以输出可能较长；这说明上下文已经通过 stdin 传给本地 CLI。

---

## 9. 如何测试：多人加入同一房间

在创建者 Alice 的 Web 页面：

1. 右侧 `Invite` 选择 `member`；
2. 点击 `Create invite`；
3. 复制 `Room ID` 和 `Invite token`。

然后用另一个浏览器、无痕窗口，或清理 localStorage 后打开：

```text
http://127.0.0.1:5173/
```

选择 Join room：

- Room ID：填 Alice 复制的 room id；
- Invite token：填 invite token；
- Your name：例如 `Bob`。

验证：

- Alice 和 Bob 页面都能看到 Participants 中有两个人；
- Bob 能看到加入前的历史消息；
- Alice 发言，Bob 页面同步显示；
- Bob 发言，Alice 页面同步显示；
- 任意人类消息都会触发当前 Active Agent 回复；
- Active Agent 是房间共享状态，不是某个浏览器自己的本地状态。

---

## 10. 如何测试：接入 Claude Code CLI

前提：本机已经安装并登录 Claude Code CLI，且命令行中可以执行：

```powershell
claude --version
```

复制模板：

```powershell
Copy-Item docs\examples\claude-code-agent.json docs\examples\claude-code-agent.local.json
```

编辑 `docs\examples\claude-code-agent.local.json`：

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "替换为 room_id",
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

- `working_dir` 请改成你希望 Claude Code 分析的目录；如果在 worktree 里测试，可以改成 `D:\Development\2\.worktrees\multi-user-ai-room`。
- 模板默认只开放 `Read,LS,Grep,Glob`，并设置较低预算，适合本地只读测试。
- `--no-session-persistence` 是有意设置的：每一轮对话的共享上下文由 CACP 统一组装，而不是依赖 Claude Code 自己的历史会话。
- 真实 Claude Code 调用可能产生费用，请先用短问题测试。

启动：

```powershell
corepack pnpm --filter @cacp/cli-adapter dev ../../docs/examples/claude-code-agent.local.json
```

回到 Web 选择 `Claude Code Agent`，发送一个短问题，例如：

```text
请用三句话概括这个仓库当前的模块结构，只做只读分析。
```

预期：

1. Web 出现 streaming AI 气泡；
2. 完成后出现一条普通 AI 消息；
3. 多人浏览器都能看到同一输出；
4. 后续人类消息会继续由 CACP 带着最近 20 条持久消息作为上下文触发 Claude Code。

---

## 11. 如何测试：AI 结构化决策卡片

Agent 如果输出下面这种 fenced block：

````text
```cacp-question
{"question":"下一步是否进入 Claude Code 实测？","options":["同意","先继续用 Echo 测试"]}
```
````

Server 在 turn complete 时会解析它，并追加 `question.created`。Web 右侧 `Decisions` 区域会显示决策卡片。

当前 UI 已能展示问题卡片；`question.response_submitted` 接口和 policy/proposal 能力在 Server 中存在，但“多人必须全部同意后再继续”的完整 UI 流程属于下一阶段增强。

---

## 12. API 摘要

常用房间与协作接口：

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

Agent 相关接口：

```http
POST /rooms/:roomId/agents/register
POST /rooms/:roomId/agents/select
POST /rooms/:roomId/agent-turns/:turnId/start
POST /rooms/:roomId/agent-turns/:turnId/delta
POST /rooms/:roomId/agent-turns/:turnId/complete
POST /rooms/:roomId/agent-turns/:turnId/fail
```

兼容保留的旧 Task 接口：

```http
POST /rooms/:roomId/tasks
POST /rooms/:roomId/tasks/:taskId/start
POST /rooms/:roomId/tasks/:taskId/output
POST /rooms/:roomId/tasks/:taskId/complete
POST /rooms/:roomId/tasks/:taskId/fail
```

更完整的协议说明见：

```text
docs/protocol/cacp-v0.1.md
```

---

## 13. 当前限制与后续方向

当前已完成的重点是 **多人共享 AI 对话房间的可运行 vertical slice**。仍待完善：

- 正式账号体系和长期权限管理；
- 邀请链接的过期时间、撤销、审计；
- 多人决策问题的完整 UI 作答与 policy gate；
- 多 Agent 同时协作、路由和角色分工；
- 长对话摘要、artifact 记忆和上下文压缩；
- 对 Codex / opencode / OpenClaw / Hermes 等更多工具的专用 adapter；
- 生产级安全、部署、日志和可观测性。

这个 MVP 的价值在于：它已经把“多人 + AI + CLI Agent + 事件协议 + 共享上下文”串成了一条可以运行、可以测试、可以继续标准化的路径。
