# openode-studio 实时预览目标架构（可执行方案）

> 说明：文件名按需求使用 `openode`，内容面向 `opencode-studio` 现有架构落地。

## 1. 目标与非目标

### 1.1 目标

- 提供“右侧边栏实时预览”能力，支持边编辑边查看。
- 在本地优先前提下，具备远程/容器运行时扩展能力。
- 对常见前端框架（Vite/Next）实现稳定端口发现与 HMR 感知。
- 给出清晰错误态、恢复能力、资源治理与安全边界。

### 1.2 非目标（首期）

- 不覆盖所有语言与多进程复杂编排（如微服务全链路联调）。
- 不在首期实现公网共享预览链接。
- 不做完整云 IDE 替代，只做 Studio 内高质量预览闭环。

## 2. 目标架构（分层）

```text
+--------------------------------------------------------------+
|                        Web UI (Vue)                          |
|  Chat/Editor | Right Preview Panel | Status Store | Logs UI  |
+------------------------------+-------------------------------+
                               |
                               v
+--------------------------------------------------------------+
|                  Preview Orchestrator (Server)               |
| Session Runtime Manager | Port Registry | Health Supervisor   |
| Log Parser | Snapshot Manager | Resource Governor             |
+------------------------------+-------------------------------+
                               |
                 +-------------+-------------+
                 |                           |
                 v                           v
+-------------------------------+   +--------------------------+
| Runtime Adapter: Local Proc   |   | Runtime Adapter: Remote  |
| spawn npm/pnpm/bun dev        |   | container/vm executor     |
+-------------------------------+   +--------------------------+
                 |                           |
                 +-------------+-------------+
                               v
+--------------------------------------------------------------+
|                 Studio Reverse Proxy + Sandbox               |
| /preview/{session}/{port} -> target runtime endpoint         |
| CSP/Header rewrite | cookie strip | origin isolation         |
+--------------------------------------------------------------+
```

## 3. 核心数据流

### 3.1 编辑到预览（主路径）

1. 用户编辑文件（IDE/AI 生成）触发 `fs delta` 事件。
2. `Preview Orchestrator` 将 delta 标记到对应 session。
3. 若 dev server 未启动：调用 Runtime Adapter 拉起。
4. `Port Registry` 自动发现端口（日志 + 主动探测）。
5. 预览 URL 统一映射为 `/preview/{session}/{port}`。
6. 前端 iframe 刷新或等待 HMR，状态条更新为 `Ready`。

### 3.2 错误与恢复（异常路径）

1. `Health Supervisor` 检测进程退出/端口失活。
2. 进入 `Recovering` 状态并执行策略：
   - 首次：自动重启进程
   - 连续失败：提示查看日志 + 提供“一键修复”
   - 多次失败：建议回退快照
3. 恢复成功后回到 `Ready`，保留设备模式与当前路径。

## 4. 运行时策略

### 4.1 运行时选择

- **默认**：本地进程（最低延迟，最强兼容）。
- **后备**：远程容器/VM（当本地依赖不满足或用户主动切换）。
- **扩展**：轻量浏览器内运行时（仅用于前端快启场景）。

### 4.2 端口发现与优先级

- 一级：解析 stdout 中 `localhost/127.0.0.1`。
- 二级：探测常见端口 `3000/4173/5173/8080`。
- 三级：读取用户配置（项目级预览端口偏好）。
- 若多端口：按“最近活跃 + 框架识别”推荐默认端口。

## 5. 性能目标（SLO）

- 首次启动到首屏可见（P95）：`<= 12s`（本地 Node 前端项目）。
- 文件保存到预览更新（HMR，P95）：`<= 1.5s`。
- 预览切换设备模式响应（P95）：`<= 150ms`。
- 崩溃自动恢复成功率（单次）：`>= 90%`。
- 预览代理可用性（会话内）：`>= 99.5%`。

## 6. 安全边界

### 6.1 iframe 与代理安全

- iframe 默认 sandbox：`allow-scripts allow-forms allow-same-origin`。
- 禁止预览域直接访问 Studio 管理 API。
- 代理层移除敏感头与认证 cookie，采用会话 token 转发。
- 默认仅本地会话可见，不暴露公网访问。

### 6.2 资源与权限

- session 级 CPU/内存软限额（超限降级或重启）。
- 限制单会话最大并发进程数与端口数。
- 高危端口（数据库管理端口等）默认不暴露到 iframe。

## 7. 右侧边栏实时预览交互草案

## 7.1 交互结构

```text
Right Preview Sidebar
├─ Toolbar
│  ├─ Device Switcher (Desktop/Tablet/Mobile)
│  ├─ Refresh
│  ├─ Auto-Refresh Toggle
│  ├─ Port Selector
│  └─ Open External
├─ Runtime Status Strip
│  ├─ Building / Ready / Error / Reconnecting
│  └─ Last update timestamp
├─ Preview Frame
└─ Action Footer
   ├─ Logs
   ├─ Errors
   ├─ Fix with Agent
   ├─ Restart Runtime
   └─ Rollback Snapshot
```

### 7.2 关键交互规则

- 设备切换仅改变 viewport，不重启 runtime。
- 默认开启自动刷新；连续错误时自动关闭并提示手动刷新。
- 错误态展示“可执行动作”优先于纯文本日志。
- 空态展示“下一步命令建议”，而不是只显示“暂无预览”。

## 8. 插件协作点（为什么需要 opencode 插件）

`opencode` 插件需要承担“编辑器上下文与运行时编排”的桥梁角色，原因：

