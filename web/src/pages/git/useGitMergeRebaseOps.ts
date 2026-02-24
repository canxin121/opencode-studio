import { ref } from 'vue'

import { ApiError } from '@/lib/api'
import type { JsonValue } from '@/types/json'
import { i18n } from '@/i18n'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

export function useGitMergeRebaseOps(opts: {
  repoRoot: { value: string | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  openTerminalHelp: (title: string, explain: string, send: string) => void
}) {
  const { repoRoot, toasts, gitJson, withRepoBusy, handleGitBusy, load, openTerminalHelp } = opts

  const mergeDialogOpen = ref(false)
  const mergeTarget = ref('')
  const mergeBusy = ref(false)

  const rebaseDialogOpen = ref(false)
  const rebaseTarget = ref('')
  const rebaseBusy = ref(false)

  function normalizeBranchRef(input: string): string {
    const raw = (input || '').trim()
    if (raw.startsWith('remotes/')) return raw.replace(/^remotes\//, '')
    return raw
  }

  function openMergeDialog() {
    mergeDialogOpen.value = true
  }

  function openRebaseDialog() {
    rebaseDialogOpen.value = true
  }

  async function startMerge() {
    const dir = repoRoot.value
    if (!dir) return
    const target = normalizeBranchRef(mergeTarget.value)
    if (!target) return
    mergeDialogOpen.value = false
    mergeBusy.value = true
    await withRepoBusy('Merge', async () => {
      try {
        await gitJson('merge', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch: target }),
        })
        toasts.push('success', i18n.global.t('git.toasts.mergedTarget', { target }))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Merge', startMerge)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'merge_in_progress') {
          toasts.push('info', err.message)
          await load()
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, `git merge ${target}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      } finally {
        mergeBusy.value = false
      }
    })
  }

  async function startRebase() {
    const dir = repoRoot.value
    if (!dir) return
    const target = normalizeBranchRef(rebaseTarget.value)
    if (!target) return
    rebaseDialogOpen.value = false
    rebaseBusy.value = true
    await withRepoBusy('Rebase', async () => {
      try {
        await gitJson('rebase', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch: target }),
        })
        toasts.push('success', i18n.global.t('git.toasts.rebasedOntoTarget', { target }))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Rebase', startRebase)) return
        if (err instanceof ApiError && (err.code || '').trim() === 'merge_in_progress') {
          toasts.push('info', err.message)
          await load()
          return
        }
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, `git rebase ${target}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      } finally {
        rebaseBusy.value = false
      }
    })
  }

  return {
    mergeDialogOpen,
    mergeTarget,
    mergeBusy,
    rebaseDialogOpen,
    rebaseTarget,
    rebaseBusy,
    openMergeDialog,
    openRebaseDialog,
    startMerge,
    startRebase,
  }
}
