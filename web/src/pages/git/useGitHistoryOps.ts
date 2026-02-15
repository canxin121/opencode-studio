import { apiErrorBodyRecord, ApiError } from '@/lib/api'
import type { Ref } from 'vue'
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

export function useGitHistoryOps(opts: {
  repoRoot: { value: string | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>

  openTerminalHelp: (title: string, explain: string, send: string) => void

  commitMessage: Ref<string>
  commitErrorOpen: Ref<boolean>
  commitErrorTitle: Ref<string>
  commitErrorOutput: Ref<string>
}) {
  const {
    repoRoot,
    toasts,
    gitJson,
    withRepoBusy,
    handleGitBusy,
    load,
    openTerminalHelp,
    commitMessage,
    commitErrorOpen,
    commitErrorTitle,
    commitErrorOutput,
  } = opts

  async function undoLastCommit() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Undo commit', async () => {
      try {
        await gitJson('undo-commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'soft' }),
        })
        toasts.push('success', 'Undid last commit')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Undo commit', undoLastCommit)) return
        if (err instanceof ApiError) {
          const body = apiErrorBodyRecord(err)
          const out = typeof body?.stdout === 'string' ? body.stdout : ''
          const e = typeof body?.stderr === 'string' ? body.stderr : ''
          if (out || e) {
            commitErrorTitle.value = 'Undo commit failed'
            commitErrorOutput.value = [e, out].filter(Boolean).join('\n\n').trim()
            commitErrorOpen.value = true
            return
          }
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function cherryPickCommit(commit: string) {
    const dir = repoRoot.value
    if (!dir) return
    const hash = (commit || '').trim()
    if (!hash) return
    await withRepoBusy('Cherry-pick', async () => {
      try {
        await gitJson('cherry-pick', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commit: hash }),
        })
        toasts.push('success', `Cherry-picked ${hash.slice(0, 7)}`)
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Cherry-pick', () => cherryPickCommit(hash))) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, `git cherry-pick ${hash}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function revertCommit(commit: string) {
    const dir = repoRoot.value
    if (!dir) return
    const hash = (commit || '').trim()
    if (!hash) return
    await withRepoBusy('Revert commit', async () => {
      try {
        await gitJson('revert-commit', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commit: hash }),
        })
        toasts.push('success', `Reverted ${hash.slice(0, 7)}`)
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Revert commit', () => revertCommit(hash))) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, `git revert ${hash}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function resetCommit(commit: string, mode: 'soft' | 'mixed' | 'hard') {
    const dir = repoRoot.value
    if (!dir) return
    const hash = (commit || '').trim()
    if (!hash) return
    await withRepoBusy(`Reset (${mode})`, async () => {
      try {
        await gitJson('reset', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commit: hash, mode }),
        })
        toasts.push('success', `Reset to ${hash.slice(0, 7)} (${mode})`)
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Reset', () => resetCommit(hash, mode))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function restoreCommitTemplate() {
    const dir = repoRoot.value
    if (!dir) return
    try {
      const resp = await gitJson<{ configured: boolean; path?: string | null; template?: string | null }>(
        'commit-template',
        dir,
      )
      const tpl = (resp?.template || '').trimEnd()
      if (!tpl) {
        toasts.push('info', 'No commit template configured')
        return
      }
      commitMessage.value = tpl
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    }
  }

  function discardCommitMessage() {
    commitMessage.value = ''
  }

  return {
    undoLastCommit,
    cherryPickCommit,
    revertCommit,
    resetCommit,
    restoreCommitTemplate,
    discardCommitMessage,
  }
}
