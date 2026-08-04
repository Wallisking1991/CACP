# 08 — 提供空白引导和内置模板

**What to build:** 让第一次进入白板的参与者理解核心操作，并让编辑者可以从
少量内置布局开始构思，而不引入外部库或共享噪声。

**Blocked by:** 02 — 共享第一笔 Excalidraw 场景

**Status:** ready-for-agent

- [ ] 新白板仍以空白无限画布开始，不自动写入任何模板元素或共享 onboarding
      内容。
- [ ] 首次进入显示简短、可关闭、participant-local 的引导；关闭或第一次有
      意义的编辑后消失，其他参与者看不到这一状态。
- [ ] CACP 提供一个小型、版本化、可信的内置模板列表，不请求外部 marketplace
      或公共 Excalidraw library。
- [ ] owner/admin/member 插入模板时，它作为一次普通授权场景编辑广播给其他
      参与者，并可通过插入者的本地 undo 撤销。
- [ ] observer 可以查看已经插入的模板内容，但不能插入模板；Agent 不获得
      模板或白板入口。
- [ ] 模板场景片段经过与普通场景更新相同的元素、大小、attachment 和共享
      scene-setting 校验。
- [ ] Workspace 测试覆盖引导的本地性和消失规则、模板权限与插入；真实双
      客户端测试证明模板通过普通协作协议同步。

## Comments
