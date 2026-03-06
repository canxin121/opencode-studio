import { ref, watch } from 'vue'

import type {
  GitCommitDiffResponse,
  GitCommitFile,
  GitCommitFilesResponse,
  GitLogCommit,
  GitLogResponse,
} from '@/types/git'
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
  const historyDiff = ref('')
  const historyDiffLoading = ref(false)
  const historyDiffError = ref<string | null>(null)

  const historyFiles = ref<GitCommitFile[]>([])
  const historyFilesLoading = ref(false)
  const historyFilesError = ref<string | null>(null)
  const historyFileSelected = ref<GitCommitFile | null>(null)
  const historyFileDiff = ref('')
  const historyFileDiffLoading = ref(false)
  const historyFileDiffError = ref<string | null>(null)

  const historyFilterPath = ref<string | null>(null)
  const historyFilterAuthor = ref('')
  const historyFilterMessage = ref('')
  const historyFilterRef = ref('')
  const historyFilterRefType = ref<'branch' | 'tag'>('branch')

  const COMMIT_DETAILS_CACHE_LIMIT = 80
  const COMMIT_FILE_DIFF_CACHE_LIMIT = 160
  const HISTORY_PAGE_CACHE_LIMIT = 60
  type CommitDetailsCacheValue = { files: GitCommitFile[]; diff: string }
  type HistoryPageCacheValue = { commits: GitLogCommit[]; hasMore: boolean }
  const commitDetailsCache = new Map<string, CommitDetailsCacheValue>()
  const commitFileDiffCache = new Map<string, string>()
  const historyPageCache = new Map<string, HistoryPageCacheValue>()

  let historyLoadSeq = 0
  let selectCommitSeq = 0
  let selectFileSeq = 0
  let activeHistoryAbort: AbortController | null = null
  let activeCommitAbort: AbortController | null = null
  let activeFileDiffAbort: AbortController | null = null

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

  function normalizeRefInput(): string | undefined {
    const raw = historyFilterRef.value.trim()
    if (!raw) return undefined
    if (raw.startsWith('refs/')) return raw
    if (historyFilterRefType.value === 'tag') return `refs/tags/${raw}`
    return `refs/heads/${raw}`
  }

  function historyPageKey(directory: string, page: number): string {
    const path = (historyFilterPath.value || '').trim()
    const author = historyFilterAuthor.value.trim()
    const message = historyFilterMessage.value.trim()
    const ref = normalizeRefInput() || ''
    return `${directory}::${path}::${author}::${message}::${ref}::${page}`
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
    historyDiff.value = ''
    historyDiffError.value = null
    historyFiles.value = []
    historyFilesError.value = null
    historyFileSelected.value = null
    historyFileDiff.value = ''
    historyFileDiffError.value = null
    activeCommitAbort?.abort()
    activeFileDiffAbort?.abort()
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
          author: historyFilterAuthor.value.trim() || undefined,
          message: historyFilterMessage.value.trim() || undefined,
          ref: normalizeRefInput(),
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
    historyDiff.value = ''
    historyDiffError.value = null
    historyFileSelected.value = null
    historyFileDiff.value = ''
    historyFileDiffError.value = null
    historyFiles.value = []
    historyFilesError.value = null

    const cached = commitDetailsCache.get(commitCacheKey)
    if (cached) {
      historyFiles.value = cached.files
      historyDiff.value = cached.diff
      return
    }

    activeCommitAbort?.abort()
    const requestSeq = ++selectCommitSeq
    const abortController = new AbortController()
    activeCommitAbort = abortController

    historyFilesLoading.value = true
    historyDiffLoading.value = true
    try {
      const [filesResp, diffResp] = await Promise.all([
        gitJson<GitCommitFilesResponse>('commit-files', dir, { commit: hash }, { signal: abortController.signal }),
        gitJson<GitCommitDiffResponse>(
          'commit-diff',
          dir,
          {
            commit: hash,
            contextLines: 3,
          },
          { signal: abortController.signal },
        ),
      ])

      if (requestSeq !== selectCommitSeq || abortController.signal.aborted) return

      historyFiles.value = Array.isArray(filesResp?.files) ? filesResp.files : []
      historyDiff.value = diffResp?.diff || ''
      setBoundedCache(
        commitDetailsCache,
        commitCacheKey,
        { files: historyFiles.value, diff: historyDiff.value },
        COMMIT_DETAILS_CACHE_LIMIT,
      )
    } catch (err) {
      if (requestSeq !== selectCommitSeq || isAbortError(err)) return
      const msg = err instanceof Error ? err.message : String(err)
      historyDiffError.value = msg
      historyFilesError.value = msg
    } finally {
      if (requestSeq === selectCommitSeq) {
        historyFilesLoading.value = false
        historyDiffLoading.value = false
      }
      if (activeCommitAbort === abortController) {
        activeCommitAbort = null
      }
    }
  }

  async function selectCommitFile(file: GitCommitFile) {
    const dir = repoRoot.value
    const commit = historySelected.value
    if (!dir || !commit) return

    const hash = String(commit.hash || '').trim()
    const path = String(file.path || '').trim()
    if (!hash || !path) return
    const key = `${dir}::${hash}::${path}`

    historyFileSelected.value = file
    historyFileDiff.value = ''
    historyFileDiffError.value = null

    const cached = commitFileDiffCache.get(key)
    if (typeof cached === 'string') {
      historyFileDiff.value = cached
      return
    }

    activeFileDiffAbort?.abort()
    const requestSeq = ++selectFileSeq
    const abortController = new AbortController()
    activeFileDiffAbort = abortController

    historyFileDiffLoading.value = true
    try {
      const resp = await gitJson<GitCommitDiffResponse>(
        'commit-file-diff',
        dir,
        {
          commit: hash,
          path,
          contextLines: 3,
        },
        { signal: abortController.signal },
      )

      if (requestSeq !== selectFileSeq || abortController.signal.aborted) return

      historyFileDiff.value = resp?.diff || ''
      setBoundedCache(commitFileDiffCache, key, historyFileDiff.value, COMMIT_FILE_DIFF_CACHE_LIMIT)
    } catch (err) {
      if (requestSeq !== selectFileSeq || isAbortError(err)) return
      historyFileDiffError.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (requestSeq === selectFileSeq) {
        historyFileDiffLoading.value = false
      }
      if (activeFileDiffAbort === abortController) {
        activeFileDiffAbort = null
      }
    }
  }

  function clearSelectedFile() {
    historyFileSelected.value = null
    historyFileDiff.value = ''
    historyFileDiffError.value = null
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
    activeFileDiffAbort?.abort()
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
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  function clearHistoryFilters() {
    historyFilterAuthor.value = ''
    historyFilterMessage.value = ''
    historyFilterRef.value = ''
    historyFilterRefType.value = 'branch'
    clearHistorySelectionState()
    resetHistoryListState()
    void loadHistoryPage(1, true)
  }

  watch(
    () => repoRoot.value,
    () => {
      commitDetailsCache.clear()
      commitFileDiffCache.clear()
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
    historyDiff,
    historyDiffLoading,
    historyDiffError,
    historyFiles,
    historyFilesLoading,
    historyFilesError,
    historyFileSelected,
    historyFileDiff,
    historyFileDiffLoading,
    historyFileDiffError,
    historyFilterPath,
    historyFilterAuthor,
    historyFilterMessage,
    historyFilterRef,
    historyFilterRefType,
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
