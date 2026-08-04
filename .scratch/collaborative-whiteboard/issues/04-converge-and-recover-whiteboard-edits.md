# 04 — 让协作在冲突与断线下安全收敛

**What to build:** 让多人编辑在并发、重试、无效消息和临时断线情况下收敛到
同一权威场景，同时避免未经同步的本地修改覆盖他人工作。

**Blocked by:** 02 — 共享第一笔 Excalidraw 场景

**Status:** ready-for-agent

- [ ] 场景更新携带 client update identifier、base revision、Excalidraw
      element identifier 和版本元数据，仅允许同步明确列出的共享场景设置。
- [ ] 不同元素的并发变化会合并；同一元素的并发版本通过确定性的
      Excalidraw-compatible 规则在所有客户端收敛。
- [ ] 服务端对重试的 update identifier 去重，确认结果一致，且不会生成重复
      revision 或广播。
- [ ] 远端场景应用不会回送成新的本地更新，也不会进入当前参与者的本地
      undo/redo 历史。
- [ ] WebSocket 断开或服务端要求 resync 时，编辑器立即只读但仍可 pan/zoom；
      只有安装新的完整权威场景后才能恢复编辑。
- [ ] 房间结束后，已加载场景保持本地只读，服务端拒绝新的连接和 mutation。
- [ ] 服务端集中执行 payload、元素数量、附件数量和消息速率限制；非法、
      超限、跨 revision 或不可解析的更新返回可恢复 typed error，且不改变
      权威场景。
- [ ] 真实 WebSocket 测试覆盖独立元素合并、同元素冲突、重试去重、无效更新
      隔离、断线只读和完整 resync。
- [ ] adapter/Workspace 测试覆盖 remote-update suppression、本地 undo/redo、
      resync 状态和房间结束状态，不重新测试供应商绘图工具。

## Comments
