# 02 — 共享第一笔 Excalidraw 场景

**What to build:** 打通第一个完整协作切片，使同一 Live Room 中的两名授权
参与者能够通过 CACP 拥有的实时会话看到同一个 Excalidraw 元素，并让后来者
获得当前白板。

**Blocked by:** 01 — 建立白板工作区与编辑器边界

**Status:** ready-for-agent

- [ ] 共享 Protocol 模块定义带版本的白板握手、完整场景、元素更新、确认和
      typed error 契约，且这些消息不属于持久 `CacpEvent` 历史。
- [ ] 专用的房间级 WebSocket 会话复用参与者 token、origin、Live Room 和
      连接生命周期校验。
- [ ] `owner/admin/member` 能连接并提交编辑，`observer` 能连接但服务端拒绝
      编辑，`agent` token 无法建立白板会话。
- [ ] 每个 Live Room 首次使用时惰性创建一个内存场景和单调递增 revision；
      服务端确认并广播接受的第一个元素更新。
- [ ] 新连接和重连连接先收到一个权威完整场景及 revision，完成初始同步前
      客户端不能编辑。
- [ ] Web `WhiteboardSession` 通过已建立的 editor adapter 应用远端场景和
      提交本地变化，observer 始终以只读编辑器进入。
- [ ] 使用真实 server builder、内存数据库和真实 WebSocket 的测试证明两名
      编辑者同步、observer/agent 拒绝、初始消息顺序和重连快照。
- [ ] 房间结束和服务器关闭会清理基本场景、revision 和连接状态；普通房间
      事件回放及 Local Tool Agent 流中不出现白板场景消息。
- [ ] 一个使用真实 Excalidraw adapter 和两个浏览器上下文的冒烟测试证明
      一端绘制的文本或形状会出现在另一端。

## Comments
