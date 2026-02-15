import { ref, type Ref } from 'vue'

import { ApiError } from '@/lib/api'

import type { GitStashEntry, GitStashListResponse, GitStashShowResponse } from '@/types/git'
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

export function useGitStashOps(opts: {
  repoRoot: Ref<string | null>
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  loadBranches: () => Promise<void>
  openTerminalHelp: (title: string, explain: string, send: string) => void
}) {
  const { repoRoot, toasts, gitJson, withRepoBusy, handleGitBusy, load, loadBranches, openTerminalHelp } = opts

  const isStashExpanded = ref(false)
  const stashList = ref<GitStashEntry[]>([])
  const stashLoading = ref(false)

  const stashDialogOpen = ref(false)
  const stashMessage = ref('')
  const stashIncludeUntracked = ref(false)
  const stashKeepIndex = ref(false)
  const stashStaged = ref(false)

  const stashViewOpen = ref(false)
  const stashViewTitle = ref('')
  const stashViewDiff = ref('')
  const stashViewLoading = ref(false)
  const stashViewError = ref<string | null>(null)

  async function loadStash(directory: string) {
    const dir = (directory || '').trim()
    if (!dir) return
    stashLoading.value = true
    try {
      const resp = await gitJson<GitStashListResponse>('stash', dir)
      stashList.value = Array.isArray(resp?.stashes) ? resp.stashes : []
    } catch {
      stashList.value = []
    } finally {
      stashLoading.value = false
    }
  }

  async function stashBranchFrom(refStr: string) {
    const dir = repoRoot.value
    if (!dir) return
    const r = (refStr || '').trim()
    const branch = `stash/${r.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
    await withRepoBusy('Stash branch', async () => {
      try {
        await gitJson('stash/branch', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ref: r, branch }),
        })
        toasts.push('success', `Created branch ${branch}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Stash branch', () => stashBranchFrom(refStr))) return
        if (err instanceof ApiError && (err.code || '').trim() === 'git_interactive_required') {
          openTerminalHelp('Requires terminal', err.message, `git stash branch ${branch} ${r}`)
          return
        }
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stashPush() {
    await stashPushVariant({
      message: (stashMessage.value || '').trim() || null,
      includeUntracked: stashIncludeUntracked.value,
      keepIndex: stashKeepIndex.value,
      staged: stashStaged.value,
      fromDialog: true,
    })
  }

  async function stashPushVariant(opts: {
    message?: string | null
    includeUntracked?: boolean
    keepIndex?: boolean
    staged?: boolean
    fromDialog?: boolean
  }) {
    const dir = repoRoot.value
    if (!dir) return
    if (opts.fromDialog) stashDialogOpen.value = false

    const staged = Boolean(opts.staged)
    const payload = {
      message: (opts.message || '').trim() || null,
      includeUntracked: staged ? false : Boolean(opts.includeUntracked),
      keepIndex: staged ? false : Boolean(opts.keepIndex),
      staged,
    }

    await withRepoBusy('Stash push', async () => {
      try {
        await gitJson('stash/push', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        stashMessage.value = ''
        stashIncludeUntracked.value = false
        stashKeepIndex.value = false
        stashStaged.value = false
        toasts.push('success', 'Stashed changes')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Stash push', () => stashPushVariant(opts))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stashPushKeepIndexQuick() {
    await stashPushVariant({ includeUntracked: false, keepIndex: true })
  }

  async function stashPushIncludeUntrackedQuick() {
    await stashPushVariant({ includeUntracked: true, keepIndex: false })
  }

  async function stashPushStagedQuick() {
    await stashPushVariant({ staged: true })
  }

  async function stashAction(action: 'apply' | 'pop' | 'drop', refStr: string) {
    const dir = repoRoot.value
    if (!dir) return
    const r = (refStr || '').trim()
    if (!r) return

    await withRepoBusy(`Stash ${action}`, async () => {
      try {
        await gitJson(`stash/${action}`, dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ref: r }),
        })
        toasts.push('success', `stash ${action} ${r}`)
        await load()
      } catch (err) {
        if (handleGitBusy(err, `Stash ${action}`, () => stashAction(action, refStr))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stashDropAll() {
    const dir = repoRoot.value
    if (!dir) return

    await withRepoBusy('Stash drop all', async () => {
      try {
        const resp = await gitJson<{ cleared?: number }>('stash/drop-all', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        const cleared = Number(resp?.cleared || 0)
        toasts.push('success', cleared > 0 ? `Dropped ${cleared} stashes` : 'No stashes to drop')
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Stash drop all', stashDropAll)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function stashView(refStr: string) {
    const dir = repoRoot.value
    if (!dir) return
    const r = (refStr || '').trim()
    if (!r) return

    stashViewTitle.value = r
    stashViewOpen.value = true
    stashViewLoading.value = true
    stashViewError.value = null
    stashViewDiff.value = ''
    try {
      const resp = await gitJson<GitStashShowResponse>('stash/show', dir, { ref: r })
      stashViewTitle.value = (resp?.ref || r).trim() || r
      stashViewDiff.value = (resp?.diff || '').trimEnd()
      if (!stashViewDiff.value) {
        stashViewError.value = 'No diff output for this stash entry.'
      }
    } catch (err) {
      stashViewError.value = err instanceof Error ? err.message : String(err)
    } finally {
      stashViewLoading.value = false
    }
  }

  return {
    isStashExpanded,
    stashList,
    stashLoading,
    stashDialogOpen,
    stashMessage,
    stashIncludeUntracked,
    stashKeepIndex,
    stashStaged,
    stashViewOpen,
    stashViewTitle,
    stashViewDiff,
    stashViewLoading,
    stashViewError,
    loadStash,
    stashPush,
    stashPushKeepIndexQuick,
    stashPushIncludeUntrackedQuick,
    stashPushStagedQuick,
    stashAction,
    stashBranchFrom,
    stashDropAll,
    stashView,
  }
}
