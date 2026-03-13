# AI 控制台 Web 实时预览竞品深度研究

## 研究目标与方法

本研究面向 `opencode-studio` 的“右侧边栏实时预览”能力设计，聚焦以下问题：

- 不同产品如何做运行时隔离（本地容器/WebContainer/远程 VM）。
- 文件变更如何低延迟同步到预览运行时，并触发 HMR/增量构建。
- 端口发现、转发与代理链路如何保证可用性与安全性。
- iframe 沙箱、安全策略、崩溃恢复、资源限流如何落地。
- 预览面板 UI 在设备切换、刷新、错误态、空态上的可用性差异。

研究对象覆盖：Cursor、Replit Agent、StackBlitz/Bolt.new、Vercel v0、GitHub Copilot Workspace/Codespaces、Claude Artifacts。

## 横向对比总表

| 产品 | 运行时隔离模型 | 文件同步机制 | HMR/增量构建 | 端口发现与代理 | 预览沙箱/安全 | 恢复与限流 | 预览交互成熟度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cursor（Cloud Agents + 本地 IDE） | 本地开发机 + 云端独立 VM（按任务分支） | Git 分支/PR 回写 + IDE 本地 FS 变更 | 依赖项目原生 dev server（Vite/Next） | 通常由本地 `localhost` 或云 Agent 环境暴露链接 | 企业安全策略 + 云 agent 权限边界 | 云 agent 可并行、可重试；成本按模型计费 | 高（IDE + 多终端协同），但“统一预览面板”产品化较弱 |
| Replit Agent | 托管远程容器/工作区 | Agent 改动直接作用于工作区 FS；带 Checkpoint 回滚 | 平台托管构建与运行，支持实时测试流程 | 平台内置应用访问与分享 URL | 工作区隔离 + 平台鉴权分享 | Checkpoint + Rollback；按工作量计费与预算控制 | 高（工作区原生预览、进度与回滚联动） |
| StackBlitz / Bolt.new | 浏览器内 WebContainer（Node 运行时在浏览器）+ Bolt 云能力 | 内存 FS 挂载/更新（`mount`），即时反映 | 前端框架 HMR 极快；本地 CPU 驱动 | 浏览器内服务发现 + 预览 frame；跨浏览器策略差异 | 强依赖 COOP/COEP、SAB、iframe 约束 | 受浏览器内存限制；重启容器成本低 | 很高（“所见即所得” + 快速冷启动） |
| Vercel v0 | v0 生成 + 云端托管构建/部署 + 在线编辑器 | 对话生成与代码编辑共存；可同步 GitHub 仓库 | 编辑后可即时预览，部署走 Vercel 流水线 | 预览/生产 URL 分离，天然代理与 HTTPS | Vercel 托管隔离 + 项目级权限 | `Fix with v0`、版本回退、按项目部署治理 | 很高（设计模式、Diff、Split、版本化） |
| GitHub Copilot Workspace / Codespaces | Workspace 基于 Codespaces（远程 VM + devcontainer） | 仓库浅克隆到 `/workspaces`，容器内持久目录 | 依赖容器内原生 dev server 与工具链 | 自动识别 `localhost:PORT`，可手动 forward/标注/可见性控制 | 端口默认私有，支持 org/public 策略与 token 访问 | codespace 超时/恢复、重建容器、可配置机器规格 | 高（端口面板、分享策略成熟，AI 预览联动中等） |
| Claude Artifacts（同类：可运行 artifact） | 会话侧 artifact 运行容器（平台托管） | 对话驱动 artifact 版本更新 | 以 artifact 重新渲染/修复为主，非传统 HMR | 非通用端口模型，强调可分享 artifact 链接 | artifact 权限边界 + MCP 授权弹窗 | 版本切换、“Try fixing with Claude”、计划级能力差异 | 中高（原型与交互演示强，工程化调试弱） |

## 关键维度深度分析

### 1) 运行时隔离

