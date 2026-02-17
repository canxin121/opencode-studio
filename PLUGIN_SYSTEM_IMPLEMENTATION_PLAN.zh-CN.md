# OpenCode Studio 独立 TypeScript 插件系统 - 实施计划

## 1) 目标与硬性约束

在 Studio 侧构建一个插件平台：与 OpenCode Core 内部实现解耦，但仍使用 `opencode.json` 的插件列表作为发现入口。

硬性约束：

- OpenCode Core 源码零改动。
- 仅允许修改：
  - `opencode-studio`
  - `opencode_dir/opencode-planpilot`
- 插件配置必须仅由插件自有存储持久化（Studio 不得为插件配置引入持久化 DB/文件）。
- 插件必须可将 UI 挂载到 Studio 指定界面（优先 chat），并支持丰富交互（Planpilot 的 plan/step/goal CRUD）。
- 架构应以 TypeScript 为主、可扩展，不依赖 OpenCode 内部消息通道。

## 2) 范围与非目标

范围内：

- 通用的 Studio 插件运行时契约。
- 基于 OpenCode 配置插件列表的插件发现机制。
- 插件 manifest/能力模型。
- 插件 action 调用模型。
- Settings 与 Chat 场景的插件 UI 挂载模型。
- Planpilot 作为参考实现：在 Chat 中实现完整 CRUD + 状态展示。

范围外（Phase-1）：

- 直接在 Studio 主 JS 上下文执行任意第三方插件代码。
- 修改 OpenCode Core 插件协议。
- 插件市场/分发后端。

## 3) 高层架构

### 3.1 核心思路

将 Studio 插件视为外部能力提供方，提供两类契约：

1. **控制契约**（manifest + actions + events）：通过 Studio 服务端桥接，以 HTTP/SSE 对接。
2. **UI 契约**（web bundle entry）：由 Studio Web 在 host 挂载容器中加载。

Studio 仅负责编排；插件负责领域逻辑与持久化。

### 3.2 运行时组件

1. **Studio Plugin Registry（server, Rust）**
   - 从 `GET /api/config/opencode` 返回数据读取插件标识（`plugin` 数组）。
   - 解析每个插件的 Studio manifest 路径与 web 入口元数据。
   - 维护仅内存的注册表（临时缓存）。

2. **Studio Plugin Bridge（server, Rust -> Node process）**
   - 执行插件 bridge 命令完成 action 调用。
   - 在需要时启动插件事件流适配器并中继到 SSE。
   - Studio 不持久化任何插件业务数据。

3. **Studio Plugin Host（web, TS/Vue）**
   - 拉取 manifest，并在声明的 surface 上挂载插件 UI。
   - 通过 Studio 插件端点转发 action 调用。
   - 提供统一 Host SDK API（`invokeAction`、`subscribeEvents`、runtime context）。

4. **插件侧 Studio SDK（TS package）**
   - 提供 manifest/action/event 契约类型。
   - 提供插件 web 入口与 bridge handler 的构建辅助。

### 3.3 发现来源

- 插件启用状态唯一事实来源：`opencode.json` 的插件列表（Studio 已可编辑）。
- Studio 对列表中的插件逐个做 Studio 能力解析。
- 若插件缺少 Studio manifest：对 OpenCode 仍可启用，但会被 Studio 运行时忽略。

## 4) 契约设计

### 4.1 Manifest 契约（`studio.manifest.json`）

每个插件随产物提供 manifest 文件。

必填字段：

- `id`：稳定插件标识（如 `opencode-planpilot`）。
- `version`：插件版本。
- `displayName`。
- `bridge`：action/event 适配器可执行规范。
- `ui`：web 入口元数据。
- `capabilities`：能力列表。

建议字段：

- `settingsSchema`：插件配置编辑用 JSON Schema。
- `mounts`：UI 挂载声明。

挂载声明示例：

- `settings.panel`
- `chat.sidebar`
- `chat.activity.inline`
- `chat.message.footer`

