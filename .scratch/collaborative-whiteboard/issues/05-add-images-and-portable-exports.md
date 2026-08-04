# 05 — 添加图片和自包含导出

**What to build:** 让授权编辑者把图片安全地放入共享白板，并让参与者在房间
结束前后导出可携带的 PNG、SVG 和 `.excalidraw` 成果。

**Blocked by:** 02 — 共享第一笔 Excalidraw 场景

**Status:** ready-for-agent

- [ ] Room Attachment 引用模型能够表达白板引用，同时保持现有 Main Input 和
      Orbit Attachment 行为兼容。
- [ ] 粘贴、拖放和文件选择都经过同一受保护上传流程以及既有 MIME、大小和
      room ownership 校验。
- [ ] 场景只保存同一 Live Room 内有效的 Room Attachment identifier，不在
      场景、更新或快照中保存二进制或 base64 数据。
- [ ] 授权客户端能够把受保护的图片字节解析为 Excalidraw file；observer
      可以查看，但不能新增、替换或删除图片。
- [ ] 删除图片元素会移除对应白板引用；无其他内容引用时按 Room Attachment
      生命周期清理二进制。
- [ ] 当前场景和选区能够导出 PNG、SVG 和 `.excalidraw`；含图片的导出在格式
      支持范围内自包含，缺失或拒绝的图片产生可见错误而非静默空白。
- [ ] 房间结束或服务器关闭会清理白板附件引用和服务端临时字节；已经加载到
      浏览器的结束场景仍保持只读并可本地导出。
- [ ] 真实 server/attachment 测试覆盖跨房间拒绝、受保护下载、引用增减和
      清理；adapter 契约及浏览器冒烟测试覆盖图片插入和三种导出。

## Comments
