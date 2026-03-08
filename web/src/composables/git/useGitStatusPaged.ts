import { computed, ref } from 'vue'

import type { GitStatusFile, GitStatusResponse } from '@/types/git'

export function useGitStatusPaged(opts: {
  gitReady: { value: boolean }
  status: { value: GitStatusResponse | null }
  pageSize: number
  loadStatusPage: (args: {
    directory: string
    scope: 'staged' | 'unstaged' | 'untracked' | 'merge'
    offset: number
    limit: number
  }) => Promise<GitStatusResponse>
}) {
  const mergeList = ref<GitStatusFile[]>([])
  const stagedList = ref<GitStatusFile[]>([])
  const changesList = ref<GitStatusFile[]>([])
  const untrackedList = ref<GitStatusFile[]>([])

  const mergeListLoading = ref(false)
  const stagedListLoading = ref(false)
  const changesListLoading = ref(false)
  const untrackedListLoading = ref(false)

  const mergeCount = computed(() => opts.status.value?.mergeCount ?? mergeList.value.length)
  const stagedCount = computed(() => opts.status.value?.stagedCount ?? stagedList.value.length)
  const changesCount = computed(() => opts.status.value?.unstagedCount ?? changesList.value.length)
  const untrackedCount = computed(() => opts.status.value?.untrackedCount ?? untrackedList.value.length)

  const hasMoreMerge = computed(() => mergeList.value.length < mergeCount.value)
  const hasMoreStaged = computed(() => stagedList.value.length < stagedCount.value)
  const hasMoreUnstaged = computed(() => changesList.value.length < changesCount.value)
  const hasMoreUntracked = computed(() => untrackedList.value.length < untrackedCount.value)

  type Scope = 'staged' | 'unstaged' | 'untracked' | 'merge'
  const pendingReloadByScope: Record<Scope, boolean> = {
    merge: false,
    staged: false,
    unstaged: false,
    untracked: false,
  }
  const latestDirectoryByScope: Record<Scope, string> = {
    merge: '',
    staged: '',
    unstaged: '',
    untracked: '',
  }

  function listForScope(scope: Scope) {
    if (scope === 'merge') return mergeList
    if (scope === 'staged') return stagedList
    if (scope === 'unstaged') return changesList
    return untrackedList
  }

  function loadingForScope(scope: Scope) {
    if (scope === 'merge') return mergeListLoading
    if (scope === 'staged') return stagedListLoading
    if (scope === 'unstaged') return changesListLoading
    return untrackedListLoading
  }

  function mapFiles(resp: GitStatusResponse): GitStatusFile[] {
    const diffStats = resp?.diffStats || {}
    if (!Array.isArray(resp?.files)) return []
    return resp.files.map((file) => {
      const stat = diffStats[file.path]
      if (!stat) return file
      return {
        ...file,
        insertions: stat.insertions,
        deletions: stat.deletions,
      }
    })
  }

  async function reloadScopeFirstPage(directory: string, scope: Scope) {
    if (!opts.gitReady.value) return
    const trimmedDirectory = directory.trim()
    if (!trimmedDirectory) return

    latestDirectoryByScope[scope] = trimmedDirectory
    const list = listForScope(scope)
    const loading = loadingForScope(scope)

    if (loading.value) {
      pendingReloadByScope[scope] = true
      return
    }

    loading.value = true
    try {
      const resp = await opts.loadStatusPage({
        directory: trimmedDirectory,
        scope,
        offset: 0,
        limit: opts.pageSize,
      })
      list.value = mapFiles(resp)
    } finally {
      loading.value = false
      if (pendingReloadByScope[scope]) {
        pendingReloadByScope[scope] = false
        const queuedDirectory = latestDirectoryByScope[scope]
        if (queuedDirectory) {
          void reloadScopeFirstPage(queuedDirectory, scope)
        }
      }
    }
  }

  async function loadMore(directory: string, scope: Scope) {
    if (!opts.gitReady.value) return
    const trimmedDirectory = directory.trim()
    if (!trimmedDirectory) return

    latestDirectoryByScope[scope] = trimmedDirectory

    const list = listForScope(scope)
    const loading = loadingForScope(scope)

    if (loading.value) return
    loading.value = true
    try {
      const offset = list.value.length
      const resp = await opts.loadStatusPage({
        directory: trimmedDirectory,
        scope,
        offset,
        limit: opts.pageSize,
      })
      const next = mapFiles(resp)
      if (next.length) list.value = [...list.value, ...next]
    } finally {
      loading.value = false
      if (pendingReloadByScope[scope]) {
        pendingReloadByScope[scope] = false
        const queuedDirectory = latestDirectoryByScope[scope] || trimmedDirectory
        if (queuedDirectory) {
          void reloadScopeFirstPage(queuedDirectory, scope)
        }
      }
    }
  }

  async function reloadFirstPages(directory: string) {
    if (!opts.gitReady.value) return
    const trimmedDirectory = directory.trim()
    if (!trimmedDirectory) return

    const scopes: Scope[] = ['merge', 'staged', 'unstaged', 'untracked']
    await Promise.all(scopes.map((scope) => reloadScopeFirstPage(trimmedDirectory, scope)))
  }

  function resetAll() {
    mergeList.value = []
    stagedList.value = []
    changesList.value = []
    untrackedList.value = []
    pendingReloadByScope.merge = false
    pendingReloadByScope.staged = false
    pendingReloadByScope.unstaged = false
    pendingReloadByScope.untracked = false
    latestDirectoryByScope.merge = ''
    latestDirectoryByScope.staged = ''
    latestDirectoryByScope.unstaged = ''
    latestDirectoryByScope.untracked = ''
  }

  return {
    mergeList,
    stagedList,
    changesList,
    untrackedList,
    mergeListLoading,
    stagedListLoading,
    changesListLoading,
    untrackedListLoading,
    mergeCount,
    stagedCount,
    changesCount,
    untrackedCount,
    hasMoreMerge,
    hasMoreStaged,
    hasMoreUnstaged,
    hasMoreUntracked,
    loadMore,
    reloadFirstPages,
    resetAll,
  }
}