### 4.2 Action 契约

统一 action 端点结构：

- Request：`{ action: string, payload: unknown, context: HostContext }`
- Response：`{ ok: boolean, data?: unknown, error?: { code, message, details? } }`

用于设置集成的基础必备 action：

- `config.get`
- `config.set`
- `health.ping`

Planpilot 专用 action（示例）：

- `plan.list`, `plan.create`, `plan.update`, `plan.done`
- `step.create`, `step.update`, `step.done`
- `goal.create`, `goal.update`, `goal.done`
- `runtime.status`, `runtime.continue_now`, `runtime.pause_auto`, `runtime.resume_auto`

### 4.3 Event 契约（可选但推荐）

插件可发出 Host 可消费事件：

- `plugin.status.changed`
- `planpilot.plan.updated`
- `planpilot.step.updated`
- `planpilot.goal.updated`

传输方式：Studio SSE 端点中继插件 bridge 事件到 Web 订阅方。

## 5) 持久化模型（仅插件自有）

### 5.1 原则

Studio 不持久化存储任何插件配置值。

- Studio 可保留仅内存 request/session 缓存以优化 UX。
- 持久写入由插件通过 `config.set` 完成。
- 读取统一通过插件 `config.get`。

### 5.2 Planpilot 映射

- Planpilot 现有配置保持在插件自有位置（`~/.config/opencode/.planpilot`）。
- Planpilot 现有 SQLite 仍是 plan/step/goal 状态的插件侧事实来源。
- Studio 只调用 Planpilot action；不在本地存储中镜像或规范化 plan 表。

## 6) Studio 服务端实施计划（Rust）

### Phase A - Registry + manifest 读取

1. 新增 `plugin_runtime` 服务端模块。
2. 建立插件注册表刷新流程，触发时机：
   - 服务启动时
   - `PUT /api/config/opencode` 成功后
3. 对每个已配置插件 id，按确定性规则解析 manifest：
   - 优先插件 package 元数据显式路径（`opencodeStudio.manifest`）。
   - 回退约定路径（`dist/studio.manifest.json`、`studio.manifest.json`）。
4. 暴露端点：
   - `GET /api/plugins`
   - `GET /api/plugins/:id/manifest`

### Phase B - action bridge

5. 新增端点 `POST /api/plugins/:id/action`。
6. 使用 JSON stdin/stdout 协议执行插件 bridge 命令。
7. 增加按插件维度的超时和结构化错误映射。
8. 对重复 bridge 失败引入轻量内存熔断。

### Phase C - events + assets

9. 若插件支持 events，新增 `GET /api/plugins/:id/events` SSE 中继。
10. 新增 `GET /api/plugins/:id/assets/*`，静态透传插件 UI bundle 资源。

## 7) Studio Web 实施计划（TS/Vue）

### Phase D - host runtime

1. 新增 `web/src/plugins/host/` 模块：
   - manifest store
   - action client
   - event subscriber
   - mount resolver
2. 在 runtime bootstrap 与 opencode config 加载后拉取 manifest。
3. 维护插件健康状态：`ready | degraded | unavailable`。

### Phase E - settings 集成

4. 扩展 Settings 页面，加入插件 section 渲染器。
5. 若插件暴露 `settingsSchema`，渲染通用 schema-driven 表单。
6. 保存流程：
   - UI 仅修改本地 draft。
   - Save 调用 `config.set` action。
   - Reload 调用 `config.get` action。

### Phase F - chat 集成

7. 为声明 surface 增加 chat 挂载槽（如 `chat.sidebar`、`chat.activity.inline`）。
8. 在插件 host wrapper 中加载插件 UI 入口（iframe 或 micro-frontend 挂载）。
9. 提供 Host SDK bridge，支持 action invoke + SSE subscribe。
10. Planpilot 的挂载目标：
   - chat 侧边栏 plan 状态卡片
   - chat 主区域交互式 plan/step/goal CRUD 面板

## 8) 插件侧实施计划（`opencode-planpilot`）

