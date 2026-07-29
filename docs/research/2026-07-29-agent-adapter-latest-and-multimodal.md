# Agent 适配器最新版与图片/文件输入调研

日期：2026-07-29

范围：`packages/cli-adapter` 中 Claude、Codex、GitHub Copilot、Kimi 四个本地工具型 Agent SDK 适配器。HTTP LLM provider WIP 已归档，不属于本次实现或当前产品支持面。

方法：对照仓库源码、lockfile、各 SDK 的官方 npm 包声明、官方 changelog/release、官方 API 文档。本文不把某个厂商的兼容协议能力推断为其他厂商也支持。

## 结论摘要

1. 建议升级：
   - `@anthropic-ai/claude-agent-sdk`：`0.2.128` → `0.3.220`。
   - `@openai/codex-sdk`：`0.128.0` → `0.146.0`。
   - `@github/copilot-sdk`：`0.3.0` → `1.0.8`。
   - `@moonshot-ai/kimi-agent-sdk`：当前 `0.1.8` 已是最新稳定版，无需升版本，但 CACP 尚未暴露它已有的多模态输入。
2. 不能只改 `package.json`：
   - Copilot 1.x 的 client 构造参数发生了明确的不兼容变化，当前 `cliPath/useStdio/autoStart` 写法必须迁移到 `RuntimeConnection.forStdio({ path })`。
   - Claude 0.3.x 有工具、MCP 初始化与权限回调行为变化，需要更新事件归一化和回归测试。
   - Codex 和 Kimi 的 SDK 已有图片输入，但 CACP 自己的类型把输入收窄成了 `string`。
3. 图片/文件上传应先建立 CACP 自己的统一附件模型，再由各适配器做降级映射。不能把附件直接拼进 prompt，也不能假设所有 “OpenAI-compatible” 或 “Anthropic-compatible” 服务都支持相同 content block。
4. 对任意文件最可靠的 Agent 路径是：服务器保存附件元数据和受控对象，Local Connector 下载到每房间/每消息的隔离工作目录，再把本地路径或 SDK 原生 attachment 传给 Agent。图片可在支持时走原生视觉输入；不支持时必须明确提示“仅作为工作区文件提供”，不能静默丢失。

## 当前仓库基线

依赖声明在 [`packages/cli-adapter/package.json`](../../packages/cli-adapter/package.json)，实际 lock 版本在 [`pnpm-lock.yaml`](../../pnpm-lock.yaml)：

