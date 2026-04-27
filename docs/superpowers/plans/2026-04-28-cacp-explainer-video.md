# CACP 协议宣介动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 HyperFrames 创建一段约 150 秒的 CACP 协议宣介动画，从痛点对比到协议标准定位，面向开源社区和模型厂商。

**Architecture:** 四幕叙事结构（痛点 → 协议架构 → 生态共建 → 愿景），全部用 HTML + CSS + GSAP 动画在 HyperFrames 中合成，渲染为 1920x1080 MP4。

**Tech Stack:** HyperFrames CLI, HTML5, CSS3, GSAP (Timeline + Tweens), SVG (`docs/cacp-concept.svg`)

---

## 文件结构

```
hyperframes-cacp-explainer/
├── index.html              # 主 composition，串联四幕场景
├── scenes/
│   ├── scene-1-problem.html      # 第一幕：单人交互困境
│   ├── scene-2-protocol.html     # 第二幕：CACP 协议架构
│   ├── scene-3-ecosystem.html    # 第三幕：开放协议与生态
│   └── scene-4-vision.html       # 第四幕：愿景与号召
├── assets/
│   └── cacp-concept.svg    # 从 docs/cacp-concept.svg 复制
├── styles/
│   └── common.css          # 共享样式（配色、字体、动画基类）
└── hyperframes.json        # HyperFrames 项目配置
```

---

## Task 1: 初始化 HyperFrames 项目

**Files:**
- Create: `hyperframes-cacp-explainer/` (project root)

- [ ] **Step 1: 初始化项目**

```bash
npx hyperframes init hyperframes-cacp-explainer --non-interactive
```

- [ ] **Step 2: 复制协议架构图素材**

```bash
cp docs/cacp-concept.svg hyperframes-cacp-explainer/assets/
```

- [ ] **Step 3: 创建目录结构**

```bash
cd hyperframes-cacp-explainer
mkdir -p scenes styles assets
```

- [ ] **Step 4: Commit**

```bash
git add hyperframes-cacp-explainer/
git commit -m "chore: init hyperframes project for cacp explainer video"
```

---

## Task 2: 创建共享样式

**Files:**
- Create: `hyperframes-cacp-explainer/styles/common.css`

- [ ] **Step 1: 编写共享样式**

```css
/* styles/common.css */
:root {
  --bg-dark: #1a1a2e;
  --bg-light: #faf8f5;
  --text-primary: #1c1813;
  --text-secondary: #6b6255;
  --text-muted: #9ca3af;
  --accent-blue: #2563eb;
  --accent-orange: #c76b2a;
  --accent-purple: #7c3aed;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg-dark);
  color: white;
  overflow: hidden;
  width: 1920px;
  height: 1080px;
}

.scene {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.text-reveal {
  opacity: 0;
}

.card {
  background: var(--bg-light);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

/* Utility classes for animations */
.fade-in { opacity: 0; }
.slide-up { opacity: 0; transform: translateY(30px); }
.scale-in { opacity: 0; transform: scale(0.9); }
```

- [ ] **Step 2: Commit**

```bash
git add styles/common.css
git commit -m "feat: add shared styles for explainer video"
```

---

## Task 3: 第一幕 — 单人交互困境（0:00-0:40）

**Files:**
- Create: `hyperframes-cacp-explainer/scenes/scene-1-problem.html`
- Modify: `hyperframes-cacp-explainer/index.html` (引入 scene-1)

- [ ] **Step 1: 创建第一幕 HTML**

