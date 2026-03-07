import { ref, type Ref } from 'vue'
import { i18n } from '@/i18n'

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
  const branchPicker = ref<GitBranchesResponse | null>(null)
  const isBranchDialogOpen = ref(false)
  const branchesLoading = ref(false)
  const branchPickerLoading = ref(false)
  const branchPickerPage = ref(1)
  const branchPickerPageSize = ref(40)
  const branchPickerTotal = ref(0)
  const branchPickerTotalPages = ref(1)
  const branchPickerSearch = ref('')
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

  async function loadBranchPicker(opts?: { page?: number; pageSize?: number; search?: string }) {
    const dir = root.value
    if (!dir) return
    const pageRaw = Number(opts?.page ?? branchPickerPage.value)
    const pageSizeRaw = Number(opts?.pageSize ?? branchPickerPageSize.value)
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.floor(pageSizeRaw)) : 40
    const search = String((opts?.search ?? branchPickerSearch.value) || '').trim()

    branchPickerLoading.value = true
    try {
      const resp = await gitJson<GitBranchesResponse>('branches', dir, {
        page,
        pageSize,
        search: search || undefined,
        localOnly: true,
      })
      branchPicker.value = resp
      branchPickerPage.value = Number(resp.page || page) || page
      branchPickerPageSize.value = Number(resp.pageSize || pageSize) || pageSize
      branchPickerTotal.value = Number(resp.total || Object.keys(resp.branches || {}).length) || 0
      branchPickerTotalPages.value = Math.max(1, Number(resp.totalPages || 1) || 1)
      branchPickerSearch.value = String(resp.search ?? search)
    } catch {
      branchPicker.value = null
      branchPickerPage.value = 1
      branchPickerTotal.value = 0
      branchPickerTotalPages.value = 1
    } finally {
      branchPickerLoading.value = false
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
        toasts.push('success', i18n.global.t('git.toasts.createdBranch', { name }))
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
        toasts.push('success', i18n.global.t('git.toasts.checkedOutBranch', { name: branch }))
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
        toasts.push('success', i18n.global.t('git.toasts.deletedBranch', { name }))
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
        toasts.push('success', i18n.global.t('git.toasts.deletedRemoteBranch', { name: remoteName }))
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
        toasts.push('success', i18n.global.t('git.toasts.renamedFromTo', { from, to }))
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
    branchPicker,
    isBranchDialogOpen,
    branchesLoading,
    branchPickerLoading,
    branchPickerPage,
    branchPickerPageSize,
    branchPickerTotal,
    branchPickerTotalPages,
    branchPickerSearch,
    newBranchName,
    renameBranchOpen,
    renameBranchFrom,
    renameBranchTo,
    loadBranches,
    loadBranchPicker,
    createBranch,
    checkoutBranch,
    deleteBranch,
    deleteRemoteBranch,
    openRenameBranch,
    submitRenameBranch,
  }
}
