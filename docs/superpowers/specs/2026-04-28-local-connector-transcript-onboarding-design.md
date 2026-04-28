# CACP Local Connector Transcript and Onboarding Design

日期：2026-04-28  
状态：已与用户讨论并批准的设计草案  
范围：云端房间创建后的 Local Connector 引导、本地聊天记录写入、Connector 连接成功提示

## 1. 背景

CACP 当前已经形成“云端 Web Room + 用户本地 Local Connector + 本地 Agent 执行”的边界。房主在云端创建房间后，会生成连接码，用户下载并运行 `CACP-Local-Connector.exe`，再把连接码粘贴到命令行窗口中完成本地 Agent 接入。

这条链路已经可用，但存在三个体验缺口：

1. 房间聊天内容只在 Web Room 中展示，房主希望 Connector 运行后能实时写入到 `CACP-Local-Connector.exe` 所在客户端目录中，形成可读的本地记录。
2. 房主创建房间后，需要更直接地拿到连接码，不应依赖在侧边栏中寻找复制入口。
3. `CACP-Local-Connector.exe` 成功连接后，命令行窗口应给出醒目的“连接成功、不要关闭窗口、回到 Web 开始协作”的引导。

## 2. 目标

- 在不改变 CACP 协议主模型的前提下，增强 Local Connector 与 Web UI 的首次使用体验。
- 将房间聊天正文实时写入 Connector 所在目录下的 Markdown 文件，便于房主直接打开阅读。
- 在云端模式下，房主创建房间后立即看到“下载 Connector + 复制连接码”的弹窗。
- Connector 真正建立 WebSocket 事件流后，输出彩色、醒目的成功提示和简短流程图，提醒房主可以进入 Web 开启多人协同式 AI 创作。

## 3. 非目标

- 不做完整事件日志同步；本次只保存用户可读聊天正文。
- 不保存连接码、pairing token、participant token 或其他敏感凭据。
- 不新增云端 transcript 导出接口。
- 不做附件、白板、任务产物、Agent 工具调用结果的本地 workspace 同步。
- 不改变现有房间、参与者、Agent pairing、WebSocket 事件协议。

## 4. 设计决策

### 4.1 本地聊天记录：每个房间一个 `chat.md`

用户选择：每个房间一个文件。

Connector 在自身工作目录下创建：

```text
rooms/<room_id>/chat.md
```

对于打包后的 `CACP-Local-Connector.exe`，默认工作目录应继续使用 exe 所在目录。这样用户可以把 exe 放到任意文件夹，聊天记录会自然落到同一个客户端目录中。

### 4.2 只记录聊天正文

用户选择：只写可读聊天内容，不写完整事件日志。

记录范围：

- `message.created` 事件。
- 人类消息和 Agent 最终消息。
- Markdown 中显示时间、发送者、消息正文。

不记录：

- 原始事件 JSON。
- 连接码、pairing token、participant token。
- Agent 状态、审批、任务输出 delta 等非聊天正文事件。

### 4.3 连接码弹窗内容

用户选择：弹窗包含下载 Local Connector 和复制连接码两个核心动作。

房主在云端模式下创建房间并生成新 `connection_code` 后，Web Room 自动显示 modal：

- 下载 `CACP-Local-Connector.exe`。
- 一键复制连接码。
- 显示连接码有效期。
- 提供关闭按钮。

侧边栏已有 Local Connector 卡片继续保留，弹窗只优化首次创建后的关键路径。

### 4.4 成功提示触发时机

用户选择：WebSocket 事件流真正连上后再提示成功。

这比“连接码 claim 成功”更准确，因为用户最关心的是本地 Connector 是否已经在线、能否服务 Web Room。

## 5. 本地 `chat.md` 格式

初次创建文件时写入头部：

```md
# CACP Room Chat

Room: room_xxx
Started: 2026-04-28 11:30

---
```

每条消息追加为：

```md
## 2026-04-28 11:31 - Alice

你好，我们开始讨论。

## 2026-04-28 11:32 - Claude Code

我已收到上下文。
```

发送者名称来源：

- Connector 接收到的 `participant.joined` 历史事件与后续事件可维护 `participant_id -> display_name` 映射。
- 如果暂时没有名称，则回退为 `actor_id`。

时间来源：

- 使用事件的 `created_at`。
- 本地显示可以采用系统 locale 的可读时间；文件内容保持稳定、易读即可。

Markdown 安全处理：

- 消息正文原样保留为文本。
- 标题中的发送者名称需去除换行，避免破坏 Markdown 结构。
- 单条消息之间保留空行，便于阅读和复制。

## 6. 写入与去重规则

Connector 建立 WebSocket 后，服务端会先推送历史事件，再推送实时事件。Connector 需要将这两类事件统一处理：

1. 看到 `participant.joined` 时更新参与者名称映射。
2. 看到 `message.created` 时尝试写入 `chat.md`。
3. 用 `message_id` 去重；同一个 `message_id` 只写一次。
4. 如果 `message_id` 缺失，则用 `event_id` 作为去重键。
5. 文件已存在时不清空，继续追加当前进程未写过的消息。

本设计接受一个限制：如果用户手动删除了文件中间的某些消息，Connector 不负责重建完整文件；它只保证当前连接期间不重复追加同一消息。

## 7. 错误处理

本地文件写入不能阻断 Connector 主功能。

- 如果无法创建 `rooms/<room_id>` 或无法写入 `chat.md`，命令行输出醒目错误。
- Connector 仍继续保持 WebSocket 在线。
- 后续消息仍可尝试写入；如果一直失败，错误可以节流显示，避免刷屏。
- 成功提示中显示本地记录路径；如果写入初始化失败，则显示“聊天记录保存失败，请检查目录权限”。

