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

export function useGitPatchOps(opts: {
  repoRoot: { value: string | null }
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  refreshAfterPatchOp?: () => Promise<void>
  refreshDiff: () => void
}) {
  const { repoRoot, gitJson, toasts, withRepoBusy, handleGitBusy, load, refreshAfterPatchOp, refreshDiff } = opts
  const refreshPatchState = refreshAfterPatchOp || load

  type PatchMode = 'stage' | 'unstage' | 'discard'
  type PatchTarget = 'hunk' | 'selected'

  function toPatchMode(mode: PatchMode, target: PatchTarget): string {
    if (target === 'selected') return `${mode}-selected`
    return mode
  }

  async function applyPatch(patch: string, mode: PatchMode, target: PatchTarget) {
    const dir = repoRoot.value
    if (!dir) return
    const source = patch || ''
    if (!source.trim()) return
    const content = source
    const scope = target === 'selected' ? 'selected lines' : 'hunk'
    const label = mode === 'stage' ? `Stage ${scope}` : mode === 'unstage' ? `Unstage ${scope}` : `Discard ${scope}`

    await withRepoBusy(label, async () => {
      try {
        await gitJson('patch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch: content, mode: toPatchMode(mode, target), target }),
        })
        toasts.push('success', label)
        await refreshPatchState()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, label, () => applyPatch(patch, mode, target))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stageHunk(patch: string) {
    await applyPatch(patch, 'stage', 'hunk')
  }

  async function unstageHunk(patch: string) {
    await applyPatch(patch, 'unstage', 'hunk')
  }

  async function discardHunk(patch: string) {
    await applyPatch(patch, 'discard', 'hunk')
  }

  async function stageSelected(patch: string) {
    await applyPatch(patch, 'stage', 'selected')
  }

  async function unstageSelected(patch: string) {
    await applyPatch(patch, 'unstage', 'selected')
  }

  async function discardSelected(patch: string) {
    await applyPatch(patch, 'discard', 'selected')
  }

  return {
    stageHunk,
    unstageHunk,
    discardHunk,
    stageSelected,
    unstageSelected,
    discardSelected,
  }
}