### Phase G - Studio manifest 与 bridge

1. 在构建产物中增加 `studio.manifest.json` 生成。
2. 新增 Node bridge 入口：
   - 接收 action 请求 JSON
   - 将 action 映射到现有 Planpilot app/service 方法
   - 返回统一响应结构
3. 新增可选事件发射适配器，用于 Planpilot 状态变更。

### Phase H - Studio Web UI 包

4. 新增 `src/studio-web/` TS UI 应用（插件自有 micro-frontend）。
5. 实现 Host SDK 集成：
   - 通过 Studio Host 调用插件 action
   - 订阅 plan 更新事件
6. 实现 CRUD 组件：
   - plan 列表/详情
   - step/goal CRUD 与状态切换
   - runtime 控制（continue/pause/resume）

### Phase I - 插件配置集成

7. 通过 bridge 暴露 `settingsSchema`、`config.get`、`config.set`。
8. 全部持久配置写入保持在现有插件配置文件中。

## 9) 数据流

### 9.1 Settings 配置流

1. Studio 加载插件 manifest。
2. Studio 渲染 schema 驱动设置面板。
3. 用户修改字段并保存。
4. Studio -> `POST /api/plugins/:id/action`（`config.set`）。
5. 插件写入插件自有配置。
6. Studio 通过 `config.get` 刷新。

### 9.2 Chat UI + CRUD 流（Planpilot）

1. Chat 页面解析插件 mounts。
2. Planpilot 组件加载并请求 `plan.list`。
3. 用户创建/更新 plan/step/goal。
4. 组件调用 action；Planpilot 更新 SQLite。
5. 插件发出更新事件；Studio SSE 中继。
6. 组件增量刷新状态。

## 10) 版本与兼容性

- 在 manifest 引入 `studioApiVersion`（如 `1`）。
- Host 采用兼容策略：
  - 要求 major 一致
  - minor 的向后兼容能力通过 capability 检查门控
- 为契约字段与 action 增加弃用标记。

## 11) 测试策略

### 11.1 Server

- 单测：manifest 解析、registry 刷新、action bridge 错误映射。
- 集成测试：使用 mock bridge 验证插件端点。
- 鲁棒性测试：畸形 manifest 与异常 bridge 响应的拒绝处理。

### 11.2 Web

- 单测：mount resolver、plugin stores、action client。
- 组件测试：settings schema 表单渲染与保存闭环。
- E2E：chat 挂载渲染与 Planpilot CRUD 往返流程。

### 11.3 插件（Planpilot）

- action handler 与配置 API 单测。
- bridge stdin/stdout 协议集成测试。
- plan/step/goal CRUD 交互 UI 测试。

## 12) 交付阶段与里程碑

1. **M1**：Registry + manifest 端点 + host manifest store。
2. **M2**：Action bridge + 通用 settings 配置 CRUD。
3. **M3**：Chat mount host + 插件资源加载器。
4. **M4**：Planpilot chat 组件，完成 plan/step/goal 全 CRUD。
5. **M5**：稳定性/性能/测试/文档收口。

## 13) 验收标准

- OpenCode Core 仓库无任何改动。
- 在 `opencode.json` 中启用/禁用插件可立即影响 Studio 插件可用性。
- 插件设置可在 Studio 编辑并正确持久化，且 Studio 无插件配置持久存储。
- Planpilot 状态与 CRUD 在 chat surface 内可用。
- 插件故障可优雅降级，不导致 Studio chat/settings 崩溃。
- registry、bridge、settings 流程、Planpilot CRUD 测试通过。

## 14) 建议实施顺序

优先做垂直切片，而不是先堆全部基础设施：

1. Manifest + 列表端点 + Web manifest 加载。
2. `config.get`/`config.set` bridge + settings 面板。
3. Chat mount host + 最小 Planpilot 状态卡。
4. 完整 Planpilot CRUD + 事件同步。
5. 集成收口与完整测试矩阵。
