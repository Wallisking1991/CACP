# CACP 协作 AI/CLI Agent 房间 Demo

CACP（Collaborative Agent Communication Protocol）是一个本地优先的多人协作 AI 房间原型。它把 Web 房间、多参与者聊天、本地 CLI Agent、邀请链接、事件流和 **AI Flow Control** 连接在一起，用来验证“多人一起和同一个 AI/Agent 讨论并推进任务”的交互模式。

当前版本已经移除了旧的结构化 Decision/Question 流程：不再有创建房间时的 `Default policy`，不再解析 `cacp-decision`，Web 端也不再展示 Decisions 面板。多人协同节奏主要由房主通过 **AI Flow Control** 控制。

## 当前能力

- 创建共享 AI 房间，并生成 owner token。
- 生成邀请链接，让其他参与者用独立浏览器窗口/身份加入同一房间。
- 一键启动本地 Agent bridge，或手动复制 pairing command。
- 支持 Claude Code CLI、Codex CLI、opencode CLI 和 Echo Test Agent 的 profile。
- 选择 Active Agent 后，普通聊天消息会自动触发 Agent turn。
- 房间控制项仅 owner/admin 可管理；**AI Flow Control 仅 owner 可使用**。
- Observer 邀请加入者只能观看对话，不能发送消息或修改任何控制项。
- Claude Code CLI 的 `Full access` 会使用真正的跳过权限检查模式；修改 Permission 后需要重新启动本地 Agent 才会生效。
- 房主可开启 **AI Flow Control**：
  - 开启后，人类消息仍实时显示给所有人；
  - 消息标记为 `Queued for AI`；
  - 不会逐条发送给 AI；
  - 房主点击 `Submit collected answers` 后，本轮多人回答会合并成一次 Agent turn。
- `Clear room` 会为所有客户端清空当前消息和 AI Flow Control 派生历史。

## 目录结构

```text
.
├─ docs/
│  ├─ examples/        # Agent 配置示例
│  └─ protocol/        # 当前协议说明
├─ packages/
│  ├─ protocol/        # @cacp/protocol：事件与策略基础类型
│  ├─ server/          # @cacp/server：Fastify + WebSocket + SQLite
│  ├─ cli-adapter/     # @cacp/cli-adapter：本地 CLI Agent 适配器
│  └─ web/             # @cacp/web：React/Vite 房间 UI
├─ start-test-services.cmd
├─ start-test-services.ps1
└─ package.json
```

## 安装

要求：

- Node.js 20+
- Corepack
- pnpm（通过 Corepack 使用）
- Windows PowerShell

安装依赖：

```powershell
corepack enable
corepack pnpm install
```

## 一键启动测试服务

推荐使用前台窗口模式：

```powershell
.\start-test-services.cmd
```

启动后：

- Web: `http://127.0.0.1:5173/`
- Server: `http://127.0.0.1:3737`

关闭该 console 或按 `Ctrl+C` 会停止本次启动的服务。

如果要重启后台服务：

```powershell
.\start-test-services.ps1 -Restart
```

## 手工测试流程

1. 打开 `http://127.0.0.1:5173/`。
2. 创建房间，只需要填写 room name 和 your name。
3. 在右侧 `Local Agent` 中选择 Agent type 和 Permission，建议先用 `Claude Code CLI` 或 `Echo Test Agent`。
   - `Read only`：只读分析。
   - `Limited write`：允许普通文件创建/编辑。
   - `Full access`：允许 Claude Code CLI 在房主明确要求时创建/修改文件并执行必要命令。
4. 点击 `Start local agent`。
   - Windows 应弹出一个新的本地 Agent bridge console。
   - 该 console 会显示英文警告，不要在房间使用期间关闭它。
5. Agent 上线后，在 `Active Agent` 中选择它。
6. 点击 `Create invite link`，复制链接到另一个浏览器窗口或隐身窗口加入第二个参与者。
   - `Member` 可以参与聊天，但不能修改控制项。
   - `Observer` 只能观看，不能发送消息，也不能修改控制项。
7. 普通模式下，任意参与者发送消息后，Active Agent 会收到上下文并回复。
8. 测试多人收集：
   - 房主点击 `Start collecting answers`；
   - 两个浏览器窗口分别发送回答；
   - 确认消息显示 `Queued for AI`，且 AI 不会立即回复；
   - 房主点击 `Submit collected answers`；
   - 确认 AI 收到合并后的多人回答并继续回复。
9. 测试 `Cancel collection`：开启收集后发送消息，再取消，确认不会触发 Agent turn。
10. 测试 `Clear room`：确认当前消息和收集历史在所有客户端被清空。

## 常用开发命令

```powershell
# 完整检查：测试 + 构建
corepack pnpm check

# 仅测试
corepack pnpm test

# 仅构建
corepack pnpm build

# 单独启动 Server
corepack pnpm dev:server

# 单独启动 Web
corepack pnpm dev:web
```

按 package 测试：

```powershell
corepack pnpm --filter @cacp/protocol test
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/cli-adapter test
corepack pnpm --filter @cacp/web test
```

## 当前核心交互模型

### Live mode

默认模式。人类消息会：

1. 写入房间事件流；
2. 显示给所有参与者；
3. 触发 Active Agent 的下一轮回复。

### AI Flow Control

房主认为某一轮问题需要多人先分别回答时，开启收集模式。开启后：

1. 所有人仍在主聊天区发消息；
2. 消息不会逐条发给 AI；
3. 房主确认回答收集完成后，再一次性提交给 AI。

这比让 AI 自动创建结构化决策更可靠，也更接近当前 MVP 的验证目标。

## CLI Agent 状态

- **Claude Code CLI**：当前优先测试目标。
- **Codex CLI**：profile 已预留，后续继续真实验证。
- **opencode CLI**：profile 已预留，后续继续真实验证。
- **Echo Test Agent**：适合快速验证房间、消息流和 Agent turn。

## 协议说明

当前协议说明见：

- [docs/protocol/cacp-v0.2.md](docs/protocol/cacp-v0.2.md)

旧的 `docs/protocol/cacp-v0.1.md` 仅作为历史参考。

## 注意事项

- 当前项目是本地 MVP demo，不是生产鉴权系统。
- Invite token、pairing token、room token 都应视为敏感信息。
- 如果修改了 Server/Web 代码，已运行的测试服务需要重启后才会生效。
- 如果 `Start local agent` 行为异常，优先检查 `.tmp-test-services/server.*.log` 和 `.tmp-test-services/adapters/` 下的启动脚本与日志。
