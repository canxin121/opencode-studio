import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '@/i18n'

import * as chatApi from '@/stores/chat/api'
import { apiJson } from '@/lib/api'
import { buildFlattenedTree } from '@/features/sessions/model/tree'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import type { SseEvent } from '@/lib/sse'
import { postAppBroadcast } from '@/lib/appBroadcast'
import { resolveSidebarSeqAfterBootstrap } from '@/stores/directorySessionSeq'
import {
  mergeRuntimeState,
  normalizeRuntime,
  runtimeIsActive,
  runtimeStateEquivalent,
  type SessionRuntimeState,
} from '@/stores/directorySessionRuntime'
import { isUiPrefsConflictError, readUiPrefsConflictCurrent } from '@/stores/uiPrefsConflict'
import { rebaseUiPrefsDeltaOntoRemote } from '@/stores/uiPrefsRebase'
import {
  clearDirectorySessionSnapshot,
  saveDirectorySessionSnapshot,
  type DirectorySessionSnapshot,
  type SessionRuntimeSnapshot,
  type SessionSummarySnapshot,
} from '@/data/directorySessionSnapshotDb'
import {
  defaultChatSidebarUiPrefs,
  loadChatSidebarUiPrefs,
  patchChatSidebarUiPrefs,
  saveChatSidebarUiPrefs,
  type ChatSidebarUiPrefs,
} from '@/data/chatSidebarUiPrefs'

import {
  RECENT_INDEX_MAX_ITEMS,
  type ChatSidebarStateWire,
  type DirectorySessionPageState,
  type DirectorySessionTreeHint,
  type RecentIndexWireItem,
  type RecentIndexEntry,
  type RunningIndexWireItem,
  type RunningIndexEntry,
  type SessionPayloadConsistency,
  normalizeRecentIndexItem,
  normalizeRunningIndexItem,
  parseSessionPagePayload,
} from '@/stores/directorySessions/index'
import {
  removeSessionFromPageState,
  upsertRuntimeOnlyRunningIndexEntry,
  upsertSessionInPageState,
} from '@/stores/directorySessions/pageState'
import { applyRootTotalDelta, computeRootTotalDeltas } from '@/stores/directorySessions/rootTotals'
import { matchDirectoryEntryForPath } from '@/stores/directorySessions/pathMatch'
import { readParentId, readUpdatedAt } from '@/stores/directorySessions/runtime'
import type { JsonObject as UnknownRecord, JsonValue } from '@/types/json'
import {
  compareUiPrefsRecency,
  type ChatSidebarPatchOp,
  normalizeUiPrefs,
  parseChatSidebarPatchOps,
  parseChatSidebarPreferencesPatchOps,
  uiPrefsBodyEquals,
} from '@/stores/directorySessions/prefs'
import {
  parseSidebarPatchRefreshHint,
  resolveSidebarPatchPlan,
  type SidebarPatchRefreshHint,
} from '@/stores/directorySessions/sidebarPatchPlanner'
import { createStringRefreshQueue } from '@/stores/directorySessions/sidebarRefreshQueue'
import {
  SIDEBAR_STATE_ENDPOINT,
  SNAPSHOT_SAVE_DEBOUNCE_MS,
  UI_PREFS_ENDPOINT,
  UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS,
  jsonLikeDeepEqual,
} from '@/stores/directorySessions/persistence'

type SidebarSessionRow = {
  id: string
  session: SessionSummarySnapshot | null
  directory: DirectoryEntry | null
  renderKey: string
  depth: number
  parentId: string | null
  rootId: string
  isParent: boolean
  isExpanded: boolean
}

type DirectorySidebarView = {
  sessionCount: number
  rootPage: number
  rootPageCount: number
  hasActiveOrBlocked: boolean
  pinnedRows: SidebarSessionRow[]
  recentRows: SidebarSessionRow[]
  recentParentById: Record<string, string | null>
  recentRootIds: string[]
}

type SidebarFooterView = {
  total: number
  page: number
  pageCount: number
  rows: SidebarSessionRow[]
}

type SidebarFocusedSession = {
  sessionId: string
  directoryId: string
  directoryPath: string
}

function asRecord(value: JsonValue): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function readObjectId(value: JsonValue): string {
  const raw = asRecord(value)?.id
  return typeof raw === 'string' ? raw.trim() : ''
}

function readSessionDirectory(value: JsonValue): string {
  const raw = asRecord(value)?.directory
  return typeof raw === 'string' ? raw.trim() : ''
}

function readSessionTimeRecord(value: JsonValue): UnknownRecord | null {
  return asRecord(asRecord(value)?.time)
}

function toSessionSummarySnapshot(value: JsonValue): SessionSummarySnapshot | null {
  const record = asRecord(value)
  const id = typeof record?.id === 'string' ? record.id.trim() : ''
  if (!record || !id) return null
  return { ...record, id }
}

function toRuntimeSnapshot(value: JsonValue): SessionRuntimeSnapshot {
  const runtime = asRecord(value)
  const attention = runtime?.attention
  return {
    statusType: typeof runtime?.statusType === 'string' ? runtime.statusType : undefined,
    phase: typeof runtime?.phase === 'string' ? runtime.phase : undefined,
    attention: attention === 'permission' || attention === 'question' || attention === null ? attention : undefined,
    displayState: typeof runtime?.displayState === 'string' ? runtime.displayState : undefined,
    updatedAt:
      typeof runtime?.updatedAt === 'number' && Number.isFinite(runtime.updatedAt) ? runtime.updatedAt : undefined,
  }
}

function isDegradedConsistency(consistency: SessionPayloadConsistency | undefined): boolean {
  return consistency?.degraded === true
}

function readEventType(evt: SseEvent): string {
  return typeof evt.type === 'string' ? evt.type.trim() : ''
}

function readEventProperties(evt: SseEvent): UnknownRecord {
  return asRecord(evt.properties) || {}
}

function readEventOps(evt: SseEvent): JsonValue[] {
  const props = readEventProperties(evt)
  if (Array.isArray(props.ops)) return props.ops
  const eventRecord = asRecord(evt)
  return Array.isArray(eventRecord?.ops) ? eventRecord.ops : []
}

function readEventPatchRefreshHint(evt: SseEvent): SidebarPatchRefreshHint | null {
  const props = readEventProperties(evt)
  const fromProps = parseSidebarPatchRefreshHint(props.hints as JsonValue)
  if (fromProps) return fromProps
  const eventRecord = asRecord(evt)
  return parseSidebarPatchRefreshHint((eventRecord?.hints as JsonValue) || undefined)
}