## 8. Web 创建房间后的连接码弹窗

### 8.1 展示条件

仅在以下条件同时满足时自动弹出：

- 当前为云端模式。
- 当前用户是房主。
- 创建房间流程刚刚生成新的 `connection_code`。

刷新页面不重复自动弹出。

### 8.2 内容结构

弹窗建议内容：

```text
连接本地 Agent

1. 下载并运行 CACP-Local-Connector.exe
2. 点击复制连接码
3. 把连接码粘贴到 Connector 窗口中

[下载 CACP-Local-Connector.exe] [复制连接码]

连接码有效期至：...
```

### 8.3 行为

- 点击下载按钮：使用现有 `download_url`。
- 点击复制按钮：复制完整 `connection_code`。
- 复制成功后按钮文案短暂变为“已复制”。
- 如果剪贴板 API 失败，仍展示可手动选择的连接码预览。
- 关闭弹窗后，侧边栏仍可再次下载和复制。

## 9. Connector 连接成功提示

### 9.1 触发

在 `packages/cli-adapter/src/index.ts` 的 WebSocket `open` 事件中触发。

### 9.2 提示内容

建议输出：

```text
╔══════════════════════════════════════════════╗
║  ✅ 连接成功 / CONNECTED                     ║
╚══════════════════════════════════════════════╝

🤖 本地 Agent 已连接到房间：room_xxx
⚠️  请不要关闭此窗口，否则本地 Agent 会从房间断开。

📄 聊天记录正在保存到：
D:\...\rooms\room_xxx\chat.md

──────────────────────────────────────────────
👥 房主现在可以回到 Web 房间
🚀 开启多人协同式 AI 创作
──────────────────────────────────────────────

        👤 房主 / 团队成员
              │
              ▼
        🌐 CACP Web Room
              │  实时讨论 / 多人协作
              ▼
        🤖 Local Agent
              │
              ▼
        📄 本地聊天记录 chat.md
```

### 9.3 颜色

- 成功标题：绿色。
- “不要关闭窗口”：黄色或红色。
- `chat.md` 路径：青色。
- 图标和边框使用普通 Unicode/ASCII；终端不支持颜色时仍能读懂。

### 9.4 与现有启动提示的关系

服务端本地自动启动脚本 `buildLocalAgentConsoleScript()` 已有“不要关闭窗口”的启动前提示。新提示发生在真正连接成功后，表达更具体：

- 当前已在线。
- 可以回到 Web Room。
- 多人协同式 AI 创作可以开始。
- 本地聊天记录路径在哪里。

## 10. 组件影响

### 10.1 `packages/cli-adapter`

新增或调整：

- 本地 transcript helper：负责路径解析、目录创建、Markdown 头部、消息格式化、去重追加。
- CLI 成功提示 helper：负责彩色输出和图标流程图。
- `index.ts` WebSocket 消息处理：在处理 `participant.joined` 和 `message.created` 时更新 transcript。

### 10.2 `packages/web`

新增或调整：

- 创建房间后连接码 modal 组件。
- `App.tsx` 中在云端创建房间并设置 `createdPairing` 后触发 modal。
- i18n 文案：中英文都需要补齐，避免公开页面出现半翻译状态。
- 侧边栏 Local Connector 卡片保留。

### 10.3 `packages/server` 和 `packages/protocol`

不需要协议或服务端 API 变更。

## 11. 测试计划

### 11.1 CLI adapter

- `message.created` 能写入 `rooms/<room_id>/chat.md`。
- `participant.joined` 后，消息标题使用 display name。
- 重复 `message_id` 不重复追加。
- 缺失 `message_id` 时使用 `event_id` 去重。
- 写入目录失败时不抛出导致进程退出。
- 连接成功提示包含：
  - “连接成功 / CONNECTED”
  - “请不要关闭此窗口”
  - “回到 Web 房间”
  - “开启多人协同式 AI 创作”
  - `chat.md` 路径

### 11.2 Web

- 云端创建房间并生成 pairing 后显示 modal。
- modal 下载按钮使用 `createdPairing.download_url`。
- modal 复制按钮复制完整 `createdPairing.connection_code`。
- 复制成功显示“已复制”。
- 关闭 modal 后侧边栏仍显示 Local Connector 卡片。
- 刷新页面不重复自动弹出。
- 中英文 i18n 文案完整。

### 11.3 全仓验证

完成实现后运行：

```powershell
corepack pnpm check
```

## 12. 安全与隐私

- 本地 `chat.md` 只写入聊天正文，不写 token、连接码、密钥。
- 文件落在用户主动放置 Connector 的目录中，不写系统目录或隐藏目录。
- 连接码弹窗显示和复制的是当前已有 pairing 结果，不新增敏感服务端接口。
- 命令行提示避免输出 participant token 或 agent token。

## 13. 开放问题与明确取舍

- 本次不做服务端 transcript 导出，避免扩大云端导出权限面。
- 本次不做完整事件日志，本地文件以“人可读”为第一优先级。
- 本次不解决多进程同时连接同一房间时对同一 `chat.md` 并发追加的问题；常规使用路径是一个 Connector 对一个房间，后续如需要可加入文件锁。
- 本次不承诺离线补全所有历史；但当前 WebSocket 历史事件回放机制已经能在连接成功时补写服务端推送的历史 `message.created`。

## 14. 自检

- 无空白待补项。
- 设计与 local-first/cloud-room 边界一致：云端只负责房间与事件流，本地 Connector 负责本地文件落盘。
- 范围聚焦在三个用户提出的优化点：本地聊天记录、创建后连接码弹窗、连接成功命令行提示。
- 不要求协议或服务端 API 变更，实施风险集中在 CLI adapter 和 Web UI。
