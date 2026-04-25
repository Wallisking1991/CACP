# CACP — 协作式 Agent 通信协议

CACP（Collaborative Agent Communication Protocol）是一个实验性的 **多人 AI/Agent 协同协议与 MVP 参考平台**。

它要验证的核心想法是：AI 对话不应该只能是“一个人与一个 AI”的单线交互，而应该允许多个被授权的人共同加入同一个协作房间，一起讨论、提问、投票、做决策，并共同驱动或观察一个或多个 AI/CLI Agent 的执行过程。

换句话说，CACP 不是单纯再做一个聊天界面，而是尝试提供一个 **协议优先的多人协同层**。不同的人类客户端、CLI Agent、本地自动化工具、未来的 IDE 插件、聊天平台、MCP/A2A 桥接器或自定义 Agent，都可以通过同一套房间、事件、任务、提案和策略模型协同工作。

## 项目当前包含什么

当前仓库是 CACP 的 MVP 实现，主要包含：

- **协议包 `@cacp/protocol`**：定义事件、参与者、投票、策略和策略评估相关的 Zod Schema。
- **协议服务器 `@cacp/server`**：提供 Room、Participant、Bearer Token、追加式事件存储、WebSocket 事件流、提案、投票、Agent 注册和任务生命周期接口。
- **通用 CLI Adapter `@cacp/cli-adapter`**：把一个本地命令注册成 Agent，监听被分配的任务，执行命令，并把 stdout/stderr 流式写回 Room。
- **最小 Web Room 客户端 `@cacp/web`**：用于创建房间、发送消息、创建问题、选择 Agent、创建任务并查看事件流。
- **协议文档**：`docs/protocol/cacp-v0.1.md`。
- **安全的本地 Demo 配置模式**：真实 token 放在被 Git 忽略的 `*.local.json` 文件中。

## 适合用来做什么

这个项目目前适合：

- 验证“多人共同参与 AI 对话”的产品和协议想法；
- 验证人类用户与 AI/CLI Agent 共享同一个事件流的协同模式；
- 验证多人共同决策、审批、投票和任务分发流程；
- 给 Codex、Claude Code、opencode、脚本工具或自定义 Agent 做统一接入层；
- 作为未来标准化多人 AI 协同协议的早期参考实现。

它目前还不是生产级系统，更适合作为本地 MVP、协议实验和后续架构演进基础。

## 仓库结构

```text
.
|-- docs/
|   |-- examples/
|   |   `-- generic-cli-agent.json
|   |-- protocol/
|   |   `-- cacp-v0.1.md
|   `-- superpowers/
|       |-- plans/
|       `-- specs/
|-- packages/
|   |-- protocol/      # @cacp/protocol：协议 Schema 与策略引擎
|   |-- server/        # @cacp/server：Fastify + WebSocket + SQLite 事件服务器
|   |-- cli-adapter/   # @cacp/cli-adapter：通用本地 CLI Agent 桥接器
|   `-- web/           # @cacp/web：React/Vite 参考 Web Room
|-- package.json
|-- pnpm-workspace.yaml
`-- tsconfig.base.json
```

## 总体架构

```text
人类客户端
  Web Room / 未来 CLI 客户端 / 未来 IDE 插件
        |
        | HTTP + WebSocket
        v
CACP 协议服务器
  rooms / participants / event log / proposals / policies / tasks
        |
        | CACP event stream
        v
Agent Adapter
  当前先实现 Generic CLI Adapter
        |
        | 本地进程 stdin/stdout/stderr
        v
AI 或 CLI 工具
  Codex / Claude Code / opencode / scripts / custom agents
```

CACP 的设计原则是 **protocol-first**：

- **Server** 是协同状态、权限和事件日志的权威来源；
- **Web Client** 只是一个参考人类界面，不绑定协议本身；
- **CLI Adapter** 只是第一个参考 Agent 接入方式；
- 其他客户端或 Agent 可以按照 `docs/protocol/cacp-v0.1.md` 中的 HTTP、WebSocket 和事件约定接入。

## 核心概念

### Room

Room 是一个共享协作空间，可以包含：

- 人类参与者；
- Agent；
- 消息；
- 问题；
- 提案；
- 决策；
- 投票；
- 任务；
- 输出；
- 未来可扩展的 artifact。