export const useDirectorySessionStore = defineStore('directorySession', () => {
  const directoriesById = ref<Record<string, DirectoryEntry>>({})
  const directoryOrder = ref<string[]>([])
  const sessionSummariesById = ref<Record<string, SessionSummarySnapshot>>({})
  const directoryIdBySessionId = ref<Record<string, string>>({})
  const rootsByDirectoryId = ref<Record<string, string[]>>({})
  const childrenByParentSessionId = ref<Record<string, string[]>>({})
  const runtimeBySessionId = ref<Record<string, SessionRuntimeState>>({})
  const sessionPageByDirectoryId = ref<Record<string, DirectorySessionPageState>>({})
  // Keep pinned lists as id arrays; session objects live in `sessionSummariesById`.
  // This avoids duplicated session objects across multiple caches.
  const pinnedSessionIdsByDirectoryId = ref<Record<string, string[]>>({})
  const worktreePathsByDirectoryId = ref<Record<string, string[]>>({})
  const recentIndex = ref<RecentIndexEntry[]>([])
  const recentIndexTotal = ref(0)
  const runningIndex = ref<RunningIndexEntry[]>([])
  const runningIndexTotal = ref(0)
  const directorySidebarById = ref<Record<string, DirectorySidebarView>>({})
  const pinnedFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const recentFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const runningFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const sidebarStateFocus = ref<SidebarFocusedSession | null>(null)
  const directoryPageRows = ref<DirectoryEntry[]>([])
  const directoryPageTotal = ref(0)
  const uiPrefs = ref<ChatSidebarUiPrefs>(loadChatSidebarUiPrefs())

  const loading = ref(false)
  const error = ref<string | null>(null)

  let snapshotPersistTimer: number | null = null
  let uiPrefsRemotePersistTimer: number | null = null
  let uiPrefsRemotePersistInFlight = false
  let uiPrefsRemotePersistQueued = false
  let uiPrefsLocalRevision = 0
  let uiPrefsAckedRevision = 0
  let uiPrefsAckedBaseline = normalizeUiPrefs(uiPrefs.value)

  function clearUiPrefsRemotePersistDebounce() {
    if (uiPrefsRemotePersistTimer !== null) {
      window.clearTimeout(uiPrefsRemotePersistTimer)
      uiPrefsRemotePersistTimer = null
    }
    uiPrefsRemotePersistQueued = false
  }

  function setUiPrefsBaseline(next: ChatSidebarUiPrefs) {
    uiPrefsAckedBaseline = normalizeUiPrefs(next)
  }

  function markUiPrefsConverged(next: ChatSidebarUiPrefs) {
    setUiPrefsBaseline(next)
    // When we observe the server already contains our local body, stop pending writes.
    clearUiPrefsRemotePersistDebounce()
  }

  // Note: delta rebase lives in uiPrefsRebase.ts for unit testing.

  const SSE_SEQ_GAP_THROTTLE_MS = 1500
  const SIDEBAR_PATCH_REFRESH_THROTTLE_MS = 120
  const SIDEBAR_PATCH_REFRESH_QUEUE_MAX = 64
  const SIDEBAR_PATCH_REFRESH_ALL_KEY = '__all__'
  const SIDEBAR_FOOTER_REFRESH_THROTTLE_MS = 180
  let lastSidebarPatchSeq = 0
  let lastSidebarPatchGapAt = 0
  let sidebarPatchOutOfSync = false
  let sidebarPatchSawSeqReset = false
  let sidebarPatchResyncInFlight = false
  let lastUiPrefsPatchSeq = 0
  let lastUiPrefsPatchGapAt = 0
  let uiPrefsPatchOutOfSync = false
  let uiPrefsPatchResyncInFlight = false
  const sidebarPatchRefreshQueue = createStringRefreshQueue({
    maxItems: SIDEBAR_PATCH_REFRESH_QUEUE_MAX,
  })
  let sidebarPatchRefreshTimer: number | null = null
  let sidebarPatchRefreshInFlight = false
  let sidebarFooterRefreshTimer: number | null = null
  let sidebarFooterRefreshInFlight = false
  let sidebarFooterRefreshPendingRecent = false
  let sidebarFooterRefreshPendingRunning = false

  function parseSseSeq(evt: SseEvent): number | null {
    const props = readEventProperties(evt)
    const rawSeq = Number(props.seq)
    if (Number.isFinite(rawSeq) && rawSeq > 0) {
      return Math.max(1, Math.floor(rawSeq))
    }

    const rootSeq = Number(asRecord(evt)?.seq)
    if (Number.isFinite(rootSeq) && rootSeq > 0) {
      return Math.max(1, Math.floor(rootSeq))
    }

    const rawId = asRecord(evt)?.lastEventId
    const id = typeof rawId === 'string' ? rawId.trim() : ''
    if (!id) return null
    const parsed = Number.parseInt(id, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.max(1, Math.floor(parsed))
  }

  function getSidebarPatchCursor(): string {
    return lastSidebarPatchSeq > 0 ? String(lastSidebarPatchSeq) : ''
  }

  const visibleDirectories = computed<DirectoryEntry[]>(() => {
    return directoryOrder.value
      .map((id) => directoriesById.value[id])
      .filter((entry): entry is DirectoryEntry => Boolean(entry))
  })

  const sessionSummariesByDirectoryId = computed(() => {
    const out: Record<string, SessionSummarySnapshot[]> = {}
    for (const [sessionId, session] of Object.entries(sessionSummariesById.value)) {
      const directoryId = directoryIdBySessionId.value[sessionId]
      if (!directoryId) continue
      if (!out[directoryId]) out[directoryId] = []
      out[directoryId].push(session)
    }
    for (const list of Object.values(out)) {
      list.sort((a, b) => readUpdatedAt(b) - readUpdatedAt(a))
    }
    return out
  })

  const allSessionIndexById = computed(() => {
    const out: Record<string, { session: SessionSummarySnapshot; directory: DirectoryEntry | null }> = {}
    for (const [directoryId, list] of Object.entries(sessionSummariesByDirectoryId.value)) {
      const directory = directoriesById.value[directoryId] || null
      for (const session of list) {
        const sid = readObjectId(session)
        if (!sid || out[sid]) continue
        out[sid] = { session, directory }
      }
    }

    for (const [directoryId, ids] of Object.entries(pinnedSessionIdsByDirectoryId.value)) {
      const directory = directoriesById.value[directoryId] || null
      for (const rawId of ids || []) {
        const sid = String(rawId || '').trim()
        if (!sid || out[sid]) continue
        const session = sessionSummariesById.value[sid]
        if (!session) continue
        out[sid] = { session, directory }
      }
    }

    return out
  })

  function scheduleSnapshotPersist() {
    if (snapshotPersistTimer !== null) return
    snapshotPersistTimer = window.setTimeout(() => {
      snapshotPersistTimer = null
      void persistSnapshot()
    }, SNAPSHOT_SAVE_DEBOUNCE_MS)
  }

  async function persistSnapshot() {
    const snapshot: DirectorySessionSnapshot = {
      schemaVersion: 1,
      savedAt: Date.now(),
      directoryEntries: visibleDirectories.value,
      sessionSummaries: Object.values(sessionSummariesById.value),
      runtimeBySessionId: runtimeBySessionId.value,
      rootsByDirectoryId: rootsByDirectoryId.value,
      childrenByParentSessionId: childrenByParentSessionId.value,
    }
    await saveDirectorySessionSnapshot(snapshot)
  }

  function hasUnsyncedUiPrefsChanges(): boolean {
    return uiPrefsLocalRevision !== uiPrefsAckedRevision
  }

  function applyIncomingUiPrefs(
    incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined,
    opts?: { allowWhenLocalDirty?: boolean },
  ): boolean {
    const incoming = normalizeUiPrefs(incomingRaw)
    const current = normalizeUiPrefs(uiPrefs.value)

    // Monotonic guard: never apply older remote versions.
    if (compareUiPrefsRecency(incoming, current) < 0) {
      return false
    }

    const localDirty = hasUnsyncedUiPrefsChanges()
    if (localDirty && !opts?.allowWhenLocalDirty) {
      // We have local optimistic edits that are not acked by the server yet.
      // Do NOT reject the remote update; instead, merge our local delta (relative
      // to the last acked baseline) on top of the newer remote, then re-PUT.
      const base = uiPrefsAckedBaseline

      // If there is no local delta anymore (user toggled back), we can adopt remote
      // and clear the dirty bit to prevent pointless write loops.
      if (uiPrefsBodyEquals(base, current)) {
        uiPrefs.value = incoming
        uiPrefsAckedRevision = uiPrefsLocalRevision
        markUiPrefsConverged(incoming)
        persistUiPrefs({ remote: false })
        return true
      }

      // If remote already matches our local body, consider it acked (perhaps from another tab).
      if (uiPrefsBodyEquals(current, incoming)) {
        uiPrefs.value = incoming
        uiPrefsAckedRevision = uiPrefsLocalRevision
        markUiPrefsConverged(incoming)
        persistUiPrefs({ remote: false })
        return true
      }

      uiPrefs.value = rebaseUiPrefsDeltaOntoRemote({ base, local: current, remote: incoming })
      // Local body is now based on the newest remote.
      setUiPrefsBaseline(incoming)
      persistUiPrefs({ remote: false })
      // Ensure we converge: re-PUT our local delta on top of the newest remote.
      scheduleUiPrefsRemotePersist()
      return true
    }

    uiPrefs.value = incoming
    setUiPrefsBaseline(incoming)
    if (!hasUnsyncedUiPrefsChanges()) markUiPrefsConverged(incoming)
    persistUiPrefs({ remote: false })
    return true
  }

  function applyIncomingUiPrefsMetadata(incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined): boolean {
    const incoming = normalizeUiPrefs(incomingRaw)
    if (compareUiPrefsRecency(incoming, uiPrefs.value) <= 0) {
      return false
    }
    uiPrefs.value = normalizeUiPrefs({
      ...uiPrefs.value,
      version: incoming.version,
      updatedAt: incoming.updatedAt,
    })
    // Do not update the acked baseline: metadata-only updates do not represent
    // an authoritative body convergence.
    persistUiPrefs({ remote: false })
    return true
  }

  function adoptAuthoritativeUiPrefs(incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined) {
    const incoming = normalizeUiPrefs(incomingRaw)
    uiPrefs.value = incoming
    uiPrefsLocalRevision = 0
    uiPrefsAckedRevision = 0
    markUiPrefsConverged(incoming)
    persistUiPrefs({ remote: false })
  }

  function normalizePagedIndexTotal(rawTotal: number | undefined, fallback: number): number {
    if (typeof rawTotal === 'number' && Number.isFinite(rawTotal)) {
      return Math.max(0, Math.floor(rawTotal))
    }
    return Math.max(0, Math.floor(fallback))
  }

  function applyRecentIndexPageWire(pageRaw: JsonValue) {
    const page = asRecord(pageRaw)
    const list = Array.isArray(page?.items) ? page.items : []
    const normalized = list
      .map((item) => normalizeRecentIndexItem(item as RecentIndexWireItem))
      .filter((item): item is RecentIndexEntry => Boolean(item))

    normalized.sort((a, b) => {
      const diff = b.updatedAt - a.updatedAt
      if (diff !== 0) return diff
      return a.sessionId.localeCompare(b.sessionId)
    })

    recentIndex.value = normalized.slice(0, RECENT_INDEX_MAX_ITEMS)
    recentIndexTotal.value = Math.min(
      RECENT_INDEX_MAX_ITEMS,
      Math.max(
        normalizePagedIndexTotal(page?.total as number | undefined, recentIndex.value.length),
        recentIndex.value.length,
      ),
    )
  }

  function applyRunningIndexPageWire(pageRaw: JsonValue) {
    const page = asRecord(pageRaw)
    const list = Array.isArray(page?.items) ? page.items : []
    const normalized = list
      .map((item) => normalizeRunningIndexItem(item as RunningIndexWireItem))
      .filter((item): item is RunningIndexEntry => Boolean(item))

    normalized.sort((a, b) => {
      const diff = b.updatedAt - a.updatedAt
      if (diff !== 0) return diff
      return a.sessionId.localeCompare(b.sessionId)
    })

    runningIndex.value = normalized
    runningIndexTotal.value = Math.max(
      normalizePagedIndexTotal(page?.total as number | undefined, normalized.length),
      normalized.length,
    )

    const nextRuntime = { ...runtimeBySessionId.value }
    for (const item of normalized) {
      nextRuntime[item.sessionId] = mergeRuntimeState(nextRuntime[item.sessionId], item.runtime)
    }
    runtimeBySessionId.value = nextRuntime
  }

  function scheduleUiPrefsRemotePersist() {
    if (uiPrefsRemotePersistTimer !== null) return
    uiPrefsRemotePersistTimer = window.setTimeout(() => {
      uiPrefsRemotePersistTimer = null
      void persistUiPrefsToApi()
    }, UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS)
  }

  async function persistUiPrefsToApi() {
    if (uiPrefsRemotePersistInFlight) {
      uiPrefsRemotePersistQueued = true
      return
    }

    uiPrefsRemotePersistInFlight = true
    const requestRevision = uiPrefsLocalRevision
    const payload = normalizeUiPrefs(uiPrefs.value)
    try {
      const persisted = await apiJson<ChatSidebarUiPrefs>(UI_PREFS_ENDPOINT, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'if-match': String(Math.max(0, Math.floor(payload.version || 0))),
        },
        body: JSON.stringify(payload),
      })
      // Server accepted a write (for some local revision); advance the baseline so future
      // merges only re-apply the delta since this persisted state.
      setUiPrefsBaseline(normalizeUiPrefs(persisted))
      uiPrefsAckedRevision = Math.max(uiPrefsAckedRevision, requestRevision)
      if (requestRevision === uiPrefsLocalRevision) {
        if (!applyIncomingUiPrefs(persisted, { allowWhenLocalDirty: true })) {
          applyIncomingUiPrefsMetadata(persisted)
        }
      } else {
        applyIncomingUiPrefsMetadata(persisted)
      }
    } catch (err) {
      const remoteCurrent = readUiPrefsConflictCurrent(err)
      if (isUiPrefsConflictError(err)) {
        if (remoteCurrent) {
          const remote = normalizeUiPrefs(remoteCurrent)
          const local = normalizeUiPrefs(uiPrefs.value)
          const base = uiPrefsAckedBaseline
          const hasLocalDelta = !uiPrefsBodyEquals(local, remote)

          if (hasLocalDelta) {
            uiPrefs.value = rebaseUiPrefsDeltaOntoRemote({ base, local, remote })
            // Local body is now based on the newest remote.
            setUiPrefsBaseline(remote)
            persistUiPrefs({ remote: false })
            uiPrefsRemotePersistQueued = true
          } else {
            uiPrefs.value = remote
            uiPrefsAckedRevision = Math.max(uiPrefsAckedRevision, requestRevision, uiPrefsLocalRevision)
            if (!hasUnsyncedUiPrefsChanges()) {
              markUiPrefsConverged(remote)
            } else {
              setUiPrefsBaseline(remote)
            }
            persistUiPrefs({ remote: false })
          }
        } else {
          void revalidateUiPrefsFromApi().then((ok) => {
            if (!ok || hasUnsyncedUiPrefsChanges()) {
              uiPrefsRemotePersistQueued = true
              scheduleUiPrefsRemotePersist()
            }
          })
          uiPrefsRemotePersistQueued = true
        }
      } else {
        // Keep local preferences and retry so local optimistic updates eventually converge.
        uiPrefsRemotePersistQueued = true
      }
    } finally {
      uiPrefsRemotePersistInFlight = false
      if (uiPrefsRemotePersistQueued) {
        uiPrefsRemotePersistQueued = false
        scheduleUiPrefsRemotePersist()
      }
    }
  }

  function persistUiPrefs(opts?: { remote?: boolean }) {
    saveChatSidebarUiPrefs(uiPrefs.value)
    if (opts?.remote !== false) {
      scheduleUiPrefsRemotePersist()
    }
  }

  function patchUiPrefs(patch: Partial<ChatSidebarUiPrefs>) {
    const nextBody = normalizeUiPrefs(patchChatSidebarUiPrefs(uiPrefs.value, patch))
    if (uiPrefsBodyEquals(nextBody, uiPrefs.value)) {
      return
    }
    uiPrefsLocalRevision += 1
    uiPrefs.value = normalizeUiPrefs({
      ...nextBody,
      updatedAt: Date.now(),
    })
    persistUiPrefs()
    // Local tab -> other tabs. SSE covers cross-device; BroadcastChannel covers same-browser tabs.
    postAppBroadcast('chatSidebarUiPrefs.updated', { updatedAt: Date.now() })
  }

  async function revalidateUiPrefsFromApi(): Promise<boolean> {
    try {
      const remote = await apiJson<ChatSidebarUiPrefs>(UI_PREFS_ENDPOINT)
      if (!applyIncomingUiPrefs(remote)) {
        applyIncomingUiPrefsMetadata(remote)
      }
      if (uiPrefsPatchOutOfSync) {
        uiPrefsPatchOutOfSync = false
        // Reset stream baseline; GET /preferences has no seq watermark.
        lastUiPrefsPatchSeq = 0
      }
      return true
    } catch {
      // Keep local UI prefs when backend sync is unavailable.
      return false
    }
  }

  async function resyncUiPrefsPatchStream() {
    if (uiPrefsPatchResyncInFlight) return
    uiPrefsPatchResyncInFlight = true
    try {
      const ok = await revalidateUiPrefsFromApi()
      if (ok) {
        uiPrefsPatchOutOfSync = false
        stopUiPrefsPatchRetry()
      }
    } finally {
      uiPrefsPatchResyncInFlight = false
    }
  }

  function requestUiPrefsPatchResync(now: number) {
    if (now - lastUiPrefsPatchGapAt < SSE_SEQ_GAP_THROTTLE_MS) return
    lastUiPrefsPatchGapAt = now
    void resyncUiPrefsPatchStream().catch(() => {})
    scheduleUiPrefsPatchRetry()
  }

  function applyChatSidebarPreferencesEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar-preferences.patch') return

    const seq = parseSseSeq(evt)
    if (uiPrefsPatchOutOfSync) {
      requestUiPrefsPatchResync(Date.now())
      return
    }

    if (seq !== null) {
      if (lastUiPrefsPatchSeq > 0 && seq === lastUiPrefsPatchSeq) {
        return
      }

      const expected = lastUiPrefsPatchSeq > 0 ? lastUiPrefsPatchSeq + 1 : null
      const reset = lastUiPrefsPatchSeq > 0 && seq < lastUiPrefsPatchSeq
      const gap = expected !== null && seq !== expected
      if (reset || gap) {
        uiPrefsPatchOutOfSync = true
        requestUiPrefsPatchResync(Date.now())
        scheduleUiPrefsPatchRetry()
        return
      }
      lastUiPrefsPatchSeq = seq
    }

    const opsRaw = readEventOps(evt)
    const ops = parseChatSidebarPreferencesPatchOps(opsRaw)
    if (ops.length === 0) return

    let changed = false
    for (const op of ops) {
      const incoming = op.preferences
      const applied = applyIncomingUiPrefs(incoming)
      if (!applied) {
        applyIncomingUiPrefsMetadata(incoming)
      }
      changed = applied || changed
    }

    if (!changed) return
  }

  function directoryEntryByPath(path: string): DirectoryEntry | null {
    return matchDirectoryEntryForPath(visibleDirectories.value, path)
  }

  function toDirectoryEntry(value: JsonValue | null | undefined): DirectoryEntry | null {
    const record = asRecord((value as JsonValue) || undefined)
    if (!record) return null
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    if (!id || !path) return null
    const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : undefined
    return { id, path, ...(label ? { label } : {}) }
  }

  function normalizeSidebarSessionRow(raw: JsonValue): SidebarSessionRow | null {
    const record = asRecord(raw)
    if (!record) return null
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id) return null

    const wireSession = toSessionSummarySnapshot(record.session as JsonValue)
    const session = wireSession || sessionSummariesById.value[id] || null
    const wireDirectory = toDirectoryEntry(record.directory as JsonValue)
    const sessionDirectory = readSessionDirectory(session)
    const directory =
      wireDirectory ||
      (sessionDirectory ? directoryEntryByPath(sessionDirectory) : null) ||
      (sessionDirectory
        ? (() => {
            const did = directoryIdForPath(sessionDirectory)
            return did ? directoriesById.value[did] || null : null
          })()
        : null)

    const depthRaw = Number(record.depth)
    const depth = Number.isFinite(depthRaw) ? Math.max(0, Math.floor(depthRaw)) : 0
    const renderKey = typeof record.renderKey === 'string' && record.renderKey.trim() ? record.renderKey.trim() : id
    const parentId = typeof record.parentId === 'string' && record.parentId.trim() ? record.parentId.trim() : null
    const rootId = typeof record.rootId === 'string' && record.rootId.trim() ? record.rootId.trim() : id

    return {
      id,
      session,
      directory,
      renderKey,
      depth,
      parentId,
      rootId,
      isParent: record.isParent === true,
      isExpanded: record.isExpanded === true,
    }
  }

  function normalizeSidebarFooterView(raw: JsonValue | null | undefined): SidebarFooterView {
    const record = asRecord((raw as JsonValue) || undefined)
    const rowsRaw = Array.isArray(record?.rows) ? record.rows : []
    const rows: SidebarSessionRow[] = []
    for (const item of rowsRaw) {
      const row = normalizeSidebarSessionRow(item)
      if (row) rows.push(row)
    }
    const totalRaw = Number(record?.total)
    const pageRaw = Number(record?.page)
    const pageCountRaw = Number(record?.pageCount)
    const total = Number.isFinite(totalRaw) ? Math.max(0, Math.floor(totalRaw)) : rows.length
    const pageCount = Number.isFinite(pageCountRaw) ? Math.max(1, Math.floor(pageCountRaw)) : 1
    const page = Number.isFinite(pageRaw) ? Math.max(0, Math.min(pageCount - 1, Math.floor(pageRaw))) : 0
    return {
      total,
      page,
      pageCount,
      rows,
    }
  }

  function normalizeDirectorySidebarSection(raw: JsonValue, directoryId: string): DirectorySidebarView | null {
    const section = asRecord(raw)
    if (!section) return null
    const did = String(directoryId || '').trim()
    if (!did) return null

    const pinnedRowsRaw = Array.isArray(section.pinnedRows) ? section.pinnedRows : []
    const recentRowsRaw = Array.isArray(section.recentRows) ? section.recentRows : []

    const pinnedRows: SidebarSessionRow[] = []
    for (const item of pinnedRowsRaw) {
      const row = normalizeSidebarSessionRow(item)
      if (row) pinnedRows.push(row)
    }
    const recentRows: SidebarSessionRow[] = []
    for (const item of recentRowsRaw) {
      const row = normalizeSidebarSessionRow(item)
      if (row) recentRows.push(row)
    }

    const sessionCountRaw = Number(section.sessionCount)
    const rootPageRaw = Number(section.rootPage)
    const rootPageCountRaw = Number(section.rootPageCount)
    const sessionCount = Number.isFinite(sessionCountRaw) ? Math.max(0, Math.floor(sessionCountRaw)) : recentRows.length
    const rootPageCount = Number.isFinite(rootPageCountRaw) ? Math.max(1, Math.floor(rootPageCountRaw)) : 1
    const rootPage = Number.isFinite(rootPageRaw)
      ? Math.max(0, Math.min(rootPageCount - 1, Math.floor(rootPageRaw)))
      : 0

    const recentParentByIdRaw = asRecord(section.recentParentById as JsonValue) || {}
    const recentParentById: Record<string, string | null> = {}
    for (const [sessionIdRaw, parentRaw] of Object.entries(recentParentByIdRaw)) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId) continue
      if (typeof parentRaw === 'string' && parentRaw.trim()) {
        recentParentById[sessionId] = parentRaw.trim()
        continue
      }
      recentParentById[sessionId] = null
    }

    const recentRootIds = Array.isArray(section.recentRootIds)
      ? section.recentRootIds.map((value) => String(value || '').trim()).filter(Boolean)
      : []

    return {
      sessionCount,
      rootPage,
      rootPageCount,
      hasActiveOrBlocked: section.hasActiveOrBlocked === true,
      pinnedRows,
      recentRows,
      recentParentById,
      recentRootIds,
    }
  }

  function applySidebarView(raw: JsonValue | null | undefined) {
    const view = asRecord((raw as JsonValue) || undefined)
    const directoryRowsById = asRecord(view?.directoryRowsById as JsonValue) || {}

    const nextDirectorySidebarById: Record<string, DirectorySidebarView> = {}
    for (const [directoryIdRaw, sectionRaw] of Object.entries(directoryRowsById)) {
      const directoryId = String(directoryIdRaw || '').trim()
      if (!directoryId) continue
      const normalized = normalizeDirectorySidebarSection(sectionRaw, directoryId)
      if (!normalized) continue
      nextDirectorySidebarById[directoryId] = normalized
    }

    directorySidebarById.value = nextDirectorySidebarById
    pinnedFooterView.value = normalizeSidebarFooterView(view?.pinnedFooter as JsonValue)
    recentFooterView.value = normalizeSidebarFooterView(view?.recentFooter as JsonValue)
    runningFooterView.value = normalizeSidebarFooterView(view?.runningFooter as JsonValue)
  }

  function upsertRecentIndexEntry(entry: RecentIndexEntry) {
    const sid = (entry.sessionId || '').trim()
    if (!sid) return
    const next = recentIndex.value.slice()
    const idx = next.findIndex((item) => item.sessionId === sid)
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...entry }
    } else {
      next.push(entry)
    }
    next.sort((a, b) => {
      const diff = b.updatedAt - a.updatedAt
      if (diff !== 0) return diff
      return a.sessionId.localeCompare(b.sessionId)
    })
    if (next.length > RECENT_INDEX_MAX_ITEMS) {
      next.length = RECENT_INDEX_MAX_ITEMS
    }
    recentIndex.value = next
    recentIndexTotal.value = Math.min(RECENT_INDEX_MAX_ITEMS, Math.max(recentIndexTotal.value, next.length))
  }

  function removeSessionFromFooterIndexes(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    const hadRecent = recentIndex.value.some((item) => item.sessionId === sid)
    if (hadRecent) {
      recentIndex.value = recentIndex.value.filter((item) => item.sessionId !== sid)
      recentIndexTotal.value = Math.max(0, recentIndexTotal.value - 1)
    }

    const hadRunning = runningIndex.value.some((item) => item.sessionId === sid)
    if (hadRunning) {
      runningIndex.value = runningIndex.value.filter((item) => item.sessionId !== sid)
      runningIndexTotal.value = Math.max(0, runningIndexTotal.value - 1)
    }
  }

  function syncRunningIndexFromRuntime(sessionId: string, runtime: SessionRuntimeState) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    const active = runtimeIsActive(runtime, { includeCooldown: true })
    const next = runningIndex.value.slice()
    const idx = next.findIndex((item) => item.sessionId === sid)

    if (!active) {
      if (idx >= 0) {
        next.splice(idx, 1)
        runningIndex.value = next
        runningIndexTotal.value = Math.max(0, runningIndexTotal.value - 1)
      }
      return
    }

    const summary = sessionSummariesById.value[sid]
    if (!summary) {
      const result = upsertRuntimeOnlyRunningIndexEntry(next, runningIndexTotal.value, {
        sessionId: sid,
        runtime,
        directoryIdHint: directoryIdBySessionId.value[sid] || null,
        nowMs: Date.now(),
      })
      runningIndex.value = result.entries
      runningIndexTotal.value = result.total
      return
    }

    const directoryId = (directoryIdBySessionId.value[sid] || '').trim() || null
    const directoryPath = readSessionDirectory(summary) || null
    const patch: RunningIndexEntry = {
      sessionId: sid,
      directoryId,
      directoryPath,
      runtime,
      updatedAt: Math.max(Date.now(), readUpdatedAt(summary)),
    }
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...patch,
      }
    } else {
      next.push(patch)
      runningIndexTotal.value = Math.max(runningIndexTotal.value, next.length)
    }
    next.sort((a, b) => {
      const diff = b.updatedAt - a.updatedAt
      if (diff !== 0) return diff
      return a.sessionId.localeCompare(b.sessionId)
    })
    runningIndex.value = next
  }

  function setDirectoryEntries(entries: DirectoryEntry[]) {
    const previousById = directoriesById.value
    const nextById: Record<string, DirectoryEntry> = {}
    const order: string[] = []
    for (const entry of entries) {
      const id = (entry?.id || '').trim()
      const path = (entry?.path || '').trim()
      if (!id || !path) continue

      const prev = previousById[id] || null
      const prevLabel = prev && typeof prev.label === 'string' ? prev.label : undefined
      const nextLabel = typeof entry.label === 'string' && entry.label.trim() ? entry.label : prevLabel

      nextById[id] = { ...(prev || {}), ...entry, id, path, label: nextLabel }
      order.push(id)
    }
    directoriesById.value = nextById
    directoryOrder.value = order
    scheduleSnapshotPersist()
  }

  // Out-of-sync protection:
  // - When the SSE patch stream has a gap/reset, we stop applying patches until a successful REST bootstrap.
  // - If that bootstrap fails (offline, transient server error), we must keep retrying in the background.
  let sidebarPatchRetryTimer: number | null = null
  let sidebarPatchRetryDelayMs = 0
  let uiPrefsPatchRetryTimer: number | null = null
  let uiPrefsPatchRetryDelayMs = 0

  function stopSidebarPatchRetry() {
    if (sidebarPatchRetryTimer !== null) {
      window.clearTimeout(sidebarPatchRetryTimer)
      sidebarPatchRetryTimer = null
    }
    sidebarPatchRetryDelayMs = 0
  }

  function stopUiPrefsPatchRetry() {
    if (uiPrefsPatchRetryTimer !== null) {
      window.clearTimeout(uiPrefsPatchRetryTimer)
      uiPrefsPatchRetryTimer = null
    }
    uiPrefsPatchRetryDelayMs = 0
  }

  function scheduleSidebarPatchRetry() {
    if (!sidebarPatchOutOfSync) {
      stopSidebarPatchRetry()
      return
    }
    if (sidebarPatchRetryTimer !== null) return

    const base = sidebarPatchRetryDelayMs > 0 ? Math.min(30000, Math.floor(sidebarPatchRetryDelayMs * 1.6)) : 2000
    const jitter = Math.floor(Math.random() * 600)
    const delay = Math.min(30000, base + jitter)
    sidebarPatchRetryDelayMs = delay

    sidebarPatchRetryTimer = window.setTimeout(() => {
      sidebarPatchRetryTimer = null
      if (!sidebarPatchOutOfSync) {
        stopSidebarPatchRetry()
        return
      }
      void resyncSidebarPatchStream()
        .catch(() => {})
        .finally(() => {
          scheduleSidebarPatchRetry()
        })
    }, delay)
  }

  function scheduleUiPrefsPatchRetry() {
    if (!uiPrefsPatchOutOfSync) {
      stopUiPrefsPatchRetry()
      return
    }
    if (uiPrefsPatchRetryTimer !== null) return

    const base = uiPrefsPatchRetryDelayMs > 0 ? Math.min(30000, Math.floor(uiPrefsPatchRetryDelayMs * 1.6)) : 2000
    const jitter = Math.floor(Math.random() * 600)
    const delay = Math.min(30000, base + jitter)
    uiPrefsPatchRetryDelayMs = delay

    uiPrefsPatchRetryTimer = window.setTimeout(() => {
      uiPrefsPatchRetryTimer = null
      if (!uiPrefsPatchOutOfSync) {
        stopUiPrefsPatchRetry()
        return
      }
      void resyncUiPrefsPatchStream()
        .catch(() => {})
        .finally(() => {
          scheduleUiPrefsPatchRetry()
        })
    }, delay)
  }

  function rebuildDirectoryTreeIndexesMany(directoryIds: Iterable<string>) {
    const unique = Array.from(
      new Set(
        Array.from(directoryIds)
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    )
    if (unique.length === 0) return

    const expanded = new Set(uiPrefs.value.expandedParentSessionIds)
    const byDirectory = sessionSummariesByDirectoryId.value

    const nextRoots = { ...rootsByDirectoryId.value }
    const nextChildren: Record<string, string[]> = {}

    for (const session of Object.values(sessionSummariesById.value)) {
      const sessionId = readObjectId(session)
      if (!sessionId) continue
      const parentId = readParentId(session)
      if (!parentId) continue
      if (!nextChildren[parentId]) nextChildren[parentId] = []
      nextChildren[parentId].push(sessionId)
    }

    for (const [parentId, list] of Object.entries(nextChildren)) {
      const deduped = Array.from(new Set(list))
      deduped.sort(
        (a, b) => readUpdatedAt(sessionSummariesById.value[b]) - readUpdatedAt(sessionSummariesById.value[a]),
      )
      nextChildren[parentId] = deduped
    }

    for (const directoryId of unique) {
      const pageIds = (sessionPageByDirectoryId.value[directoryId]?.sessions || [])
        .map((session) => readObjectId(session))
        .filter(Boolean)
      const pinnedIds = pinnedSessionIdsByDirectoryId.value[directoryId] || []

      const keepIds = new Set<string>()
      const list = [...pageIds, ...pinnedIds]
        .map((rawId) => String(rawId || '').trim())
        .filter((sid) => {
          if (!sid || keepIds.has(sid)) return false
          keepIds.add(sid)
          return true
        })
        .map((sid) => sessionSummariesById.value[sid])
        .filter((session): session is SessionSummarySnapshot => Boolean(session))

      if (list.length === 0 && byDirectory[directoryId]?.length) {
        nextRoots[directoryId] = buildFlattenedTree(byDirectory[directoryId], expanded).rootIds.slice()
        continue
      }
      const tree = buildFlattenedTree(list, expanded)
      nextRoots[directoryId] = (tree.rootIds || []).slice()
    }

    rootsByDirectoryId.value = nextRoots
    childrenByParentSessionId.value = nextChildren
    scheduleSnapshotPersist()
  }

  function rebuildDirectoryTreeIndexes(directoryId: string) {
    const dirId = (directoryId || '').trim()
    if (!dirId) return
    rebuildDirectoryTreeIndexesMany([dirId])
  }

  function upsertDirectorySessionSummaries(
    directoryId: string,
    sessions: SessionSummarySnapshot[],
    opts?: { treeHint?: DirectorySessionTreeHint },
  ) {
    const dirId = (directoryId || '').trim()
    if (!dirId) return

    const nextById = { ...sessionSummariesById.value }
    const nextDirectoryBySessionId = { ...directoryIdBySessionId.value }
    const keep = new Set<string>()

    for (const rawSession of sessions) {
      const sessionId = readObjectId(rawSession)
      if (!sessionId) continue
      keep.add(sessionId)
      nextById[sessionId] = rawSession
      const sessionDirectory = readSessionDirectory(rawSession)
      const mappedDirectoryId = directoryIdForPath(sessionDirectory)
      nextDirectoryBySessionId[sessionId] = mappedDirectoryId || dirId
    }

    for (const [sessionId, mappedDirectoryId] of Object.entries(nextDirectoryBySessionId)) {
      if (mappedDirectoryId !== dirId) continue
      if (keep.has(sessionId)) continue
      delete nextById[sessionId]
      delete nextDirectoryBySessionId[sessionId]
    }

    sessionSummariesById.value = nextById
    directoryIdBySessionId.value = nextDirectoryBySessionId

    const treeHint = opts?.treeHint
    if (treeHint) {
      rootsByDirectoryId.value = {
        ...rootsByDirectoryId.value,
        [dirId]: treeHint.rootSessionIds.slice(),
      }

      const nextChildren = { ...childrenByParentSessionId.value }
      const touchedParentIds = new Set<string>()
      const previousSessions = sessionPageByDirectoryId.value[dirId]?.sessions || []
      for (const session of previousSessions) {
        const parentId = readParentId(session)
        if (parentId) touchedParentIds.add(parentId)
      }
      for (const session of sessions) {
        const parentId = readParentId(session)
        if (parentId) touchedParentIds.add(parentId)
      }
      for (const parentId of Object.keys(treeHint.childrenByParentSessionId)) {
        touchedParentIds.add(parentId)
      }
      for (const parentId of touchedParentIds) {
        delete nextChildren[parentId]
      }
      for (const [parentId, childIds] of Object.entries(treeHint.childrenByParentSessionId)) {
        const pid = String(parentId || '').trim()
        if (!pid) continue
        const ids = childIds.map((id) => String(id || '').trim()).filter(Boolean)
        if (ids.length === 0) continue
        nextChildren[pid] = Array.from(new Set(ids))
      }
      childrenByParentSessionId.value = nextChildren
    } else {
      rebuildDirectoryTreeIndexes(dirId)
    }
    scheduleSnapshotPersist()
  }

  function upsertRuntime(sessionId: string, patch: Partial<SessionRuntimeState>) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const previous = runtimeBySessionId.value[sid]
    const nextRuntime = mergeRuntimeState(previous, patch)
    if (
      !previous &&
      nextRuntime.statusType === 'unknown' &&
      nextRuntime.phase === 'unknown' &&
      !nextRuntime.attention
    ) {
      return
    }
    if (previous && runtimeStateEquivalent(normalizeRuntime(previous), nextRuntime)) {
      return
    }
    runtimeBySessionId.value = {
      ...runtimeBySessionId.value,
      [sid]: nextRuntime,
    }
    syncRunningIndexFromRuntime(sid, nextRuntime)
    scheduleSnapshotPersist()
  }

  function directoryIdForPath(directoryPath: string): string | null {
    const normalized = normalizeDirForCompare(directoryPath)
    if (!normalized) return null
    const matched = visibleDirectories.value.find((entry) => normalizeDirForCompare(entry.path) === normalized)
    return matched ? matched.id : null
  }

  function upsertSessionSummaryPatch(sessionPatch: JsonValue, opts?: { trustAsNewRoot?: boolean }): boolean {
    const sid = readObjectId(sessionPatch)
    if (!sid) return false

    const incoming = asRecord(sessionPatch) || {}
    const previous = sessionSummariesById.value[sid] || null
    const previousUpdatedAt = readUpdatedAt(previous)
    const incomingUpdatedAt = readUpdatedAt(incoming)

    // Ignore stale full snapshots so older replayed events cannot reshuffle recent ordering.
    if (previous && previousUpdatedAt > 0 && incomingUpdatedAt > 0 && incomingUpdatedAt < previousUpdatedAt) {
      return false
    }

    const { time: incomingTimeRaw, ...incomingRest } = incoming
    const previousTime = readSessionTimeRecord(previous)
    const incomingTime = asRecord(incomingTimeRaw)

    const merged: SessionSummarySnapshot = {
      ...(previous || {}),
      ...incomingRest,
      id: sid,
    }

    if (previousTime || incomingTime) {
      const nextTime: UnknownRecord = {
        ...(previousTime || {}),
        ...(incomingTime || {}),
      }
      const mergedUpdatedAt = incomingUpdatedAt > 0 ? Math.max(previousUpdatedAt, incomingUpdatedAt) : previousUpdatedAt
      if (mergedUpdatedAt > 0) {
        nextTime.updated = mergedUpdatedAt
      }
      merged.time = nextTime
    }

    if (previous && jsonLikeDeepEqual(previous, merged)) {
      return false
    }

    sessionSummariesById.value = {
      ...sessionSummariesById.value,
      [sid]: merged,
    }

    const previousDirectoryId = String(directoryIdBySessionId.value[sid] || '').trim()
    let mappedDirectoryId = previousDirectoryId
    const patchDirectory = readSessionDirectory(merged)
    const byPath = patchDirectory ? directoryIdForPath(patchDirectory) : null
    if (byPath) mappedDirectoryId = byPath
    if (mappedDirectoryId) {
      directoryIdBySessionId.value = {
        ...directoryIdBySessionId.value,
        [sid]: mappedDirectoryId,
      }
    }

    const rootTotalDeltas = computeRootTotalDeltas({
      previousDirectoryId,
      nextDirectoryId: mappedDirectoryId,
      previousParentId: previous ? readParentId(previous) : null,
      nextParentId: readParentId(merged),
      hadPrevious: Boolean(previous),
      trustAsNewRoot: Boolean(opts?.trustAsNewRoot),
    })

    const nextPagesByDirectoryId = { ...sessionPageByDirectoryId.value }
    let pagesChanged = false
    const applyPagePatch = (directoryId: string, page: DirectorySessionPageState | null) => {
      const did = (directoryId || '').trim()
      if (!did || !page) return
      nextPagesByDirectoryId[did] = page
      pagesChanged = true
    }

    if (previousDirectoryId && previousDirectoryId !== mappedDirectoryId) {
      const prevPage = nextPagesByDirectoryId[previousDirectoryId]
      const patched = prevPage
        ? removeSessionFromPageState(prevPage, sid, {
            decrementRootTotal: false,
            readSessionId: readObjectId,
          })
        : null
      applyPagePatch(previousDirectoryId, patched)
    }

    if (mappedDirectoryId) {
      const currentPage = nextPagesByDirectoryId[mappedDirectoryId]
      const patched = currentPage
        ? upsertSessionInPageState(currentPage, merged, {
            incrementRootTotal: false,
            maxRootCount: 10,
            readSessionId: readObjectId,
            readParentId,
            equals: jsonLikeDeepEqual,
          })
        : null
      applyPagePatch(mappedDirectoryId, patched)
    }

    for (const [directoryId, deltaRaw] of Object.entries(rootTotalDeltas)) {
      const did = (directoryId || '').trim()
      if (!did) continue
      const page = nextPagesByDirectoryId[did]
      if (!page) continue
      const delta = Number(deltaRaw)
      if (!Number.isFinite(delta) || delta === 0) continue
      const nextTotalRoots = applyRootTotalDelta(page.totalRoots, delta)
      if (nextTotalRoots === page.totalRoots) continue
      nextPagesByDirectoryId[did] = {
        ...page,
        totalRoots: nextTotalRoots,
      }
      pagesChanged = true
    }

    if (pagesChanged) {
      sessionPageByDirectoryId.value = nextPagesByDirectoryId
    }

    const updatedAt = readUpdatedAt(merged)
    if (mappedDirectoryId) {
      upsertRecentIndexEntry({
        sessionId: sid,
        directoryId: mappedDirectoryId,
        directoryPath:
          String(directoriesById.value[mappedDirectoryId]?.path || patchDirectory || '').trim() || patchDirectory,
        updatedAt,
      })
    }
    const runningIdx = runningIndex.value.findIndex((item) => item.sessionId === sid)
    if (runningIdx >= 0) {
      const next = runningIndex.value.slice()
      const current = next[runningIdx]
      if (current) {
        next[runningIdx] = {
          ...current,
          directoryId: mappedDirectoryId || current.directoryId,
          directoryPath: patchDirectory || current.directoryPath,
          updatedAt: Math.max(current.updatedAt || 0, updatedAt),
        }
      }
      runningIndex.value = next
    }

    const touchedDirectoryIds = new Set<string>()
    if (previousDirectoryId) touchedDirectoryIds.add(previousDirectoryId)
    if (mappedDirectoryId) touchedDirectoryIds.add(mappedDirectoryId)
    if (touchedDirectoryIds.size > 0) {
      rebuildDirectoryTreeIndexesMany(touchedDirectoryIds)
    }
    scheduleSnapshotPersist()
    return true
  }

  function removeSessionFromSidebarState(
    sessionId: string,
    opts?: {
      preserveRuntime?: boolean
    },
  ) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    const touchedDirectoryIds = new Set<string>()

    const existingSummary = sessionSummariesById.value[sid] || null
    const sessionWasRoot = existingSummary ? !readParentId(existingSummary) : false

    const mappedDirectoryId = String(directoryIdBySessionId.value[sid] || '').trim()

    const nextPageByDirectoryId = { ...sessionPageByDirectoryId.value }
    const pageTargets = mappedDirectoryId ? [mappedDirectoryId] : Object.keys(nextPageByDirectoryId)
    for (const directoryId of pageTargets) {
      const page = nextPageByDirectoryId[directoryId]
      if (!page) continue
      const sessions = Array.isArray(page?.sessions) ? page.sessions : []
      const containsSession = sessions.some((session) => readObjectId(session) === sid)
      const decrementRootTotal = Boolean(sessionWasRoot && mappedDirectoryId && directoryId === mappedDirectoryId)
      if (!containsSession && !decrementRootTotal) continue

      const filtered = containsSession ? sessions.filter((session) => readObjectId(session) !== sid) : sessions
      const removedRootCount = containsSession
        ? sessions.filter((session) => {
            const id = readObjectId(session)
            return id === sid && !readParentId(session)
          }).length
        : 0
      const rootDelta = removedRootCount > 0 ? removedRootCount : decrementRootTotal ? 1 : 0
      const totalRoots =
        typeof page.totalRoots === 'number' && Number.isFinite(page.totalRoots)
          ? Math.max(0, page.totalRoots - rootDelta)
          : page.totalRoots

      nextPageByDirectoryId[directoryId] = {
        ...page,
        totalRoots: typeof totalRoots === 'number' ? totalRoots : 0,
        sessions: filtered,
      }
      touchedDirectoryIds.add(directoryId)
    }
    sessionPageByDirectoryId.value = nextPageByDirectoryId

    const nextPinnedByDirectoryId = { ...pinnedSessionIdsByDirectoryId.value }
    const pinnedTargets = mappedDirectoryId ? [mappedDirectoryId] : Object.keys(nextPinnedByDirectoryId)
    for (const directoryId of pinnedTargets) {
      const list = nextPinnedByDirectoryId[directoryId] || []
      if (!list.length) continue
      const filtered = list.filter((id) => String(id || '').trim() !== sid)
      if (filtered.length === list.length) continue
      nextPinnedByDirectoryId[directoryId] = filtered
      touchedDirectoryIds.add(directoryId)
    }
    pinnedSessionIdsByDirectoryId.value = nextPinnedByDirectoryId

    if (mappedDirectoryId) touchedDirectoryIds.add(mappedDirectoryId)

    const nextSummaries = { ...sessionSummariesById.value }
    delete nextSummaries[sid]
    sessionSummariesById.value = nextSummaries

    const nextDirectoryIdBySessionId = { ...directoryIdBySessionId.value }
    delete nextDirectoryIdBySessionId[sid]
    directoryIdBySessionId.value = nextDirectoryIdBySessionId

    if (!opts?.preserveRuntime) {
      const nextRuntime = { ...runtimeBySessionId.value }
      delete nextRuntime[sid]
      runtimeBySessionId.value = nextRuntime
    }

    removeSessionFromFooterIndexes(sid)

    if (touchedDirectoryIds.size > 0) {
      rebuildDirectoryTreeIndexesMany(touchedDirectoryIds)
    }
    scheduleSnapshotPersist()
  }

  function sessionRootPageCount(directoryId: string, pageSize: number): number {
    const did = (directoryId || '').trim()
    if (!did || pageSize <= 0) return 1
    const total = sessionPageByDirectoryId.value[did]?.totalRoots
    const fallback = rootsByDirectoryId.value[did]?.length || 0
    const value = typeof total === 'number' && Number.isFinite(total) ? total : fallback
    return Math.max(1, Math.ceil(Math.max(0, value) / pageSize))
  }

  function setSessionRootPage(directoryId: string, page: number, pageSize: number): number {
    const did = (directoryId || '').trim()
    if (!did) return 0
    const max = Math.max(0, sessionRootPageCount(did, pageSize) - 1)
    const next = Math.max(0, Math.min(max, Math.floor(page || 0)))
    patchUiPrefs({
      sessionRootPageByDirectoryId: {
        ...uiPrefs.value.sessionRootPageByDirectoryId,
        [did]: next,
      },
    })
    return next
  }

  async function resolveDirectoryForSession(
    sessionId: string,
    hint?: { directoryId?: string; directoryPath?: string; locateResult?: JsonValue; skipRemote?: boolean },
  ): Promise<{ directoryId: string; directoryPath: string; locatedDir: string } | null> {
    const sid = (sessionId || '').trim()
    if (!sid) return null

    const hintId = (hint?.directoryId || '').trim()
    const hintPath = (hint?.directoryPath || '').trim()
    if (hintId && hintPath) {
      return { directoryId: hintId, directoryPath: hintPath, locatedDir: '' }
    }

    const focused = sidebarStateFocus.value
    if (focused && focused.sessionId === sid) {
      return {
        directoryId: focused.directoryId,
        directoryPath: focused.directoryPath,
        locatedDir: focused.directoryPath,
      }
    }

    const mappedDirectoryId = String(directoryIdBySessionId.value[sid] || '').trim()
    const summary = sessionSummariesById.value[sid] || null
    const summaryDirectoryPath = readSessionDirectory(summary)
    if (mappedDirectoryId) {
      const mapped = visibleDirectories.value.find((entry) => (entry.id || '').trim() === mappedDirectoryId)
      if (mapped?.path) {
        return {
          directoryId: mappedDirectoryId,
          directoryPath: mapped.path,
          locatedDir: summaryDirectoryPath || mapped.path,
        }
      }
      if (summaryDirectoryPath) {
        return {
          directoryId: mappedDirectoryId,
          directoryPath: summaryDirectoryPath,
          locatedDir: summaryDirectoryPath,
        }
      }
    }

    if (summaryDirectoryPath) {
      const summaryNorm = normalizeDirForCompare(summaryDirectoryPath)
      const matchedByPath = summaryNorm
        ? visibleDirectories.value.find((entry) => normalizeDirForCompare(entry.path) === summaryNorm)
        : null
      if (matchedByPath) {
        return {
          directoryId: matchedByPath.id,
          directoryPath: matchedByPath.path,
          locatedDir: summaryDirectoryPath,
        }
      }
    }

    if (hint?.skipRemote) {
      return null
    }

    const locateResult = hint?.locateResult ?? (await chatApi.locateSession(sid).catch(() => null))
    const loc = asRecord(locateResult)
    const rawPid = loc?.projectId ?? loc?.project_id
    const rawPath = loc?.projectPath ?? loc?.project_path
    const pid = typeof rawPid === 'string' ? rawPid.trim() : ''
    const ppath = typeof rawPath === 'string' ? rawPath.trim() : ''
    const locatedDir = typeof loc?.directory === 'string' ? loc.directory.trim() : ''

    const preferredDir = locatedDir
    const preferredNorm = normalizeDirForCompare(preferredDir)
    const preferred = preferredNorm
      ? visibleDirectories.value.find((entry) => normalizeDirForCompare(entry.path) === preferredNorm)
      : null

    const matched =
      preferred ||
      (pid ? visibleDirectories.value.find((entry) => (entry.id || '').trim() === pid) : null) ||
      (ppath
        ? visibleDirectories.value.find((entry) => normalizeDirForCompare(entry.path) === normalizeDirForCompare(ppath))
        : null)

    if (!matched) {
      if (pid && ppath) {
        return {
          directoryId: pid,
          directoryPath: ppath,
          locatedDir,
        }
      }
      return null
    }
    return {
      directoryId: matched.id,
      directoryPath: matched.path,
      locatedDir,
    }
  }

  function statusLabelForSessionId(sessionId: string): { label: string; dotClass: string } {
    const sid = (sessionId || '').trim()
    const runtime = runtimeBySessionId.value[sid]
    if (!runtime) return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.idle')), dotClass: '' }
    const displayState = runtime.displayState
    if (displayState === 'needsPermission') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsPermission')),
        dotClass: 'bg-amber-500',
      }
    }
    if (displayState === 'needsReply') {
      return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsReply')), dotClass: 'bg-sky-500' }
    }
    if (displayState === 'retrying') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.retrying')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (displayState === 'running') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.running')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (displayState === 'coolingDown') {
      return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.coolingDown')), dotClass: 'bg-primary/70' }
    }
    return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.idle')), dotClass: '' }
  }

  function isSessionRuntimeActive(sessionId: string, opts?: { includeCooldown?: boolean }): boolean {
    const sid = (sessionId || '').trim()
    if (!sid) return false
    return runtimeIsActive(runtimeBySessionId.value[sid], opts)
  }

  function applyGlobalEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (!type) return

    // Sidebar state is backend-authoritative. Consume only dedicated sidebar
    // patch/preference streams and avoid deriving sidebar runtime from generic
    // session events on the frontend.
    if (type === 'chat-sidebar.patch') {
      applyChatSidebarPatchEvent(evt)
      return
    }
    if (type === 'chat-sidebar-preferences.patch') {
      applyChatSidebarPreferencesEvent(evt)
    }
  }

  async function resyncSidebarPatchStream() {
    if (sidebarPatchResyncInFlight) return
    sidebarPatchResyncInFlight = true
    try {
      const ok = await revalidateFromApi()
      if (ok) {
        sidebarPatchOutOfSync = false
        stopSidebarPatchRetry()
      }
    } finally {
      sidebarPatchResyncInFlight = false
    }
  }

  function requestSidebarPatchResync(now: number) {
    if (now - lastSidebarPatchGapAt < SSE_SEQ_GAP_THROTTLE_MS) return
    lastSidebarPatchGapAt = now
    void resyncSidebarPatchStream().catch(() => {})
    scheduleSidebarPatchRetry()
  }

  function applyRuntimeOnlyPatchOps(ops: ChatSidebarPatchOp[]): boolean {
    if (ops.length === 0) return false
    const baseRuntime = runtimeBySessionId.value
    let nextRuntime = baseRuntime
    let runtimeChanged = false
    const touchedRunningSessionIds = new Set<string>()

    const ensureRuntime = () => {
      if (runtimeChanged) return
      nextRuntime = { ...baseRuntime }
      runtimeChanged = true
    }

    for (const op of ops) {
      if (op.type === 'sessionRuntime.upsert') {
        const runtime = asRecord(op.runtime)
        const sidRaw = runtime?.sessionID ?? runtime?.sessionId
        const sid = typeof sidRaw === 'string' ? sidRaw.trim() : ''
        if (!sid) continue
        const next = mergeRuntimeState(nextRuntime[sid], runtime)
        const previous = nextRuntime[sid]
        if (previous && runtimeStateEquivalent(normalizeRuntime(previous), next)) continue
        ensureRuntime()
        nextRuntime[sid] = next
        touchedRunningSessionIds.add(sid)
        continue
      }

      if (op.type === 'sessionRuntime.remove') {
        const sid = String(op.sessionId || '').trim()
        if (!sid) continue
        if (!Object.prototype.hasOwnProperty.call(nextRuntime, sid)) continue
        ensureRuntime()
        delete nextRuntime[sid]
        touchedRunningSessionIds.add(sid)
      }
    }

    if (!runtimeChanged) return false
    runtimeBySessionId.value = nextRuntime
    for (const sid of touchedRunningSessionIds) {
      const runtime = nextRuntime[sid]
      if (runtime) {
        syncRunningIndexFromRuntime(sid, runtime)
        continue
      }
      const hadRunning = runningIndex.value.some((item) => item.sessionId === sid)
      if (hadRunning) {
        runningIndex.value = runningIndex.value.filter((item) => item.sessionId !== sid)
        runningIndexTotal.value = Math.max(0, runningIndexTotal.value - 1)
      }
    }
    scheduleSnapshotPersist()
    return true
  }

  function scheduleSidebarPatchProjectionRefresh(delayMs = SIDEBAR_PATCH_REFRESH_THROTTLE_MS) {
    if (sidebarPatchRefreshTimer !== null) return
    sidebarPatchRefreshTimer = window.setTimeout(
      () => {
        sidebarPatchRefreshTimer = null
        void drainSidebarPatchProjectionRefreshQueue().catch(() => {})
      },
      Math.max(20, Math.floor(delayMs)),
    )
  }

  async function drainSidebarPatchProjectionRefreshQueue() {
    if (sidebarPatchRefreshInFlight) return
    sidebarPatchRefreshInFlight = true
    try {
      let shouldRefreshState = false
      while (true) {
        const target = sidebarPatchRefreshQueue.shift()
        if (!target) break

        if (target === SIDEBAR_PATCH_REFRESH_ALL_KEY) {
          shouldRefreshState = true
          continue
        }

        const directoryId = String(target || '').trim()
        if (!directoryId) continue
        shouldRefreshState = true
      }

      if (shouldRefreshState) {
        await revalidateFromApi().catch(() => false)
      }
    } finally {
      sidebarPatchRefreshInFlight = false
      if (sidebarPatchRefreshQueue.size() > 0) {
        scheduleSidebarPatchProjectionRefresh()
      }
    }
  }

  function enqueueSidebarPatchProjectionRefresh(directoryIds: string[], refreshAll: boolean) {
    let overflowed = false
    if (refreshAll) {
      const result = sidebarPatchRefreshQueue.enqueue(SIDEBAR_PATCH_REFRESH_ALL_KEY)
      overflowed = overflowed || Boolean(result.dropped)
    }

    for (const rawId of directoryIds) {
      const did = String(rawId || '').trim()
      if (!did) continue
      const result = sidebarPatchRefreshQueue.enqueue(did)
      overflowed = overflowed || Boolean(result.dropped)
    }

    if (overflowed) {
      sidebarPatchRefreshQueue.enqueue(SIDEBAR_PATCH_REFRESH_ALL_KEY)
    }

    scheduleSidebarPatchProjectionRefresh()
  }

  function scheduleSidebarFooterRefresh(delayMs = SIDEBAR_FOOTER_REFRESH_THROTTLE_MS) {
    if (sidebarFooterRefreshTimer !== null) return
    sidebarFooterRefreshTimer = window.setTimeout(
      () => {
        sidebarFooterRefreshTimer = null
        void drainSidebarFooterRefresh().catch(() => {})
      },
      Math.max(40, Math.floor(delayMs)),
    )
  }

  function enqueueSidebarFooterRefresh(opts: { recent?: boolean; running?: boolean }) {
    if (opts.recent) sidebarFooterRefreshPendingRecent = true
    if (opts.running) sidebarFooterRefreshPendingRunning = true
    if (!sidebarFooterRefreshPendingRecent && !sidebarFooterRefreshPendingRunning) return
    scheduleSidebarFooterRefresh()
  }

  async function drainSidebarFooterRefresh() {
    if (sidebarFooterRefreshInFlight) return
    sidebarFooterRefreshInFlight = true
    try {
      while (sidebarFooterRefreshPendingRecent || sidebarFooterRefreshPendingRunning) {
        const refreshRecent = sidebarFooterRefreshPendingRecent
        const refreshRunning = sidebarFooterRefreshPendingRunning
        sidebarFooterRefreshPendingRecent = false
        sidebarFooterRefreshPendingRunning = false

        if (refreshRecent || refreshRunning) {
          await revalidateFromApi().catch(() => false)
        }
      }
    } finally {
      sidebarFooterRefreshInFlight = false
      if (sidebarFooterRefreshPendingRecent || sidebarFooterRefreshPendingRunning) {
        scheduleSidebarFooterRefresh()
      }
    }
  }

  function applyChatSidebarPatchEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.patch') return

    const seq = parseSseSeq(evt)
    if (sidebarPatchOutOfSync) {
      requestSidebarPatchResync(Date.now())
      return
    }

    if (seq !== null) {
      if (lastSidebarPatchSeq > 0 && seq === lastSidebarPatchSeq) {
        return
      }

      const expected = lastSidebarPatchSeq > 0 ? lastSidebarPatchSeq + 1 : null
      const reset = lastSidebarPatchSeq > 0 && seq < lastSidebarPatchSeq
      const gap = expected !== null && seq !== expected
      if (reset || gap) {
        sidebarPatchOutOfSync = true
        if (reset) {
          sidebarPatchSawSeqReset = true
        }
        requestSidebarPatchResync(Date.now())
        scheduleSidebarPatchRetry()
        return
      }
      lastSidebarPatchSeq = seq
    }

    const opsRaw = readEventOps(evt)
    const ops = parseChatSidebarPatchOps(opsRaw)
    if (ops.length === 0) return
    const hint = readEventPatchRefreshHint(evt)
    const plan = resolveSidebarPatchPlan(
      ops,
      {
        directoriesById: directoriesById.value,
        directoryIdBySessionId: directoryIdBySessionId.value,
        sessionSummariesById: sessionSummariesById.value,
      },
      hint,
    )

    applyRuntimeOnlyPatchOps(plan.runtimeOnlyOps)
    if (plan.refreshAll || plan.refreshDirectoryIds.length > 0) {
      enqueueSidebarPatchProjectionRefresh(plan.refreshDirectoryIds, plan.refreshAll)
    }
    if (plan.refreshRecentIndex || plan.refreshRunningIndex) {
      enqueueSidebarFooterRefresh({
        recent: plan.refreshRecentIndex,
        running: plan.refreshRunningIndex,
      })
    }
  }

  async function revalidateFromStateApi(opts?: {
    limitPerDirectory?: number
    directoriesPage?: number
    directoryQuery?: string
    focusSessionId?: string
    pinnedPage?: number
    recentPage?: number
    runningPage?: number
  }): Promise<void> {
    const params = new URLSearchParams()
    if (typeof opts?.directoriesPage === 'number' && Number.isFinite(opts.directoriesPage)) {
      params.set('directoriesPage', String(Math.max(0, Math.floor(opts.directoriesPage))))
    }
    if (typeof opts?.directoryQuery === 'string') {
      const q = opts.directoryQuery.trim()
      if (q) params.set('directoryQuery', q)
    }
    if (typeof opts?.focusSessionId === 'string') {
      const sid = opts.focusSessionId.trim()
      if (sid) params.set('focusSessionId', sid)
    }
    if (typeof opts?.pinnedPage === 'number' && Number.isFinite(opts.pinnedPage)) {
      params.set('pinnedPage', String(Math.max(0, Math.floor(opts.pinnedPage))))
    }
    if (typeof opts?.recentPage === 'number' && Number.isFinite(opts.recentPage)) {
      params.set('recentPage', String(Math.max(0, Math.floor(opts.recentPage))))
    }
    if (typeof opts?.runningPage === 'number' && Number.isFinite(opts.runningPage)) {
      params.set('runningPage', String(Math.max(0, Math.floor(opts.runningPage))))
    }
    const stateUrl = params.size > 0 ? `${SIDEBAR_STATE_ENDPOINT}?${params.toString()}` : SIDEBAR_STATE_ENDPOINT
    const state = await apiJson<ChatSidebarStateWire>(stateUrl)
    const stateRecord = asRecord((state as JsonValue) || undefined) || {}
    if (!Object.prototype.hasOwnProperty.call(stateRecord, 'preferences')) {
      throw new Error('chat sidebar state payload is missing preferences')
    }
    adoptAuthoritativeUiPrefs((stateRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)

    const focusRecord = asRecord(stateRecord.focus as JsonValue)
    const focusSessionId = typeof focusRecord?.sessionId === 'string' ? focusRecord.sessionId.trim() : ''
    const focusDirectoryId = typeof focusRecord?.directoryId === 'string' ? focusRecord.directoryId.trim() : ''
    const focusDirectoryPath = typeof focusRecord?.directoryPath === 'string' ? focusRecord.directoryPath.trim() : ''
    sidebarStateFocus.value =
      focusSessionId && focusDirectoryId && focusDirectoryPath
        ? {
            sessionId: focusSessionId,
            directoryId: focusDirectoryId,
            directoryPath: focusDirectoryPath,
          }
        : null

    const limit =
      typeof opts?.limitPerDirectory === 'number' && Number.isFinite(opts.limitPerDirectory)
        ? Math.max(1, Math.floor(opts.limitPerDirectory))
        : 10

    const directoriesPage = asRecord(stateRecord.directoriesPage as JsonValue)
    const entries = normalizeDirectories((directoriesPage?.items as JsonValue) || [])
    setDirectoryEntries(entries)

    directoryPageRows.value = entries
    directoryPageTotal.value =
      typeof directoriesPage?.total === 'number' && Number.isFinite(directoriesPage.total)
        ? Math.max(0, Math.floor(directoriesPage.total))
        : entries.length
    const sessionPageLimit =
      typeof directoriesPage?.limit === 'number' && Number.isFinite(directoriesPage.limit) && directoriesPage.limit > 0
        ? Math.max(1, Math.floor(directoriesPage.limit))
        : limit

    const directoryIdSet = new Set(entries.map((entry) => entry.id))
    const pagesByDirectoryId = asRecord(stateRecord.sessionPagesByDirectoryId as JsonValue) || {}
    const runtimePayload = asRecord(stateRecord.runtimeBySessionId as JsonValue) || {}

    const nextPageByDirectoryId: Record<string, DirectorySessionPageState> = {}
    const nextSessionSummariesById: Record<string, SessionSummarySnapshot> = {}
    const nextDirectoryIdBySessionId: Record<string, string> = {}

    for (const entry of entries) {
      if (!Object.prototype.hasOwnProperty.call(pagesByDirectoryId, entry.id)) continue
      const page = parseSessionPagePayload(pagesByDirectoryId[entry.id], sessionPageLimit)
      const degraded = isDegradedConsistency(page.consistency)

      const existingPage = sessionPageByDirectoryId.value[entry.id]
      const preserveExisting =
        degraded &&
        page.sessions.length === 0 &&
        Array.isArray(existingPage?.sessions) &&
        existingPage.sessions.length > 0
      const effectivePage = preserveExisting && existingPage ? existingPage : page

      nextPageByDirectoryId[entry.id] = effectivePage
      for (const session of effectivePage.sessions) {
        const sid = readObjectId(session)
        if (!sid) continue
        nextSessionSummariesById[sid] = session
        const sessionDirectory = readSessionDirectory(session)
        nextDirectoryIdBySessionId[sid] = directoryIdForPath(sessionDirectory) || entry.id
      }
    }

    sessionPageByDirectoryId.value = nextPageByDirectoryId
    sessionSummariesById.value = nextSessionSummariesById
    directoryIdBySessionId.value = nextDirectoryIdBySessionId

    pinnedSessionIdsByDirectoryId.value = Object.fromEntries(
      Object.entries(pinnedSessionIdsByDirectoryId.value).filter(([directoryId]) => directoryIdSet.has(directoryId)),
    )
    worktreePathsByDirectoryId.value = Object.fromEntries(
      Object.entries(worktreePathsByDirectoryId.value).filter(([directoryId]) => directoryIdSet.has(directoryId)),
    )

    const existingRuntime = runtimeBySessionId.value
    runtimeBySessionId.value = Object.fromEntries(
      Object.entries(runtimePayload).map(([sid, runtime]) => [
        sid,
        mergeRuntimeState(existingRuntime[sid], toRuntimeSnapshot(runtime)),
      ]),
    )

    rootsByDirectoryId.value = {}
    childrenByParentSessionId.value = {}
    for (const entry of entries) {
      rebuildDirectoryTreeIndexes(entry.id)
    }

    applyRecentIndexPageWire(stateRecord.recentPage as JsonValue)
    applyRunningIndexPageWire(stateRecord.runningPage as JsonValue)
    applySidebarView(stateRecord.view as JsonValue)

    scheduleSnapshotPersist()

    lastSidebarPatchSeq = resolveSidebarSeqAfterBootstrap({
      currentSeq: lastSidebarPatchSeq,
      bootstrapSeq: state?.seq,
      outOfSync: sidebarPatchOutOfSync,
      sawReset: sidebarPatchSawSeqReset,
    })
    sidebarPatchOutOfSync = false
    sidebarPatchSawSeqReset = false
    stopSidebarPatchRetry()
  }

  async function revalidateFromApi(opts?: {
    limitPerDirectory?: number
    directoriesPage?: number
    directoryQuery?: string
    focusSessionId?: string
    pinnedPage?: number
    recentPage?: number
    runningPage?: number
  }): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await revalidateFromStateApi(opts)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      loading.value = false
    }
  }

  async function bootstrapWithStaleWhileRevalidate() {
    await revalidateFromApi()
  }

  async function resetAllPersistedState() {
    if (snapshotPersistTimer !== null) {
      window.clearTimeout(snapshotPersistTimer)
      snapshotPersistTimer = null
    }
    if (uiPrefsRemotePersistTimer !== null) {
      window.clearTimeout(uiPrefsRemotePersistTimer)
      uiPrefsRemotePersistTimer = null
    }
    uiPrefsRemotePersistInFlight = false
    uiPrefsRemotePersistQueued = false
    uiPrefsLocalRevision = 0
    uiPrefsAckedRevision = 0
    lastSidebarPatchSeq = 0
    lastSidebarPatchGapAt = 0
    sidebarPatchOutOfSync = false
    sidebarPatchSawSeqReset = false
    sidebarPatchResyncInFlight = false
    lastUiPrefsPatchSeq = 0
    lastUiPrefsPatchGapAt = 0
    uiPrefsPatchOutOfSync = false
    uiPrefsPatchResyncInFlight = false
    stopSidebarPatchRetry()
    stopUiPrefsPatchRetry()
    if (sidebarPatchRefreshTimer !== null) {
      window.clearTimeout(sidebarPatchRefreshTimer)
      sidebarPatchRefreshTimer = null
    }
    sidebarPatchRefreshQueue.clear()
    sidebarPatchRefreshInFlight = false
    if (sidebarFooterRefreshTimer !== null) {
      window.clearTimeout(sidebarFooterRefreshTimer)
      sidebarFooterRefreshTimer = null
    }
    sidebarFooterRefreshInFlight = false
    sidebarFooterRefreshPendingRecent = false
    sidebarFooterRefreshPendingRunning = false

    directoriesById.value = {}
    directoryOrder.value = []
    sessionSummariesById.value = {}
    directoryIdBySessionId.value = {}
    rootsByDirectoryId.value = {}
    childrenByParentSessionId.value = {}
    runtimeBySessionId.value = {}
    sessionPageByDirectoryId.value = {}
    pinnedSessionIdsByDirectoryId.value = {}
    worktreePathsByDirectoryId.value = {}
    recentIndex.value = []
    recentIndexTotal.value = 0
    runningIndex.value = []
    runningIndexTotal.value = 0
    directorySidebarById.value = {}
    pinnedFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    recentFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    runningFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    sidebarStateFocus.value = null
    directoryPageRows.value = []
    directoryPageTotal.value = 0
    uiPrefs.value = defaultChatSidebarUiPrefs()
    persistUiPrefs()
    await clearDirectorySessionSnapshot()
  }

  return {
    directoriesById,
    sessionSummariesById,
    rootsByDirectoryId,
    childrenByParentSessionId,
    runtimeBySessionId,
    sessionPageByDirectoryId,
    worktreePathsByDirectoryId,
    recentIndex,
    recentIndexTotal,
    runningIndex,
    runningIndexTotal,
    directorySidebarById,
    pinnedFooterView,
    recentFooterView,
    runningFooterView,
    sidebarStateFocus,
    directoryPageRows,
    directoryPageTotal,
    uiPrefs,
    loading,
    error,
    visibleDirectories,
    sessionSummariesByDirectoryId,
    allSessionIndexById,
    setSessionRootPage,
    patchUiPrefs,
    setDirectoryEntries,
    upsertDirectorySessionSummaries,
    upsertRuntime,
    upsertSessionSummaryPatch,
    removeSessionFromSidebarState,
    resolveDirectoryForSession,
    statusLabelForSessionId,
    isSessionRuntimeActive,
    applyGlobalEvent,
    applyChatSidebarPatchEvent,
    applyChatSidebarPreferencesEvent,
    getSidebarPatchCursor,
    revalidateUiPrefsFromApi,
    revalidateFromApi,
    bootstrapWithStaleWhileRevalidate,
    persistSnapshot,
    resetAllPersistedState,
  }
})