- **本地优先（Cursor 本地）**：开发体验最佳，文件改动零拷贝；但本地环境漂移、端口冲突、依赖污染风险高。
- **远程容器/VM（Replit/Codespaces/Cursor Cloud）**：环境一致性强，便于团队复现；代价是网络抖动和远端资源成本。
- **浏览器内隔离（WebContainer）**：冷启动快、无需后端算力、低运维；受浏览器能力与内存天花板约束。
- **托管 artifact（Claude）**：上手快、分享强，适合演示；对复杂工程和多进程编排能力不足。

结论：`opencode-studio` 应采用**混合双运行时**（本地进程优先 + 远程/容器后备），并兼容“浏览器内轻量运行”用于快速预览。

### 2) 文件同步

- **IDE 本地 FS 直连**（Cursor）：路径最短，延迟最低。
- **仓库/分支回写**（Cloud Agent、Workspace）：可审计、可协作，但不是“每次敲字即预览”。
- **内存 FS 挂载**（WebContainer）：适合高频、细粒度更新，尤其前端项目。
- **会话版本化**（Artifacts）：强调版本演进与可回退，弱于工程目录精确同步。

结论：需要把“编辑态快同步”和“任务态可审计”拆层：
1) 编辑态走 `fs delta` 流；
2) 里程碑走 checkpoint/snapshot。

### 3) HMR 与增量构建

- 主流产品都复用框架原生 HMR（Vite/Next/Turbo），平台不重复造构建器。
- 体验差异在于：谁先检测到“可访问端口”，谁先把错误态从终端翻译成 UI 状态。

结论：`opencode-studio` 要把“构建日志语义化”作为核心能力：把 `compiling`、`hmr-ready`、`build-failed` 映射到预览状态机。

### 4) 端口发现与代理

- Codespaces 的做法最完整：自动发现 + 手动添加 + 标签 + 可见性策略（private/org/public）。
- WebContainer 在 frame 内预览时受浏览器策略影响，Firefox/Safari 在某些场景要新窗口兜底。

结论：`opencode-studio` 建议实现**Port Registry**（端口注册中心）：
- 自动发现 stdout 中 `localhost`/`127.0.0.1`；
- 主动探测常见端口（3000/4173/5173/8080）；
- 统一经 `studio proxy` 暴露 `/{session}/{port}`。

### 5) iframe 沙箱与安全策略

- WebContainer 经验表明：跨域隔离（COOP/COEP）与嵌入策略是关键前置条件。
- Codespaces 通过 token 与端口可见性策略降低端口暴露风险。
- Artifacts 通过授权弹窗（如 MCP）做能力升级控制。

结论：默认策略应为：
- iframe `sandbox="allow-scripts allow-forms allow-same-origin"`（按能力增量开启）；
- 端口默认私有，仅当前会话可读；
- 敏感头与 cookie 在代理层剥离，禁止预览页访问 Studio 管理 API。

### 6) 崩溃恢复与资源限流

- Replit 的 checkpoint/rollback 与 v0 的版本/修复交互，明显降低“AI 改坏项目”的焦虑。
- Codespaces 通过生命周期与机器规格管理可控成本。

结论：`opencode-studio` 需要三层恢复：
1) 进程自动重启；
2) 预览快照回退；
3) 会话级恢复（重连后恢复同一 URL/设备态）。

### 7) 预览 UI 交互

优秀产品共性：

- 设备切换（Desktop/Tablet/Mobile）
- 强制刷新 / 自动刷新切换
- 空态引导（如何启动 dev server）
- 错误态可操作（复制日志、一键修复、回退）

## 各产品优缺点与可借鉴点

### Cursor

- **优点**：本地开发无缝；云 Agent 并行执行能力强；支持 MCP 扩展。
- **缺点**：预览面板标准化弱于“专用 Web IDE”。
- **借鉴**：将“并行 agent”与“预览结果验收”打通，形成任务闭环。

### Replit Agent

