import { ref, watch } from 'vue'

import type { GitCommitFile, GitCommitFilesResponse, GitLogCommit, GitLogResponse } from '@/types/git'
import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

export function useGitHistoryLog(opts: { repoRoot: { value: string | null }; gitJson: GitJson }) {
  const { repoRoot, gitJson } = opts

  const historyOpen = ref(false)
  const historyLoading = ref(false)
  const historyError = ref<string | null>(null)
  const historyCommits = ref<GitLogCommit[]>([])
  const historyHasMore = ref(false)
  const historyCurrentPage = ref(1)
  const historyKnownLastPage = ref(1)
  const historyExactLastPage = ref<number | null>(null)
  const historyLimit = 40

  const historySelected = ref<GitLogCommit | null>(null)

  const historyFiles = ref<GitCommitFile[]>([])
  const historyFilesLoading = ref(false)
  const historyFilesError = ref<string | null>(null)
  const historyFileSelected = ref<GitCommitFile | null>(null)
  const historyFilesCurrentPage = ref(1)
  const historyFilesKnownLastPage = ref(1)
  const historyFilesExactLastPage = ref<number | null>(null)
  const historyFilesHasMore = ref(false)
  const historyFilesTotal = ref<number | null>(null)
  const historyFilesServerPaged = ref(false)
  const historyFilesLimit = 100

  const historyFilterPath = ref<string | null>(null)
  const historySearchDraft = ref('')
  const historySearchQuery = ref('')

  const COMMIT_DETAILS_CACHE_LIMIT = 80
  const HISTORY_PAGE_CACHE_LIMIT = 60
  type CommitDetailsCacheValue = {
    files: GitCommitFile[]
    currentPage: number
    knownLastPage: number
    exactLastPage: number | null
    hasMore: boolean
    total: number | null
    serverPaged: boolean
  }
  type HistoryPageCacheValue = { commits: GitLogCommit[]; hasMore: boolean }
  const commitDetailsCache = new Map<string, CommitDetailsCacheValue>()
  const historyPageCache = new Map<string, HistoryPageCacheValue>()

  let historyLoadSeq = 0
  let selectCommitSeq = 0
  let activeHistoryAbort: AbortController | null = null
  let activeCommitAbort: AbortController | null = null

  function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number) {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, value)
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      cache.delete(oldestKey)
    }
  }

  function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false
    const name = String((err as { name?: string }).name || '')
    return name === 'AbortError'
  }

  function historyPageKey(directory: string, page: number): string {
    const path = (historyFilterPath.value || '').trim()
    const search = historySearchQuery.value.trim().toLowerCase()
    return `${directory}::${path}::${search}::${page}`
  }

  function resetHistoryListState() {
    activeHistoryAbort?.abort()
    activeHistoryAbort = null
    historyCommits.value = []
    historyHasMore.value = false
    historyError.value = null
    historyCurrentPage.value = 1
    historyKnownLastPage.value = 1
    historyExactLastPage.value = null
    historyPageCache.clear()
  }

  function clearHistorySelectionState() {
    historySelected.value = null
    historyFiles.value = []
    historyFilesLoading.value = false
    historyFilesError.value = null
    historyFileSelected.value = null
    activeCommitAbort?.abort()
    activeCommitAbort = null
    resetHistoryFilesPagination()
  }

  function resetHistoryFilesPagination() {
    historyFilesCurrentPage.value = 1
    historyFilesKnownLastPage.value = 1
    historyFilesExactLastPage.value = null
    historyFilesHasMore.value = false
    historyFilesTotal.value = null
    historyFilesServerPaged.value = false
  }

  function updateHistoryPageBounds(page: number, hasMore: boolean) {
    historyCurrentPage.value = page
    if (hasMore) {
      historyKnownLastPage.value = Math.max(historyKnownLastPage.value, page + 1)
      historyExactLastPage.value = null
      return
    }
    historyKnownLastPage.value = Math.max(historyKnownLastPage.value, page)
    historyExactLastPage.value = page
  }

  async function loadHistoryPage(page = 1, force = false) {
    const dir = repoRoot.value
    if (!dir) return

    const targetPage = Math.max(1, Math.floor(Number(page) || 1))
    const cacheKey = historyPageKey(dir, targetPage)
    if (!force) {
      const cached = historyPageCache.get(cacheKey)
      if (cached) {
        activeHistoryAbort?.abort()
        activeHistoryAbort = null
        historyLoadSeq += 1
        historyLoading.value = false
        historyError.value = null
        historyCommits.value = cached.commits
        historyHasMore.value = cached.hasMore
        updateHistoryPageBounds(targetPage, cached.hasMore)
        return
      }
    }

    activeHistoryAbort?.abort()
    const requestSeq = ++historyLoadSeq
    const abortController = new AbortController()
    activeHistoryAbort = abortController

    historyLoading.value = true
    historyError.value = null
    try {
      const offset = (targetPage - 1) * historyLimit
      const resp = await gitJson<GitLogResponse>(
        'log',
        dir,
        {
          offset,
          limit: historyLimit,
          path: historyFilterPath.value || undefined,
          search: historySearchQuery.value.trim() || undefined,
          graph: true,
        },
        {
          signal: abortController.signal,
        },
      )
      if (requestSeq !== historyLoadSeq || abortController.signal.aborted) return

      const commits = Array.isArray(resp?.commits) ? resp.commits : []
      const hasMore = Boolean(resp?.hasMore)
      historyCommits.value = commits
      historyHasMore.value = hasMore
      updateHistoryPageBounds(targetPage, hasMore)
      setBoundedCache(historyPageCache, cacheKey, { commits, hasMore }, HISTORY_PAGE_CACHE_LIMIT)
    } catch (err) {
      if (requestSeq !== historyLoadSeq || isAbortError(err)) return
      historyError.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (requestSeq === historyLoadSeq) {
        historyLoading.value = false
      }
      if (activeHistoryAbort === abortController) {
        activeHistoryAbort = null
      }
    }
  }

  async function loadMoreHistory() {
    const nextPage = historyCurrentPage.value + 1
    const hasKnownPage = nextPage <= historyKnownLastPage.value
    if (!historyHasMore.value && !hasKnownPage) return
    await loadHistoryPage(nextPage)
  }

  async function loadPreviousHistoryPage() {
    if (historyCurrentPage.value <= 1) return
    await loadHistoryPage(historyCurrentPage.value - 1)
  }

  async function selectCommit(commit: GitLogCommit) {
    const hash = String(commit?.hash || '').trim()
    if (!hash) return

    historySelected.value = commit
    historyFileSelected.value = null
    historyFiles.value = []
    historyFilesError.value = null
    resetHistoryFilesPagination()

    await loadCommitFilesPage(1)
  }

  async function loadCommitFilesPage(page = 1, force = false) {
    const dir = repoRoot.value
    const hash = String(historySelected.value?.hash || '').trim()
    if (!dir || !hash) return

    const targetPage = Math.max(1, Math.floor(Number(page) || 1))
    const commitCacheKey = `${dir}::${hash}::${targetPage}`
    if (!force) {
      const cached = commitDetailsCache.get(commitCacheKey)
      if (cached) {
        historyFiles.value = cached.files
        historyFilesCurrentPage.value = cached.currentPage
        historyFilesKnownLastPage.value = cached.knownLastPage
        historyFilesExactLastPage.value = cached.exactLastPage
        historyFilesHasMore.value = cached.hasMore
        historyFilesTotal.value = cached.total
        historyFilesServerPaged.value = cached.serverPaged
        historyFilesLoading.value = false
        historyFilesError.value = null
        return
      }
    }

    activeCommitAbort?.abort()
    const requestSeq = ++selectCommitSeq
    const abortController = new AbortController()
    activeCommitAbort = abortController

    historyFilesLoading.value = true
    try {
      const filesResp = await gitJson<GitCommitFilesResponse>(
        'commit-files',
        dir,
        {
          commit: hash,
          offset: (targetPage - 1) * historyFilesLimit,
          limit: historyFilesLimit,
          page: targetPage,
          pageSize: historyFilesLimit,
        },
        { signal: abortController.signal },
      )

      if (requestSeq !== selectCommitSeq || abortController.signal.aborted) return

      const files = Array.isArray(filesResp?.files) ? filesResp.files : []
      const hasPagingMeta =
        filesResp?.hasMore !== undefined ||
        filesResp?.nextOffset !== undefined ||
        filesResp?.offset !== undefined ||
        filesResp?.limit !== undefined ||
        filesResp?.page !== undefined ||
        filesResp?.pageSize !== undefined ||
        filesResp?.total !== undefined ||
        filesResp?.totalPages !== undefined

      let pageFiles = files
      let currentPage = targetPage
      let knownLastPage = 1
      let exactLastPage: number | null = null
      let hasMore = false
      let total: number | null = null

      if (hasPagingMeta) {
        const responseLimit = Math.max(
          1,
          Math.floor(Number(filesResp?.pageSize ?? filesResp?.limit) || historyFilesLimit),
        )
        const responsePage = Math.floor(Number(filesResp?.page) || 0)
        const responseOffset = Number(filesResp?.offset)
        if (responsePage > 0) {
          currentPage = responsePage
        } else if (Number.isFinite(responseOffset)) {
          currentPage = Math.max(1, Math.floor(responseOffset / responseLimit) + 1)
        }

        const responseTotal = Number(filesResp?.total)
        if (Number.isFinite(responseTotal) && responseTotal >= 0) {
          total = Math.floor(responseTotal)
        }

        const responseTotalPages = Math.floor(Number(filesResp?.totalPages) || 0)
        if (responseTotalPages > 0) {
          knownLastPage = responseTotalPages
          exactLastPage = responseTotalPages
          hasMore = currentPage < responseTotalPages
        } else if (total !== null) {
          const totalPages = Math.max(1, Math.ceil(total / responseLimit))
          knownLastPage = totalPages
          exactLastPage = totalPages
          hasMore = currentPage < totalPages
        } else {
          hasMore = Boolean(filesResp?.hasMore)
          knownLastPage = hasMore
            ? Math.max(historyFilesKnownLastPage.value, currentPage + 1)
            : Math.max(historyFilesKnownLastPage.value, currentPage)
          exactLastPage = hasMore ? null : currentPage
        }
      } else {
        const totalCount = files.length
        const totalPages = Math.max(1, Math.ceil(totalCount / historyFilesLimit))
        currentPage = Math.max(1, Math.min(targetPage, totalPages))
        const start = (currentPage - 1) * historyFilesLimit
        pageFiles = files.slice(start, start + historyFilesLimit)
        knownLastPage = totalPages
        exactLastPage = totalPages
        hasMore = currentPage < totalPages
        total = totalCount
      }

      historyFiles.value = pageFiles
      if (historyFileSelected.value) {
        const selectedPath = historyFileSelected.value.path
        const stillVisible = pageFiles.some((file) => file.path === selectedPath)
        if (!stillVisible) {
          historyFileSelected.value = null
        }
      }
      historyFilesCurrentPage.value = currentPage
      historyFilesKnownLastPage.value = knownLastPage
      historyFilesExactLastPage.value = exactLastPage
      historyFilesHasMore.value = hasMore
      historyFilesTotal.value = total
      historyFilesServerPaged.value = hasPagingMeta

      setBoundedCache(
        commitDetailsCache,
        commitCacheKey,
        {
          files: pageFiles,
          currentPage,
          knownLastPage,
          exactLastPage,
          hasMore,
          total,
          serverPaged: hasPagingMeta,
        },
        COMMIT_DETAILS_CACHE_LIMIT,
      )
    } catch (err) {
      if (requestSeq !== selectCommitSeq || isAbortError(err)) return
      const msg = err instanceof Error ? err.message : String(err)
      historyFilesError.value = msg
    } finally {
      if (requestSeq === selectCommitSeq) {
        historyFilesLoading.value = false
      }
      if (activeCommitAbort === abortController) {
        activeCommitAbort = null
      }
    }
  }

  function selectCommitFile(file: GitCommitFile) {
    historyFileSelected.value = file
  }

  async function loadMoreCommitFiles() {
    const nextPage = historyFilesCurrentPage.value + 1
    const hasKnownPage = nextPage <= historyFilesKnownLastPage.value
    if (!historyFilesHasMore.value && !hasKnownPage) return
    await loadCommitFilesPage(nextPage)
  }

  async function loadPreviousCommitFilesPage() {
    if (historyFilesCurrentPage.value <= 1) return
    await loadCommitFilesPage(historyFilesCurrentPage.value - 1)
  }

  async function loadCommitFilesAtPage(page: number) {
    const next = Math.max(1, Math.floor(Number(page) || 1))
    if (next === historyFilesCurrentPage.value && historyFiles.value.length > 0) return
    await loadCommitFilesPage(next)
  }

  function clearSelectedFile() {
    historyFileSelected.value = null
  }

  function openHistoryDialog() {
    historyFilterPath.value = null
    historyOpen.value = true
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  function openFileHistory(path: string) {
    const p = (path || '').trim()
    if (!p) return
    historyFilterPath.value = p
    historyOpen.value = true
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  function closeHistoryDialog() {
    historyOpen.value = false
    activeHistoryAbort?.abort()
    activeCommitAbort?.abort()
  }

  function refreshHistory() {
    void loadHistoryPage(historyCurrentPage.value, true)
  }

  function clearHistoryFilter() {
    historyFilterPath.value = null
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  function applyHistoryFilters() {
    historySearchQuery.value = historySearchDraft.value.trim()
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  function clearHistoryFilters() {
    historySearchDraft.value = ''
    historySearchQuery.value = ''
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  watch(
    () => repoRoot.value,
    () => {
      commitDetailsCache.clear()
      resetHistoryListState()
      clearHistorySelectionState()
      if (!historyOpen.value) return
      void loadHistoryPage(1, true)
    },
  )

  return {
    historyOpen,
    historyLoading,
    historyError,
    historyCommits,
    historyHasMore,
    historyLimit,
    historyCurrentPage,
    historyKnownLastPage,
    historyExactLastPage,
    historySelected,
    historyFiles,
    historyFilesLoading,
    historyFilesError,
    historyFileSelected,
    historyFilesCurrentPage,
    historyFilesKnownLastPage,
    historyFilesExactLastPage,
    historyFilesHasMore,
    historyFilesTotal,
    historyFilesServerPaged,
    historyFilesLimit,
    historyFilterPath,
    historySearchDraft,
    historySearchQuery,
    openHistoryDialog,
    openFileHistory,
    closeHistoryDialog,
    refreshHistory,
    clearHistoryFilter,
    applyHistoryFilters,
    clearHistoryFilters,
    loadHistoryPage,
    loadPreviousHistoryPage,
    loadMoreHistory,
    selectCommit,
    loadCommitFilesPage,
    loadMoreCommitFiles,
    loadPreviousCommitFilesPage,
    loadCommitFilesAtPage,
    selectCommitFile,
    clearSelectedFile,
  }
}