| SDK                |        当前声明 / lock |                                                                        2026-07-29 最新稳定版 | 升级性质                            |
| ------------------ | ---------------------: | -------------------------------------------------------------------------------------------: | ----------------------------------- |
| Claude Agent SDK   | `^0.2.128` / `0.2.128` | [`0.3.220`](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.220) | 跨 `0.x` minor，含 breaking changes |
| OpenAI Codex SDK   |  `0.128.0` / `0.128.0` |                      [`0.146.0`](https://github.com/openai/codex/releases/tag/rust-v0.146.0) | 公开类型对比主要为增量变化          |
| GitHub Copilot SDK |     `^0.3.0` / `0.3.0` |                         [`1.0.8`](https://github.com/github/copilot-sdk/releases/tag/v1.0.8) | 跨 major，client 构造 API 不兼容    |
| Kimi Agent SDK     |     `^0.1.8` / `0.1.8` |                 [`0.1.8`](https://www.npmjs.com/package/@moonshot-ai/kimi-agent-sdk/v/0.1.8) | 已是最新稳定版                      |

`^0.2.128` 不会自动进入 Claude `0.3.x`，`^0.3.0` 也不会自动进入 Copilot `1.x`；因此当前 lockfile 保持旧版是预期的 semver 结果。

当前四个 Agent runtime 都把房间消息以纯字符串发送：

- Claude：[`claude/runtime.ts`](../../packages/cli-adapter/src/claude/runtime.ts) 调用 `query({ prompt: string })`。
- Codex：[`codex/types.ts`](../../packages/cli-adapter/src/codex/types.ts) 和 [`codex/codex-sdk.ts`](../../packages/cli-adapter/src/codex/codex-sdk.ts) 将 `runStreamed` 收窄为 `string`。
- Copilot：[`copilot/runtime.ts`](../../packages/cli-adapter/src/copilot/runtime.ts) 只调用 `session.send({ prompt })`。
- Kimi：[`kimi/runtime.ts`](../../packages/cli-adapter/src/kimi/runtime.ts) 只调用 `session.prompt(prompt)`；虽然边界类型已容许数组，runtime 没有使用。

当前 LLM provider 也仅支持纯文本：

- [`llm/providers/types.ts`](../../packages/cli-adapter/src/llm/providers/types.ts) 只有 `openai-chat | anthropic-messages` 两种协议，request input 没有 attachment/content-part。
- [`llm/providers/openai-chat.ts`](../../packages/cli-adapter/src/llm/providers/openai-chat.ts) 固定请求 `/chat/completions`，user `content` 为字符串。
- [`llm/providers/anthropic-messages.ts`](../../packages/cli-adapter/src/llm/providers/anthropic-messages.ts) 的 user `content` 也是字符串。

## 逐适配器升级结论

### Claude Agent SDK：0.2.128 → 0.3.220

#### 升级兼容性

CACP 已经使用 `query()` 和 `options.resume`，没有使用 0.3.142 删除的 unstable v2 session API，因此主要调用路径仍然成立。官方 changelog 明确列出的 0.3.142 breaking changes包括：

- 删除 v2 session API；多轮应使用 `AsyncIterable<SDKUserMessage>`，恢复会话继续使用 `options.resume`。
- MCP server 改为默认后台连接，首轮可能看到 `pending`；需要首轮强依赖时使用 `alwaysLoad`，或用 `MCP_CONNECTION_NONBLOCKING=0` 恢复旧等待行为。
- SDK/headless session 从 `TodoWrite` 切换为 `TaskCreate/TaskUpdate/TaskGet/TaskList`，消费者应按 task ID 累积状态，而不是替换整个待办快照。以上均见 [Claude Agent SDK 0.3.142 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03142)。

另外需要纳入测试的变化：

- 0.3.143 将 `@anthropic-ai/sdk` 与 `@modelcontextprotocol/sdk` 改为 peer dependencies；pnpm 会安装，但打包/SEA 构建必须验证类型与运行时解析。[官方 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03143)
- 原生构建默认把 find/grep 走 Bash 内嵌实现；如果 CACP 依赖 `canUseTool` 或 hook 拦截专用 Grep/Glob，需要在 `tools` 或 `allowedTools` 中显式声明。[0.3.162](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03162)
- background agent 的权限请求现在会转发给 `canUseTool`，且 stdin 会保持打开。[0.3.186](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03186)
- `canUseTool` options 增加 `requestId`，并可返回 `null` 以抑制自动响应。[0.3.199](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03199)

#### 图片与文件

0.3.220 的发布类型仍允许 `query` 接收 `string | AsyncIterable<SDKUserMessage>`，而 `SDKUserMessage.message` 使用 Anthropic `MessageParam`。因此 CACP 可以为含附件的单轮消息生成一个结构化 `SDKUserMessage` 输入流，而不是继续只传 string。会话恢复仍走 `options.resume`；这与官方迁移说明一致。[TypeScript Agent SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript) / [0.3.142 migration note](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md#03142)

Canonical Anthropic Messages 输入形态：

- 图片：user `content` 数组中的 `image` block；source 可为 base64、URL 或 Files API `file_id`。[Claude Vision 文档](https://platform.claude.com/docs/en/build-with-claude/vision#send-images-to-claude)
- PDF/文档：`document` block；PDF 可用 URL、base64 或 Files API `file_id`。纯文本文件可以 text/plain document 使用；`.docx`、`.xlsx` 等二进制格式不能直接作为 document block，需转文本或 PDF。[Claude PDF 文档](https://platform.claude.com/docs/en/build-with-claude/pdf-support#process-pdfs-with-claude)

实现建议：

- 将 Claude boundary 的 `prompt` 类型扩为 `string | AsyncIterable<ClaudeUserMessage>`，不要在 adapter 内使用 `unknown` 跳过校验。
- 图片优先用 `image` content block；PDF/text 可用 `document` block。
- 对 `.docx/.xlsx/zip` 等任意文件，下载到 Connector 隔离工作目录，在文本中给出受控相对路径，让 Agent 使用文件工具读取；不要伪装成 Anthropic document block。
- 增加 “MCP pending 后首轮工具可用性”“background agent 权限请求”“Task 工具增量事件”回归测试。

### OpenAI Codex SDK：0.128.0 → 0.146.0

#### 升级兼容性

对 npm 包公开 `.d.ts` 的 `0.128.0` 与 `0.146.0` 比对，`startThread`、`resumeThread`、`Thread.runStreamed` 的主调用模式未移除。可见增量包括 MCP tool result 的 `_meta`，以及 usage 的 `cache_write_input_tokens`。0.146.0 的 SDK 会在旧 event 未给出该 usage 字段时补 `0`。[0.146.0 `items.ts`](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/src/items.ts) / [`thread.ts`](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/src/thread.ts)

没有发现针对 TypeScript SDK 0.128→0.146 的单独 breaking migration guide；因此“主要为增量”是公开类型差异结论，不代表无需真实 CLI/SEA 集成测试。

#### 图片与文件

最新 SDK 的输入类型为：

```ts
type Input =
  | string
  | Array<
      { type: "text"; text: string } | { type: "local_image"; path: string }
    >;
```

`run` 与 `runStreamed` 均接受该类型，图片路径会传给 Codex CLI 的 `--image`。[官方 `thread.ts`](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/src/thread.ts#L36-L42) / [SDK README 图片示例](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/README.md#attaching-images)

因此当前阻塞点不在 SDK，而在 CACP 自己把 `runStreamed` 写成 `input: string`。建议：

- 在 `codex/types.ts` 定义与 SDK 对齐的 `CodexInput` union，并在 boundary 中透传。
- 图片先下载为 Connector 本地文件，再传 `{ type: "local_image", path }`。
- 最新公开 `UserInput` 没有任意 `file` 类型。普通文件应落在 thread 的 `workingDirectory` 或 `additionalDirectories` 内，并在 text item 中引用路径；这属于“Agent 可访问文件”，不是“模型原生文件 attachment”，UI 必须区分。
- 更新 usage 和 MCP result 的归一化类型，避免把新字段丢掉；未知 event 保持前向兼容。

### GitHub Copilot SDK：0.3.0 → 1.0.8

#### 必须迁移的 client 构造 API

0.3.0 的 `CopilotClientOptions` 使用 `cliPath`、`useStdio`、`autoStart` 等字段。[官方 v0.3.0 类型](https://github.com/github/copilot-sdk/blob/v0.3.0/nodejs/src/types.ts#L1159-L1251)

1.0.8 改为 `connection?: RuntimeConnection`，默认是 bundled runtime 的 stdio；自定义二进制路径应写为：

```ts
new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: cliPath }),
});
```

官方 1.0.8 类型与构造示例见 [`CopilotClientOptions`](https://github.com/github/copilot-sdk/blob/v1.0.8/nodejs/src/types.ts#L1344-L1402) 和 [`CopilotClient` constructor](https://github.com/github/copilot-sdk/blob/v1.0.8/nodejs/src/client.ts#L493-L548)。因此 CACP 当前 `new CopilotClient({ cliPath, useStdio: true, autoStart: true })` 会在 1.x 编译失败，不能仅升级依赖。

`createSession/resumeSession`、session `on`、`send`、`abort`、`disconnect` 仍是有效的核心路径。官方兼容表也明确列出 session create/resume、send/sendAndWait、history、abort、custom tools 和 tool permission hooks。[GitHub Copilot SDK/CLI compatibility](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility#available-in-sdk)

其他值得考虑但不应与版本升级捆绑启用的能力：

- 1.x 支持 `toolSearch` 延迟加载大量工具。[官方 changelog](https://github.com/github/copilot-sdk/blob/v1.0.8/CHANGELOG.md#feature-tool-search-configuration)
- `mode: "copilot-cli"` 是默认 ambient 行为；官方类型警告它会带来可访问主机环境的工具能力，多用户 server 应使用 `"empty"` 并显式配置。CACP 的 Agent 执行发生在用户本地 Connector，不等同于服务端多租户执行，但仍应把此模式做成显式、安全可见的配置，而不是升级时悄悄改变权限模型。[官方类型说明](https://github.com/github/copilot-sdk/blob/v1.0.8/nodejs/src/types.ts#L1335-L1343)

#### 图片与文件

Copilot 是四个 SDK 中附件接口最完整的：

- `send({ attachments: [{ type: "file", path }] })`；图片会自动编码、缩放。
- `directory` attachment 可附加目录上下文。
- custom tools 支持完整 JSON Schema，见 [官方兼容表](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility#available-in-sdk)。
- `blob` attachment 可以直接传 base64 数据和 MIME type，适合内存中的截图/图片，不必先写磁盘。[官方 changelog](https://github.com/github/copilot-sdk/blob/v1.0.8/CHANGELOG.md#blob-attachments-for-inline-binary-data)

1.0.8 的 `session.send` 仍同时接受字符串和带 `prompt/attachments/mode` 的 `MessageOptions`。[官方 `session.ts`](https://github.com/github/copilot-sdk/blob/v1.0.8/nodejs/src/session.ts#L433-L465)

建议：

- CACP 上传文件已落盘时使用 `file`，目录分享需要单独的高风险权限确认，不要根据普通上传自动生成 `directory` attachment。
- 仅对受信 MIME 的小型图片考虑 `blob`；普通文件继续使用受控 local path，避免 base64 带来的内存和 IPC 放大。
- 保留现有 `onPermissionRequest` 桥接，并增加 resume、attachment、tool event、abort 的 1.x 集成测试。

### Kimi Agent SDK：保持 0.1.8

#### 版本与现有能力

官方 npm latest 仍为 `0.1.8`；当前无需 bump。其 Node API 原生支持：

- `createSession({ sessionId })` 恢复既有 session。
- `Session.prompt(content: string | ContentPart[])`，返回可异步迭代的 Turn。
- Turn 支持 `interrupt()`、approval；SDK 支持 zod external tools，见 [Kimi Agent SDK Node README](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/node/agent_sdk/README.md#api-reference) 和 [tool/approval 示例](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/node/agent_sdk/README.md#creating-external-tools)。

#### 图片与文件

`ContentPart` 支持 `text`、`think`、`image_url`、`audio_url`、`video_url`；官方图片示例使用 data URL，并在同一 session 中继续多轮对话。[官方 ContentPart 定义](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/node/agent_sdk/README.md#content-types) / [图片多轮示例](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/node/agent_sdk/README.md#multi-turn-conversation-with-image-input)

公开类型没有通用 `file/document` part。建议：

- 把 Kimi runtime 的 prompt 参数扩为 `string | KimiContentPart[]`，图片按 `image_url` 发送。
- URL 应优先使用短期、授权、不可猜测的下载地址；在 Connector 已取得文件时，也可生成 data URL，但必须设置大小上限。
- 任意文件仍下载到 `workDir` 并在文本中引用受控路径。不要把 audio/video/image 支持解释成“任意文件上传都原生支持”。

## OpenAI-compatible 与 Anthropic-compatible 的当前标准输入

### OpenAI

OpenAI 当前建议新项目使用 Responses API；Chat Completions 仍受支持。Responses 提供 typed Items、内置工具、多轮状态和原生多模态。[官方迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)

两种需要支持但必须分开的形态：

1. Chat Completions：
   - 图片：user `content` 数组使用 `{ type: "text" }` 与 `{ type: "image_url", image_url: { url } }`，URL 可为公网 URL 或 data URL。[官方 vision 示例](https://developers.openai.com/api/docs/guides/images-vision#giving-a-model-images-as-input)
   - 文件：当前官方 Chat Completions 示例支持 `{ type: "file", file: { file_id } }`。[官方 file inputs 示例](https://developers.openai.com/api/docs/guides/file-inputs)
2. Responses：
   - 文本/图片：`input_text`、`input_image`。
   - 文件：`input_file`，可使用 base64 `file_data`、Files API `file_id` 或 external `file_url`。PDF 会同时提取文本和页面图像；docx/pptx/text 提取文本；表格有专门处理。[官方 file inputs 文档](https://developers.openai.com/api/docs/guides/file-inputs#how-it-works)

对 CACP 的含义：

- 不要把现有 `openai-chat` provider 原地改成 `/responses`；新增 `openai-responses` 协议族和对应 SSE parser，保留 Chat Completions。
- `custom-openai-compatible` 默认能力只能是 text。增加显式 capabilities/config，例如 `visionChatContent`、`chatFileBlock`、`responses`、`responsesFileInput`；只有用户选择或探测确认后才发送对应 block。
- SiliconFlow、Kimi API、MiniMax、GLM、DeepSeek 等当前复用 OpenAI Chat builder 的 provider，必须分别依据其官方 endpoint/model 文档开启能力；本文没有对它们作“均支持图片/文件”的推断。

### Anthropic

Canonical Anthropic Messages 使用 user `content` block 数组：

- 图片为 `image`，source 是 base64、URL 或 Files API `file_id`。[官方 Vision](https://platform.claude.com/docs/en/build-with-claude/vision#send-images-to-claude)
- PDF/文本文件为 `document`，source 是 URL、base64 或 Files API `file_id`；二进制 Office 文件需要转换。[官方 PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support#process-pdfs-with-claude)

对 `custom-anthropic-compatible` 同样不能默认启用所有 block。建议用 capability flags 分开表示：

- `imageBase64`
- `imageUrl`
- `filesApi`
- `documentPdf`
- `documentText`

若网关只兼容基础 Messages text，则 UI 仍允许上传，但 adapter 应改走本地文件路径/文本提取降级，并向用户显示降级状态。

## 推荐的统一附件架构

### 1. Protocol 层：消息只引用附件，不把二进制塞进 WebSocket event

建议新增稳定的领域类型：

```ts
type RoomAttachment = {
  id: string;
  messageId?: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: "image" | "document" | "archive" | "other";
  state: "uploading" | "ready" | "failed" | "expired";
};

type AgentPromptPart =
  { type: "text"; text: string } | { type: "attachment"; attachmentId: string };
```

二进制用独立的授权 HTTP upload/download 流；room event 只保存不可变 attachment metadata/reference。这样不会让 SQLite event log、WebSocket 重放、上下文派生和客户端内存被 base64 放大。

### 2. Server 层：上传生命周期与访问控制

- `init upload` → 流式上传 → MIME sniff/大小/hash 校验 → `ready`。
- 下载必须同时校验 room membership、attachment ownership/visibility 和短期 token。
- 配置总大小、单文件、单消息、房间配额；文件名只做展示，存储 key 使用服务端 ID。
- 禁止路径穿越、可执行内容自动运行、HTML/SVG 主动内容直接内联；日志不得记录 download token、原文件内容或 connector 本地路径。
- 删除/过期用独立事件表达，历史消息保留 metadata，但不保证二进制永久存在。

### 3. Local Connector：安全落盘与 adapter materialization

- 每个 room/message 使用隔离目录，如 `<connector-data>/attachments/<roomId>/<messageId>/`。
- 服务端文件名不得直接决定本地路径；使用 attachment ID 作为真实文件名，展示名保存为 metadata。
- 校验下载后的 size + sha256，再原子重命名为 ready。
- adapter 收到的是结构化 `ResolvedAttachment`，包括受控 local path、MIME、大小和可选短期 URL；adapter 自己选择最佳映射。
- session 结束后按策略清理；清理不得越过 Connector data root。

### 4. Adapter capability negotiation

建议每个 adapter/provider 暴露：

```ts
type AdapterInputCapabilities = {
  nativeImages: boolean;
  nativeFiles: "none" | "selected-types" | "any-local-file";
  acceptedMimeTypes?: string[];
  maxAttachmentBytes?: number;
  supportsRemoteUrl: boolean;
  supportsDataUrl: boolean;
  supportsLocalPath: boolean;
};
```

推荐映射：

| Adapter            | 图片最佳路径                 | 任意文件最佳路径                              | 需要明确的降级                    |
| ------------------ | ---------------------------- | --------------------------------------------- | --------------------------------- |
| Claude Agent       | `SDKUserMessage` image block | PDF/text document block；其他为本地工作区路径 | Office/binary 不可伪装成 document |
| Codex              | `local_image`                | 工作目录/`additionalDirectories` + 文本引用   | SDK 没有通用 file input           |
| Copilot            | `file` 或小图 `blob`         | `file` attachment                             | directory 必须单独授权            |
| Kimi               | `image_url`/data URL         | `workDir` 路径 + 文本引用                     | 没有通用 file part                |
| OpenAI Chat        | `image_url` content          | `file` block（仅确认支持时）                  | 兼容网关默认 text-only            |
| OpenAI Responses   | `input_image`                | `input_file`                                  | 需要独立 endpoint/parser          |
| Anthropic Messages | `image`                      | `document`（受支持格式）                      | 兼容网关默认 text-only            |

关键 UX 原则：发送前在 composer 附件 chip 上显示最终能力状态——“原生视觉”“作为文件供 Agent 读取”“将提取文本”“此适配器不支持”。不允许上传成功但运行时静默忽略。

## 推荐实施顺序与验证

1. 先定义 Protocol attachment metadata、HTTP 上传/下载、权限与限额；此阶段不改 SDK。
2. 增加 Connector attachment resolver 和统一 `AgentPromptPart[]`，保留纯文本兼容入口。
3. 先接 Copilot 与 Codex 图片：
   - Copilot 原生 file/blob 接口清晰。
   - Codex `local_image` 路径简单，能验证 server→connector 落盘链路。
4. 接 Kimi `ContentPart[]` 与 Claude `SDKUserMessage`；同步升级 Claude 0.3.220 并处理 Task/MCP/permission 行为。
5. 升 Copilot 1.0.8 并单独完成 constructor migration；不要与附件协议变更放进同一个难以回滚的提交。
6. 升 Codex 0.146.0，扩展 Input、usage、MCP `_meta`。
7. 最后扩展 HTTP LLM provider：
   - 先让现有 Chat/Messages builder 接受 capability-gated content parts。
   - 再新增 OpenAI Responses endpoint 和 SSE parser。

最低验证矩阵：

- 每个 Agent：新会话、恢复会话、纯文本、单图、多图、普通文件、取消、permission allow/deny、tool call、SDK/CLI 缺失错误。
- 上传：越权下载、过大、MIME 伪造、hash 不匹配、重复上传、断点/失败、附件过期、房间事件重放。
- Windows Connector/SEA：包含空格和非 ASCII 的路径、长路径、只读目录、打包后 SDK binary/runtime 解析。
- provider：text-only capability 不发送多模态 block；已启用能力的 request snapshot 与官方形态一致；SSE 中 text/tool/error/terminal event 均能正确结束。

## 官方资料索引

- Claude：[0.3.220 release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.220)、[完整 changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)、[TypeScript Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript)、[Vision](https://platform.claude.com/docs/en/build-with-claude/vision)、[PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)。
- Codex：[0.146.0 release](https://github.com/openai/codex/releases/tag/rust-v0.146.0)、[TypeScript SDK README](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/README.md)、[`thread.ts`](https://github.com/openai/codex/blob/rust-v0.146.0/sdk/typescript/src/thread.ts)。
- Copilot：[1.0.8 release](https://github.com/github/copilot-sdk/releases/tag/v1.0.8)、[changelog](https://github.com/github/copilot-sdk/blob/v1.0.8/CHANGELOG.md)、[SDK/CLI compatibility](https://docs.github.com/en/copilot/how-tos/copilot-sdk/troubleshooting/compatibility)、[Node client types](https://github.com/github/copilot-sdk/blob/v1.0.8/nodejs/src/types.ts)。
- Kimi：[npm package 0.1.8](https://www.npmjs.com/package/@moonshot-ai/kimi-agent-sdk/v/0.1.8)、[Node SDK README](https://github.com/MoonshotAI/kimi-agent-sdk/blob/main/node/agent_sdk/README.md)。
- OpenAI API：[Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[Images and vision](https://developers.openai.com/api/docs/guides/images-vision)、[File inputs](https://developers.openai.com/api/docs/guides/file-inputs)。