```html
<!-- scenes/scene-1-problem.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../styles/common.css">
  <style>
    .scene-problem {
      background: var(--bg-dark);
    }
    .opening-text {
      font-size: 48px;
      font-weight: 600;
      text-align: center;
      opacity: 0;
    }
    .chat-screens {
      display: flex;
      gap: 40px;
      margin-top: 60px;
      opacity: 0;
    }
    .chat-screen {
      width: 360px;
      height: 480px;
      background: #252540;
      border-radius: 16px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .chat-header {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .chat-bubble {
      background: rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.5;
    }
    .pain-points {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      opacity: 0;
    }
    .pain-point {
      font-size: 56px;
      font-weight: 700;
      color: #ef4444;
      margin: 20px 0;
      opacity: 0;
    }
    .closing-statement {
      font-size: 42px;
      font-weight: 600;
      text-align: center;
      max-width: 900px;
      line-height: 1.4;
      opacity: 0;
    }
  </style>
</head>
<body>
  <div class="scene scene-problem" id="scene1">
    <!-- 1.1 开场 -->
    <div class="opening-text" id="s1-opening">
      当前，所有 AI 交互都是一对一
    </div>

    <!-- 1.2 三屏场景 -->
    <div class="chat-screens" id="s1-screens">
      <div class="chat-screen">
        <div class="chat-header">产品经理</div>
        <div class="chat-bubble">如何设计一个用户登录流程？</div>
        <div class="chat-bubble" style="background: rgba(37,99,235,0.2); margin-left: 20px;">
          建议采用手机号 + 验证码方案...
        </div>
      </div>
      <div class="chat-screen">
        <div class="chat-header">设计师</div>
        <div class="chat-bubble">登录页用什么配色最好？</div>
        <div class="chat-bubble" style="background: rgba(37,99,235,0.2); margin-left: 20px;">
          推荐使用蓝色系，体现信任感...
        </div>
      </div>
      <div class="chat-screen">
        <div class="chat-header">开发者</div>
        <div class="chat-bubble">OAuth 2.0 怎么实现最安全？</div>
        <div class="chat-bubble" style="background: rgba(37,99,235,0.2); margin-left: 20px;">
          建议使用 PKCE 扩展...
        </div>
      </div>
    </div>

    <!-- 1.3 痛点 -->
    <div class="pain-points" id="s1-pain">
      <div class="pain-point" id="p1">信息孤岛</div>
      <div class="pain-point" id="p2">上下文断裂</div>
      <div class="pain-point" id="p3">结论碎片化</div>
    </div>

    <!-- 1.3 收尾 -->
    <div class="closing-statement" id="s1-closing">
      AI 时代的人机交互<br>还停留在单人聊天模式
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });

    // 1.1 开场文字淡入
    tl.to("#s1-opening", { opacity: 1, duration: 1.5, delay: 0.5 })
      .to("#s1-opening", { opacity: 0, duration: 1, delay: 1 })

    // 1.2 三屏展示
      .to("#s1-screens", { opacity: 1, duration: 1 })
      .from(".chat-screen", { y: 50, opacity: 0, duration: 0.8, stagger: 0.3 }, "-=0.5")
      .to("#s1-screens", { opacity: 0.3, duration: 1, delay: 2 })

    // 1.3 痛点浮现
      .to("#s1-pain", { opacity: 1, duration: 0.5 })
      .to("#p1", { opacity: 1, scale: 1.1, duration: 0.6 })
      .to("#p1", { scale: 1, duration: 0.3 })
      .to("#p2", { opacity: 1, scale: 1.1, duration: 0.6 })
      .to("#p2", { scale: 1, duration: 0.3 })
      .to("#p3", { opacity: 1, scale: 1.1, duration: 0.6 })
      .to("#p3", { scale: 1, duration: 0.3 })
      .to("#s1-pain", { opacity: 0, duration: 0.8, delay: 0.5 })

    // 1.3 收尾
      .to("#s1-screens", { opacity: 0, duration: 0.5 }, "-=0.5")
      .to("#s1-closing", { opacity: 1, duration: 1 })
      .to("#s1-closing", { opacity: 0, duration: 1, delay: 2 });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scenes/scene-1-problem.html
git commit -m "feat: add scene 1 - problem statement"
```

---

