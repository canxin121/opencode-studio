# AGENTS 验收门槛（对齐 CI）

[English](../../../AGENTS.md) | 简体中文

本文件定义 Agent 在交付变更前必须满足的最低验收门槛。
基准来源：`.github/workflows/ci.yml`。
若本文件与 CI 配置不一致，以 CI 为准。

## 适用规则

- 在仓库根目录执行命令。
- 任何代码变更在提交前都应满足以下检查。
- 不得通过降低标准绕过检查（如移除 `--locked`、取消 `-D warnings`）。

## 版本更新

- 更新项目版本号时，必须使用 `scripts/` 目录下的 Python 脚本，不要手动改各清单文件。
- 命令：`python3 scripts/version_sync.py set <version>`（示例：`python3 scripts/version_sync.py set 0.1.0`）。
- 版本更新后，本地校验必须包含 `python3 scripts/version_sync.py check`。

## 必过检查

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

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test -q --locked --manifest-path server/Cargo.toml
python3 -m json.tool desktop/src-tauri/tauri.conf.json >/dev/null
python3 -m json.tool desktop/src-tauri/tauri.conf.full.json >/dev/null
python3 -m json.tool desktop/src-tauri/capabilities/default.json >/dev/null
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

- 上述命令全部返回成功（exit code 0）才算通过。
- 任一命令失败即视为未通过验收。

## 版本对齐

- Bun 版本策略跟随 CI（`bun-version: latest`）。
- 当 CI 版本策略变更时，应同步更新本文件。
