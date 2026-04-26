# CACP 协作 AI/CLI Agent 房间

CACP（Collaborative Agent Communication Protocol）是一个本地优先的多用户协作 AI/CLI Agent 房间原型。它通过统一的通信与协议层，把 Web 房间、多人聊天、CLI Agent pairing、Active Agent、决策审批和房间事件流连接在一起。

当前重点是验证：多个人在同一个房间里和本地 CLI Agent 协作，AI 在需要时提出明确决策，成员直接在主聊天里回答，服务器根据房间策略记录并收敛结果。

---

## 当前能力

- 创建房间并生成 owner token。
- 邀请第二位或更多参与者加入房间。
- 通过 pairing command 连接本地 CLI Agent。
- 选择 Active Agent，让新的人类消息触发 Agent turn。
- 在主聊天中查看人类与 Agent 消息。
- Agent 可用 `cacp-decision` block 创建协议级 decision。
- 用户在主聊天里回答 decision，`Decisions` 面板展示 Current Decision 与 Decision History。
- Agent action approval 也走 decision 协议。
- owner/admin 可 Clear room，为所有人清空消息与决策历史边界。

Web UI 文案当前为英文；本文档使用中文，便于项目说明和手工测试。

---

## 架构与 packages

```text
.
├─ docs/
│  ├─ examples/                 # Agent 配置示例
│  ├─ protocol/                 # CACP 协议文档
│  └─ superpowers/              # 规格与实施计划记录
├─ packages/
│  ├─ protocol/                 # @cacp/protocol：事件、策略、decision schema
│  ├─ server/                   # @cacp/server：Fastify + WebSocket + SQLite/内存状态
│  ├─ cli-adapter/              # @cacp/cli-adapter：本地 CLI Agent 适配器
│  └─ web/                      # @cacp/web：React/Vite 房间 UI
├─ start-test-services.cmd      # 一键前台启动测试服务
├─ start-test-services.ps1      # 测试服务启动/停止脚本
├─ package.json
├─ pnpm-lock.yaml
└─ pnpm-workspace.yaml
```

核心数据流：

1. Web 创建房间、邀请成员、创建 pairing token。
2. CLI Adapter claim pairing token 并注册为 Agent。
3. Web 选择 Active Agent。
4. 用户在主聊天发送消息。
5. Server 追加 `message.created`，并为 Active Agent 创建 `agent.turn.requested`。
6. Adapter 执行本地 CLI，把输出回传给 Server。
7. Server 保存 Agent 最终消息，解析 `cacp-decision`，并发布 `decision.*` 事件。
8. 所有客户端通过事件流派生一致的房间状态。

---

## 环境要求与安装

要求：

- Node.js 20+
- Corepack
- pnpm（通过 Corepack 使用）
- Windows PowerShell
- 首个真实 CLI 测试目标：Claude Code CLI

安装依赖：

```powershell
corepack enable
corepack pnpm install
```

如果 Corepack 已启用，直接运行 `corepack pnpm install` 即可。

---

## 一键前台启动测试服务

在仓库根目录运行：

```powershell
.\start-test-services.cmd
```

该命令会以前台方式启动 Server 与 Web：

- Server: `http://127.0.0.1:3737`
- Web: `http://127.0.0.1:5173/`

控制台窗口会保持打开并持续显示日志。按 `Ctrl+C` 或直接关闭该窗口会停止本次启动的测试服务。

可选：如果希望启动后自动打开浏览器，可以运行：

```powershell
.\start-test-services.cmd -Open
```

---

## 常用开发命令

```powershell
# 完整检查：测试 + 构建
corepack pnpm check

# 仅运行测试
corepack pnpm test

# 仅构建
corepack pnpm build

# 单独启动 Server
corepack pnpm dev:server

# 单独启动 Web
corepack pnpm dev:web

# 启动默认 adapter 示例
corepack pnpm dev:adapter
```