- **优点**：从构建到运行到回滚的一体化体验强。
- **缺点**：平台锁定感较强，复杂企业网络接入成本高。
- **借鉴**：把 checkpoint 作为预览体验的一等公民。

### StackBlitz / Bolt.new

- **优点**：WebContainer 极致启动速度；前端迭代体验优秀。
- **缺点**：重度项目受浏览器资源约束；跨浏览器行为差异。
- **借鉴**：引入“轻量预览模式”（浏览器内运行）用于秒级反馈。

### Vercel v0

- **优点**：编辑器、Diff、部署、修复链路完整；设计与工程衔接好。
- **缺点**：更偏 Web 应用赛道，对非 Web 进程支持有限。
- **借鉴**：预览与部署 URL 分层；错误一键修复入口前置。

### Copilot Workspace / Codespaces

- **优点**：端口治理成熟，容器环境标准化强。
- **缺点**：Workspace 本身偏任务流，实时“边改边看”要依赖底层能力组合。
- **借鉴**：端口注册、可见性策略、devcontainer 约定化能力。

### Claude Artifacts

- **优点**：快速生成可交互原型、版本切换和分享体验好。
- **缺点**：工程化多进程预览能力较弱。
- **借鉴**：把“可分享 artifact”作为演示态输出，不替代工程态预览。

## 对 openode-studio（opencode-studio）的直接启发

1. 实时预览不是单功能，而是 **运行时 + 代理 + 状态机 + UI** 的组合能力。
2. 首版不追求“全技术栈全平台”，优先支持 **Vite/Next 常见前端场景**。
3. 预览成功率比“理论能力覆盖”更重要，必须优先落地：
   - 自动端口发现
   - 错误态语义化
   - 一键恢复/重启
4. 引入 **快照回退** 与 **资源预算**，降低 AI 自动改动带来的不可控风险。

## “右侧边栏实时预览”交互草案（文字 + 结构图）

### 交互目标

- 右侧常驻，可折叠，最少打断主编辑区。
- 让用户在 3 秒内判断：当前是否可预览、是否健康、问题在哪。

### 结构图（信息架构）

```text
+-------------------------------------------------------------+
| 顶栏: [设备 Desktop v] [刷新] [自动刷新:On] [端口:5173 v]    |
+-------------------------------------------------------------+
| 状态条: Ready / Building / Error / Reconnecting             |
+-------------------------------------------------------------+
|                                                             |
|                    Preview iframe 区域                      |
|                                                             |
+-------------------------------------------------------------+
| 底栏: [日志] [错误] [网络] [一键修复] [回退快照]            |
+-------------------------------------------------------------+
```

### 关键状态

- **空态**：提示“未发现可预览端口”，给出 `npm run dev` 引导与推荐端口。
- **加载态**：显示构建阶段（安装依赖/启动服务/HMR 就绪）。
- **错误态**：显示可操作建议（复制错误、一键修复、重启服务、回退快照）。
- **离线态**：会话断连后自动重连，保持设备模式与上次 URL。

## 参考来源

- Cursor Features: `https://cursor.com/features`
- Cursor Cloud Agent Docs: `https://cursor.com/docs/cloud-agent`
- Replit Agent Docs: `https://docs.replit.com/replitai/agent`
- StackBlitz WebContainers Docs: `https://webcontainers.io`
- StackBlitz Browser Support: `https://developer.stackblitz.com/platform/webcontainers/browser-support`
- Bolt.new: `https://bolt.new`
- v0 Docs: `https://v0.dev/docs`
- v0 Code Editing: `https://v0.dev/docs/code-editing`
- v0 Deployments: `https://v0.dev/docs/deployments`
- GitHub Copilot Workspace Blog: `https://github.blog/news-insights/product-news/github-copilot-workspace/`
- GitHub Codespaces Deep Dive: `https://docs.github.com/en/codespaces/getting-started/deep-dive`
- GitHub Codespaces Port Forwarding: `https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace`
- Claude Artifacts Help: `https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them`