## Task 4: 第二幕 — CACP 协议架构（0:40-1:55）

**Files:**
- Create: `hyperframes-cacp-explainer/scenes/scene-2-protocol.html`

- [ ] **Step 1: 创建第二幕 HTML**

```html
<!-- scenes/scene-2-protocol.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../styles/common.css">
  <style>
    .scene-protocol {
      background: var(--bg-dark);
    }
    .transition-text {
      font-size: 42px;
      font-weight: 600;
      text-align: center;
      max-width: 1000px;
      line-height: 1.5;
      opacity: 0;
    }
    .protocol-logo {
      font-size: 72px;
      font-weight: 700;
      color: var(--accent-blue);
      opacity: 0;
      margin-bottom: 20px;
    }
    .architecture-container {
      width: 900px;
      height: 540px;
      position: relative;
      opacity: 0;
    }
    .arch-layer {
      position: absolute;
      width: 100%;
      border-radius: 16px;
      padding: 24px;
      opacity: 0;
      transform: translateY(20px);
    }
    .layer-participants {
      top: 0;
      height: 120px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .layer-coordination {
      top: 140px;
      height: 240px;
      background: rgba(37,99,235,0.1);
      border: 2px solid var(--accent-blue);
    }
    .layer-ai {
      top: 400px;
      height: 120px;
      background: rgba(199,107,42,0.1);
      border: 2px solid var(--accent-orange);
    }
    .layer-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 12px;
      letter-spacing: 1px;
    }
    .layer-items {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .layer-item {
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 14px;
    }
    .event-flow {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 40px;
      opacity: 0;
    }
    .event-node {
      background: rgba(124,58,237,0.2);
      border: 1px solid var(--accent-purple);
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 13px;
      font-family: monospace;
      opacity: 0;
    }
    .event-arrow {
      color: var(--text-muted);
      font-size: 20px;
      opacity: 0;
    }
    .comparison-container {
      display: flex;
      gap: 80px;
      margin-top: 40px;
      opacity: 0;
    }
    .comparison-side {
      text-align: center;
      opacity: 0;
    }
    .comparison-side h3 {
      font-size: 20px;
      margin-bottom: 20px;
      color: var(--text-muted);
    }
    .comparison-side.cacp h3 {
      color: var(--accent-blue);
    }
    .comparison-diagram {
      width: 360px;
      height: 280px;
      background: rgba(255,255,255,0.04);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .demo-ui {
      width: 800px;
      height: 500px;
      background: var(--bg-light);
      border-radius: 16px;
      overflow: hidden;
      opacity: 0;
      display: flex;
    }
    .demo-sidebar {
      width: 200px;
      background: #f0ebe3;
      padding: 16px;
    }
    .demo-chat {
      flex: 1;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .demo-message {
      max-width: 70%;
      padding: 12px 16px;
      border-radius: 12px;
      margin-bottom: 12px;
      font-size: 14px;
      color: var(--text-primary);
      opacity: 0;
    }
    .demo-message.user {
      background: #e8e0d5;
      align-self: flex-start;
    }
    .demo-message.agent {
      background: rgba(199,107,42,0.15);
      align-self: flex-end;
    }
    .demo-message.queued {
      background: rgba(124,58,237,0.1);
      border: 1px dashed var(--accent-purple);
    }
    .queued-badge {
      font-size: 11px;
      color: var(--accent-purple);
      margin-top: 4px;
    }
    .demo-controls {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      opacity: 0;
    }
    .demo-btn {
      padding: 8px 20px;
      border-radius: 8px;
      border: none;
      font-size: 13px;
      cursor: pointer;
      opacity: 0;
    }
    .btn-primary {
      background: var(--accent-orange);
      color: white;
    }
    .btn-secondary {
      background: #e8e0d5;
      color: var(--text-primary);
    }
  </style>
</head>
<body>
  <div class="scene scene-protocol" id="scene2">
    <!-- 2.1 转折 -->
    <div class="transition-text" id="s2-transition">
      如果 AI 能像加入 Slack 频道一样<br>加入人类的协作空间呢？
    </div>

    <!-- 2.2 协议定位 -->
    <div class="protocol-logo" id="s2-logo">CACP</div>
    <div class="architecture-container" id="s2-arch">
      <div class="arch-layer layer-participants" id="layer-p">
        <div class="layer-title">参与者层</div>
        <div class="layer-items">
          <div class="layer-item">房主（控制 AI 流转）</div>
          <div class="layer-item">成员（发送消息）</div>
          <div class="layer-item">观察者（只读）</div>
        </div>
      </div>
      <div class="arch-layer layer-coordination" id="layer-c">
        <div class="layer-title">共享协调层</div>
        <div class="layer-items">
          <div class="layer-item">事件日志（Append-Only）</div>
          <div class="layer-item">消息收集（Batching）</div>
          <div class="layer-item">角色权限体系</div>
        </div>
      </div>
      <div class="arch-layer layer-ai" id="layer-a">
        <div class="layer-title">AI 执行层</div>
        <div class="layer-items">
          <div class="layer-item">共享本地 Agent</div>
          <div class="layer-item">Claude Code / Codex / opencode</div>
        </div>
      </div>
    </div>

    <!-- 2.3 事件驱动 -->
    <div class="event-flow" id="s2-events">
      <div class="event-node">message.created</div>
      <div class="event-arrow">→</div>
      <div class="event-node">ai.collection.submitted</div>
      <div class="event-arrow">→</div>
      <div class="event-node">agent.turn.requested</div>
      <div class="event-arrow">→</div>
      <div class="event-node">agent.turn.completed</div>
    </div>

    <!-- 2.4 范式对比 -->
    <div class="comparison-container" id="s2-compare">
      <div class="comparison-side">
        <h3>传统模式</h3>
        <div class="comparison-diagram" id="compare-traditional">
          <!-- 简化为文字+箭头 -->
          <div style="font-size: 18px; color: var(--text-muted);">
            人 → AI<br><br>
            <span style="font-size: 14px;">单向 · 孤立 · 碎片化</span>
          </div>
        </div>
      </div>
      <div class="comparison-side cacp">
        <h3>CACP 模式</h3>
        <div class="comparison-diagram" id="compare-cacp">
          <div style="font-size: 18px; color: var(--accent-blue);">
            多人 ↔ AI ↔ 多人<br><br>
            <span style="font-size: 14px;">网状 · 共享 · 协作</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 2.5 AI Flow Control 演示 -->
    <div class="demo-ui" id="s2-demo">
      <div class="demo-sidebar">
        <div style="font-weight: 600; margin-bottom: 16px; color: var(--text-primary);">房间成员</div>
        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">👤 房主（你）</div>
        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">👤 设计师小红</div>
        <div style="font-size: 14px; color: var(--text-secondary);">👤 开发者小刚</div>
      </div>
      <div class="demo-chat">
        <div class="demo-controls" id="demo-ctrls">
          <button class="demo-btn btn-primary" id="btn-start">Start collecting answers</button>
          <button class="demo-btn btn-secondary" id="btn-submit" style="display:none;">Submit collected answers</button>
        </div>
        <div class="demo-message user" id="dm1">设计师小红：登录页建议用 OAuth + 微信扫码</div>
        <div class="demo-message user queued" id="dm2">
          开发者小刚：还需要考虑手机号验证码兜底
          <div class="queued-badge">Queued for AI</div>
        </div>
        <div class="demo-message agent" id="dm3">Agent：基于两位的建议，推荐采用 OAuth 2.0 + 微信扫码为主，手机号兜底...</div>
      </div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    const tl2 = gsap.timeline({ defaults: { ease: "power2.inOut" } });

    // 2.1 转折
    tl2.to("#s2-transition", { opacity: 1, duration: 1.5, delay: 0.5 })
       .to("#s2-transition", { opacity: 0, duration: 1, delay: 1.5 })

    // 2.2 协议架构
       .to("#s2-logo", { opacity: 1, duration: 0.8 })
       .to("#s2-arch", { opacity: 1, duration: 0.5 })
       .to("#layer-p", { opacity: 1, y: 0, duration: 0.6 })
       .to("#layer-c", { opacity: 1, y: 0, duration: 0.6 }, "-=0.3")
       .to("#layer-a", { opacity: 1, y: 0, duration: 0.6 }, "-=0.3")
       .to("#s2-logo", { opacity: 0, duration: 0.5, delay: 1 })
       .to("#s2-arch", { opacity: 0, duration: 0.5 }, "-=0.3")

    // 2.3 事件流
       .to("#s2-events", { opacity: 1, duration: 0.5 })
       .to(".event-node", { opacity: 1, duration: 0.4, stagger: 0.3 })
       .to(".event-arrow", { opacity: 1, duration: 0.3, stagger: 0.3 }, "-=0.9")
       .to("#s2-events", { opacity: 0, duration: 0.5, delay: 1 })

    // 2.4 范式对比
       .to("#s2-compare", { opacity: 1, duration: 0.5 })
       .to("#compare-traditional", { opacity: 1, duration: 0.6 })
       .to("#compare-cacp", { opacity: 1, duration: 0.6 })
       .to("#s2-compare", { opacity: 0, duration: 0.5, delay: 1.5 })

    // 2.5 AI Flow Control 演示
       .to("#s2-demo", { opacity: 1, duration: 0.5 })
       .to("#demo-ctrls", { opacity: 1, duration: 0.3 })
       .to("#btn-start", { opacity: 1, duration: 0.3 })
       .to("#dm1", { opacity: 1, duration: 0.4 })
       .to("#dm2", { opacity: 1, duration: 0.4 })
       .to("#btn-start", { opacity: 0, duration: 0.2 })
       .to("#btn-submit", { display: "block", opacity: 1, duration: 0.3 })
       .to("#btn-submit", { opacity: 0, duration: 0.2, delay: 0.5 })
       .to("#dm3", { opacity: 1, duration: 0.5 })
       .to("#s2-demo", { opacity: 0, duration: 1, delay: 1.5 });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scenes/scene-2-protocol.html
git commit -m "feat: add scene 2 - cacp protocol architecture"
```

