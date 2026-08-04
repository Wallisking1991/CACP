# 07 — 把选择或 Frame 发送为 Main Input

**What to build:** 让 owner/admin 把白板选择或 Frame 明确提升为受治理的
Main Input，同时保留 PNG 预览和可编辑 `.excalidraw` 源文件。

**Blocked by:** 04 — 让协作在冲突与断线下安全收敛；05 —
添加图片和自包含导出

**Status:** ready-for-agent

- [ ] 只有非空选择或 Frame 才能发起“发送到主对话”；member/observer 不显示
      该操作且服务端拒绝伪造请求。
- [ ] 确认界面显示所选内容的 PNG 预览、`.excalidraw` 源文件、目标 Agent、
      expected board revision，并要求非空指令和显式提交。
- [ ] 在提交前通过既有 Agent Input Capability 规则显示目标 Agent 对 PNG 和
      源文件的支持或明确失败，不使用静默 fallback。
- [ ] adapter 从选择创建规范化 source 和 PNG，而不改变共享白板或当前
      revision。
- [ ] 一个服务端 promotion 操作原子校验角色、Live Room、board revision、
      选择元数据、附件、目标 Agent capability 和幂等键，然后创建普通 queued
      Main Input。
- [ ] 成功 promotion 为 PNG 和源文件添加 Main Input references，并只给目标
      Local Tool Agent 建立 Agent Attachment Grant；其他 Agent 不能读取。
- [ ] 网络重试不会产生重复 attachment、Main Input、grant 或房间通知；任何
      校验失败都不会留下部分 Main Input 或 Agent grant。
- [ ] promotion 复用既有 Main Input 顺序、队列、取消、回放和通知语义，且不
      直接调用或自动唤醒 Agent。
- [ ] 真实 server/Main Input 测试覆盖成功、权限、capability、陈旧 revision、
      原子失败和幂等重试；Workspace 测试覆盖选择、预览、确认和错误恢复。
- [ ] 真实浏览器冒烟测试证明一个 Frame 能从 Excalidraw 进入主对话并形成
      带 PNG 和源文件的单一 Main Input。

## Comments
