# 09 — 完成手机端、国际化和无障碍体验

**What to build:** 把已经完成的白板能力收口为适合桌面、平板、手机、键盘和
辅助技术用户的统一体验，同时保持 Excalidraw 的成熟交互。

**Blocked by:** 03 — 显示协作者和安静活动状态；05 —
添加图片和自包含导出；06 — 用临时快照恢复整个白板；07 —
把选择或 Frame 发送为 Main Input；08 — 提供空白引导和内置模板

**Status:** ready-for-agent

- [ ] 桌面和平板保留完整 Excalidraw 工具及 CACP collaboration chrome，房间
      头部和主要操作不会遮挡画布。
- [ ] 手机使用全屏画布，并直接提供选择、基本绘图、文本、pan 和 zoom；模板、
      导出、快照和 promotion 等高级操作进入带标签的紧凑底部菜单。
- [ ] CACP 自有触摸控件至少为 44×44 CSS pixels，pinch zoom、双指 pan 和
      合理的触摸滚动不会被外层 Workspace 阻断。
- [ ] owner/admin/member/observer 在手机菜单中只看到各自可用的操作；只读和
      断线状态不会留下可提交的编辑入口。
- [ ] 所有 CACP 自有白板标签、确认、错误和连接状态提供中文与英文文案；
      Excalidraw locale 跟随现有界面语言。
- [ ] 工作区切换、参与者头像、菜单和 dialogs 支持键盘顺序、可见 focus、
      Escape/关闭行为及关闭后的合理 focus restoration。
- [ ] 连接、同步、只读、未读和活动状态具有可访问文本或 live status，任何
      含义都不只依赖颜色、动画或 hover。
- [ ] 每个前置 ticket 的基础可访问行为保持通过；本 ticket 增加代表性桌面、
      平板和手机 viewport 的集成行为测试，而不是用 CSS snapshot 代替。
- [ ] 一个窄 touch viewport 的真实浏览器冒烟测试覆盖进入白板、基本绘图、
      presence、图片、模板、高级菜单、导出和返回主对话。
- [ ] 白板相关的完整格式、lint、类型检查、单元/集成测试和生产构建通过，既有
      主对话与 Orbit 回归测试保持绿色。

## Comments
