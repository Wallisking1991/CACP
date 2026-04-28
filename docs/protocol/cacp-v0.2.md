# CACP v0.2：多人 AI 房间与 Roundtable Mode

CACP v0.2 当前实现聚焦于多人共享房间、Agent pairing、实时事件流和房主控制的 **Roundtable Mode**。旧的结构化 Decision/Question 流程已经从当前主实现中移除：服务端不再解析 `cacp-decision`，Web 不再展示 Decisions 面板，创建房间也不再包含 `default_policy`。

## 核心事件

### 房间与参与者

- `room.created`
- `participant.joined`
- `participant.left`
- `participant.role_updated`
- `invite.created`
- `room.agent_selected`

### 消息与 Agent turn

- `message.created`
- `agent.turn.requested`
- `agent.turn.followup_queued`
- `agent.turn.started`
- `agent.output.delta`
- `agent.turn.completed`
- `agent.turn.failed`

### Agent pairing/status

- `agent.pairing_created`
- `agent.registered`
- `agent.unregistered`
- `agent.disconnected`
- `agent.status_changed`
- `agent.action_approval_requested`
- `agent.action_approval_resolved`

当前 action approval 不再转换为结构化 decision。为了避免误执行高风险动作，服务端会记录请求并返回 rejected，实际协作确认应通过普通聊天和 Roundtable Mode 完成。

### Roundtable Mode

- `ai.collection.started`
- `ai.collection.submitted`
- `ai.collection.cancelled`

### 清空当前上下文

- `room.history_cleared`

当前新事件使用：

```json
{
  "scope": "messages"
}
```

实现仍兼容旧运行数据中的 `messages_and_decisions` 边界，用于避免旧本地数据库影响当前 UI 派生状态。

## 创建房间

```http
POST /rooms
```

请求：

```json
{
  "name": "CACP AI Room",
  "display_name": "Alice"
}
```

响应：

```json
{
  "room_id": "room_xxx",
  "owner_id": "user_xxx",
  "owner_token": "cacp_xxx"
}
```

说明：

- 不再接受或需要 `default_policy`。
- owner 会作为第一个 human participant 加入房间。

## Roundtable Mode

### 开始圆桌

```http
POST /rooms/:roomId/ai-collection/start
Authorization: Bearer <owner_token>
```

响应：

```json
{
  "collection_id": "collection_xxx"
}
```

效果：

- 后续 human `message.created` 会带上 `collection_id`。
- 消息仍广播给所有客户端。
- 不会触发新的 `agent.turn.requested`。

### 申请圆桌模式

```http
POST /rooms/:roomId/ai-collection/request
```

### 同意圆桌申请

```http
POST /rooms/:roomId/ai-collection/requests/:requestId/approve
Authorization: Bearer <owner_token>
```

### 拒绝圆桌申请

```http
POST /rooms/:roomId/ai-collection/requests/:requestId/reject
Authorization: Bearer <owner_token>
```

### 提交圆桌结果

```http
POST /rooms/:roomId/ai-collection/submit
Authorization: Bearer <owner_token>
```

响应：

```json
{
  "ok": true,
  "collection_id": "collection_xxx",
  "message_ids": ["msg_1", "msg_2"]
}
```

效果：

- 追加 `ai.collection.submitted`。
- 如果有 Active Agent，则创建一次 `agent.turn.requested`。
- `context_prompt` 会包含本轮收集到的多人回答。

### 取消圆桌

```http
POST /rooms/:roomId/ai-collection/cancel
Authorization: Bearer <owner_token>
```

响应：

```json
{
  "ok": true,
  "collection_id": "collection_xxx"
}
```

效果：

- 追加 `ai.collection.cancelled`。
- 不触发 Agent turn。

## 普通消息触发 Agent

```http
POST /rooms/:roomId/messages
Authorization: Bearer <owner_admin_or_member_token>
```

请求：

```json
{
  "text": "我们下一步怎么设计多人协作？"
}
```

Live mode 下：

1. 追加 `message.created`；
2. 如果房间有 online Active Agent，则创建 `agent.turn.requested`；
3. 如果已有未完成 turn，则追加 `agent.turn.followup_queued`，避免并发重复 turn。

Roundtable 模式下：

1. 追加带 `collection_id` 的 `message.created`；
2. 不创建 Agent turn；
3. 等 owner 提交收集结果后再合并触发。

## Agent pairing

Owner/admin 可创建 pairing token：

```http
POST /rooms/:roomId/agent-pairings
Authorization: Bearer <owner_or_admin_token>
```

浏览器本地一键启动使用：

```http
POST /rooms/:roomId/agent-pairings/start-local
Authorization: Bearer <owner_or_admin_token>
```

服务端会生成本地 adapter 启动命令，并在 Windows 上打开一个新的 PowerShell console。该 console 是本地 Agent bridge，关闭它会断开本地 CLI Agent。

## 已移除的当前主流程

当前 v0.2 demo 不再使用：

- 创建房间时的 `default_policy`
- `room_default`
- `decision.*`
- `question.*`
- `cacp-decision`
- `cacp-question`
- Web Decisions 面板
- AI 自动生成结构化决策并由服务器自动收敛的流程

如果后续重新引入治理/审批能力，建议基于 Roundtable Mode 的稳定体验重新设计，而不是恢复旧的自动 Decision 判断逻辑。