按 package 运行测试：

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test
```

---

## 手工测试流程

建议先用 Claude Code CLI 作为第一真实测试目标；Codex CLI 与 opencode CLI 已通过 adapter profile 架构预留/支持，但仍计划继续做真实 CLI 验证。

1. 打开 `http://127.0.0.1:5173/`。
2. 创建一个 room，输入房间名和你的显示名。
3. 在 Local Agent / pairing 区域选择 Agent 类型，生成 pairing command，并在新的 PowerShell 窗口中运行该命令。
4. Agent 出现在 Participants/Agents 后，把它选为 active agent。
5. 生成 invite link，用另一个浏览器窗口、隐身窗口或独立会话加入第二位 participant。
6. 在主聊天中请 AI 创建一个 decision，例如让它输出一个 `cacp-decision` 来决定先验证哪个 CLI。
7. 每位 eligible participant 直接在主聊天中回答，例如 `A`、`choose A`、`approve` 或 `reject`。
8. 验证 `Current Decision` 在策略满足后移动到 `Decision History`，并显示 result / decided_by。
9. 用 owner 身份点击 `Clear room`，确认所有客户端的消息与决策历史都在边界后被清空。

---

## Message / 主聊天与 Decisions 面板

CACP v0.2 的交互原则是：**回答决策也在主聊天完成**。

- Message / 主聊天：用户和 Agent 的主要交流区。用户直接输入普通消息，也直接输入 decision 答案。
- Decisions panel：审计与状态视图，不是主要答题表单。
  - `Current Decision` 展示当前 active decision。
  - `Decision History` 展示已经 resolved 或 cancelled 的 decision。
  - 如果没有 active decision，会显示 `No active decision.`。

当主聊天消息能被服务器明确解释为当前 decision 的答案时，服务器会在保存普通消息之外追加 `decision.response_recorded`，并在策略满足后追加 `decision.resolved`。

---

## Clear room 行为

owner/admin 使用 `Clear room` 后，Server 会追加 `room.history_cleared` 边界事件。

对所有客户端来说，边界之前的内容不再显示为当前上下文：

- messages 被清空；
- current decision 与 decision history 被清空；
- streaming turn 派生状态被切到边界之后；
- 后续 Agent 上下文只包含边界之后的新消息和决策。

Clear room 不会销毁房间，也不会移除 participants、agents、active agent selection 或 invite/pairing 基础状态。它的语义是“为所有人清空当前消息与决策上下文”。

---

## CACP v0.2 协议文档

Decision protocol 的详细事件、payload、单一 active decision gate、`cacp-decision` block、主聊天响应规则、action approval 与 clear-room 边界行为见：

- [docs/protocol/cacp-v0.2.md](docs/protocol/cacp-v0.2.md)

旧的 [docs/protocol/cacp-v0.1.md](docs/protocol/cacp-v0.1.md) 仍可作为 v0.1/question-centric MVP 参考，但新实现应优先遵循 v0.2 decision-centric 语义。

---

## CLI Agent 支持状态

- **Claude Code CLI**：当前第一真实测试目标。推荐优先用它验证 pairing、Active Agent、decision、action approval 和手工测试流程。
- **Codex CLI**：通过 adapter profile 架构预留/支持，计划继续补充真实 CLI 验证。
- **opencode CLI**：通过 adapter profile 架构预留/支持，计划继续补充真实 CLI 验证。
- **Echo Test Agent**：适合快速验证房间、消息流和决策解析，不代表真实 CLI 行为。

---

## 重要说明

- 当前项目仍是本地 MVP，不是生产鉴权系统。
- Invite token、pairing token、room token 应视为敏感信息，不要提交到版本库。
- `question.*` 事件属于兼容/历史路径；新的 Agent prompt 和测试流程应使用 `decision.*` 与 `cacp-decision`。
- 若遇到 UI 状态与预期不一致，优先检查 WebSocket 事件流和 `room.history_cleared` 边界后的派生状态。
