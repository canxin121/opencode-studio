# Live Preview Plugin Bridge (Draft)

This note explains how OpenCode Studio frontend can consume output from a draft plugin repository: `opencode-web-preview`.

## Goal

- Discover local frontend dev server preview URL.
- Report runtime state (`running` / `error`).
- Provide preview session metadata for UI rendering.

## Plugin Contract

Tool name: `web_preview_helper`

Request args:

- `action`: `discover | status | session`
- `url?`: explicit URL (example: `http://127.0.0.1:5173`)
- `port?`: explicit port (example: `5173`)
- `sessionName?`: optional display name

Response shape (JSON string):

```ts
type PreviewHelperResponse = {
  ok: boolean
  action: "discover" | "status" | "session"
  state?: "idle" | "running" | "error"
  url?: string
  error?: string
  checkedUrls?: string[]
  updatedAt?: number
  session?: {
    id: string
    name: string
    projectDir?: string
    state?: "idle" | "running" | "error"
    url?: string
    error?: string
    startedAt?: number
    updatedAt?: number
    frameworkHint?: string
    metadata?: {
      source: "manual" | "scan"
      checkedUrls: string[]
      frameworkHint?: string
    }
  }
}
```

## Frontend Consumption Workflow

1. On session attach or preview panel open, call `discover` once.
2. If `ok=true` and `state=running`, render URL CTA and framework badge.
3. Start polling `status` every 3-5 seconds (or on session idle events).
4. If `status` returns error, switch panel state to degraded and keep retry action available.
5. On details panel open, call `session` to render metadata (project path, timestamps, checkedUrls).

## Suggested UI State Mapping

- `running`: green status + "Open Preview" button.
- `error`: warning status + error text + "Retry Discover" action.
- `idle` or missing URL: neutral status + "Discover Preview" action.

## Example Consumer Pseudocode

```ts
async function callPreviewHelper(action: "discover" | "status" | "session") {
  const text = await runOpencodeTool("web_preview_helper", { action })
  const data = JSON.parse(text) as PreviewHelperResponse
  return data
}

async function initPreviewPanel() {
  const discover = await callPreviewHelper("discover")
  updatePreviewStore(discover)

  if (discover.state === "running") {
    startInterval(async () => {
      const status = await callPreviewHelper("status")
      updatePreviewStore(status)
    }, 4000)
  }
}
```

## Error Handling Notes

- Tool returns JSON string, so frontend should guard `JSON.parse` with fallback.
- `discover` may return `error=no_reachable_dev_server`; treat as non-fatal and expose retry.
- `status` may return transient network errors; do not close panel automatically.

## Bridge Evolution Ideas

- Add plugin-side `events.poll` bridge action to avoid interval polling.
- Persist preview sessions to local state store for restart recovery.
- Include optional screenshot capability and tunnel metadata.

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