---

## Task 5: 第三幕 — 开放协议与生态共建（1:55-2:35）

**Files:**
- Create: `hyperframes-cacp-explainer/scenes/scene-3-ecosystem.html`

- [ ] **Step 1: 创建第三幕 HTML**

```html
<!-- scenes/scene-3-ecosystem.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../styles/common.css">
  <style>
    .scene-ecosystem {
      background: var(--bg-dark);
    }
    .arch-repeat {
      width: 700px;
      height: 400px;
      opacity: 0;
    }
    .protocol-labels {
      display: flex;
      gap: 40px;
      margin-top: 30px;
      opacity: 0;
    }
    .protocol-label {
      background: rgba(37,99,235,0.15);
      border: 1px solid var(--accent-blue);
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 14px;
    }
    .agent-panel {
      display: flex;
      gap: 32px;
      margin-top: 40px;
      opacity: 0;
    }
    .agent-card {
      width: 180px;
      height: 220px;
      background: rgba(255,255,255,0.06);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      opacity: 0;
      transform: translateY(20px);
    }
    .agent-card.verified {
      border: 2px solid #22c55e;
    }
    .agent-card.experimental {
      border: 2px solid #f59e0b;
    }
    .agent-icon {
      font-size: 48px;
    }
    .agent-name {
      font-size: 16px;
      font-weight: 600;
    }
    .agent-status {
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 20px;
    }
    .agent-status.verified {
      background: rgba(34,197,94,0.2);
      color: #22c55e;
    }
    .agent-status.experimental {
      background: rgba(245,158,11,0.2);
      color: #f59e0b;
    }
    .callout-text {
      font-size: 28px;
      font-weight: 600;
      text-align: center;
      margin-top: 40px;
      opacity: 0;
    }
    .community-cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      margin-top: 30px;
      opacity: 0;
    }
    .cta-line {
      font-size: 22px;
      color: var(--accent-blue);
    }
  </style>
</head>
<body>
  <div class="scene scene-ecosystem" id="scene3">
    <!-- 3.1 协议架构强调 -->
    <div class="arch-repeat" id="s3-arch">
      <!-- 简化的三层架构展示 -->
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
          <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px;">参与者层</div>
          <div style="font-size: 16px;">房主 · 成员 · 观察者</div>
        </div>
        <div style="background: rgba(37,99,235,0.1); border: 2px solid var(--accent-blue); border-radius: 12px; padding: 24px; text-align: center;">
          <div style="font-size: 14px; color: var(--accent-blue); margin-bottom: 8px;">共享协调层</div>
          <div style="font-size: 16px;">事件日志 · 消息收集 · 角色权限</div>
        </div>
        <div style="background: rgba(199,107,42,0.1); border: 2px solid var(--accent-orange); border-radius: 12px; padding: 20px; text-align: center;">
          <div style="font-size: 14px; color: var(--accent-orange); margin-bottom: 8px;">AI 执行层</div>
          <div style="font-size: 16px;">共享本地 Agent</div>
        </div>
      </div>
    </div>

    <div class="protocol-labels" id="s3-labels">
      <div class="protocol-label">传输层（WebSocket）</div>
      <div class="protocol-label">消息层（Event Schema）</div>
      <div class="protocol-label">应用层（Room UI / Agent Adapter）</div>
    </div>

    <!-- 3.2 Agent 状态 -->
    <div class="agent-panel" id="s3-agents">
      <div class="agent-card verified" id="agent1">
        <div class="agent-icon">🤖</div>
        <div class="agent-name">Claude Code</div>
        <div class="agent-status verified">完整验证</div>
      </div>
      <div class="agent-card experimental" id="agent2">
        <div class="agent-icon">💻</div>
        <div class="agent-name">Codex</div>
        <div class="agent-status experimental">待完善</div>
      </div>
      <div class="agent-card experimental" id="agent3">
        <div class="agent-icon">🔧</div>
        <div class="agent-name">opencode</div>
        <div class="agent-status experimental">待完善</div>
      </div>
      <div class="agent-card verified" id="agent4">
        <div class="agent-icon">📡</div>
        <div class="agent-name">Echo</div>
        <div class="agent-status verified">测试 Agent</div>
      </div>
    </div>

    <div class="callout-text" id="s3-callout">
      CACP 协议已就绪，Agent 生态等待社区共建
    </div>

    <!-- 3.3 社区号召 -->
    <div class="community-cta" id="s3-cta">
      <div class="cta-line">欢迎贡献你的 Agent 适配器</div>
      <div class="cta-line">欢迎接入你的 AI 能力</div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    const tl3 = gsap.timeline({ defaults: { ease: "power2.inOut" } });

    // 3.1 协议架构
    tl3.to("#s3-arch", { opacity: 1, duration: 0.8, delay: 0.5 })
       .to("#s3-labels", { opacity: 1, duration: 0.5 })
       .to("#s3-arch", { opacity: 0, duration: 0.5, delay: 1.5 })
       .to("#s3-labels", { opacity: 0, duration: 0.3 }, "-=0.3")

    // 3.2 Agent 状态
       .to("#s3-agents", { opacity: 1, duration: 0.5 })
       .to("#agent1", { opacity: 1, y: 0, duration: 0.5 })
       .to("#agent2", { opacity: 1, y: 0, duration: 0.5 }, "-=0.3")
       .to("#agent3", { opacity: 1, y: 0, duration: 0.5 }, "-=0.3")
       .to("#agent4", { opacity: 1, y: 0, duration: 0.5 }, "-=0.3")
       .to("#s3-callout", { opacity: 1, duration: 0.8, delay: 0.5 })
       .to("#s3-agents", { opacity: 0, duration: 0.5, delay: 1 })
       .to("#s3-callout", { opacity: 0, duration: 0.3 }, "-=0.3")

    // 3.3 社区号召
       .to("#s3-cta", { opacity: 1, duration: 0.8 })
       .to("#s3-cta", { opacity: 0, duration: 1, delay: 2 });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scenes/scene-3-ecosystem.html
git commit -m "feat: add scene 3 - open protocol and ecosystem"
```

