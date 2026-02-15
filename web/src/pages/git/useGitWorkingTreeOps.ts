import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

export function useGitWorkingTreeOps(opts: {
  root: { value: string | null }
  selectedFile: { value: string | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  refreshAfterStageOp?: () => Promise<void>
  refreshDiff: () => void
}) {
  const { root, selectedFile, toasts, gitJson, withRepoBusy, handleGitBusy, load, refreshAfterStageOp, refreshDiff } = opts
  const refreshStageState = refreshAfterStageOp || load

  async function stagePaths(paths: string[]) {
    const dir = root.value
    if (!dir || paths.length === 0) return
    await withRepoBusy('Stage', async () => {
      try {
        await gitJson('stage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'paths', paths }),
        })
        await refreshStageState()
        if (selectedFile.value && paths.includes(selectedFile.value)) refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Stage', () => stagePaths(paths))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stageAll() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Stage all', async () => {
      try {
        await gitJson('stage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ all: true }),
        })
        await refreshStageState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Stage all', stageAll)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stageAllTracked() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Stage tracked', async () => {
      try {
        await gitJson('stage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'tracked' }),
        })
        await refreshStageState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Stage tracked', stageAllTracked)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stageAllUntracked() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Stage untracked', async () => {
      try {
        await gitJson('stage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'untracked' }),
        })
        await refreshStageState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Stage untracked', stageAllUntracked)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stageAllMerge() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Stage merge', async () => {
      try {
        await gitJson('stage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'merge' }),
        })
        await refreshStageState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Stage merge', stageAllMerge)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function unstagePaths(paths: string[]) {
    const dir = root.value
    if (!dir || paths.length === 0) return
    await withRepoBusy('Unstage', async () => {
      try {
        await gitJson('unstage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paths }),
        })
        await refreshStageState()
        if (selectedFile.value && paths.includes(selectedFile.value)) refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Unstage', () => unstagePaths(paths))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function unstageAll() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Unstage all', async () => {
      try {
        await gitJson('unstage', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ all: true }),
        })
        await refreshStageState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Unstage all', unstageAll)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function cleanUntracked(all = false) {
    const dir = root.value
    if (!dir) return
    await withRepoBusy(all ? 'Clean all' : 'Clean untracked', async () => {
      try {
        await gitJson('clean', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: all ? 'all' : 'untracked' }),
        })
        await load()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, all ? 'Clean all' : 'Clean untracked', () => cleanUntracked(all))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function discardAllTracked() {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Discard tracked', async () => {
      try {
        await gitJson('clean', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'tracked' }),
        })
        await load()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Discard tracked', discardAllTracked)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function revertFile(path: string) {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Discard file', async () => {
      try {
        await gitJson('revert', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        toasts.push('success', 'Changes discarded')
        await load()
        if (selectedFile.value === path) refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Discard file', () => revertFile(path))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function ignorePath(path: string) {
    const dir = root.value
    const p = (path || '').trim()
    if (!dir || !p) return
    await withRepoBusy('Ignore', async () => {
      try {
        const resp = await gitJson<{ added?: boolean; path?: string }>('ignore', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p }),
        })
        if (selectedFile.value === p) selectedFile.value = null
        if (resp?.added === false) {
          toasts.push('info', 'Already ignored')
        } else {
          toasts.push('success', `Ignored ${resp?.path || p}`)
        }
        await load()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Ignore', () => ignorePath(path))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    stagePaths,
    stageAll,
    stageAllTracked,
    stageAllUntracked,
    stageAllMerge,
    unstagePaths,
    unstageAll,
    cleanUntracked,
    discardAllTracked,
    revertFile,
    ignorePath,
  }
}
