# Live Preview Plugin Bridge (Draft)

This note documents the current contract for the OpenCode plugin `opencode-web-preview`.

Key change from early drafts: the plugin does not persist its own state files. OpenCode Studio owns preview session storage + runtime.

## Goal

- Let OpenCode (agent) create/update/start/stop Studio workspace preview sessions.
- Discover a reachable local dev server URL (loopback only).
- Keep preview session config/state in Studio so the Studio UI reads a single source of truth.

## Plugin Contract

Tool name: `web_preview_helper`

Request args (selected):

- `action`: `help | discover | host.start | host.stop | host.restart | host.status | sessions.list`
- `id?`: preview session id (required for host.stop/host.restart/host.status)
- `port?`: preferred port for host.start/host.restart; also used as a discover hint
- `command?`: explicit command to run for host.start/host.restart
- `args?`: explicit argv array for command
- `url?`: explicit URL to probe for discover

Response shape (JSON string):

```ts
type PreviewHelperResponse = {
  ok: boolean
  action: string
  error?: string
  status?: number
  updatedAt?: number

  // discover
  url?: string
  frameworkHint?: string
  checkedUrls?: string[]

  // host.* + sessions.list
  studioBaseUrl?: string
  session?: unknown
  sessions?: unknown
}
```

## Studio API (Source Of Truth)

Studio persists preview session records and exposes them via:

- `GET /api/workspace/preview/sessions`
- `GET /api/workspace/preview/sessions/{id}`
- `POST /api/workspace/preview/sessions`
- `PUT /api/workspace/preview/sessions/{id}`
- `POST /api/workspace/preview/sessions/{id}/start`
- `POST /api/workspace/preview/sessions/{id}/stop`

The OpenCode plugin uses these endpoints; the Studio UI should read from the same endpoints.

## Suggested UI State Mapping

- `running`: green status + "Open Preview" button.
- `error`: warning status + error text + "Retry Discover" action.
- `idle` or missing URL: neutral status + "Discover Preview" action.

## Example Consumer Pseudocode

```ts
async function loadPreviewSessions() {
  const res = await fetch("/api/workspace/preview/sessions")
  const data = await res.json()
  return data
}
```

## Error Handling Notes

- Tool returns JSON string, so frontend should guard `JSON.parse` with fallback.
- `discover` may return `error=no_reachable_dev_server`; treat as non-fatal and expose retry.
- `status` may return transient network errors; do not close panel automatically.

## Bridge Evolution Ideas

- Add a Studio-side "recommended command" endpoint so the plugin can be thinner.
- Add Studio-side session selection helpers (e.g. by directory/opencodeSessionId).

## 为何必须 proxy-only

- 浏览器里的前端不能再直接请求 `127.0.0.1:<port>` 这类本地地址：当 Studio 由远端 origin 承载时，用户设备与该 origin 的网络拓扑不一致，直接访问会出现不可达或命中错误主机。
- 统一走当前 Studio origin 的 `/api/workspace/preview/proxy`，可以把预览流量限制在后端可控边界内，并复用现有鉴权与审计链路。
- 代理层会强制 `http/https + loopback(host)` 目标校验，并剥离 `set-cookie` 等高风险响应头，避免把本地服务 cookie 注入到 Studio 上下文。
- 代理响应增加 `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN`，确保仅允许在当前 Studio 页面内嵌，降低点击劫持和跨站嵌入风险。

## Repo and Bootstrapping Status

- Draft plugin repo created at `/home/canxin/Git/opencode_dir/opencode-web-preview`.
- Local scaffold includes `package.json`, `src/index.ts`, and README.
- Local plugin repo initialized with git and first commit.

## GitHub Remote Initialization

If `gh` is available and authenticated, run:

```bash
cd /home/canxin/Git/opencode_dir/opencode-web-preview
gh repo create opencode-web-preview --private --source . --remote origin --push
```

If blocked (for example unauthenticated `gh`), keep local repo state and retry the command after `gh auth login`.