---

## Task 6: 第四幕 — 愿景与号召（2:35-2:55）

**Files:**
- Create: `hyperframes-cacp-explainer/scenes/scene-4-vision.html`

- [ ] **Step 1: 创建第四幕 HTML**

```html
<!-- scenes/scene-4-vision.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="../styles/common.css">
  <style>
    .scene-vision {
      background: var(--bg-dark);
    }
    .vision-line {
      font-size: 52px;
      font-weight: 700;
      text-align: center;
      line-height: 1.4;
      opacity: 0;
    }
    .vision-line.accent {
      color: var(--accent-blue);
    }
    .final-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      opacity: 0;
    }
    .brand-logo {
      font-size: 80px;
      font-weight: 800;
      color: var(--accent-blue);
      letter-spacing: 4px;
    }
    .brand-tagline {
      font-size: 28px;
      color: var(--text-muted);
    }
    .brand-footer {
      font-size: 18px;
      color: var(--text-secondary);
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="scene scene-vision" id="scene4">
    <!-- 4.1 愿景 -->
    <div class="vision-line" id="v1">AI 不应该只服务一个人</div>
    <div class="vision-line accent" id="v2">它应该成为团队协作的一部分</div>

    <!-- 4.2 收尾 -->
    <div class="final-brand" id="v-brand">
      <div class="brand-logo">CACP</div>
      <div class="brand-tagline">多人协作的 AI 通信协议</div>
      <div class="brand-footer">
        协议已开源 · 生态共建中 · 欢迎贡献 Agent 适配
      </div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script>
    const tl4 = gsap.timeline({ defaults: { ease: "power2.inOut" } });

    // 4.1 愿景文字
    tl4.to("#v1", { opacity: 1, duration: 1.5, delay: 0.5 })
       .to("#v1", { opacity: 0.3, duration: 0.5, delay: 1 })
       .to("#v2", { opacity: 1, duration: 1.5 })
       .to("#v1", { opacity: 0, duration: 0.3 })
       .to("#v2", { opacity: 0, duration: 0.3, delay: 0.5 })

    // 4.2 品牌收尾
       .to("#v-brand", { opacity: 1, duration: 1 })
       .to("#v-brand", { opacity: 0, duration: 2, delay: 3 });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add scenes/scene-4-vision.html
git commit -m "feat: add scene 4 - vision and call to action"
```

