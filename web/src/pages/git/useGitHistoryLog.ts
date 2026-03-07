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

  const historyFilterPath = ref<string | null>(null)
  const historySearchDraft = ref('')
  const historySearchQuery = ref('')

  const COMMIT_DETAILS_CACHE_LIMIT = 80
  const HISTORY_PAGE_CACHE_LIMIT = 60
  type CommitDetailsCacheValue = { files: GitCommitFile[] }
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
    historyFilesError.value = null
    historyFileSelected.value = null
    activeCommitAbort?.abort()
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
    const dir = repoRoot.value
    if (!dir) return
    const hash = String(commit?.hash || '').trim()
    if (!hash) return
    const commitCacheKey = `${dir}::${hash}`

    historySelected.value = commit
    historyFileSelected.value = null
    historyFiles.value = []
    historyFilesError.value = null

    const cached = commitDetailsCache.get(commitCacheKey)
    if (cached) {
      historyFiles.value = cached.files
      return
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
        { commit: hash },
        { signal: abortController.signal },
      )

      if (requestSeq !== selectCommitSeq || abortController.signal.aborted) return

      historyFiles.value = Array.isArray(filesResp?.files) ? filesResp.files : []
      setBoundedCache(commitDetailsCache, commitCacheKey, { files: historyFiles.value }, COMMIT_DETAILS_CACHE_LIMIT)
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
    selectCommitFile,
    clearSelectedFile,
  }
}
