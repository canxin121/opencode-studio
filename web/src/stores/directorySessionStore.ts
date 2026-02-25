import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '@/i18n'

import * as chatApi from '@/stores/chat/api'
import { apiJson } from '@/lib/api'
import { buildFlattenedTree, type FlatTreeRow } from '@/features/sessions/model/tree'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import { extractSessionActivityUpdate } from '@/lib/sessionActivityEvent.js'
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
  loadDirectorySessionSnapshot,
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
  DIRECTORIES_PAGE_SIZE_DEFAULT,
  FOOTER_PAGE_SIZE_DEFAULT,
  RECENT_INDEX_DEFAULT_LIMIT,
  RECENT_INDEX_MAX_ITEMS,
  RUNNING_INDEX_DEFAULT_LIMIT,
  type DirectoriesPageWire,
  type DirectorySessionPageState,
  type DirectorySessionsBootstrapWire,
  type PagedIndexWire,
  type RecentIndexWireItem,
  type RecentIndexEntry,
  type RunningIndexWireItem,
  type RunningIndexEntry,
  type SessionPayloadConsistency,
  type SessionSummariesWire,
  normalizeRecentIndexItem,
  normalizeRunningIndexItem,
  parseSessionPagePayload,
} from '@/stores/directorySessions/index'
import {
  removeSessionFromPageState,
  upsertRuntimeOnlyRunningIndexEntry,
  upsertSessionInPageState,
} from '@/stores/directorySessions/pageState'
import { matchDirectoryEntryForPath } from '@/stores/directorySessions/pathMatch'
import { extractSessionId, readParentId, readUpdatedAt } from '@/stores/directorySessions/runtime'
import type { JsonObject as UnknownRecord, JsonValue } from '@/types/json'
import {
  compareUiPrefsRecency,
  normalizeUiPrefs,
  parseChatSidebarPatchOps,
  parseChatSidebarPreferencesPatchOps,
  uiPrefsBodyEquals,
} from '@/stores/directorySessions/prefs'
import {
  SIDEBAR_BOOTSTRAP_ENDPOINT,
  SNAPSHOT_SAVE_DEBOUNCE_MS,
  UI_PREFS_ENDPOINT,
  UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS,
  jsonLikeDeepEqual,
  metricNowMs,
} from '@/stores/directorySessions/persistence'

type EnsureDirectoryAggregateOpts = {
  force?: boolean
  focusSessionId?: string
  pinnedSessionIds: string[]
  page: number
  pageSize: number
  includeWorktrees?: boolean
}

type RunningSidebarRow = {
  id: string
  session: SessionSummarySnapshot | null
  directory: DirectoryEntry | null
  updatedAt: number
  statusType: string
  attention: 'permission' | 'question' | null
}