### Participant

Participant 表示 Room 中的参与主体。MVP 中包含以下角色：

- `owner`
- `admin`
- `member`
- `observer`
- `agent`

其中：

- `owner`、`admin`、`member` 可以执行人类协作行为；
- `observer` 只能观察，不能写入协作内容；
- `agent` 可以读取/监听事件，并上报被分配任务的生命周期事件。

### Event

Room 中的所有内容都以追加式 CACP Event 保存。

示例：

```json
{
  "protocol": "cacp",
  "version": "0.1.0",
  "event_id": "evt_123",
  "room_id": "room_123",
  "type": "message.created",
  "actor_id": "user_123",
  "created_at": "2026-04-25T00:00:00.000Z",
  "payload": {}
}
```

这种设计有几个好处：

- 所有参与者看到同一份事实记录；
- Web 客户端、Agent Adapter 和未来集成都可以从事件流恢复状态；
- 决策、投票、任务执行和输出都有可追踪记录；
- 后续可以自然扩展审计、回放、归档和跨工具同步。

### Proposal 与 Policy

正式决策和审批通过 Proposal 表达，通过 Vote 和 Policy 进行评估。

MVP 支持的策略类型：

- `owner_approval`：Owner 批准；
- `majority`：多数通过；
- `role_quorum`：指定角色达到法定人数；
- `unanimous`：一致通过；
- `no_approval`：无需审批。

这使得 CACP 不只适用于“危险操作审批”，也适用于多人讨论中的普通决策，例如：

- 是否采用某个技术方案；
- 是否让 Agent 执行某个任务；
- 是否接受某个产出；
- 是否进入下一阶段；
- 是否把某个结论标记为团队决策。

### Agent Task

人类参与者可以为已注册的 Agent 创建任务。被分配的 Agent 可以：

1. 开始任务；
2. 流式输出内容；
3. 完成任务；
4. 标记任务失败。

服务器会检查：

- 是否由被分配的 Agent 上报；
- 任务是否已经开始；
- 任务是否已经终止；
- 是否存在重复 start 或终止后继续输出等非法状态。

## 环境要求

推荐环境：

- Node.js 20 或更新版本；
- Corepack；
- Git。

本仓库通过 Corepack 使用 `pnpm@9.15.4`。大部分脚本都写成了 `corepack pnpm ...`，因此即使系统没有全局 `pnpm` 命令，也可以正常执行。

首次安装依赖：

```powershell
corepack enable
corepack pnpm install
```

如果 `corepack enable` 因为 Node 安装目录权限问题失败，只要 Corepack 可用，通常仍然可以直接使用：

```powershell
corepack pnpm install
```

## 常用命令

以下命令都在仓库根目录执行。

```powershell
# 运行全部测试和构建，这是最重要的健康检查命令
corepack pnpm check

# 只运行全部测试
corepack pnpm test

# 只构建全部 package
corepack pnpm build

# 启动协议服务器：http://127.0.0.1:3737
corepack pnpm dev:server

# 启动 Web Room：http://127.0.0.1:5173
corepack pnpm dev:web

# 启动 CLI Adapter，默认读取被 Git 忽略的本地配置文件
corepack pnpm dev:adapter
```

单独测试某个 package：

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test
```

## 如何测试

### 1. 完整自动化验证

最重要的验证命令是：

```powershell
corepack pnpm check
```

它会依次执行：

1. 构建协议包；
2. 运行所有 package 的测试；
3. 构建所有 package。

预期结果：所有测试和构建都通过。

### 2. 按 package 测试

如果你只改了某个模块，可以运行对应 package 的测试和构建。

```powershell
# 协议 Schema 与策略引擎
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/protocol build

# Server 路由、鉴权、事件存储、提案、任务生命周期
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/server build

# CLI 进程执行器与任务结果映射
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/cli-adapter build