1. **上下文就近**：插件直接感知编辑器文件变更、当前工作区、活动终端。
2. **启动编排**：插件可以在本地统一拉起/停止 dev server，减少前后端猜测。
3. **诊断增强**：插件可采集 IDE 诊断、任务状态，与预览错误做关联。
4. **体验一致**：无论在 Studio 或 IDE，预览 session 可共享状态。

## 8.1 插件接口草案（建议）

### 控制面 API（Studio -> Plugin）

```ts
// 启动会话运行时
POST /plugin/preview/session/start
{
  sessionId: string,
  workspacePath: string,
  command?: string,      // e.g. "npm run dev"
  env?: Record<string, string>
}

// 停止会话运行时
POST /plugin/preview/session/stop
{
  sessionId: string
}

// 请求端口列表
GET /plugin/preview/session/{sessionId}/ports
```

### 8.1.1 v2 Hosted Session + `proxyBasePath` 契约

- 插件不再只上报一个裸端口，而是通过调用 Studio API 创建/更新 hosted preview session。
- hosted session 的状态与配置由 Studio 持久化（SQLite），`GET /api/workspace/preview/sessions` 返回 `{ version, updatedAt, sessions }`。
- `PreviewSessionRecord.id` 统一使用 `pv_...`，只允许 ASCII 字母数字、`_`、`-`，便于路由和日志检索。
- 每个 record 必须携带 `proxyBasePath`，格式固定为 `/api/workspace/preview/s/{id}/`，Studio iframe 与静态资源、XHR、HMR WebSocket 全部经由该路径进入代理层。
- `targetUrl` 仅允许 loopback `http/https` 目标（`localhost`、`127.0.0.1`、`[::1]`），Studio 后端在代理前再次校验，避免 SSRF。

```json
{
  "version": 1,
  "updatedAt": 1710000000000,
  "sessions": [
    {
      "id": "pv_vite-main",
      "directory": "/workspace/app",
      "opencodeSessionId": "ses_123",
      "state": "running",
      "proxyBasePath": "/api/workspace/preview/s/pv_vite-main/",
      "targetUrl": "http://127.0.0.1:5173/",
      "pid": 43122,
      "port": 5173,
      "command": "bun",
      "args": ["run", "dev"],
      "logsPath": "/tmp/opencode-preview.log",
      "startedAt": 1710000000000,
      "updatedAt": 1710000000123,
      "frameworkHint": "vite"
    }
  ]
}
```

Studio v2 读取与代理流程：

1. UI 调用 `GET /api/workspace/preview/sessions`（可带 `directory`）读取 hosted preview sessions。
2. UI 选择某条 session 后，直接把 iframe 指向该 session 的 `proxyBasePath`。
3. 后端根据 `{id}` 从 registry 命中 `targetUrl`，代理全部 HTTP 请求与 WebSocket upgrade。
4. 代理层剥离 hop-by-hop / `Cookie` / `Authorization` / `Set-Cookie`，并补充只允许 `self` 内嵌的 frame 限制头。
5. 如果插件重启或切换端口，只需通过 Studio API 更新 session 的 `targetUrl`（以及相关字段），Studio 在 TTL 缓存刷新后即可接管新目标。

### 事件流（Plugin -> Studio）

```ts
type PreviewEvent =
  | { type: "runtime.started"; sessionId: string; pid: number }
  | { type: "runtime.exited"; sessionId: string; code: number }
  | { type: "port.opened"; sessionId: string; port: number; protocol: "http" | "https" }
  | { type: "port.closed"; sessionId: string; port: number }
  | { type: "build.state"; sessionId: string; state: "building" | "ready" | "error"; message?: string }
  | { type: "log.chunk"; sessionId: string; stream: "stdout" | "stderr"; data: string }
  | { type: "resource.usage"; sessionId: string; cpuPct: number; memMB: number }
```

### 快照接口

```ts
POST /plugin/preview/session/snapshot/create
POST /plugin/preview/session/snapshot/rollback
GET  /plugin/preview/session/{sessionId}/snapshots
```

## 9. 渐进落地路线（M0 -> M3）

### M0（1-2 周）：可用最小闭环

- 本地 runtime 拉起（单命令）
- 自动端口发现 + 右侧 iframe 预览
- 基础状态机（空态/加载/就绪/错误）

验收：Vite 项目可稳定预览，保存后可见刷新。

### M1（2-3 周）：稳定性增强

- Health Supervisor 自动重启
- 日志语义化（构建中/成功/失败）
- 手动刷新、设备切换、端口切换

验收：异常退出后自动恢复，错误态可操作。

### M2（3-4 周）：安全与治理

- 代理层安全头与 cookie 策略
- 资源限流（CPU/内存/并发端口）
- 快照创建与回退

验收：长时间会话稳定，超限有清晰降级策略。

### M3（后续）：高级能力

- 远程容器/VM Adapter
- 与 AI 一键修复深度联动
- 预览分享（受控、短时、鉴权）

## 10. 风险与规避

- **风险**：不同框架日志格式差异导致状态误判。  
  **规避**：日志规则可配置 + 心跳探测双判定。
- **风险**：Windows/macOS/Linux 启动命令行为差异。  
  **规避**：插件侧统一命令封装与平台适配层。
- **风险**：长会话资源泄漏。  
  **规避**：会话 TTL、空闲回收、资源超限熔断。

## 11. 执行建议

优先做“成功率和可恢复性”，再做“高阶炫技能力”。

推荐首批验收用例：

- React + Vite（5173）
- Next.js（3000）
- Vue + Vite（5173）
- 构建失败后自动恢复
- 端口冲突与多端口场景
