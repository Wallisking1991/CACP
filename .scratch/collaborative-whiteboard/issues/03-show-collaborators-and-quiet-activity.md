# 03 — 显示协作者和安静活动状态

**What to build:** 让参与者看见谁正在白板的什么位置工作，并在主对话和白板
之间获得低打扰的未读活动提示。

**Blocked by:** 02 — 共享第一笔 Excalidraw 场景

**Status:** ready-for-agent

- [ ] 白板会话能够节流传输光标、选区、viewport、显示名称和稳定的参与者
      颜色，而不改变场景 revision。
- [ ] 白板显示活跃参与者及其实时光标、姓名和选区；选择参与者头像会把当前
      viewport 定位到对方正在查看的区域。
- [ ] presence 在连接关闭或 heartbeat 超时后及时消失，后来者和重连者不会
      收到历史光标、选区或 viewport。
- [ ] 主对话中的白板入口显示活跃编辑人数和安静的未查看活动点；进入白板会
      清除当前参与者的活动点。
- [ ] 白板中的房间头部显示主对话未读活动，返回主对话后按既有阅读语义清除
      提示。
- [ ] routine scene/presence 更新不创建主对话消息、房间通知或声音。
- [ ] presence 和活动数据不会进入 durable event replay，也不会发送到 Local
      Tool Agent room stream。
- [ ] 真实 WebSocket 测试覆盖 presence 广播与过期；Workspace 测试覆盖头像
      定位、计数、活动点和两个方向的未读清除规则。

## Comments
