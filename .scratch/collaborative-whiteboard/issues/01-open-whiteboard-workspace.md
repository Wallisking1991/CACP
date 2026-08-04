# 01 — 建立白板工作区与编辑器边界

**What to build:** 让人类参与者能够在主对话与一个真实、完整但暂未联网的
Excalidraw 白板之间切换，同时建立后续协作功能共同使用的
`WhiteboardEditorAdapter` 边界。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 房间头部提供具有明确选中状态和可访问名称的 `主对话 | 白板`
      切换控件，切换只影响当前参与者。
- [ ] 进入白板时保留房间头部，以白板替换状态、消息、队列和 composer
      区域，并只在本地隐藏 Orbit。
- [ ] 返回主对话后恢复原有 Orbit 状态、composer 草稿、消息滚动位置、队列
      上下文和合理的键盘焦点。
- [ ] Excalidraw 仅在首次进入白板时延迟加载，默认呈现空白无限画布，并保留
      标准绘图工具、菜单、上下文菜单、快捷键和本地导出入口。
- [ ] 嵌入编辑器不显示公共分享、供应商云存储或外部协作入口。
- [ ] Workspace 只通过 `WhiteboardEditorAdapter` 使用编辑器能力；生产
      Excalidraw adapter 与内存 fake 实现相同契约。
- [ ] 使用内存 fake 的用户行为测试覆盖切换、状态保留、Orbit 恢复、焦点和
      延迟加载，不依赖 Excalidraw 的内部 DOM 结构。
- [ ] 使用真实 adapter 的契约测试证明场景读取、场景应用、只读切换、清理和
      导出入口能够通过公开 Excalidraw API 工作。

## Comments
