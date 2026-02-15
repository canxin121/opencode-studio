import type { Ref } from 'vue'
import { ref } from 'vue'

import type { GitWorktreeInfo } from '@/types/git'
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

export function useGitWorktrees(opts: {
  repoRoot: Ref<string | null>
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
}) {
  const { repoRoot, gitJson, toasts, withRepoBusy, handleGitBusy } = opts

  const worktreesOpen = ref(false)
  const worktreesLoading = ref(false)
  const worktreesError = ref<string | null>(null)
  const worktrees = ref<GitWorktreeInfo[]>([])

  const newWorktreePath = ref('')
  const newWorktreeBranch = ref('')
  const newWorktreeStartPoint = ref('HEAD')
  const newWorktreeCreateBranch = ref(false)

  async function loadWorktrees() {
    const dir = repoRoot.value
    if (!dir) return
    worktreesLoading.value = true
    worktreesError.value = null
    try {
      const resp = await gitJson<GitWorktreeInfo[]>('worktrees', dir)
      worktrees.value = Array.isArray(resp) ? resp : []
    } catch (err) {
      worktrees.value = []
      worktreesError.value = err instanceof Error ? err.message : String(err)
    } finally {
      worktreesLoading.value = false
    }
  }

  function openWorktrees() {
    worktreesOpen.value = true
    void loadWorktrees()
  }

  async function addWorktree() {
    const dir = repoRoot.value
    if (!dir) return
    const path = newWorktreePath.value.trim()
    const branch = newWorktreeBranch.value.trim()
    const startPoint = newWorktreeStartPoint.value.trim()
    const createBranch = newWorktreeCreateBranch.value
    if (!path) return
    if (createBranch && !branch) return

    await withRepoBusy('Add worktree', async () => {
      try {
        await gitJson('worktrees', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            path,
            branch: branch || undefined,
            startPoint: startPoint || undefined,
            createBranch,
          }),
        })
        toasts.push('success', `Added worktree ${path}`)
        newWorktreePath.value = ''
        await loadWorktrees()
      } catch (err) {
        if (handleGitBusy(err, 'Add worktree', addWorktree)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function removeWorktree(path: string) {
    const dir = repoRoot.value
    if (!dir) return
    const p = (path || '').trim()
    if (!p) return
    await withRepoBusy('Remove worktree', async () => {
      try {
        await gitJson('worktrees', dir, undefined, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p }),
        })
        toasts.push('success', `Removed worktree ${p}`)
        await loadWorktrees()
      } catch (err) {
        if (handleGitBusy(err, 'Remove worktree', () => removeWorktree(path))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function pruneWorktrees() {
    const dir = repoRoot.value
    if (!dir) return
    await withRepoBusy('Prune worktrees', async () => {
      try {
        await gitJson('worktrees/prune', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        toasts.push('success', 'Pruned worktrees')
        await loadWorktrees()
      } catch (err) {
        if (handleGitBusy(err, 'Prune worktrees', pruneWorktrees)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function migrateWorktreeChanges(sourcePath: string) {
    const dir = repoRoot.value
    if (!dir) return
    const source = (sourcePath || '').trim()
    if (!source || source === dir) return

    await withRepoBusy('Migrate worktree changes', async () => {
      try {
        await gitJson('worktrees/migrate', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sourcePath: source,
            includeUntracked: true,
            deleteFromSource: true,
          }),
        })
        toasts.push('success', 'Migrated worktree changes')
        await loadWorktrees()
      } catch (err) {
        if (handleGitBusy(err, 'Migrate worktree changes', () => migrateWorktreeChanges(sourcePath))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    worktreesOpen,
    worktreesLoading,
    worktreesError,
    worktrees,
    newWorktreePath,
    newWorktreeBranch,
    newWorktreeStartPoint,
    newWorktreeCreateBranch,
    loadWorktrees,
    openWorktrees,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    migrateWorktreeChanges,
  }
}
