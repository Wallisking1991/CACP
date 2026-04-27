# CACP — 协同式智能体通信协议

[English](./README.md) · [体验地址](https://cacp.zuchongai.com/)

## 愿景

CACP 希望形成一种新的、基于多人系统的 AI 交互规范。它不再把 AI 视为“一个人和一个聊天框”的私有工具，而是探索一种共享房间模式：多个人类用户与一个或多个 Agent 在同一事件流中讨论、协调、决策和执行。

这个项目的目标是让 AI 协作变成 protocol-first：客户端、服务器、本地连接器和不同 Agent 工具，都可以围绕统一的房间、角色、消息、事件和控制流语义进行互操作。

<p align="center">
  <img src="./docs/cacp-concept.svg" alt="CACP 概念图" width="900" />
</p>

## CACP 是什么？

CACP 是 **Collaborative Agent Communication Protocol** 的缩写，可理解为“协同式智能体通信协议”。它是一个本地优先的多人 AI 协作协议层和参考平台。目前包含：

- 面向人类用户的 Web 房间，用于创建、加入、邀请和讨论；
- 基于 Fastify/WebSocket 的房间服务器，使用追加式事件日志保存状态；
- 共享 TypeScript/Zod 协议包，用于统一事件和类型契约；
- 本地 CLI Adapter，可连接 Claude Code、Codex、opencode 或 echo 测试 Agent；
- **AI Flow Control**：房主可以先收集多位成员的输入，再合并成一次 Agent 轮次提交。

体验地址：**https://cacp.zuchongai.com/**

## 用户手册

### 1. 打开体验地址

访问 `https://cacp.zuchongai.com/`。该地址用于体验和验证交互模型，请不要输入生产密钥、私有 token 或敏感企业数据。

### 2. 创建房间

选择 **Create Room / 创建房间**，填写房间名称和你的显示名称，然后选择 Agent 类型和权限级别。首次连接真实 CLI Agent 时，建议优先使用 `read_only`。

### 3. 连接本地 Agent

在云端体验模式下，可以从界面下载 Local Connector，并复制生成的 connection code。Connector 会把云端房间桥接到你本机运行的 CLI Agent。关闭 Connector 窗口后，本地 Agent 会断开连接。

### 4. 邀请协作者

房主可以在侧边栏生成邀请链接。`member` 适合参与讨论和发言的成员，`observer` 适合只读观察者。房主可以批准加入请求、移除参与者、清空房间历史。

### 5. 使用 AI Flow Control 协作

快速讨论可以直接使用普通实时聊天。如果需要多人先发表意见，再让 AI 统一处理，房主可以切换到收集模式，等待成员提交观点，审阅后一次性提交给当前激活的 Agent。

### 6. 管理 Agent

侧边栏会显示 Agent 状态、当前激活的 Agent、能力标签和管理入口。如果 Agent 离线，可以重新连接 Local Connector，或重新发起 pairing 流程。

## 开发者手册

### 仓库结构

```text
packages/protocol     共享事件 schema、类型和协议契约
packages/server       Fastify/WebSocket 服务器、认证、配对、事件存储
packages/cli-adapter  本地 CLI 连接器和命令运行逻辑
packages/web          React + Vite Web 房间界面
docs/                 协议文档、图示、示例和部署说明
scripts/              构建和工具脚本
```

### 环境要求

使用 Node.js 20+、Corepack，以及 `package.json` 中声明的 pnpm 版本。

```powershell
corepack enable
corepack pnpm install
```

### 常用命令

```powershell
corepack pnpm check        # 先运行测试，再构建所有包
corepack pnpm test         # 构建 protocol，然后递归运行 Vitest
corepack pnpm build        # 构建所有 workspace package
corepack pnpm dev:server   # 启动 API/WebSocket server，地址 127.0.0.1:3737
corepack pnpm dev:web      # 启动 Vite Web UI，地址 127.0.0.1:5173
corepack pnpm dev:adapter  # 启动通用本地 CLI adapter 示例
```

针对单个包调试：

```powershell
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
```

### 本地开发流程

1. 使用 `corepack pnpm dev:server` 启动服务器。
2. 使用 `corepack pnpm dev:web` 启动 Web UI。
3. 在浏览器中创建房间。
4. 将 `docs/examples/*.json` 示例复制成 git 忽略的 `.local.json` 配置。
5. 运行 `corepack pnpm dev:adapter` 连接本地 Agent。

在 Windows 上，也可以使用 `start-test-services.ps1` 或 `start-test-services.cmd` 启动、重启后台测试服务。运行日志和生成的 adapter 启动脚本会写入 `.tmp-test-services/`。

### 协议开发原则

CACP 采用事件溯源模型。新增行为时，优先定义事件契约，再从事件推导状态。修改事件类型或 payload 时，通常需要同步更新：

- `packages/protocol/src/schemas.ts`；
- `packages/server/src/*` 中的服务端派生逻辑和路由行为；
- `packages/web/src/room-state.ts` 中的前端房间状态派生；
- 测试用例和 `docs/protocol/` 下的协议文档。

### 安全与配置

不要提交 `.env`、`.deploy/*`、`docs/Server info.md`、本地 connector 配置、SQLite 数据库、SSH key、participant token、invite token、pairing code 或生产配置。公开体验环境适合验证交互模型，不适合承载敏感业务数据。

## 联系方式

如需反馈、合作或部署沟通，可以联系：

- 453043662@qq.com
- wangzuchong@gmail.com
- 1023289914@qq.com
