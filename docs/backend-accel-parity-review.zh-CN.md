# 后端加速/能力对齐评审（Studio）

[English](backend-accel-parity-review.md) | 简体中文

## 本次已实现内容

- 新增持久化本地附件缓存：使用 SQLite 元数据索引 + 磁盘 base64 blob（`server/src/attachment_cache.rs`）。
- 将附件缓存接入 assistant 消息转发（`server/src/opencode_proxy.rs`），重复的 `serverPath` 附件可复用本地持久化 payload 路径，避免每次都重新读取并编码源文件。
- 将上传时缓存注册接入 `/fs/upload`（`server/src/fs.rs`），上传文件可立即在 assistant 流程中复用。
- 新增 session 状态本地优先/回退行为（`server/src/opencode_proxy.rs`）：
  - `?local=true` / `?preferLocal=true` 直接从 Studio 运行时索引返回状态。
  - OpenCode 不可用/重启中/请求失败时自动本地回退。
- 改进跨目录父子会话处理（`server/src/opencode_session.rs`）：
  - Root/children 视图会基于 parent ID 从缓存 + SQLite 回填缺失父记录，父会话目录不同时子会话仍可解析血缘链。
- 强化 SQLite 读取路径（`server/src/opencode_session/sqlite_dao.rs`）：
  - 增加 busy/locked 重试。
  - 增加更安全的 read pragma 与偏性能的读参数。
  - 增加 DAO 的按 session ID 直接查询能力，用于父链回填。

## 为什么这些改动影响大

- 附件缓存去掉了常见 resend/edit/retry 场景下重复的高成本文件读取 + base64 编码。
- 本地状态回退减少 OpenCode 短暂不可用时的脆弱体验。
- 跨目录父链回填补上了 workbench 类布局下的重要层级缺口。
- busy 重试可降低 SQLite 锁竞争下的瞬时降级响应。

## 后续可继续优化

- 为附件 blob 与元数据增加有界淘汰策略（按容量和时间）。
- 持久化并暴露附件缓存 hit/miss 指标，便于调优。
- 为 `/session/status` 之外的只读端点增加本地优先快路径。
- 在无 SQLite 环境中扩展父链 hydration 的 JSON 存储回退。
- 在会话列表与状态 API 之间加入共享一致性追踪 ID，便于调试。
