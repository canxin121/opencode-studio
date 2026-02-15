import { ApiError } from '@/lib/api'
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

export function useGitSequencerOps(opts: {
  repoRoot: { value: string | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  openTerminalHelp: (title: string, explain: string, send: string) => void
}) {
  const { repoRoot, toasts, gitJson, withRepoBusy, handleGitBusy, load, openTerminalHelp } = opts

  async function abortMerge() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Merge abort', async () => {
      try {
        await gitJson('merge/abort', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        toasts.push('success', 'Merge aborted')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Merge abort', abortMerge)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function abortRebase() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Rebase abort', async () => {
      try {
        await gitJson('rebase/abort', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        toasts.push('success', 'Rebase aborted')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Rebase abort', abortRebase)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function cherryPickContinue() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Cherry-pick continue', async () => {
      try {
        await gitJson('cherry-pick/continue', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Cherry-pick continued')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Cherry-pick continue', cherryPickContinue)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, 'git cherry-pick --continue')
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function cherryPickSkip() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Cherry-pick skip', async () => {
      try {
        await gitJson('cherry-pick/skip', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Cherry-pick skipped')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Cherry-pick skip', cherryPickSkip)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function cherryPickAbort() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Cherry-pick abort', async () => {
      try {
        await gitJson('cherry-pick/abort', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Cherry-pick aborted')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Cherry-pick abort', cherryPickAbort)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function revertContinue() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Revert continue', async () => {
      try {
        await gitJson('revert/continue', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Revert continued')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Revert continue', revertContinue)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, 'git revert --continue')
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function revertSkip() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Revert skip', async () => {
      try {
        await gitJson('revert/skip', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Revert skipped')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Revert skip', revertSkip)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function revertAbortSeq() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Revert abort', async () => {
      try {
        await gitJson('revert/abort', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Revert aborted')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Revert abort', revertAbortSeq)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function rebaseContinue() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Rebase continue', async () => {
      try {
        await gitJson('rebase/continue', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Rebase continued')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Rebase continue', rebaseContinue)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, 'git rebase --continue')
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function rebaseSkip() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Rebase skip', async () => {
      try {
        await gitJson('rebase/skip', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        toasts.push('success', 'Rebase skipped')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Rebase skip', rebaseSkip)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    abortMerge,
    abortRebase,
    cherryPickContinue,
    cherryPickSkip,
    cherryPickAbort,
    revertContinue,
    revertSkip,
    revertAbortSeq,
    rebaseContinue,
    rebaseSkip,
  }
}
