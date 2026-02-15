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

  async function loadMore(directory: string, scope: Scope) {
    if (!opts.gitReady.value) return
    if (!directory.trim()) return

    const list = listForScope(scope)
    const loading = loadingForScope(scope)

    if (loading.value) return
    loading.value = true
    try {
      const offset = list.value.length
      const resp = await opts.loadStatusPage({
        directory,
        scope,
        offset,
        limit: opts.pageSize,
      })
      const next = mapFiles(resp)
      if (next.length) list.value = [...list.value, ...next]
    } finally {
      loading.value = false
    }
  }

  async function reloadFirstPages(directory: string) {
    if (!opts.gitReady.value) return
    if (!directory.trim()) return

    const scopes: Scope[] = ['merge', 'staged', 'unstaged', 'untracked']
    await Promise.all(
      scopes.map(async (scope) => {
        const list = listForScope(scope)
        const loading = loadingForScope(scope)
        if (loading.value) return
        loading.value = true
        try {
          const resp = await opts.loadStatusPage({
            directory,
            scope,
            offset: 0,
            limit: opts.pageSize,
          })
          list.value = mapFiles(resp)
        } finally {
          loading.value = false
        }
      }),
    )
  }

  function resetAll() {
    mergeList.value = []
    stagedList.value = []
    changesList.value = []
    untrackedList.value = []
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
