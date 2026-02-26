# AGENTS 验收门槛（对齐 CI）

本文件定义 Agent 在交付变更前必须满足的最低验收门槛。
基准来源：`.github/workflows/ci.yml`。
若本文件与 CI 配置不一致，以 CI 为准。

## 适用规则

- 在仓库根目录执行命令。
- 任何代码变更在提交前都应满足以下检查。
- 不得通过降低标准绕过检查（如移除 `--locked`、取消 `-D warnings`）。

## 必过检查

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

## 验收判定

- 上述命令全部返回成功（exit code 0）才算通过。
- 任一命令失败即视为未通过验收。

## 版本对齐

- Bun 版本对齐 CI：`1.3.9`。
- CI 变更后，应同步更新本文件中的门槛命令。
