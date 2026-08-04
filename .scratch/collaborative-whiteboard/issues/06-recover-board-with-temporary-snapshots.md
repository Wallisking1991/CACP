# 06 — 用临时快照恢复整个白板

**What to build:** 让 owner/admin 能在 Live Room 生命周期内查看临时检查点、
安全清空白板或把整个白板恢复成旧状态，同时让所有协作者重新收敛。

**Blocked by:** 04 — 让协作在冲突与断线下安全收敛

**Status:** ready-for-agent

- [ ] 服务端按有意义 revision 的节流 cadence 建立压缩的全场景快照环，并按
      配置的数量和总字节预算同时限制它。
- [ ] owner/admin 能看到足以识别 revision 和时间的临时快照并发起清空或
      恢复；member/observer 不显示高影响操作且服务端拒绝其请求。
- [ ] 清空和恢复都展示目标 revision、当前 revision 和影响范围，并要求显式
      确认。
- [ ] 服务端在每次清空或恢复前先建立 pre-operation snapshot，并使用确认时的
      expected revision 拒绝已经过时的操作。
- [ ] 清空创建新的空场景 head revision；恢复把快照内容复制为新的 head
      revision，revision 永不倒退。
- [ ] 成功操作向所有白板客户端广播一个完整权威场景，清除不再兼容的本地
      undo 历史，并允许客户端从同一 revision 继续编辑。
- [ ] 清空或恢复产生一条低频房间通知，自动检查点不产生对话消息或声音。
- [ ] 房间结束和服务器重启会删除全部快照、预算状态及 pre-operation
      snapshot。
- [ ] 真实房间接口测试覆盖快照边界、陈旧确认、角色拒绝、清空、恢复、
      revision 单调性、广播和生命周期清理。

## Comments
