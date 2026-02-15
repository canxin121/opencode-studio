import { nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance, type ComputedRef, type Ref } from 'vue'

import { includesQuery, sessionLabel } from '@/features/sessions/model/labels'
import type { DirectoryEntry } from '@/features/sessions/model/types'

type SessionLike = { id?: string | number | null; title?: string | null; slug?: string | null }
type FlattenedRow = { id?: string | null }
type FlattenedTree = { rows: FlattenedRow[]; parentById: Record<string, string | null>; rootIds: string[] }
type SessionSearchHit = { directory: DirectoryEntry; session: SessionLike }
type SessionRefEl = Element | ComponentPublicInstance | null
type LocateValue = unknown
type LocateRecord = Record<string, LocateValue>

function asRecord(value: LocateValue): LocateRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as LocateRecord
}

function isAbortError(err: LocateValue): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  return asRecord(err)?.name === 'AbortError'
}

export function useSidebarLocate(opts: {
  ui: {
    sidebarLocateSeq: number
    sidebarLocateSessionId: string | null
    clearSidebarLocateRequest: () => void
  }
  directories: ComputedRef<DirectoryEntry[]>
  directoryPage: Ref<number>
  directoriesPageSize: number
  collapsedDirectoryIds: Ref<Set<string>>
  pinnedSessionIds: Ref<string[]>
  sidebarQuery: Ref<string>
  sidebarQueryNorm: ComputedRef<string>
  searchSessions?: (
    directory: DirectoryEntry,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<SessionLike[]>
  aggregatedSessionsForDirectory: (directoryId: string, directoryPath: string) => SessionLike[]
  ensureDirectoryAggregateLoaded: (
    directoryId: string,
    directoryPath: string,
    opts?: { force?: boolean; focusSessionId?: string },
  ) => Promise<void>
  resolveDirectoryForSession: (
    sessionId: string,
    hint?: { directoryId?: string; directoryPath?: string; locateResult?: object | null },
  ) => Promise<{ directoryId: string; directoryPath: string; locatedDir: string } | null>
  flattenedByDirectoryId: ComputedRef<Record<string, FlattenedTree>>
  ensureAncestorsExpanded: (parentById: Record<string, string | null>, sessionId: string) => void
}) {
  const locatedSessionId = ref<string>('')
  let locateFlashTimer: number | null = null

  const sessionElById = new Map<string, Element>()
  function setSessionEl(sessionId: string, el: SessionRefEl) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const dom = el instanceof Element ? el : null
    if (dom) sessionElById.set(sid, dom)
    else sessionElById.delete(sid)
  }

  function flashLocated(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    locatedSessionId.value = sid
    if (locateFlashTimer) window.clearTimeout(locateFlashTimer)
    locateFlashTimer = window.setTimeout(() => {
      locateFlashTimer = null
      if (locatedSessionId.value === sid) locatedSessionId.value = ''
    }, 1800)
  }

  function sessionMatchesQuery(s: SessionLike, q: string): boolean {
    if (!q) return false
    return includesQuery(sessionLabel(s), q) || includesQuery(String(s?.id || ''), q)
  }

  const sessionSearchHits = ref<SessionSearchHit[]>([])

  const SEARCH_DEBOUNCE_MS = 280
  const searchWarming = ref(false)
  let searchWarmSeq = 0
  let searchDebounceTimer: number | null = null
  let activeSearchController: AbortController | null = null

  function clearSearchRequest() {
    if (searchDebounceTimer !== null) {
      window.clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    if (activeSearchController) {
      activeSearchController.abort()
      activeSearchController = null
    }
  }

  onBeforeUnmount(() => {
    clearSearchRequest()
  })

  watch(
    () => opts.sidebarQueryNorm.value,
    (q) => {
      const token = ++searchWarmSeq
      clearSearchRequest()

      if (!q || q.length < 2) {
        sessionSearchHits.value = []
        searchWarming.value = false
        return
      }

      searchWarming.value = true
      searchDebounceTimer = window.setTimeout(() => {
        searchDebounceTimer = null
        const controller = new AbortController()
        activeSearchController = controller

        void (async () => {
          try {
            const out: SessionSearchHit[] = []
            if (opts.searchSessions) {
              for (const p of opts.directories.value) {
                if (token !== searchWarmSeq || controller.signal.aborted) return
                if (!p?.path) continue
                const remaining = Math.max(0, 60 - out.length)
                if (!remaining) break
                const list = await opts.searchSessions(p, q, remaining, controller.signal)
                for (const s of list) {
                  if (!s?.id) continue
                  out.push({ directory: p, session: s })
                  if (out.length >= 60) break
                }
              }
            } else {
              for (const p of opts.directories.value) {
                if (token !== searchWarmSeq || controller.signal.aborted) return
                const list = opts.aggregatedSessionsForDirectory(p.id, p.path)
                for (const s of list) {
                  if (!s?.id) continue
                  if (!sessionMatchesQuery(s, q)) continue
                  out.push({ directory: p, session: s })
                  if (out.length >= 60) break
                }
                if (out.length >= 60) break
              }
            }
            if (token === searchWarmSeq && !controller.signal.aborted) {
              sessionSearchHits.value = out
            }
          } catch (err) {
            if (isAbortError(err)) return
            if (token === searchWarmSeq) {
              sessionSearchHits.value = []
            }
          } finally {
            if (activeSearchController === controller) {
              activeSearchController = null
            }
            if (token === searchWarmSeq) {
              searchWarming.value = false
            }
          }
        })()
      }, SEARCH_DEBOUNCE_MS)
    },
  )

  async function locateSessionInSidebar(
    sessionId: string,
    opts2?: { hintDirectoryId?: string; hintDirectoryPath?: string; clearSearch?: boolean },
  ) {
    const sid = (sessionId || '').trim()
    if (!sid) return false
    if (opts.directories.value.length === 0) return false

    if (opts2?.clearSearch !== false) {
      // Locating should show the session in the real list, not a filtered view.
      opts.sidebarQuery.value = ''
    }

    const resolved = await opts.resolveDirectoryForSession(sid, {
      directoryId: opts2?.hintDirectoryId,
      directoryPath: opts2?.hintDirectoryPath,
    })
    if (!resolved) return false

    const focusId = resolved.directoryId
    const focusPath = resolved.directoryPath

    // Jump to the directory page that contains the focused entry.
    const projIndex = opts.directories.value.findIndex((p) => p.id === focusId)
    if (projIndex >= 0) {
      opts.directoryPage.value = Math.floor(projIndex / opts.directoriesPageSize)
    }

    // Ensure the directory entry is expanded.
    if (opts.collapsedDirectoryIds.value.has(focusId)) {
      const next = new Set(opts.collapsedDirectoryIds.value)
      next.delete(focusId)
      opts.collapsedDirectoryIds.value = next
    }

    await opts.ensureDirectoryAggregateLoaded(focusId, focusPath, { focusSessionId: sid })
    await nextTick()

    const isPinned = opts.pinnedSessionIds.value.includes(sid)
    if (!isPinned) {
      const tree = opts.flattenedByDirectoryId.value[focusId]
      if (tree) {
        const row = (tree.rows || []).find((r) => r?.id === sid) || null
        if (row) {
          opts.ensureAncestorsExpanded(tree.parentById, sid)
        }
      }
    }

    await nextTick()
    await nextTick()
    const el = sessionElById.get(sid)
    if (el) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        // ignore
      }
    }
    flashLocated(sid)
    return true
  }

  async function locateFromSearch(hit: SessionSearchHit) {
    const sid = hit?.session?.id
    if (!sid) return
    // Search hit is user intent; locate should show the canonical list position.
    await locateSessionInSidebar(String(sid), {
      hintDirectoryId: hit.directory.id,
      hintDirectoryPath: hit.directory.path,
      clearSearch: true,
    })
  }

  const lastHandledLocateSeq = ref(0)
  watch(
    () => [opts.ui.sidebarLocateSeq, opts.ui.sidebarLocateSessionId, opts.directories.value.length] as const,
    async ([seq, sid]) => {
      if (!seq) return
      if (seq === lastHandledLocateSeq.value) return
      if (!sid || !sid.trim()) {
        lastHandledLocateSeq.value = seq
        opts.ui.clearSidebarLocateRequest()
        return
      }
      if (opts.directories.value.length === 0) return

      await locateSessionInSidebar(sid, { clearSearch: true })
      lastHandledLocateSeq.value = seq
      opts.ui.clearSidebarLocateRequest()
    },
    { immediate: true },
  )

  return {
    locatedSessionId,
    locateFromSearch,
    locateSessionInSidebar,
    searchWarming,
    sessionSearchHits,
    setSessionEl,
  }
}