type RecentSidebarRow = {
  id: string
  session: SessionSummarySnapshot
  directory: DirectoryEntry
  updatedAt: number
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

function toSessionSummarySnapshotList(value: JsonValue): SessionSummarySnapshot[] {
  if (!Array.isArray(value)) return []
  const out: SessionSummarySnapshot[] = []
  for (const item of value) {
    const summary = toSessionSummarySnapshot(item)
    if (summary) out.push(summary)
  }
  return out
}

function toRuntimeSnapshot(value: JsonValue): SessionRuntimeSnapshot {
  const runtime = asRecord(value)
  const attention = runtime?.attention
  return {
    statusType: typeof runtime?.statusType === 'string' ? runtime.statusType : undefined,
    phase: typeof runtime?.phase === 'string' ? runtime.phase : undefined,
    attention: attention === 'permission' || attention === 'question' || attention === null ? attention : undefined,
    updatedAt:
      typeof runtime?.updatedAt === 'number' && Number.isFinite(runtime.updatedAt) ? runtime.updatedAt : undefined,
  }
}

function isDegradedConsistency(consistency: SessionPayloadConsistency | undefined): boolean {
  return consistency?.degraded === true
}

function retryDelayFromConsistency(consistency: SessionPayloadConsistency | undefined, fallbackMs = 200): number {
  const raw = consistency?.retryAfterMs
  const parsed = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(50, Math.floor(raw)) : fallbackMs
  return Math.min(10_000, parsed)
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

function readRuntimeStatusType(value: JsonValue): SessionRuntimeState['statusType'] | null {
  const status = typeof value === 'string' ? value.trim() : ''
  if (status === 'busy' || status === 'retry' || status === 'idle') return status
  return null
}

function readRuntimePhase(value: JsonValue): SessionRuntimeState['phase'] | null {
  const phase = typeof value === 'string' ? value.trim() : ''
  if (phase === 'idle' || phase === 'busy' || phase === 'cooldown') return phase
  return null
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
  const pinnedSummaryKeyByDirectoryId = ref<Record<string, string>>({})
  const worktreePathsByDirectoryId = ref<Record<string, string[]>>({})
  const worktreeLoadingByDirectoryId = ref<Record<string, boolean>>({})
  const aggregateLoadingByDirectoryId = ref<Record<string, boolean>>({})
  const aggregateAttemptedByDirectoryId = ref<Record<string, boolean>>({})
  const recentIndex = ref<RecentIndexEntry[]>([])
  const recentIndexTotal = ref(0)
  const runningIndex = ref<RunningIndexEntry[]>([])
  const runningIndexTotal = ref(0)
  const directoryPageRows = ref<DirectoryEntry[]>([])
  const directoryPageTotal = ref(0)
  const directoryPageLoading = ref(false)
  const uiPrefs = ref<ChatSidebarUiPrefs>(loadChatSidebarUiPrefs())

  const loading = ref(false)
  const error = ref<string | null>(null)

  let snapshotPersistTimer: number | null = null
  let uiPrefsRemotePersistTimer: number | null = null
  let uiPrefsRemotePersistInFlight = false
  let uiPrefsRemotePersistQueued = false
  let recentIndexLoadInFlight: Promise<void> | null = null
  let runningIndexLoadInFlight: Promise<void> | null = null
  const summariesLoadInFlight = new Map<string, Promise<void>>()
  let directoryPageLoadSeq = 0
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
  let lastSidebarPatchSeq = 0
  let lastSidebarPatchGapAt = 0
  let sidebarPatchOutOfSync = false
  let sidebarPatchSawSeqReset = false
  let sidebarPatchResyncInFlight = false
  let lastUiPrefsPatchSeq = 0
  let lastUiPrefsPatchGapAt = 0
  let uiPrefsPatchOutOfSync = false
  let uiPrefsPatchResyncInFlight = false
  let syncedAttentionSessionIds = new Set<string>()

  const pinnedSummariesByDirectoryId = computed<Record<string, SessionSummarySnapshot[]>>(() => {
    const out: Record<string, SessionSummarySnapshot[]> = {}
    for (const [directoryId, ids] of Object.entries(pinnedSessionIdsByDirectoryId.value)) {
      const list: SessionSummarySnapshot[] = []
      for (const sid of ids || []) {
        const id = String(sid || '').trim()
        if (!id) continue
        const session = sessionSummariesById.value[id]
        if (session) list.push(session)
      }
      if (list.length > 0) {
        out[directoryId] = list
      }
    }
    return out
  })

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

  function normalizeWireTimestamp(raw: JsonValue): number | undefined {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return undefined
    // Some upstream emitters use ns/us; normalize to milliseconds.
    if (value > 100_000_000_000_000_000) return Math.floor(value / 1_000_000)
    if (value > 100_000_000_000_000) return Math.floor(value / 1000)
    return Math.floor(value)
  }

  function readEventUpdatedAt(evt: SseEvent): number | undefined {
    const fromRoot = normalizeWireTimestamp(asRecord(evt)?.timestamp)
    if (fromRoot !== undefined) return fromRoot
    return normalizeWireTimestamp(readEventProperties(evt).ts)
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

  const runningSidebarRows = computed<RunningSidebarRow[]>(() => {
    const out: RunningSidebarRow[] = []
    for (const item of runningIndex.value) {
      const sid = String(item.sessionId || '').trim()
      if (!sid) continue
      const runtime = mergeRuntimeState(runtimeBySessionId.value[sid], item.runtime)
      if (!runtimeIsActive(runtime, { includeCooldown: true })) continue
      const session = sessionSummariesById.value[sid] || null
      const directory =
        (item.directoryId ? directoriesById.value[item.directoryId] || null : null) ||
        (item.directoryPath ? directoryEntryByPath(item.directoryPath) : null) ||
        (readSessionDirectory(session) ? directoryEntryByPath(readSessionDirectory(session)) : null)
      out.push({
        id: sid,
        session,
        directory,
        updatedAt: Math.max(item.updatedAt || 0, readUpdatedAt(session)),
        statusType: runtime.statusType,
        attention: runtime.attention,
      })
    }
    return out
  })

  const recentSidebarRows = computed<RecentSidebarRow[]>(() => {
    const out: RecentSidebarRow[] = []

    for (const item of recentIndex.value) {
      const sid = String(item.sessionId || '').trim()
      if (!sid) continue
      const session = sessionSummariesById.value[sid]
      const directory = directoriesById.value[item.directoryId] || directoryEntryByPath(item.directoryPath)
      if (!session || !directory) continue
      out.push({
        id: sid,
        session,
        directory,
        updatedAt: Math.max(item.updatedAt || 0, readUpdatedAt(session)),
      })
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
    if (type !== 'chat-sidebar-preferences.patch' && type !== 'sessions-sidebar-preferences.patch') return

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

  async function hydrateSessionSummariesByIds(sessionIds: string[]) {
    const unique = Array.from(new Set((sessionIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
    if (unique.length === 0) return

    const missing = unique.filter((id) => !sessionSummariesById.value[id])
    if (missing.length === 0) return
    const key = missing.slice().sort().join('|')
    if (!key) return
    const existing = summariesLoadInFlight.get(key)
    if (existing) {
      await existing
      return
    }

    const task = (async () => {
      const chunkSize = 60
      for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize)
        if (chunk.length === 0) continue
        const payload = await apiJson<SessionSummariesWire>(
          `/api/sessions/summaries?ids=${encodeURIComponent(chunk.join(','))}`,
        ).catch(() => null)
        const list = toSessionSummarySnapshotList(payload?.summaries)
        for (const summary of list) {
          upsertSessionSummaryPatch(summary)
        }

        const missingIds = Array.isArray(payload?.missingIds)
          ? payload.missingIds.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        for (const sid of missingIds) {
          removeSessionFromAggregates(sid, { preserveRuntime: true })
        }
      }
    })().finally(() => {
      summariesLoadInFlight.delete(key)
    })

    summariesLoadInFlight.set(key, task)
    await task
  }

  async function loadRecentIndexSlice(opts?: { offset?: number; limit?: number; append?: boolean }) {
    if (recentIndexLoadInFlight) {
      await recentIndexLoadInFlight
      return
    }

    const offset = Math.max(0, Math.floor(opts?.offset || 0))
    const limit = Math.max(1, Math.min(RECENT_INDEX_MAX_ITEMS, Math.floor(opts?.limit || RECENT_INDEX_DEFAULT_LIMIT)))
    const append = Boolean(opts?.append)

    const task = (async () => {
      const payload = await apiJson<PagedIndexWire<RecentIndexWireItem>>(
        `/api/chat-sidebar/recent-index?offset=${encodeURIComponent(String(offset))}&limit=${encodeURIComponent(String(limit))}`,
      ).catch(() => null)
      const list = Array.isArray(payload?.items) ? payload.items : []
      const incoming = list
        .map((item) => normalizeRecentIndexItem(item))
        .filter((item): item is RecentIndexEntry => Boolean(item))

      const base = append ? recentIndex.value.slice() : []
      const byId = new Map(base.map((item) => [item.sessionId, item]))
      for (const item of incoming) {
        byId.set(item.sessionId, item)
      }
      const merged = Array.from(byId.values())
      merged.sort((a, b) => {
        const diff = b.updatedAt - a.updatedAt
        if (diff !== 0) return diff
        return a.sessionId.localeCompare(b.sessionId)
      })
      const capped = merged.slice(0, RECENT_INDEX_MAX_ITEMS)
      recentIndex.value = capped
      const payloadTotal =
        typeof payload?.total === 'number' && Number.isFinite(payload.total)
          ? Math.max(0, Math.floor(payload.total))
          : capped.length
      recentIndexTotal.value = Math.min(RECENT_INDEX_MAX_ITEMS, Math.max(payloadTotal, capped.length))
    })().finally(() => {
      recentIndexLoadInFlight = null
    })

    recentIndexLoadInFlight = task
    await task
  }

  async function loadRunningIndexSlice(opts?: { offset?: number; limit?: number; append?: boolean }) {
    if (runningIndexLoadInFlight) {
      await runningIndexLoadInFlight
      return
    }

    const offset = Math.max(0, Math.floor(opts?.offset || 0))
    const limit = Math.max(
      1,
      Math.min(FOOTER_PAGE_SIZE_DEFAULT, Math.floor(opts?.limit || RUNNING_INDEX_DEFAULT_LIMIT)),
    )
    const append = Boolean(opts?.append)

    const task = (async () => {
      const payload = await apiJson<PagedIndexWire<RunningIndexWireItem>>(
        `/api/chat-sidebar/running-index?offset=${encodeURIComponent(String(offset))}&limit=${encodeURIComponent(String(limit))}`,
      ).catch(() => null)
      const list = Array.isArray(payload?.items) ? payload.items : []
      const incoming = list
        .map((item) => normalizeRunningIndexItem(item))
        .filter((item): item is RunningIndexEntry => Boolean(item))

      const base = append ? runningIndex.value.slice() : []
      const byId = new Map(base.map((item) => [item.sessionId, item]))
      const nextRuntime = { ...runtimeBySessionId.value }
      for (const item of incoming) {
        byId.set(item.sessionId, item)
        nextRuntime[item.sessionId] = mergeRuntimeState(nextRuntime[item.sessionId], item.runtime)
      }

      const merged = Array.from(byId.values())
      merged.sort((a, b) => {
        const diff = b.updatedAt - a.updatedAt
        if (diff !== 0) return diff
        return a.sessionId.localeCompare(b.sessionId)
      })

      runningIndex.value = merged
      runningIndexTotal.value =
        typeof payload?.total === 'number' && Number.isFinite(payload.total)
          ? Math.max(0, Math.floor(payload.total))
          : merged.length
      runtimeBySessionId.value = nextRuntime
    })().finally(() => {
      runningIndexLoadInFlight = null
    })

    runningIndexLoadInFlight = task
    await task
  }

  async function ensureRecentSessionRowsLoaded(opts?: { page?: number; pageSize?: number }) {
    const page = Math.max(0, Math.floor(opts?.page || 0))
    const pageSize = Math.max(1, Math.min(FOOTER_PAGE_SIZE_DEFAULT, Math.floor(opts?.pageSize || 10)))
    const end = (page + 1) * pageSize

    for (let step = 0; step < page + 1 && recentIndex.value.length < end; step += 1) {
      const before = recentIndex.value.length
      const remaining = Math.max(0, recentIndexTotal.value - before)
      const requestLimit = recentIndexTotal.value > 0 ? Math.min(pageSize, remaining) : pageSize
      if (requestLimit <= 0) break
      await loadRecentIndexSlice({ offset: before, limit: requestLimit, append: before > 0 })
      if (recentIndex.value.length <= before) break
    }

    const ids = recentIndex.value.slice(0, end).map((item) => item.sessionId)
    await hydrateSessionSummariesByIds(ids)
  }

  async function ensureRunningSessionRowsLoaded(opts?: { page?: number; pageSize?: number }) {
    const page = Math.max(0, Math.floor(opts?.page || 0))
    const pageSize = Math.max(
      1,
      Math.min(FOOTER_PAGE_SIZE_DEFAULT, Math.floor(opts?.pageSize || FOOTER_PAGE_SIZE_DEFAULT)),
    )
    const end = (page + 1) * pageSize

    for (let step = 0; step < page + 1 && runningIndex.value.length < end; step += 1) {
      const before = runningIndex.value.length
      const remaining = Math.max(0, runningIndexTotal.value - before)
      const requestLimit = runningIndexTotal.value > 0 ? Math.min(pageSize, remaining) : pageSize
      if (requestLimit <= 0) break
      await loadRunningIndexSlice({ offset: before, limit: requestLimit, append: before > 0 })
      if (runningIndex.value.length <= before) break
    }

    const ids = runningIndex.value.slice(0, end).map((item) => item.sessionId)
    await hydrateSessionSummariesByIds(ids)
  }

  async function ensurePinnedSessionRowsLoaded(sessionIds: string[]) {
    await hydrateSessionSummariesByIds(sessionIds)
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
  const aggregateReloadRetryTimerByDirectoryId = new Map<string, number>()

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

  function clearAggregateReloadRetry(directoryId: string) {
    const did = (directoryId || '').trim()
    if (!did) return
    const timer = aggregateReloadRetryTimerByDirectoryId.get(did)
    if (typeof timer === 'number') {
      window.clearTimeout(timer)
      aggregateReloadRetryTimerByDirectoryId.delete(did)
    }
  }

  function clearAllAggregateReloadRetries() {
    for (const timer of aggregateReloadRetryTimerByDirectoryId.values()) {
      window.clearTimeout(timer)
    }
    aggregateReloadRetryTimerByDirectoryId.clear()
  }

  function scheduleAggregateReloadRetry(
    directoryId: string,
    directoryPath: string,
    opts: EnsureDirectoryAggregateOpts,
    delayMs: number,
  ) {
    const did = (directoryId || '').trim()
    const root = (directoryPath || '').trim()
    if (!did || !root) return
    if (aggregateReloadRetryTimerByDirectoryId.has(did)) return

    const timer = window.setTimeout(
      () => {
        aggregateReloadRetryTimerByDirectoryId.delete(did)
        void ensureDirectoryAggregateLoaded(did, root, {
          ...opts,
          force: true,
        }).catch(() => {})
      },
      Math.max(50, Math.min(10_000, Math.floor(delayMs || 200))),
    )

    aggregateReloadRetryTimerByDirectoryId.set(did, timer)
  }

  async function loadDirectoryPage(opts?: { page?: number; pageSize?: number; query?: string }) {
    const page = Math.max(0, Math.floor(opts?.page || 0))
    const pageSize = Math.max(1, Math.floor(opts?.pageSize || DIRECTORIES_PAGE_SIZE_DEFAULT))
    const query = String(opts?.query || '').trim()
    const offset = page * pageSize

    const seq = ++directoryPageLoadSeq
    directoryPageLoading.value = true
    try {
      const params = new URLSearchParams()
      params.set('offset', String(offset))
      params.set('limit', String(pageSize))
      if (query) params.set('query', query)

      const payload = await apiJson<DirectoriesPageWire>(`/api/directories?${params.toString()}`).catch(() => null)
      if (seq !== directoryPageLoadSeq) {
        return {
          page,
          total: directoryPageTotal.value,
          pageCount: Math.max(1, Math.ceil(Math.max(0, directoryPageTotal.value) / pageSize)),
        }
      }

      const items = normalizeDirectories(payload?.items || [])
      const totalRaw =
        typeof payload?.total === 'number' && Number.isFinite(payload.total)
          ? Math.max(0, Math.floor(payload.total))
          : items.length
      const offsetRaw =
        typeof payload?.offset === 'number' && Number.isFinite(payload.offset)
          ? Math.max(0, Math.floor(payload.offset))
          : offset
      const limitRaw =
        typeof payload?.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
          ? Math.max(1, Math.floor(payload.limit))
          : pageSize

      directoryPageRows.value = items
      directoryPageTotal.value = totalRaw

      const resolvedPage = Math.floor(offsetRaw / limitRaw)
      const pageCount = Math.max(1, Math.ceil(totalRaw / limitRaw))
      return {
        page: Math.max(0, Math.min(Math.max(0, pageCount - 1), resolvedPage)),
        total: totalRaw,
        pageCount,
      }
    } finally {
      if (seq === directoryPageLoadSeq) {
        directoryPageLoading.value = false
      }
    }
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
    const nextChildren = { ...childrenByParentSessionId.value }

    // Remove existing child links for sessions in touched directories.
    const touchedChildIds = new Set<string>()
    for (const directoryId of unique) {
      const list = byDirectory[directoryId] || []
      for (const item of list) {
        const sid = readObjectId(item)
        if (sid) touchedChildIds.add(sid)
      }
    }
    if (touchedChildIds.size > 0) {
      for (const [parentId, list] of Object.entries(nextChildren)) {
        const filtered = (list || []).filter((childId) => !touchedChildIds.has(childId))
        if (filtered.length === (list || []).length) continue
        if (filtered.length > 0) {
          nextChildren[parentId] = filtered
        } else {
          delete nextChildren[parentId]
        }
      }
    }

    for (const directoryId of unique) {
      const list = byDirectory[directoryId] || []
      const tree = buildFlattenedTree(list, expanded)
      nextRoots[directoryId] = (tree.rootIds || []).slice()

      for (const item of list) {
        const sessionId = readObjectId(item)
        if (!sessionId) continue
        const parentId = readParentId(item)
        if (!parentId) continue
        const children = new Set(nextChildren[parentId] || [])
        children.add(sessionId)
        nextChildren[parentId] = Array.from(children).sort((a, b) => {
          return readUpdatedAt(sessionSummariesById.value[b]) - readUpdatedAt(sessionSummariesById.value[a])
        })
      }
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

  function upsertDirectorySessionSummaries(directoryId: string, sessions: SessionSummarySnapshot[]) {
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
      nextDirectoryBySessionId[sessionId] = dirId
    }

    for (const [sessionId, mappedDirectoryId] of Object.entries(nextDirectoryBySessionId)) {
      if (mappedDirectoryId !== dirId) continue
      if (keep.has(sessionId)) continue
      delete nextById[sessionId]
      delete nextDirectoryBySessionId[sessionId]
      const nextRuntime = { ...runtimeBySessionId.value }
      delete nextRuntime[sessionId]
      runtimeBySessionId.value = nextRuntime
    }

    sessionSummariesById.value = nextById
    directoryIdBySessionId.value = nextDirectoryBySessionId
    rebuildDirectoryTreeIndexes(dirId)
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

  function upsertSessionSummaryPatch(sessionPatch: JsonValue): boolean {
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
      const decrementRootTotal = Boolean(previous && !readParentId(previous))
      const patched = prevPage
        ? removeSessionFromPageState(prevPage, sid, {
            decrementRootTotal,
            readSessionId: readObjectId,
          })
        : null
      applyPagePatch(previousDirectoryId, patched)
    }

    if (mappedDirectoryId) {
      const currentPage = nextPagesByDirectoryId[mappedDirectoryId]
      const isNewInDirectory = !previous || previousDirectoryId !== mappedDirectoryId
      const incrementRootTotal = isNewInDirectory && !readParentId(merged)
      const patched = currentPage
        ? upsertSessionInPageState(currentPage, merged, {
            incrementRootTotal,
            maxRootCount: 10,
            readSessionId: readObjectId,
            readParentId,
            equals: jsonLikeDeepEqual,
          })
        : null
      applyPagePatch(mappedDirectoryId, patched)
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

  function removeSessionFromAggregates(
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

  function hasCachedSessionsForDirectory(directoryId: string): boolean {
    const did = (directoryId || '').trim()
    if (!did) return false
    const page = sessionPageByDirectoryId.value[did]
    if (!page) return false
    const pinnedIds = pinnedSessionIdsByDirectoryId.value[did] || []
    if (pinnedIds.length > 0) return true
    if (Array.isArray(page.sessions) && page.sessions.length > 0) return true
    return Number.isFinite(page.totalRoots) && page.totalRoots === 0
  }

  function aggregatedSessionsForDirectory(directoryId: string, directoryPath: string): SessionSummarySnapshot[] {
    const did = (directoryId || '').trim()
    const root = (directoryPath || '').trim()
    if (!did || !root) return []

    const pinnedIds = pinnedSessionIdsByDirectoryId.value[did] || []
    const pageSessions = sessionPageByDirectoryId.value[did]?.sessions || []
    const pageIds = pageSessions.map((item) => readObjectId(item)).filter(Boolean)

    const merged: SessionSummarySnapshot[] = []
    const seen = new Set<string>()
    for (const rawId of [...pinnedIds, ...pageIds]) {
      const sid = String(rawId || '').trim()
      if (!sid || seen.has(sid)) continue
      seen.add(sid)

      const session = sessionSummariesById.value[sid]
      if (!session) continue
      merged.push(session)
    }
    return merged
  }

  function sessionRootPageCount(directoryId: string, pageSize: number): number {
    const did = (directoryId || '').trim()
    if (!did || pageSize <= 0) return 1
    const total = sessionPageByDirectoryId.value[did]?.totalRoots
    const fallback = rootsByDirectoryId.value[did]?.length || 0
    const value = typeof total === 'number' && Number.isFinite(total) ? total : fallback
    return Math.max(1, Math.ceil(Math.max(0, value) / pageSize))
  }

  function sessionRootPage(directoryId: string, pageSize: number): number {
    const did = (directoryId || '').trim()
    if (!did) return 0
    const raw = uiPrefs.value.sessionRootPageByDirectoryId[did]
    const parsed = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    const max = Math.max(0, sessionRootPageCount(did, pageSize) - 1)
    return Math.max(0, Math.min(max, parsed))
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

  async function ensurePinnedSummariesLoaded(
    directoryId: string,
    directoryPath: string,
    pinnedSessionIds: string[],
    opts?: { force?: boolean },
  ) {
    const did = (directoryId || '').trim()
    const root = (directoryPath || '').trim()
    if (!did || !root) return

    const ids = pinnedSessionIds.map((id) => id.trim()).filter(Boolean)
    const key = ids.join('|')
    if (!opts?.force && pinnedSummaryKeyByDirectoryId.value[did] === key) return

    if (ids.length === 0) {
      pinnedSessionIdsByDirectoryId.value = { ...pinnedSessionIdsByDirectoryId.value, [did]: [] }
      pinnedSummaryKeyByDirectoryId.value = { ...pinnedSummaryKeyByDirectoryId.value, [did]: key }
      return
    }

    await hydrateSessionSummariesByIds(ids)
    const rootNorm = normalizeDirForCompare(root)
    const idsInDirectory: string[] = []
    for (const rawId of ids) {
      const id = String(rawId || '').trim()
      if (!id) continue
      const session = sessionSummariesById.value[id] || null
      if (!session) continue
      const sid = readObjectId(session)
      const mappedDirectoryId = sid ? String(directoryIdBySessionId.value[sid] || '').trim() : ''
      if (mappedDirectoryId) {
        if (mappedDirectoryId === did) idsInDirectory.push(id)
        continue
      }
      const path = readSessionDirectory(session)
      if (normalizeDirForCompare(path) === rootNorm) {
        idsInDirectory.push(id)
      }
    }

    pinnedSessionIdsByDirectoryId.value = { ...pinnedSessionIdsByDirectoryId.value, [did]: idsInDirectory }
    pinnedSummaryKeyByDirectoryId.value = { ...pinnedSummaryKeyByDirectoryId.value, [did]: key }
  }

  async function ensureDirectoryWorktreesLoaded(
    directoryId: string,
    directoryPath: string,
    opts?: { force?: boolean },
  ) {
    const did = (directoryId || '').trim()
    const root = (directoryPath || '').trim()
    if (!did || !root) return

    if (!opts?.force && Array.isArray(worktreePathsByDirectoryId.value[did])) return

    worktreeLoadingByDirectoryId.value = { ...worktreeLoadingByDirectoryId.value, [did]: true }
    try {
      const target = `/api/git/worktrees?directory=${encodeURIComponent(root)}`
      const payload = await apiJson<unknown>(target)
      const list = Array.isArray(payload) ? payload : []
      const paths = list
        .map((row) => {
          const worktree = asRecord(row)?.worktree
          return typeof worktree === 'string' ? worktree.trim() : ''
        })
        .filter(Boolean)
        .filter((p) => p !== root)
      worktreePathsByDirectoryId.value = { ...worktreePathsByDirectoryId.value, [did]: paths }
    } catch {
      worktreePathsByDirectoryId.value = { ...worktreePathsByDirectoryId.value, [did]: [] }
    } finally {
      worktreeLoadingByDirectoryId.value = { ...worktreeLoadingByDirectoryId.value, [did]: false }
    }
  }

  async function ensureDirectoryAggregateLoaded(
    directoryId: string,
    directoryPath: string,
    opts: EnsureDirectoryAggregateOpts,
  ) {
    const did = (directoryId || '').trim()
    const root = (directoryPath || '').trim()
    if (!did || !root) return

    const force = Boolean(opts?.force)
    if (!force && aggregateLoadingByDirectoryId.value[did]) return

    const focusId = typeof opts?.focusSessionId === 'string' ? opts.focusSessionId.trim() : ''
    const wantsFocus = Boolean(focusId)
    const pageSize = Math.max(1, Math.floor(opts?.pageSize || 10))
    const targetPage = Math.max(0, Math.floor(opts?.page || 0))
    const cached = sessionPageByDirectoryId.value[did]

    if (!force && !wantsFocus && cached && cached.page === targetPage) {
      await ensurePinnedSummariesLoaded(did, root, opts.pinnedSessionIds, { force: false })
      if (opts.includeWorktrees) {
        await ensureDirectoryWorktreesLoaded(did, root, { force: false })
      }
      return
    }

    aggregateLoadingByDirectoryId.value = { ...aggregateLoadingByDirectoryId.value, [did]: true }
    try {
      const params = new URLSearchParams()
      params.set('scope', 'directory')
      params.set('roots', 'true')
      params.set('includeChildren', 'true')
      params.set('includeTotal', 'true')
      params.set('limit', String(pageSize))
      if (wantsFocus) {
        params.set('focusSessionId', focusId)
      } else {
        params.set('offset', String(targetPage * pageSize))
      }

      const payload = await apiJson<unknown>(
        `/api/directories/${encodeURIComponent(did)}/sessions?${params.toString()}`,
      )
      const pageState = parseSessionPagePayload(payload, pageSize)
      const degraded = isDegradedConsistency(pageState.consistency)
      if (degraded) {
        scheduleAggregateReloadRetry(did, root, opts, retryDelayFromConsistency(pageState.consistency, 200))
      } else {
        clearAggregateReloadRetry(did)
      }

      const cachedSessions = Array.isArray(cached?.sessions) ? cached.sessions : []
      const preserveCached = degraded && pageState.sessions.length === 0 && cachedSessions.length > 0 && Boolean(cached)
      const effectivePage = preserveCached && cached ? cached : pageState
      const sessions = Array.isArray(effectivePage.sessions) ? effectivePage.sessions : []
      const totalRoots =
        typeof effectivePage.totalRoots === 'number' && Number.isFinite(effectivePage.totalRoots)
          ? effectivePage.totalRoots
          : sessions.length
      const resolvedPage =
        typeof effectivePage.page === 'number' && Number.isFinite(effectivePage.page) ? effectivePage.page : targetPage

      sessionPageByDirectoryId.value = {
        ...sessionPageByDirectoryId.value,
        [did]: {
          ...effectivePage,
          page: resolvedPage,
          totalRoots,
          sessions,
        },
      }
      setSessionRootPage(did, resolvedPage, pageSize)
      upsertDirectorySessionSummaries(did, sessions)

      await ensurePinnedSummariesLoaded(did, root, opts.pinnedSessionIds, { force: force || wantsFocus })
      if (opts.includeWorktrees) {
        await ensureDirectoryWorktreesLoaded(did, root, { force })
      }

      aggregateAttemptedByDirectoryId.value = {
        ...aggregateAttemptedByDirectoryId.value,
        [did]: true,
      }
    } catch (err) {
      if (Array.isArray(cached?.sessions) && cached.sessions.length > 0) {
        scheduleAggregateReloadRetry(did, root, opts, 300)
      }
      aggregateAttemptedByDirectoryId.value = {
        ...aggregateAttemptedByDirectoryId.value,
        [did]: true,
      }
      throw err
    } finally {
      aggregateLoadingByDirectoryId.value = { ...aggregateLoadingByDirectoryId.value, [did]: false }
    }
  }

  async function resolveDirectoryForSession(
    sessionId: string,
    hint?: { directoryId?: string; directoryPath?: string; locateResult?: JsonValue },
  ): Promise<{ directoryId: string; directoryPath: string; locatedDir: string } | null> {
    const sid = (sessionId || '').trim()
    if (!sid) return null

    const hintId = (hint?.directoryId || '').trim()
    const hintPath = (hint?.directoryPath || '').trim()
    if (hintId && hintPath && visibleDirectories.value.some((entry) => entry.id === hintId)) {
      return { directoryId: hintId, directoryPath: hintPath, locatedDir: '' }
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

    if (!matched) return null
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
    if (runtime.attention === 'permission') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsPermission')),
        dotClass: 'bg-amber-500',
      }
    }
    if (runtime.attention === 'question') {
      return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsReply')), dotClass: 'bg-sky-500' }
    }
    if (runtime.statusType === 'retry') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.retrying')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (runtime.statusType === 'busy') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.running')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (runtime.phase === 'cooldown') {
      return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.coolingDown')), dotClass: 'bg-primary/70' }
    }
    if (runtime.phase === 'busy') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.running')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.idle')), dotClass: '' }
  }

  function isSessionRuntimeActive(sessionId: string, opts?: { includeCooldown?: boolean }): boolean {
    const sid = (sessionId || '').trim()
    if (!sid) return false
    return runtimeIsActive(runtimeBySessionId.value[sid], opts)
  }

  function syncRuntimeFromStores(input: {
    sessionStatusBySession: Record<string, JsonValue>
    attentionBySession: Record<string, JsonValue>
    activitySnapshot: Record<string, JsonValue>
  }) {
    const baseRuntime = runtimeBySessionId.value
    let nextRuntime = baseRuntime
    let runtimeChanged = false
    const touchedRunningSessionIds = new Set<string>()

    const ensureRuntime = () => {
      if (runtimeChanged) return
      nextRuntime = { ...baseRuntime }
      runtimeChanged = true
    }

    const readAt = (value: JsonValue): number => {
      const raw = asRecord(value)?.at
      const at = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
      return at
    }

    const applyRuntimePatch = (sessionId: string, patch: Partial<SessionRuntimeState>) => {
      const sid = String(sessionId || '').trim()
      if (!sid) return

      const current = nextRuntime[sid]
      const candidate = mergeRuntimeState(current, patch)

      if (!current) {
        if (candidate.statusType === 'unknown' && candidate.phase === 'unknown' && !candidate.attention) {
          return
        }
      } else {
        const normalized = normalizeRuntime(current)
        if (runtimeStateEquivalent(normalized, candidate) && candidate.updatedAt <= normalized.updatedAt) {
          return
        }
      }

      ensureRuntime()
      nextRuntime[sid] = candidate
      touchedRunningSessionIds.add(sid)
    }

    for (const [sid, evt] of Object.entries(input.sessionStatusBySession || {})) {
      const sessionId = String(sid || '').trim()
      if (!sessionId) continue
      const status = readRuntimeStatusType(asRecord(asRecord(evt)?.status)?.type)
      if (status) {
        const updatedAt = readAt(evt) || Date.now()
        applyRuntimePatch(sessionId, { statusType: status, updatedAt })
      }
    }

    const nextAttentionIds = new Set<string>()
    for (const [sid, evt] of Object.entries(input.attentionBySession || {})) {
      const sessionId = String(sid || '').trim()
      if (!sessionId) continue
      nextAttentionIds.add(sessionId)
      const kind = asRecord(evt)?.kind
      const attention = kind === 'permission' || kind === 'question' ? kind : null
      const updatedAt = readAt(evt) || Date.now()
      applyRuntimePatch(sessionId, { attention, updatedAt })
    }

    // Clear attention only for sessions that previously had one.
    for (const sid of syncedAttentionSessionIds) {
      if (nextAttentionIds.has(sid)) continue
      applyRuntimePatch(sid, { attention: null, updatedAt: Date.now() })
    }
    syncedAttentionSessionIds = nextAttentionIds

    for (const [sid, activity] of Object.entries(input.activitySnapshot || {})) {
      const sessionId = String(sid || '').trim()
      if (!sessionId) continue
      const phase = readRuntimePhase(asRecord(activity)?.type)
      if (phase) {
        applyRuntimePatch(sessionId, { phase, updatedAt: Date.now() })
      }
    }

    if (!runtimeChanged) return

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
  }

  function applyGlobalEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (!type) return

    // When using a single global SSE connection, sidebar patch + prefs events
    // can arrive through /api/global/event. Reuse the existing handlers.
    if (type === 'chat-sidebar.patch' || type === 'sessions-sidebar.patch') {
      applyChatSidebarPatchEvent(evt)
      return
    }
    if (type === 'chat-sidebar-preferences.patch' || type === 'sessions-sidebar-preferences.patch') {
      applyChatSidebarPreferencesEvent(evt)
      return
    }
    const sessionId = extractSessionId(evt)
    const eventUpdatedAt = readEventUpdatedAt(evt)
    const runtimePatch = (patch: Partial<SessionRuntimeState>): Partial<SessionRuntimeState> => {
      if (eventUpdatedAt === undefined) return patch
      return { ...patch, updatedAt: eventUpdatedAt }
    }

    if (type === 'session.created' || type === 'session.updated') {
      const props = readEventProperties(evt)
      const sessionPayload = props.session ?? props.value ?? props.data ?? null
      if (asRecord(sessionPayload)) {
        upsertSessionSummaryPatch(sessionPayload)
      } else {
        const sid = sessionId
        if (sid) {
          const title = typeof props?.title === 'string' ? props.title.trim() : ''
          const slug = typeof props?.slug === 'string' ? props.slug.trim() : ''
          if (title || slug) {
            upsertSessionSummaryPatch({
              id: sid,
              ...(title ? { title } : {}),
              ...(slug ? { slug } : {}),
            })
          }
        }
      }

      if (type === 'session.created' && sessionId) {
        void hydrateSessionSummariesByIds([sessionId]).catch(() => {})
      }
    }

    const activity = extractSessionActivityUpdate(evt)
    if (activity?.sessionID) {
      const phase =
        activity.phase === 'idle' || activity.phase === 'busy' || activity.phase === 'cooldown'
          ? activity.phase
          : 'unknown'
      upsertRuntime(activity.sessionID, runtimePatch({ phase }))
    }

    if (!sessionId) return

    if (type === 'session.deleted') {
      removeSessionFromAggregates(sessionId)
      return
    }

    if (type === 'session.status') {
      const statusType = readRuntimeStatusType(asRecord(readEventProperties(evt).status)?.type)
      if (statusType) {
        upsertRuntime(sessionId, runtimePatch({ statusType }))
      }
      return
    }

    if (type === 'session.idle') {
      upsertRuntime(sessionId, runtimePatch({ statusType: 'idle', phase: 'idle', attention: null }))
      return
    }

    if (type === 'session.error') {
      upsertRuntime(sessionId, runtimePatch({ statusType: 'idle', phase: 'idle', attention: null }))
      return
    }

    if (type === 'permission.asked') {
      upsertRuntime(sessionId, runtimePatch({ attention: 'permission' }))
      return
    }

    if (type === 'question.asked') {
      upsertRuntime(sessionId, runtimePatch({ attention: 'question' }))
      return
    }

    if (type === 'permission.replied' || type === 'question.replied' || type === 'question.rejected') {
      upsertRuntime(sessionId, runtimePatch({ attention: null }))
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

  function applyChatSidebarPatchEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.patch' && type !== 'sessions-sidebar.patch') return

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

    // Apply all ops against local drafts and commit once.
    const baseSummaries = sessionSummariesById.value
    let nextSummaries = baseSummaries
    let summariesChanged = false
    const ensureSummaries = () => {
      if (summariesChanged) return
      nextSummaries = { ...baseSummaries }
      summariesChanged = true
    }

    const baseDirectoryBySession = directoryIdBySessionId.value
    let nextDirectoryBySession = baseDirectoryBySession
    let directoryBySessionChanged = false
    const ensureDirectoryBySession = () => {
      if (directoryBySessionChanged) return
      nextDirectoryBySession = { ...baseDirectoryBySession }
      directoryBySessionChanged = true
    }

    const baseDirectories = directoriesById.value
    let nextDirectories = baseDirectories
    let directoriesChanged = false
    const ensureDirectories = () => {
      if (directoriesChanged) return
      nextDirectories = { ...baseDirectories }
      directoriesChanged = true
    }

    const baseDirectoryOrder = directoryOrder.value
    let nextOrder = baseDirectoryOrder
    let orderChanged = false
    const ensureOrder = () => {
      if (orderChanged) return
      nextOrder = baseDirectoryOrder.slice()
      orderChanged = true
    }

    const basePagesByDirectory = sessionPageByDirectoryId.value
    let nextPagesByDirectory = basePagesByDirectory
    let pagesChanged = false
    const ensurePages = () => {
      if (pagesChanged) return
      nextPagesByDirectory = { ...basePagesByDirectory }
      pagesChanged = true
    }

    const basePinnedIdsByDirectory = pinnedSessionIdsByDirectoryId.value
    let nextPinnedIdsByDirectory = basePinnedIdsByDirectory
    let pinnedIdsChanged = false
    const ensurePinnedIds = () => {
      if (pinnedIdsChanged) return
      nextPinnedIdsByDirectory = { ...basePinnedIdsByDirectory }
      pinnedIdsChanged = true
    }

    const basePinnedKeyByDirectory = pinnedSummaryKeyByDirectoryId.value
    let nextPinnedKeyByDirectory = basePinnedKeyByDirectory
    let pinnedKeyChanged = false
    const ensurePinnedKey = () => {
      if (pinnedKeyChanged) return
      nextPinnedKeyByDirectory = { ...basePinnedKeyByDirectory }
      pinnedKeyChanged = true
    }

    const baseWorktreesByDirectory = worktreePathsByDirectoryId.value
    let nextWorktreesByDirectory = baseWorktreesByDirectory
    let worktreesChanged = false
    const ensureWorktrees = () => {
      if (worktreesChanged) return
      nextWorktreesByDirectory = { ...baseWorktreesByDirectory }
      worktreesChanged = true
    }

    const baseWorktreeLoadingByDirectory = worktreeLoadingByDirectoryId.value
    let nextWorktreeLoadingByDirectory = baseWorktreeLoadingByDirectory
    let worktreeLoadingChanged = false
    const ensureWorktreeLoading = () => {
      if (worktreeLoadingChanged) return
      nextWorktreeLoadingByDirectory = { ...baseWorktreeLoadingByDirectory }
      worktreeLoadingChanged = true
    }

    const baseAggregateLoadingByDirectory = aggregateLoadingByDirectoryId.value
    let nextAggregateLoadingByDirectory = baseAggregateLoadingByDirectory
    let aggregateLoadingChanged = false
    const ensureAggregateLoading = () => {
      if (aggregateLoadingChanged) return
      nextAggregateLoadingByDirectory = { ...baseAggregateLoadingByDirectory }
      aggregateLoadingChanged = true
    }

    const baseAggregateAttemptedByDirectory = aggregateAttemptedByDirectoryId.value
    let nextAggregateAttemptedByDirectory = baseAggregateAttemptedByDirectory
    let aggregateAttemptedChanged = false
    const ensureAggregateAttempted = () => {
      if (aggregateAttemptedChanged) return
      nextAggregateAttemptedByDirectory = { ...baseAggregateAttemptedByDirectory }
      aggregateAttemptedChanged = true
    }

    const baseRuntime = runtimeBySessionId.value
    let nextRuntime = baseRuntime
    let runtimeChanged = false
    const ensureRuntime = () => {
      if (runtimeChanged) return
      nextRuntime = { ...baseRuntime }
      runtimeChanged = true
    }

    let recentChanged = false
    let nextRecentTotal = recentIndexTotal.value
    const recentById = new Map<string, RecentIndexEntry>(
      (recentIndex.value || []).map((item) => [item.sessionId, item] as const),
    )

    const removedDirectoryIds = new Set<string>()
    const touchedDirectoryIds = new Set<string>()
    const touchedRunningSessionIds = new Set<string>()

    const directoryIdForPathDraft = (directoryPath: string): string | null => {
      const normalized = normalizeDirForCompare(directoryPath)
      if (!normalized) return null
      for (const id of nextOrder) {
        const entry = nextDirectories[id]
        if (!entry) continue
        if (normalizeDirForCompare(entry.path) === normalized) return entry.id
      }
      return null
    }

    const removeRecentIfPresent = (sid: string) => {
      if (!recentById.has(sid)) return
      recentById.delete(sid)
      nextRecentTotal = Math.max(0, nextRecentTotal - 1)
      recentChanged = true
    }

    const upsertRecent = (entry: RecentIndexEntry) => {
      recentById.set(entry.sessionId, entry)
      recentChanged = true
    }

    const deleteDirectoryCaches = (directoryId: string) => {
      const did = (directoryId || '').trim()
      if (!did) return
      ensurePages()
      delete nextPagesByDirectory[did]

      ensurePinnedIds()
      delete nextPinnedIdsByDirectory[did]

      ensurePinnedKey()
      delete nextPinnedKeyByDirectory[did]

      ensureWorktrees()
      delete nextWorktreesByDirectory[did]

      ensureWorktreeLoading()
      delete nextWorktreeLoadingByDirectory[did]

      ensureAggregateLoading()
      delete nextAggregateLoadingByDirectory[did]

      ensureAggregateAttempted()
      delete nextAggregateAttemptedByDirectory[did]
    }

    const removeSessionFromDraft = (sid: string, opts?: { preserveRuntime?: boolean }) => {
      const sessionId = (sid || '').trim()
      if (!sessionId) return
      const existingSummary = nextSummaries[sessionId] || null
      const sessionWasRoot = existingSummary ? !readParentId(existingSummary) : false

      const mappedDirectoryId = String(nextDirectoryBySession[sessionId] || '').trim()
      if (mappedDirectoryId) {
        touchedDirectoryIds.add(mappedDirectoryId)

        // Best-effort remove from cached directory page lists so totals stay sane.
        if (nextPagesByDirectory[mappedDirectoryId]) {
          ensurePages()
          const page = nextPagesByDirectory[mappedDirectoryId]
          if (page) {
            const containsSession = page.sessions.some((session) => readObjectId(session) === sessionId)
            const decrementRootTotal = sessionWasRoot
            if (containsSession || decrementRootTotal) {
              const filtered = containsSession
                ? page.sessions.filter((session) => readObjectId(session) !== sessionId)
                : page.sessions
              const removedRootCount = containsSession
                ? page.sessions.filter((session) => {
                    const id = readObjectId(session)
                    return id === sessionId && !readParentId(session)
                  }).length
                : 0
              const rootDelta = removedRootCount > 0 ? removedRootCount : decrementRootTotal ? 1 : 0
              const totalRoots =
                typeof page?.totalRoots === 'number' && Number.isFinite(page.totalRoots)
                  ? Math.max(0, page.totalRoots - rootDelta)
                  : page?.totalRoots
              nextPagesByDirectory[mappedDirectoryId] = {
                ...page,
                totalRoots: typeof totalRoots === 'number' ? totalRoots : 0,
                sessions: filtered,
              }
            }
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(nextSummaries, sessionId)) {
        ensureSummaries()
        delete nextSummaries[sessionId]
      }
      if (Object.prototype.hasOwnProperty.call(nextDirectoryBySession, sessionId)) {
        ensureDirectoryBySession()
        delete nextDirectoryBySession[sessionId]
      }
      if (!opts?.preserveRuntime && Object.prototype.hasOwnProperty.call(nextRuntime, sessionId)) {
        ensureRuntime()
        delete nextRuntime[sessionId]
      }

      removeRecentIfPresent(sessionId)
      touchedRunningSessionIds.add(sessionId)
    }

    const applySessionSummaryPatchDraft = (incomingRaw: JsonValue) => {
      const sid = readObjectId(incomingRaw)
      if (!sid) return

      const incoming = asRecord(incomingRaw) || {}
      const previous = nextSummaries[sid] || null
      const previousUpdatedAt = readUpdatedAt(previous)
      const incomingUpdatedAt = readUpdatedAt(incoming)

      if (previous && previousUpdatedAt > 0 && incomingUpdatedAt > 0 && incomingUpdatedAt < previousUpdatedAt) {
        return
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
        const mergedUpdatedAt =
          incomingUpdatedAt > 0 ? Math.max(previousUpdatedAt, incomingUpdatedAt) : previousUpdatedAt
        if (mergedUpdatedAt > 0) {
          nextTime.updated = mergedUpdatedAt
        }
        merged.time = nextTime
      }

      if (previous && jsonLikeDeepEqual(previous, merged)) {
        return
      }

      ensureSummaries()
      nextSummaries[sid] = merged

      const previousDirectoryId = String(nextDirectoryBySession[sid] || '').trim()
      let mappedDirectoryId = previousDirectoryId
      const patchDirectory = readSessionDirectory(merged)
      const byPath = patchDirectory ? directoryIdForPathDraft(patchDirectory) : null
      if (byPath) mappedDirectoryId = byPath
      if (mappedDirectoryId && mappedDirectoryId !== previousDirectoryId) {
        ensureDirectoryBySession()
        nextDirectoryBySession[sid] = mappedDirectoryId
      }

      if (previousDirectoryId && previousDirectoryId !== mappedDirectoryId) {
        const prevPage = nextPagesByDirectory[previousDirectoryId]
        const decrementRootTotal = Boolean(previous && !readParentId(previous))
        const patched = prevPage
          ? removeSessionFromPageState(prevPage, sid, {
              decrementRootTotal,
              readSessionId: readObjectId,
            })
          : null
        if (patched) {
          ensurePages()
          nextPagesByDirectory[previousDirectoryId] = patched
        }
      }

      if (mappedDirectoryId) {
        const currentPage = nextPagesByDirectory[mappedDirectoryId]
        const isNewInDirectory = !previous || previousDirectoryId !== mappedDirectoryId
        const incrementRootTotal = isNewInDirectory && !readParentId(merged)
        const patched = currentPage
          ? upsertSessionInPageState(currentPage, merged, {
              incrementRootTotal,
              maxRootCount: 10,
              readSessionId: readObjectId,
              readParentId,
              equals: jsonLikeDeepEqual,
            })
          : null
        if (patched) {
          ensurePages()
          nextPagesByDirectory[mappedDirectoryId] = patched
        }
      }

      if (previousDirectoryId) touchedDirectoryIds.add(previousDirectoryId)
      if (mappedDirectoryId) touchedDirectoryIds.add(mappedDirectoryId)

      const updatedAt = readUpdatedAt(merged)
      if (mappedDirectoryId) {
        const dirPath =
          String(nextDirectories[mappedDirectoryId]?.path || patchDirectory || '').trim() || patchDirectory
        upsertRecent({ sessionId: sid, directoryId: mappedDirectoryId, directoryPath: dirPath, updatedAt })
        nextRecentTotal = Math.min(RECENT_INDEX_MAX_ITEMS, Math.max(nextRecentTotal, recentById.size))
      }

      touchedRunningSessionIds.add(sid)
    }

    for (const op of ops) {
      switch (op.type) {
        case 'directoryEntry.upsert': {
          const entryRaw = op.entry
          const entryId = (entryRaw.id || '').trim()
          const entryPath = (entryRaw.path || '').trim()
          if (!entryId || !entryPath) break
          if (!nextDirectories[entryId]) {
            ensureOrder()
            nextOrder.push(entryId)
          }
          ensureDirectories()
          const prev = nextDirectories[entryId] || null
          const prevLabel =
            prev && typeof (prev as { label?: unknown }).label === 'string' ? String(prev.label).trim() : ''
          const incomingLabel =
            entryRaw && typeof (entryRaw as { label?: unknown }).label === 'string' ? String(entryRaw.label).trim() : ''

          // Preserve fields that are not included in the server payload (e.g. label from settings)
          // so sidebar SSE patches do not inadvertently erase them.
          nextDirectories[entryId] = {
            ...(prev || {}),
            ...entryRaw,
            id: entryId,
            path: entryPath,
            label: incomingLabel || prevLabel || undefined,
          }
          break
        }
        case 'directoryEntry.remove': {
          const did = (op.directoryId || '').trim()
          if (!did) break
          removedDirectoryIds.add(did)
          if (nextDirectories[did]) {
            ensureDirectories()
            delete nextDirectories[did]
          }
          if (nextOrder.includes(did)) {
            ensureOrder()
            nextOrder = nextOrder.filter((id) => id !== did)
          }
          deleteDirectoryCaches(did)
          break
        }
        case 'sessionSummary.upsert': {
          applySessionSummaryPatchDraft(op.session)
          break
        }
        case 'sessionSummary.remove': {
          removeSessionFromDraft(op.sessionId, { preserveRuntime: true })
          break
        }
        case 'sessionRuntime.upsert': {
          const runtime = op.runtime || null
          const runtimeRecord = asRecord(runtime)
          const sidRaw = runtimeRecord?.sessionID ?? runtimeRecord?.sessionId
          const sid = typeof sidRaw === 'string' ? sidRaw.trim() : ''
          if (!sid) break
          ensureRuntime()
          nextRuntime[sid] = mergeRuntimeState(nextRuntime[sid], runtime)
          touchedRunningSessionIds.add(sid)
          break
        }
        case 'sessionRuntime.remove': {
          const sid = (op.sessionId || '').trim()
          if (!sid) break
          if (Object.prototype.hasOwnProperty.call(nextRuntime, sid)) {
            ensureRuntime()
            delete nextRuntime[sid]
          }
          touchedRunningSessionIds.add(sid)
          // Runtime removal only affects running state; keep recent history intact.
          break
        }
      }
    }

    // Directory removals also evict sessions that were mapped to that directory.
    if (removedDirectoryIds.size > 0) {
      const removeSessionIds = Object.entries(nextDirectoryBySession)
        .filter(([, mappedDirectoryId]) => removedDirectoryIds.has(String(mappedDirectoryId || '').trim()))
        .map(([sid]) => sid)
      for (const sid of removeSessionIds) {
        removeSessionFromDraft(sid)
      }
    }

    if (directoriesChanged) {
      directoriesById.value = nextDirectories
    }
    if (orderChanged) {
      directoryOrder.value = nextOrder
    }
    if (pagesChanged) {
      sessionPageByDirectoryId.value = nextPagesByDirectory
    }
    if (pinnedIdsChanged) {
      pinnedSessionIdsByDirectoryId.value = nextPinnedIdsByDirectory
    }
    if (pinnedKeyChanged) {
      pinnedSummaryKeyByDirectoryId.value = nextPinnedKeyByDirectory
    }
    if (worktreesChanged) {
      worktreePathsByDirectoryId.value = nextWorktreesByDirectory
    }
    if (worktreeLoadingChanged) {
      worktreeLoadingByDirectoryId.value = nextWorktreeLoadingByDirectory
    }
    if (aggregateLoadingChanged) {
      aggregateLoadingByDirectoryId.value = nextAggregateLoadingByDirectory
    }
    if (aggregateAttemptedChanged) {
      aggregateAttemptedByDirectoryId.value = nextAggregateAttemptedByDirectory
    }

    if (summariesChanged) {
      sessionSummariesById.value = nextSummaries
    }
    if (directoryBySessionChanged) {
      directoryIdBySessionId.value = nextDirectoryBySession
    }
    if (runtimeChanged) {
      runtimeBySessionId.value = nextRuntime
    }

    if (touchedDirectoryIds.size > 0) {
      rebuildDirectoryTreeIndexesMany(touchedDirectoryIds)
    }

    if (recentChanged) {
      const merged = Array.from(recentById.values())
      merged.sort((a, b) => {
        const diff = b.updatedAt - a.updatedAt
        if (diff !== 0) return diff
        return a.sessionId.localeCompare(b.sessionId)
      })
      const capped = merged.slice(0, RECENT_INDEX_MAX_ITEMS)
      recentIndex.value = capped
      recentIndexTotal.value = Math.min(RECENT_INDEX_MAX_ITEMS, Math.max(nextRecentTotal, capped.length))
    }

    if (touchedRunningSessionIds.size > 0) {
      for (const sid of touchedRunningSessionIds) {
        const runtime = runtimeBySessionId.value[sid]
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
    }

    if (
      directoriesChanged ||
      orderChanged ||
      pagesChanged ||
      pinnedIdsChanged ||
      pinnedKeyChanged ||
      summariesChanged ||
      directoryBySessionChanged ||
      runtimeChanged ||
      recentChanged ||
      touchedRunningSessionIds.size > 0
    ) {
      scheduleSnapshotPersist()
    }
  }

  function directoryTreeRows(directoryId: string): FlatTreeRow[] {
    const dirId = (directoryId || '').trim()
    if (!dirId) return []
    const list = sessionSummariesByDirectoryId.value[dirId] || []
    const expanded = new Set(uiPrefs.value.expandedParentSessionIds)
    return buildFlattenedTree(list, expanded).rows
  }

  async function hydrateFromSnapshot() {
    const startedAt = metricNowMs()
    uiPrefs.value = loadChatSidebarUiPrefs()
    const snapshot = await loadDirectorySessionSnapshot()
    if (!snapshot) {
      if (import.meta.env.DEV) {
        console.debug('[directorySessionStore] snapshot hydrate', {
          ms: Number((metricNowMs() - startedAt).toFixed(1)),
          hasSnapshot: false,
        })
      }
      return
    }

    setDirectoryEntries(snapshot.directoryEntries)
    const snapshotSummaryEntries: Array<[string, SessionSummarySnapshot]> = []
    for (const session of snapshot.sessionSummaries || []) {
      const sid = readObjectId(session)
      if (!sid) continue
      snapshotSummaryEntries.push([sid, session])
    }
    sessionSummariesById.value = Object.fromEntries(snapshotSummaryEntries)

    const nextDirectoryIdBySessionId: Record<string, string> = {}
    const pathToDirectoryId = Object.fromEntries(
      visibleDirectories.value.map((entry) => [entry.path.trim(), entry.id.trim()]),
    )
    for (const [sid, session] of Object.entries(sessionSummariesById.value)) {
      const path = readSessionDirectory(session)
      const mapped = path ? pathToDirectoryId[path] || '' : ''
      if (mapped) {
        nextDirectoryIdBySessionId[sid] = mapped
      }
    }
    directoryIdBySessionId.value = nextDirectoryIdBySessionId

    rootsByDirectoryId.value = snapshot.rootsByDirectoryId || {}
    childrenByParentSessionId.value = snapshot.childrenByParentSessionId || {}

    runtimeBySessionId.value = Object.fromEntries(
      Object.entries(snapshot.runtimeBySessionId || {}).map(([sid, runtime]) => [sid, normalizeRuntime(runtime)]),
    )

    if (import.meta.env.DEV) {
      console.debug('[directorySessionStore] snapshot hydrate', {
        ms: Number((metricNowMs() - startedAt).toFixed(1)),
        hasSnapshot: true,
        directoryCount: directoryOrder.value.length,
        sessionCount: Object.keys(sessionSummariesById.value).length,
        runtimeCount: Object.keys(runtimeBySessionId.value).length,
      })
    }
  }

  async function revalidateFromApi(opts?: { limitPerDirectory?: number }): Promise<boolean> {
    loading.value = true
    error.value = null
    const limit =
      typeof opts?.limitPerDirectory === 'number' && Number.isFinite(opts.limitPerDirectory)
        ? Math.max(1, Math.floor(opts.limitPerDirectory))
        : 10

    try {
      const collapsedSet = new Set(
        (uiPrefs.value.collapsedDirectoryIds || []).map((id) => String(id || '').trim()).filter(Boolean),
      )
      const expandedDirectoryIds = Array.from(
        new Set(
          visibleDirectories.value.map((entry) => entry.id.trim()).filter((id) => Boolean(id) && !collapsedSet.has(id)),
        ),
      )
      const bootstrapParams = new URLSearchParams()
      bootstrapParams.set('limitPerDirectory', String(limit))
      bootstrapParams.set('expandedDirectoryIds', expandedDirectoryIds.join(','))

      const bootstrap = await apiJson<DirectorySessionsBootstrapWire>(
        `${SIDEBAR_BOOTSTRAP_ENDPOINT}?${bootstrapParams.toString()}`,
      )
      lastSidebarPatchSeq = resolveSidebarSeqAfterBootstrap({
        currentSeq: lastSidebarPatchSeq,
        bootstrapSeq: bootstrap?.seq,
        outOfSync: sidebarPatchOutOfSync,
        sawReset: sidebarPatchSawSeqReset,
      })

      const entries = normalizeDirectories(bootstrap?.directoryEntries || [])
      setDirectoryEntries(entries)

      const directoryIdSet = new Set(entries.map((entry) => entry.id))
      const pagesByDirectoryId = asRecord(bootstrap?.sessionSummariesByDirectoryId) || {}
      const runtimePayload = asRecord(bootstrap?.runtimeBySessionId) || {}

      const nextPageByDirectoryId: Record<string, DirectorySessionPageState> = {}
      const nextSessionSummariesById: Record<string, SessionSummarySnapshot> = {}
      const nextDirectoryIdBySessionId: Record<string, string> = {}
      const nextAggregateAttemptedByDirectoryId: Record<string, boolean> = {}

      for (const entry of entries) {
        if (!Object.prototype.hasOwnProperty.call(pagesByDirectoryId, entry.id)) continue
        const page = parseSessionPagePayload(pagesByDirectoryId[entry.id], limit)
        const degraded = isDegradedConsistency(page.consistency)
        if (degraded) {
          scheduleAggregateReloadRetry(
            entry.id,
            entry.path,
            {
              pinnedSessionIds: uiPrefs.value.pinnedSessionIds || [],
              page: 0,
              pageSize: limit,
              includeWorktrees: false,
              force: true,
            },
            retryDelayFromConsistency(page.consistency, 220),
          )
        } else {
          clearAggregateReloadRetry(entry.id)
        }

        const existingPage = sessionPageByDirectoryId.value[entry.id]
        const preserveExisting =
          degraded &&
          page.sessions.length === 0 &&
          Array.isArray(existingPage?.sessions) &&
          existingPage.sessions.length > 0

        const effectivePage = preserveExisting && existingPage ? existingPage : page
        nextPageByDirectoryId[entry.id] = effectivePage
        nextAggregateAttemptedByDirectoryId[entry.id] = true
        for (const session of effectivePage.sessions) {
          const sid = readObjectId(session)
          if (!sid) continue
          nextSessionSummariesById[sid] = session
          nextDirectoryIdBySessionId[sid] = entry.id
        }
      }

      sessionPageByDirectoryId.value = nextPageByDirectoryId
      sessionSummariesById.value = nextSessionSummariesById
      directoryIdBySessionId.value = nextDirectoryIdBySessionId
      aggregateAttemptedByDirectoryId.value = nextAggregateAttemptedByDirectoryId

      pinnedSessionIdsByDirectoryId.value = Object.fromEntries(
        Object.entries(pinnedSessionIdsByDirectoryId.value).filter(([directoryId]) => directoryIdSet.has(directoryId)),
      )
      pinnedSummaryKeyByDirectoryId.value = Object.fromEntries(
        Object.entries(pinnedSummaryKeyByDirectoryId.value).filter(([directoryId]) => directoryIdSet.has(directoryId)),
      )
      worktreePathsByDirectoryId.value = Object.fromEntries(
        Object.entries(worktreePathsByDirectoryId.value).filter(([directoryId]) => directoryIdSet.has(directoryId)),
      )

      const existingRuntime = runtimeBySessionId.value
      runtimeBySessionId.value = Object.fromEntries(
        Object.entries(runtimePayload).map(([sid, runtime]) => {
          return [sid, mergeRuntimeState(existingRuntime[sid], toRuntimeSnapshot(runtime))]
        }),
      )

      rootsByDirectoryId.value = {}
      childrenByParentSessionId.value = {}
      for (const entry of entries) {
        rebuildDirectoryTreeIndexes(entry.id)
      }

      scheduleSnapshotPersist()

      // Core sidebar bootstrap succeeded: resume patch consumption immediately.
      // (Footer indexes are best-effort and must not keep us frozen.)
      sidebarPatchOutOfSync = false
      sidebarPatchSawSeqReset = false
      stopSidebarPatchRetry()

      // Best-effort background hydration: do not fail the revalidate if these calls error.
      try {
        await Promise.allSettled([
          loadRecentIndexSlice({ offset: 0, limit: RECENT_INDEX_DEFAULT_LIMIT, append: false }),
          loadRunningIndexSlice({ offset: 0, limit: RUNNING_INDEX_DEFAULT_LIMIT, append: false }),
        ])
      } catch {
        // ignore
      }

      try {
        const recentPage = Math.max(0, Math.floor(uiPrefs.value.recentSessionsPage || 0))
        const runningPage = Math.max(0, Math.floor(uiPrefs.value.runningSessionsPage || 0))
        await Promise.allSettled([
          ensureRecentSessionRowsLoaded({ page: recentPage, pageSize: FOOTER_PAGE_SIZE_DEFAULT }),
          ensureRunningSessionRowsLoaded({ page: runningPage, pageSize: FOOTER_PAGE_SIZE_DEFAULT }),
          ensurePinnedSessionRowsLoaded(uiPrefs.value.pinnedSessionIds || []),
        ])
      } catch {
        // ignore
      }

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      loading.value = false
    }
  }

  async function bootstrapWithStaleWhileRevalidate() {
    await hydrateFromSnapshot()
    await revalidateUiPrefsFromApi()
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
    directoryPageLoadSeq = 0
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
    clearAllAggregateReloadRetries()
    syncedAttentionSessionIds = new Set<string>()

    directoriesById.value = {}
    directoryOrder.value = []
    sessionSummariesById.value = {}
    directoryIdBySessionId.value = {}
    rootsByDirectoryId.value = {}
    childrenByParentSessionId.value = {}
    runtimeBySessionId.value = {}
    sessionPageByDirectoryId.value = {}
    pinnedSessionIdsByDirectoryId.value = {}
    pinnedSummaryKeyByDirectoryId.value = {}
    worktreePathsByDirectoryId.value = {}
    worktreeLoadingByDirectoryId.value = {}
    aggregateLoadingByDirectoryId.value = {}
    aggregateAttemptedByDirectoryId.value = {}
    recentIndex.value = []
    recentIndexTotal.value = 0
    runningIndex.value = []
    runningIndexTotal.value = 0
    directoryPageRows.value = []
    directoryPageTotal.value = 0
    directoryPageLoading.value = false
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
    pinnedSummariesByDirectoryId,
    pinnedSummaryKeyByDirectoryId,
    worktreePathsByDirectoryId,
    worktreeLoadingByDirectoryId,
    aggregateLoadingByDirectoryId,
    aggregateAttemptedByDirectoryId,
    recentIndex,
    recentIndexTotal,
    runningIndex,
    runningIndexTotal,
    directoryPageRows,
    directoryPageTotal,
    directoryPageLoading,
    uiPrefs,
    loading,
    error,
    visibleDirectories,
    runningSidebarRows,
    recentSidebarRows,
    sessionSummariesByDirectoryId,
    allSessionIndexById,
    directoryTreeRows,
    hasCachedSessionsForDirectory,
    aggregatedSessionsForDirectory,
    sessionRootPageCount,
    sessionRootPage,
    setSessionRootPage,
    patchUiPrefs,
    setDirectoryEntries,
    loadDirectoryPage,
    upsertDirectorySessionSummaries,
    upsertRuntime,
    upsertSessionSummaryPatch,
    removeSessionFromAggregates,
    ensureDirectoryAggregateLoaded,
    resolveDirectoryForSession,
    ensureRunningSessionRowsLoaded,
    ensureRecentSessionRowsLoaded,
    ensurePinnedSessionRowsLoaded,
    statusLabelForSessionId,
    isSessionRuntimeActive,
    syncRuntimeFromStores,
    applyGlobalEvent,
    applyChatSidebarPatchEvent,
    applyChatSidebarPreferencesEvent,
    // Backward-compatible aliases for in-progress naming migration.
    applySessionsSidebarPatchEvent: applyChatSidebarPatchEvent,
    applySessionsSidebarPreferencesEvent: applyChatSidebarPreferencesEvent,
    getSidebarPatchCursor,
    hydrateFromSnapshot,
    revalidateUiPrefsFromApi,
    revalidateFromApi,
    bootstrapWithStaleWhileRevalidate,
    persistSnapshot,
    resetAllPersistedState,
  }
})
