import { ref, type Ref } from 'vue'

import type { GitBranchesResponse } from '@/types/git'
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

export function useGitBranches(opts: {
  root: Ref<string | null>
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
}) {
  const { root, toasts, gitJson, withRepoBusy, handleGitBusy, load } = opts

  const branches = ref<GitBranchesResponse | null>(null)
  const isBranchDialogOpen = ref(false)
  const branchesLoading = ref(false)
  const newBranchName = ref('')
  const renameBranchOpen = ref(false)
  const renameBranchFrom = ref('')
  const renameBranchTo = ref('')

  async function loadBranches() {
    const dir = root.value
    if (!dir) return
    branchesLoading.value = true
    try {
      branches.value = await gitJson<GitBranchesResponse>('branches', dir)
    } catch {
      branches.value = null
    } finally {
      branchesLoading.value = false
    }
  }

  async function createBranch() {
    const dir = root.value
    if (!dir) return
    const name = newBranchName.value.trim()
    if (!name) return

    await withRepoBusy('Create branch', async () => {
      try {
        await gitJson('branches', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, startPoint: 'HEAD' }),
        })
        toasts.push('success', `Created branch ${name}`)
        newBranchName.value = ''
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Create branch', createBranch)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function checkoutBranch(branch: string) {
    const dir = root.value
    if (!dir) return
    await withRepoBusy('Checkout branch', async () => {
      try {
        await gitJson('checkout', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch }),
        })
        toasts.push('success', `Checked out ${branch}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Checkout branch', () => checkoutBranch(branch))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function deleteBranch(branch: string, force = false) {
    const dir = root.value
    if (!dir) return
    const name = (branch || '').trim()
    if (!name) return

    await withRepoBusy(force ? 'Force delete branch' : 'Delete branch', async () => {
      try {
        await gitJson('branches', dir, undefined, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch: name, force }),
        })
        toasts.push('success', `Deleted branch ${name}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Delete branch', () => deleteBranch(branch, force))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function deleteRemoteBranch(name: string) {
    const dir = root.value
    if (!dir) return
    const remoteName = (name || '').trim()
    if (!remoteName) return

    await withRepoBusy('Delete remote branch', async () => {
      try {
        await gitJson('branches/delete-remote', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: remoteName }),
        })
        toasts.push('success', `Deleted remote branch ${remoteName}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Delete remote branch', () => deleteRemoteBranch(name))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  function openRenameBranch(name: string) {
    const n = (name || '').trim()
    if (!n || n.startsWith('remotes/')) return
    renameBranchFrom.value = n
    renameBranchTo.value = n
    renameBranchOpen.value = true
  }

  async function submitRenameBranch() {
    const dir = root.value
    const from = renameBranchFrom.value.trim()
    const to = renameBranchTo.value.trim()
    if (!dir || !from || !to) return
    renameBranchOpen.value = false
    await withRepoBusy('Rename branch', async () => {
      try {
        await gitJson('branches/rename', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from, to }),
        })
        toasts.push('success', `Renamed ${from} -> ${to}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Rename branch', submitRenameBranch)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    branches,
    isBranchDialogOpen,
    branchesLoading,
    newBranchName,
    renameBranchOpen,
    renameBranchFrom,
    renameBranchTo,
    loadBranches,
    createBranch,
    checkoutBranch,
    deleteBranch,
    deleteRemoteBranch,
    openRenameBranch,
    submitRenameBranch,
  }
}
