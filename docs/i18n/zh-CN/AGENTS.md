# AGENTS 本地验收门槛（快速）

[English](../../../AGENTS.md) | 简体中文

本文件定义 Agent 在交付变更前**本地**需要满足的验收门槛（快速检查）。
GitHub Actions CI 仍会跑全量检查，并以 CI 结果为准。

## 适用规则

- 在仓库根目录执行命令。
- 任何代码变更在提交前都应满足以下快速检查。
- 不得通过降低标准绕过检查（例如移除 `--locked`、跳过格式化）。

## 版本更新

- 更新项目版本号时，必须使用 `scripts/` 目录下的 Python 脚本，不要手动改各清单文件。
- 命令：`python3 scripts/version_sync.py set <version>`（示例：`python3 scripts/version_sync.py set 0.1.0`）。
- 版本更新后，本地校验必须包含 `python3 scripts/version_sync.py check`。

## 必过检查（本地快速门槛）

### 格式化

```bash
cargo fmt --all
bun run --cwd web fmt -- --cache --cache-location .prettier-cache
```

上述命令可能会修改文件。格式化产生的改动应随同 PR/提交一起提交（不要留在未提交状态）。
如果你只想“验证”格式化而不修改文件，可以使用 `cargo fmt --all -- --check` 和 `bun run --cwd web fmt:check`。

### 构建 / 健康检查

```bash
bun install --cwd web --frozen-lockfile
bun run --cwd web vite build
cargo check --workspace --all-targets --locked
```

## CI 全量检查（GitHub Actions）

CI 会在每次 push/PR 上运行这些 job；即使本地快速门槛通过，只要 CI 失败也必须视为阻塞。

### 版本一致性（对应 CI job: `version`）

```bash
python3 scripts/version_sync.py check
```

### Web（对应 CI job: `web`）

```bash
bun install --cwd web --frozen-lockfile
bun run --cwd web fmt:check -- --cache --cache-location .prettier-cache
bun run --cwd web vue-tsc -b
bun run --cwd web vite build
bun test --cwd web
```

### Rust（对应 CI job: `rust`）

Linux（fmt + clippy + tests + desktop JSON 校验）：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -q --locked --manifest-path server/Cargo.toml
python3 -m json.tool desktop/src-tauri/tauri.conf.json >/dev/null
python3 -m json.tool desktop/src-tauri/tauri.conf.full.json >/dev/null
python3 -m json.tool desktop/src-tauri/capabilities/default.json >/dev/null
```

macOS（server/plugin 运行时测试）：

```bash
cargo test -q --locked --manifest-path server/Cargo.toml
```

Windows（server/plugin 运行时测试）：

```powershell
cargo test -q --locked --manifest-path server/Cargo.toml
```

### 服务安装端到端（对应 CI job: `service-installers`）

三平台都会先从 GitHub Releases 解析稳定版本标签（`latest` 与前一个稳定版），
再基于这两个版本验证 install -> upgrade -> uninstall 关键链路。

Linux：

```bash
bun add -g opencode-ai@latest
bash scripts/test-unix-service-flow.sh --mode system --version <previous-stable-tag> --upgrade-to-version <latest-stable-tag>
```

macOS：

```bash
bun add -g opencode-ai@latest
bash scripts/test-unix-service-flow.sh --version <previous-stable-tag> --upgrade-to-version <latest-stable-tag>
```

Windows（管理员权限 PowerShell）：

```powershell
bun add -g opencode-ai@latest
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-service-flow.ps1 -Version <previous-stable-tag> -UpgradeToVersion <latest-stable-tag>
```

## 验收判定

- 本地交付：上述“必过检查（本地快速门槛）”命令必须全部返回成功（exit code 0）。
- CI 为准：合并/发布前 GitHub Actions 必须通过。
- CI 全量检查不要求在本地重复执行（除非排查 CI 失败）。

## 版本对齐

- Bun 版本策略跟随 CI（`bun-version: latest`）。
- 当 CI 版本策略变更时，应同步更新本文件。