# Web 事件解析与事件日志 reducer
corepack pnpm --filter @cacp/web test
corepack pnpm --filter @cacp/web build
```

### 3. Runtime smoke test

先构建：

```powershell
corepack pnpm build
```

验证协议包在运行时可以被导入：

```powershell
Push-Location packages\cli-adapter
node -e "import('@cacp/protocol').then(m => { if (!m.CacpEventSchema) process.exit(1); console.log('protocol import ok') })"
Pop-Location
```

验证构建后的 CLI Adapter 可以启动并显示帮助：

```powershell
node packages\cli-adapter\dist\index.js --help
```

预期输出包含：

```text
Usage: cacp-cli-adapter [config.json]
```

### 4. 手动本地 MVP Demo

这个流程用于验证完整链路：

```text
server -> web room -> local CLI adapter -> task -> streamed output
```

#### 终端 A：启动 CACP Server

```powershell
corepack pnpm dev:server
```

预期输出：

```text
CACP server listening on http://127.0.0.1:3737
```

Server 默认会把本地 SQLite 数据写入 `cacp.db`。以下文件已被 Git 忽略：

```text
*.db
*.db-shm
*.db-wal
```

#### 终端 B：启动 Web Room

```powershell
corepack pnpm dev:web
```

浏览器打开：

```text
http://127.0.0.1:5173
```

在页面中创建一个 Room，然后复制：

- `room_id`
- `token`

页面展示的 token 是本地 demo secret，不要提交到 Git。

#### 准备本地 Adapter 配置

复制示例配置到被 Git 忽略的本地文件：

```powershell
Copy-Item docs\examples\generic-cli-agent.json docs\examples\generic-cli-agent.local.json
```

编辑：

```text
docs\examples\generic-cli-agent.local.json
```

替换以下占位符：

- `replace_with_room_id`
- `replace_with_owner_or_member_token`

该本地文件已经被 `.gitignore` 忽略：

```gitignore
docs/examples/*.local.json
```

默认 Demo Agent 配置如下：

```json
{
  "server_url": "http://127.0.0.1:3737",
  "room_id": "replace_with_room_id",
  "token": "replace_with_owner_or_member_token",
  "agent": {
    "name": "Echo CLI Agent",
    "command": "node",
    "args": ["-e", "process.stdin.on('data', d => process.stdout.write('agent:' + d.toString()))"],
    "working_dir": ".",
    "capabilities": ["shell.oneshot"]
  }
}
```

#### 终端 C：启动 CLI Adapter

```powershell
corepack pnpm dev:adapter
```

预期输出类似：

```text
Registered Echo CLI Agent as agent_...
Connected adapter stream for room room_...
```

#### 在浏览器中创建 Agent Task

在 Web Room 中：

1. 选择 `Echo CLI Agent`；
2. 创建一个 task，prompt 填写：

   ```text
   hello from the room
   ```

3. 确认事件流中出现：
   - `task.created`
   - `task.started`
   - `task.output`
   - `task.completed`
4. 确认 `task.output` 中包含：

   ```text
   agent:hello from the room
   ```

如果以上流程成功，说明 server、web、adapter 和本地命令执行链路已经打通。

### 5. 只通过 API 测试

也可以不打开 Web UI，直接通过 PowerShell 调用 API。

先启动 server：

```powershell
corepack pnpm dev:server
```

创建 Room：

```powershell
$room = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3737/rooms `
  -ContentType 'application/json' `
  -Body '{"name":"API Test Room","display_name":"Alice"}'

$room
```

保存鉴权信息：

```powershell
$roomId = $room.room_id
$token = $room.owner_token
$headers = @{ Authorization = "Bearer $token" }
```

发送消息：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3737/rooms/$roomId/messages" `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{"text":"hello from API"}'
```

读取事件：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:3737/rooms/$roomId/events" `
  -Headers $headers
```

## 各 package 说明

### `@cacp/protocol`

路径：

```text
packages/protocol
```

职责：

- CACP Event Schema；
- Participant Schema；
- Vote Schema；
- Policy Schema；
- Policy Evaluation。

关键文件：

- `src/schemas.ts`
- `src/policy-engine.ts`
- `test/protocol.test.ts`

### `@cacp/server`

路径：

```text
packages/server
```

职责：

- Fastify HTTP API；
- WebSocket 事件流；
- 基于 `better-sqlite3` 的 SQLite 事件存储；
- Bearer Token 鉴权；
- Room Participant 管理；
- Invite；
- Message；
- Question；
- Proposal 与 Policy Evaluation；
- Agent 注册；
- Task 生命周期校验。

关键文件：

- `src/server.ts`
- `src/event-store.ts`
- `src/auth.ts`
- `test/server.test.ts`
- `test/server-hardening.test.ts`

### `@cacp/cli-adapter`

路径：

```text
packages/cli-adapter
```

职责：

- 加载本地 Adapter 配置；
- 注册本地 Agent；
- 连接 Room WebSocket 事件流；
- 过滤分配给当前 Agent 的 `task.created` 事件；
- 执行可信本地命令；
- 将 stdout/stderr 流式上报为 `task.output`；
- 将退出码 `0` 映射为 `task.completed`；
- 将非零退出码或运行错误映射为 `task.failed`。

关键文件：

- `src/index.ts`
- `src/runner.ts`
- `src/task-result.ts`
- `test/runner.test.ts`
- `test/task-result.test.ts`

### `@cacp/web`

路径：

```text
packages/web
```

职责：

- 创建 Room；
- 连接 WebSocket 事件流；
- 渲染事件日志；
- 发送消息；
- 创建问题；
- 选择已注册 Agent；
- 创建 Agent Task。

关键文件：

- `src/App.tsx`
- `src/api.ts`
- `src/event-log.ts`
- `test/api.test.ts`
- `test/event-log.test.ts`

## 协议文档

协议细节见：

```text
docs/protocol/cacp-v0.1.md
```

该文档包含：

- 鉴权与 token 模型；
- endpoint 列表；
- 支持的事件类型；
- 关键 payload 示例；
- CLI Adapter 接入序列；
- 本地 demo 工作流。

## 安全说明

这是一个 MVP，应当按照 **local-first experimental software** 对待。

当前已经实现的边界包括：

- Observer token 不能写入协作内容；
- Agent token 不能执行人类协作行为；
- Agent 只能上报分配给自己的 task 生命周期事件；
- Proposal 到达终态后不能继续投票；
- Task 生命周期防止重复 start，以及终态后继续 output/complete/fail；
- 包含真实 token 的本地 Adapter 配置应使用 `*.local.json`，并已被 Git 忽略。

后续生产化还需要考虑：

- 正式账号系统，而不是本地 bearer secret；
- token 过期与轮换；
- invite 过期和一次性使用；
- 更完整的审计和 artifact API；
- 生产部署配置；
- 本地命令执行的 sandbox 和 capability 控制；
- 更细粒度的多人治理和权限策略。

## 常见问题

### `pnpm` 命令不可用

优先使用 Corepack：

```powershell
corepack pnpm check
```

必要时执行：

```powershell
corepack enable
```

### `better-sqlite3` 安装失败

`better-sqlite3` 是原生依赖。建议使用 Node.js 20 或更新版本，以便使用匹配的预构建二进制包。

如果在 Windows 上安装失败，请检查当前 Node.js 版本是否被当前 `better-sqlite3` 版本支持。原生重编译可能需要 Visual Studio C++ Build Tools。

### Adapter 无法连接

检查：

1. server 是否运行在 `http://127.0.0.1:3737`；
2. `docs/examples/generic-cli-agent.local.json` 是否存在；
3. `room_id` 是否正确；
4. `token` 是否是该 Room 的 owner/admin/member token；
5. 是否通过以下命令启动：

   ```powershell
   corepack pnpm dev:adapter
   ```

### Web Room 中看不到 Agent

需要先启动 CLI Adapter，并确保它成功注册。注册成功后，Web Room 的事件流中应该出现：

```text
agent.registered
```

### Task 没有完成

检查事件流中是否出现：

- `task.started`
- `task.output`
- `task.failed`

如果配置的本地命令以非零退出码结束，Adapter 会上报 `task.failed`。

## 当前状态

这个仓库目前是 CACP 概念的实验性 MVP，用来验证：

> 多人共同参与 AI 对话，并共同治理、驱动、观察 AI/CLI Agent 的执行过程。

它已经可以用于本地演示、协议探索和早期 Adapter/Client 实验。后续如果要形成真正的开放标准，可以继续在以下方向扩展：

- 更正式的协议版本管理；
- 更完整的事件类型；
- 标准化 Agent capability 描述；
- 标准化多人决策/投票/审批模型；
- 与 Codex、Claude Code、opencode、MCP、A2A 等生态工具的桥接；
- 更完整的客户端和 Adapter SDK。