---

## Task 7: 创建主 composition 串联四幕

**Files:**
- Create: `hyperframes-cacp-explainer/index.html`

- [ ] **Step 1: 编写主 composition**

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CACP Protocol Explainer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: #1a1a2e;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .scene-container {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .scene-frame {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      border: none;
      opacity: 0;
      pointer-events: none;
    }
    .scene-frame.active {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="scene-container">
    <iframe class="scene-frame" id="frame-1" src="scenes/scene-1-problem.html"></iframe>
    <iframe class="scene-frame" id="frame-2" src="scenes/scene-2-protocol.html"></iframe>
    <iframe class="scene-frame" id="frame-3" src="scenes/scene-3-ecosystem.html"></iframe>
    <iframe class="scene-frame" id="frame-4" src="scenes/scene-4-vision.html"></iframe>
  </div>

  <script>
    // 四幕切换控制器
    // 每幕的持续时间（毫秒）
    const sceneDurations = [40000, 75000, 40000, 15000]; // 总计 170s，留一些过渡余量
    let currentScene = 0;
    let startTime = null;

    function showScene(index) {
      document.querySelectorAll('.scene-frame').forEach((frame, i) => {
        frame.classList.toggle('active', i === index);
      });
    }

    function nextScene() {
      currentScene++;
      if (currentScene >= 4) {
        currentScene = 0; // 循环播放
      }
      showScene(currentScene);
      setTimeout(nextScene, sceneDurations[currentScene]);
    }

    // 初始化
    showScene(0);
    setTimeout(nextScene, sceneDurations[0]);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: wire up all 4 scenes in main composition"
```

---

## Task 8: 配置 HyperFrames 项目

**Files:**
- Create: `hyperframes-cacp-explainer/hyperframes.json`

- [ ] **Step 1: 创建项目配置**

```json
{
  "name": "cacp-protocol-explainer",
  "version": "1.0.0",
  "format": "mp4",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 170,
  "composition": "index.html"
}
```

- [ ] **Step 2: Lint 验证**

```bash
cd hyperframes-cacp-explainer
npx hyperframes lint
```

Expected: 无致命错误（可能有警告关于外部 CDN，可忽略）

- [ ] **Step 3: Commit**

```bash
git add hyperframes.json
git commit -m "chore: add hyperframes project config"
```

---

## Task 9: 预览与渲染

**Files:**
- None (验证步骤)

- [ ] **Step 1: 启动预览**

```bash
cd hyperframes-cacp-explainer
npx hyperframes preview
```

在浏览器中打开预览地址，检查：
- [ ] 第一幕文字、三屏、痛点依次出现
- [ ] 第二幕架构图三层正确展示
- [ ] 第三幕 Agent 卡片状态正确
- [ ] 第四幕愿景文字和品牌收尾完整

- [ ] **Step 2: 渲染视频**

```bash
npx hyperframes render -o cacp-explainer.mp4 --format mp4
```

Expected: 渲染成功，输出 `cacp-explainer.mp4`，约 170 秒，1920x1080

- [ ] **Step 3: 验证输出**

```bash
ls -lh cacp-explainer.mp4
```

Expected: 文件存在，大小合理（通常 10-50MB 取决于压缩）

- [ ] **Step 4: Commit**

```bash
git add cacp-explainer.mp4
git commit -m "feat: render cacp explainer video"
```

---

## Spec Coverage Check

| 设计文档要求 | 对应任务 |
|------------|---------|
| 第一幕：痛点困境（0:00-0:40） | Task 3 |
| 第二幕：协议架构（0:40-1:55） | Task 4 |
| 第三幕：生态共建（1:55-2:35） | Task 5 |
| 第四幕：愿景号召（2:35-2:55） | Task 6 |
| 协议分层架构图展示 | Task 4 (scene-2-protocol.html) |
| 事件流动画 | Task 4 |
| AI Flow Control UI 演示 | Task 4 |
| Agent 适配状态（Claude Code ✅ 等） | Task 5 |
| 社区号召文案 | Task 5, Task 6 |
| 视觉风格（深蓝背景、科技风） | Task 2 (common.css) |
| 总时长 ~150-160 秒 | Task 7 (sceneDurations 配置) |

## Placeholder Scan

- 无 TBD / TODO
- 无 "implement later"
- 所有 HTML/CSS/JS 代码完整
- 所有命令包含预期输出

## Type Consistency

- 所有 GSAP 动画使用一致的 `power2.inOut` ease
- 所有场景共享 `common.css` 中的 CSS 变量
- 时间单位统一为毫秒（JavaScript）和秒（文档描述）
