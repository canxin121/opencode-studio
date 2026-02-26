import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import * as chatApi from './chat/api'
import type { SseEvent } from '../lib/sse'
import type {
  AttentionEvent,
  MessageEntry,
  SessionError,
  SessionErrorClassification,
  SessionErrorEvent,
  Session,
  SessionFileDiff,
  SessionRunConfig,
  SessionStatus,
  SessionStatusEvent,
} from '../types/chat'

import { clampText, extractSessionId, normalizeMessageInfoFromSse, safeJson } from './chat/reducers'

import { refreshAttentionForSession } from './chat/attention'
import {
  rejectQuestionForSession,
  replyPermissionToSession,
  replyQuestionToSession,
  sendMessageToSession,
  sendTextToSession,
} from './chat/actions'
import { upsertMessageEntryIn } from './chat/messageIndex'
import {
  createSessionRunConfigPersister,
  extractRunConfigFromMessageInfo,
  loadSessionRunConfigMap,
} from './chat/runConfig'
import { STORAGE_LAST_SESSION, STORAGE_RUN_CONFIG } from './chat/storeKeys'
import { applyStreamingEventToMessages } from './chat/streaming'
import type { JsonObject as UnknownRecord, JsonValue } from '@/types/json'

import { ApiError } from '../lib/api'

export type {
  AttentionEvent,
  MessageEntry,
  MessageInfo,
  MessagePart,
  Session,
  SessionError,
  SessionErrorEvent,
  SessionRunConfig,
  SessionFileDiff,
  SessionStatus,
  SessionStatusEvent,
} from '../types/chat'
import { useSettingsStore } from './settings'
import { useDirectoryStore } from './directory'
import { useDirectorySessionStore } from './directorySessionStore'
import { useToastsStore } from './toasts'

export const useChatStore = defineStore('chat', () => {
  const settings = useSettingsStore()
  const directoryStore = useDirectoryStore()
  const directorySessions = useDirectorySessionStore()
  const toasts = useToastsStore()

  // Keep session list fetches bounded; sidebar has its own paging.
  const SESSION_PAGE_SIZE = 30
  const MESSAGE_PAGE_SIZE = 120
  const SESSION_DIFF_PAGE_SIZE = 40

  const partDetailInFlight = new Map<string, Promise<void>>()

  // Sessions are directory-scoped; keep a cache by directory.
  const sessionsByDirectory = ref<Record<string, Session[]>>({})
  const sessionDirectoryById = ref<Record<string, string>>({})
  // Session selection must remain stable even when current directory changes.
  const sessionsById = ref<Record<string, Session>>({})
  const sessions = ref<Session[]>([])
  const sessionsLoading = ref(false)
  const sessionsError = ref<string | null>(null)

  const selectedSessionId = ref<string | null>(null)
  const messagesBySession = ref<Record<string, MessageEntry[]>>({})
  const messagesHydratedBySession = ref<Record<string, boolean>>({})
  const messages = computed<MessageEntry[]>(() => {
    const sid = selectedSessionId.value
    if (!sid) return []
    const list = messagesBySession.value[sid]
    return Array.isArray(list) ? list : []
  })
  const messagesLoading = ref(false)
  const messagesError = ref<string | null>(null)

  // Progressive history loading (increase window when user scrolls up).
  const historyLimitBySession = ref<Record<string, number>>({})
  const historyLoadingBySession = ref<Record<string, boolean>>({})
  const historyExhaustedBySession = ref<Record<string, boolean>>({})

  // Actions like revert/fork can populate the composer.
  const pendingInputText = ref('')
  const pendingInputParts = ref<JsonValue[]>([])

  // Composer drafts are per-session (survive route changes).
  const composerDraftBySession = ref<Record<string, string>>({})

  const attentionBySession = ref<Record<string, AttentionEvent>>({})
  const sessionStatusBySession = ref<Record<string, SessionStatusEvent>>({})
  const sessionErrorBySession = ref<Record<string, SessionErrorEvent>>({})
  const sessionDiffBySession = ref<Record<string, SessionFileDiff[]>>({})
  const sessionDiffHasMoreBySession = ref<Record<string, boolean>>({})
  const sessionDiffNextOffsetBySession = ref<Record<string, number>>({})
  const sessionDiffLimitBySession = ref<Record<string, number>>({})
  const sessionDiffLoadingBySession = ref<Record<string, boolean>>({})
  const sessionDiffLoadingMoreBySession = ref<Record<string, boolean>>({})
  const sessionDiffErrorBySession = ref<Record<string, string | null>>({})
  const sessionRunConfigBySession = ref<Record<string, SessionRunConfig>>({})

  // Simple debounce so we can respond to high-frequency SSE updates.
  let refreshTimer: number | null = null
  let refreshMessagesTimer: number | null = null
  const refreshMessagesRetryTimerBySession = new Map<string, number>()
  let selectSeq = 0
  let lastGlobalErrorToastAt = 0
  const lastSessionErrorToastByKey = new Map<string, { at: number; message: string }>()
  let createSessionInFlight: Promise<Session | null> | null = null

  function clearMessageRefreshRetry(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const timer = refreshMessagesRetryTimerBySession.get(sid)
    if (typeof timer === 'number') {
      window.clearTimeout(timer)
      refreshMessagesRetryTimerBySession.delete(sid)
    }
  }

  function scheduleMessageRefreshRetry(sessionId: string, delayMs: number, opts?: { limit?: number }) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (refreshMessagesRetryTimerBySession.has(sid)) return
    const delay = Math.max(60, Math.min(10_000, Math.floor(delayMs || 180)))
    const timer = window.setTimeout(() => {
      refreshMessagesRetryTimerBySession.delete(sid)
      void refreshMessages(sid, {
        silent: true,
        ...(typeof opts?.limit === 'number' ? { limit: opts.limit } : {}),
      }).catch(() => {})
    }, delay)
    refreshMessagesRetryTimerBySession.set(sid, timer)
  }

  function asRecord(value: JsonValue): UnknownRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value
  }

  function readSessionId(value: JsonValue): string {
    const id = asRecord(value)?.id
    return typeof id === 'string' ? id.trim() : ''
  }

  function readSessionDirectory(value: JsonValue): string {
    const directory = asRecord(value)?.directory
    return typeof directory === 'string' ? directory.trim() : ''
  }

  function readEventProperties(evt: SseEvent): UnknownRecord {
    return asRecord(evt.properties) || {}
  }

  type SessionErrorClassificationOrEmpty = SessionErrorClassification | ''

  function normalizeErrorClassification(value: JsonValue): SessionErrorClassificationOrEmpty {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (
      normalized === 'context_overflow' ||
      normalized === 'provider_auth' ||
      normalized === 'network' ||
      normalized === 'provider_api' ||
      normalized === 'unknown'
    ) {
      return normalized
    }
    return ''
  }

  function classificationFallbackMessage(classification: SessionErrorClassificationOrEmpty): string {
    switch (classification) {
      case 'context_overflow':
        return 'Input exceeds the model context window. Reduce context and retry.'
      case 'provider_auth':
        return 'Provider authentication failed. Reconnect provider credentials and retry.'
      case 'network':
        return 'Network error while contacting the model provider. Check connectivity and retry.'
      case 'provider_api':
        return 'The model provider returned an API error. Retry or switch model/provider.'
      default:
        return ''
    }
  }

  function parseJsonSafe(text: string): JsonValue | null {
    try {
      const parsed = JSON.parse(text)
      return parsed as JsonValue
    } catch {
      return null
    }
  }

  function readString(value: JsonValue): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  function firstNonEmpty(values: Array<string | null | undefined>): string {
    for (const value of values) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text) return text
    }
    return ''
  }

  function readErrorMessageFromJsonLike(value: JsonValue): string {
    const obj = asRecord(value)
    if (!obj) return ''
    const nested = asRecord(obj.error)
    return firstNonEmpty([readString(obj.message), readString(nested?.message), readString(obj.error)])
  }

  function nonEmptyJsonPreview(value: JsonValue): string {
    const record = asRecord(value)
    if (record && Object.keys(record).length === 0) return ''
    return clampText(safeJson(value), 260)
  }

  function normalizeSessionError(evt: SseEvent): {
    message: string
    rendered: string
    code: string
    name: string
    classification: SessionErrorClassificationOrEmpty
    details: SessionError
  } {
    const props = readEventProperties(evt)
    const rawErr = props.error
    const err = asRecord(rawErr)
    const data = asRecord(err?.data)
    const nestedError = asRecord(err?.error)
    const metadata = asRecord(data?.metadata)

    const responseBody = readString(data?.responseBody)
    const responseBodyMessage = responseBody ? readErrorMessageFromJsonLike(parseJsonSafe(responseBody)) : ''

    const message = firstNonEmpty([
      readString(err?.message),
      readString(data?.message),
      readString(nestedError?.message),
      responseBodyMessage,
      readString(props.message),
      typeof rawErr === 'string' ? rawErr : '',
    ])

    const code = firstNonEmpty([
      readString(err?.code),
      readString(data?.code),
      readString(nestedError?.code),
      readString(metadata?.code),
    ])

    const name = firstNonEmpty([readString(err?.name), readString(err?.type), readString(nestedError?.type)])

    const classification = normalizeErrorClassification(props.classification)
    const fallback = classificationFallbackMessage(classification)
    const rawPreview = nonEmptyJsonPreview(err) || nonEmptyJsonPreview(rawErr)
    const rendered = message || rawPreview || fallback || (code ? `[${code}] Session error` : 'Session error')

    const details: SessionError = {
      message: message || fallback || (code ? `[${code}] Session error` : 'Session error'),
      rendered,
      ...(code ? { code } : {}),
      ...(name ? { name } : {}),
      ...(classification ? { classification } : {}),
      raw: rawErr ?? props,
    }

    return { message, rendered, code, name, classification, details }
  }

  function pushErrorToastWithDedupe(key: string, message: string, timeoutMs = 4500, dedupeWindowMs = 1200) {
    const dedupeKey = (key || '').trim() || '__global__'
    const msg = (message || '').trim()
    if (!msg) return
    const now = Date.now()
    const prev = lastSessionErrorToastByKey.get(dedupeKey)
    if (prev && prev.message === msg && now - prev.at < Math.max(0, Math.floor(dedupeWindowMs))) return
    lastSessionErrorToastByKey.set(dedupeKey, { at: now, message: msg })
    toasts.push('error', msg, timeoutMs)
  }

  function scheduleSessionsRefresh(delayMs = 250) {
    const delay = Math.max(0, Math.floor(delayMs))
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null
      void refreshSessions()
    }, delay)
  }

  function getSessionById(sessionId: string | null | undefined): Session | null {
    const sid = (sessionId || '').trim()
    if (!sid) return null
    return sessionsById.value[sid] ?? sessions.value.find((s) => s.id === sid) ?? null
  }

  const selectedSession = computed(() => getSessionById(selectedSessionId.value))

  const selectedSessionDirectory = computed(() => {
    const id = selectedSessionId.value
    if (!id) return directoryStore.currentDirectory
    const mapped = sessionDirectoryById.value[id]
    if (mapped && mapped.trim()) return mapped.trim()
    const direct = selectedSession.value
    const sd = typeof direct?.directory === 'string' ? direct.directory.trim() : ''
    if (sd) return sd
    return directoryStore.currentDirectory
  })

  function setPendingComposer(text: string, parts?: JsonValue[]) {
    pendingInputText.value = (text || '').trim()
    pendingInputParts.value = Array.isArray(parts) ? parts : []
  }

  function consumePendingComposer(): { text: string; parts: JsonValue[] } {
    const value = { text: pendingInputText.value, parts: pendingInputParts.value }
    pendingInputText.value = ''
    pendingInputParts.value = []
    return value
  }

  function getComposerDraft(sessionId: string): string {
    const sid = (sessionId || '').trim()
    if (!sid) return ''
    const v = composerDraftBySession.value[sid]
    return typeof v === 'string' ? v : ''
  }

  function setComposerDraft(sessionId: string, text: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    composerDraftBySession.value[sid] = String(text ?? '')
  }

  function clearComposerDraft(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (Object.prototype.hasOwnProperty.call(composerDraftBySession.value, sid)) {
      const next = { ...composerDraftBySession.value }
      delete next[sid]
      composerDraftBySession.value = next
    }
  }

  const selectedAttention = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return null
    return attentionBySession.value[sid] ?? null
  })

  async function refreshAttention(sessionId: string) {
    return refreshAttentionForSession({
      sessionId,
      getDirectoryForSession,
      attentionBySession,
      sessionStatusBySession,
    })
  }

  const selectedSessionStatus = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return null
    return sessionStatusBySession.value[sid] ?? null
  })

  const selectedSessionError = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return null
    return sessionErrorBySession.value[sid] ?? null
  })

  const selectedSessionRunConfig = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return null
    return sessionRunConfigBySession.value[sid] ?? null
  })

  const selectedSessionDiff = computed<SessionFileDiff[]>(() => {
    const sid = selectedSessionId.value
    if (!sid) return []
    const list = sessionDiffBySession.value[sid]
    return Array.isArray(list) ? list : []
  })

  const selectedSessionDiffLoaded = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return false
    return Object.prototype.hasOwnProperty.call(sessionDiffBySession.value, sid)
  })

  const selectedSessionDiffLoading = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return false
    return Boolean(sessionDiffLoadingBySession.value[sid])
  })

  const selectedSessionDiffLoadingMore = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return false
    return Boolean(sessionDiffLoadingMoreBySession.value[sid])
  })

  const selectedSessionDiffHasMore = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return false
    return Boolean(sessionDiffHasMoreBySession.value[sid])
  })

  const selectedSessionDiffError = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return null
    const message = sessionDiffErrorBySession.value[sid]
    return typeof message === 'string' && message.trim() ? message : null
  })

  // Restore persisted run config so the UI can show resolved model/agent after reload.
  sessionRunConfigBySession.value = loadSessionRunConfigMap(STORAGE_RUN_CONFIG)

  function getDirectoryForSession(sessionId: string): string | null {
    const sid = (sessionId || '').trim()
    if (!sid) return directoryStore.currentDirectory
    const mapped = sessionDirectoryById.value[sid]
    if (mapped && mapped.trim()) return mapped.trim()
    return directoryStore.currentDirectory
  }

  function ensureSessionMessages(sessionId: string): MessageEntry[] {
    const sid = (sessionId || '').trim()
    if (!sid) return []
    const existing = messagesBySession.value[sid]
    if (Array.isArray(existing)) return existing
    messagesBySession.value = { ...messagesBySession.value, [sid]: [] }
    return messagesBySession.value[sid] as MessageEntry[]
  }

  function markMessagesHydrated(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (messagesHydratedBySession.value[sid]) return
    messagesHydratedBySession.value = { ...messagesHydratedBySession.value, [sid]: true }
  }

  function clearMessagesHydrated(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (!Object.prototype.hasOwnProperty.call(messagesHydratedBySession.value, sid)) return
    const next = { ...messagesHydratedBySession.value }
    delete next[sid]
    messagesHydratedBySession.value = next
  }

  const runConfigPersister = createSessionRunConfigPersister(STORAGE_RUN_CONFIG, () => sessionRunConfigBySession.value)

  function upsertSessionRunConfig(sessionId: string, patch: Partial<SessionRunConfig>, at?: number) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const now = typeof at === 'number' && Number.isFinite(at) ? at : Date.now()
    const prev = sessionRunConfigBySession.value[sid] || { at: 0 }
    const next: SessionRunConfig = {
      ...prev,
      ...patch,
      at: Math.max(prev.at || 0, now),
    }
    sessionRunConfigBySession.value = { ...sessionRunConfigBySession.value, [sid]: next }
    runConfigPersister.persistSoon()
  }

  function clearSessionError(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (!Object.prototype.hasOwnProperty.call(sessionErrorBySession.value, sid)) return
    const next = { ...sessionErrorBySession.value }
    delete next[sid]
    sessionErrorBySession.value = next
  }

  function setSessionMessages(sessionId: string, list: MessageEntry[]) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const existing = messagesBySession.value[sid]
    if (Array.isArray(existing)) {
      existing.splice(0, existing.length, ...list)
      return
    }
    messagesBySession.value = { ...messagesBySession.value, [sid]: list }
  }

  function normalizeMessageList(list: MessageEntry[]): MessageEntry[] {
    const ordered = [...list].sort((a, b) => {
      const ida = typeof a?.info?.id === 'string' ? a.info.id : ''
      const idb = typeof b?.info?.id === 'string' ? b.info.id : ''
      if (ida === idb) return 0
      return ida < idb ? -1 : 1
    })
    for (const m of ordered) {
      if (m && Array.isArray(m.parts)) {
        m.parts.sort((pa, pb) => {
          const ida = typeof pa?.id === 'string' ? pa.id : ''
          const idb = typeof pb?.id === 'string' ? pb.id : ''
          if (ida === idb) return 0
          return ida < idb ? -1 : 1
        })
      }
    }
    return ordered
  }

  function mergeMessageLists(older: MessageEntry[], newer: MessageEntry[]): MessageEntry[] {
    const map = new Map<string, MessageEntry>()
    for (const m of [...older, ...newer]) {
      const id = typeof m?.info?.id === 'string' ? m.info.id : ''
      if (!id) continue
      map.set(id, m)
    }
    return normalizeMessageList([...map.values()])
  }

  function sessionMessageLimit(sessionId: string): number {
    const sid = (sessionId || '').trim()
    const historical = settings.data?.memoryLimitHistorical
    const active = settings.data?.memoryLimitActiveSession
    const fallbackHistorical = 90
    const fallbackActive = 180
    const max = selectedSessionId.value === sid ? active : historical
    const parsed = typeof max === 'number' && Number.isFinite(max) ? Math.floor(max) : null
    const base = parsed && parsed > 0 ? parsed : selectedSessionId.value === sid ? fallbackActive : fallbackHistorical
    const window = typeof historyLimitBySession.value[sid] === 'number' ? Number(historyLimitBySession.value[sid]) : 0
    return window > base ? window : base
  }

  function pruneSessionMessages(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const list = messagesBySession.value[sid]
    if (!Array.isArray(list)) return
    const limit = sessionMessageLimit(sid)
    if (list.length > limit) {
      list.splice(0, list.length - limit)
    }
  }

  function indexSessions(dir: string | null, list: Session[]) {
    const nextDirMap = { ...sessionDirectoryById.value }
    const nextById = { ...sessionsById.value }

    for (const s of list) {
      const sd = typeof s.directory === 'string' ? s.directory.trim() : ''
      if (sd) {
        nextDirMap[s.id] = sd
      } else if (dir) {
        nextDirMap[s.id] = dir
      }
      nextById[s.id] = s
      directorySessions.upsertSessionSummaryPatch(s)
    }

    sessionDirectoryById.value = nextDirMap
    sessionsById.value = nextById
  }

  function scanCachedDirectoryForSession(sessionId: string): { dir: string; session: Session } | null {
    const sid = (sessionId || '').trim()
    if (!sid) return null
    const entries = Object.entries(sessionsByDirectory.value)
    for (const [dir, list] of entries) {
      const found = (list || []).find((s) => s.id === sid)
      if (found) {
        const sd = typeof found.directory === 'string' ? found.directory.trim() : ''
        return { dir: sd || dir, session: found }
      }
    }
    const found = sessions.value.find((s) => s.id === sid)
    if (found) {
      const sd = typeof found.directory === 'string' ? found.directory.trim() : ''
      return { dir: sd || directoryStore.currentDirectory || '', session: found }
    }
    return null
  }

  async function fetchSessionsPaged(directory: string | null, onPage?: (list: Session[]) => void): Promise<Session[]> {
    const page = await chatApi.listSessions(directory, {
      offset: 0,
      limit: SESSION_PAGE_SIZE,
      scope: 'directory',
      includeTotal: true,
    })
    const normalized = Array.isArray(page?.sessions) ? page.sessions : []
    const degraded = page?.consistency?.degraded === true
    const retryAfterMs =
      typeof page?.consistency?.retryAfterMs === 'number' && Number.isFinite(page.consistency.retryAfterMs)
        ? Math.max(80, Math.floor(page.consistency.retryAfterMs))
        : 220

    if (degraded) {
      scheduleSessionsRefresh(retryAfterMs)
      const dir = (directory || '').trim()
      const cached = dir ? sessionsByDirectory.value[dir] || [] : sessions.value
      if (normalized.length === 0 && Array.isArray(cached) && cached.length > 0) {
        const snapshot = cached.slice()
        if (onPage) onPage(snapshot)
        return snapshot
      }
    }

    if (onPage) onPage(normalized.slice())
    return normalized
  }

  async function refreshSessionsForDirectory(directory: string) {
    const dir = (directory || '').trim()
    if (!dir) return []
    try {
      const list = await fetchSessionsPaged(dir, (normalized) => {
        indexSessions(dir, normalized)
        sessionsByDirectory.value = {
          ...sessionsByDirectory.value,
          [dir]: normalized,
        }
      })
      return list
    } catch {
      return []
    }
  }

  async function refreshSessions() {
    sessionsLoading.value = true
    sessionsError.value = null
    try {
      const dir = directoryStore.currentDirectory
      const list = await fetchSessionsPaged(dir || null, (normalized) => {
        indexSessions(dir || null, normalized)
        sessions.value = normalized
        if (dir) {
          sessionsByDirectory.value = {
            ...sessionsByDirectory.value,
            [dir]: normalized,
          }
        }
      })
      sessions.value = list
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const authRequired =
        err instanceof ApiError && err.status === 401 && (err.code || '').trim().toLowerCase() === 'auth_required'

      // Don't surface transport/auth errors inside the sidebar; use toasts instead.
      sessionsError.value = null
      if (!authRequired) {
        pushErrorToastWithDedupe('sessions', msg || 'Failed to load sessions', 4500, 12_000)
      }

      // Keep existing cache so sidebar doesn't flicker empty on transient failures.
    } finally {
      sessionsLoading.value = false
    }
  }

  async function selectSession(id: string | null) {
    const previous = selectedSessionId.value
    const sid = (id || '').trim()
    selectedSessionId.value = sid || null
    messagesError.value = null

    // Keep memory bounded: when leaving a session, drop any expanded history window.
    const prevSid = typeof previous === 'string' ? previous.trim() : ''
    if (prevSid && prevSid !== sid) {
      if (historyLimitBySession.value[prevSid]) {
        const next = { ...historyLimitBySession.value }
        delete next[prevSid]
        historyLimitBySession.value = next
        pruneSessionMessages(prevSid)
      }
      if (historyExhaustedBySession.value[prevSid]) {
        const next = { ...historyExhaustedBySession.value }
        delete next[prevSid]
        historyExhaustedBySession.value = next
      }
      if (historyLoadingBySession.value[prevSid]) {
        const next = { ...historyLoadingBySession.value }
        delete next[prevSid]
        historyLoadingBySession.value = next
      }
    }

    if (sid) {
      // Keep cached messages so switching sessions feels instant.
      ensureSessionMessages(sid)
    }

    try {
      if (sid) localStorage.setItem(STORAGE_LAST_SESSION, sid)
      else localStorage.removeItem(STORAGE_LAST_SESSION)
    } catch {
      // ignore
    }

    if (!sid) return

    const token = ++selectSeq

    // Ensure we can resolve directory for this session even if it isn't in the current directory list.
    let dir: string | null = sessionDirectoryById.value[sid] || null
    if (!dir) {
      const direct = sessionsById.value[sid]
      const sd = typeof direct?.directory === 'string' ? direct.directory.trim() : ''
      if (sd) dir = sd
    }
    if (!dir) {
      const hit = scanCachedDirectoryForSession(sid)
      if (hit) {
        dir = hit.dir
        indexSessions(hit.dir, [hit.session])
      }
    }

    // Deep-link / cross-project fallback: ask the server to locate the session.
    // This avoids loading every project's session list on boot.
    if (!dir) {
      try {
        const loc = asRecord(await chatApi.locateSession(sid))
        const locatedDir = typeof loc?.directory === 'string' ? String(loc.directory).trim() : ''
        if (locatedDir) {
          dir = locatedDir
        }
        const sess = loc?.session
        if (sess && typeof sess === 'object' && readSessionId(sess) === sid) {
          const sd = readSessionDirectory(sess)
          const d = sd || dir || locatedDir
          if (d) {
            indexSessions(d, [sess as Session])
          }
        }

        // Ensure the directory-scoped session list is cached for sidebar lookups.
        if (dir) {
          await refreshSessionsForDirectory(dir).catch(() => {})
        }
      } catch {
        // ignore
      }
    }

    // If the user selected a different session while we were searching, bail.
    if (token !== selectSeq || selectedSessionId.value !== sid) return

    if (dir && dir.trim() && directoryStore.currentDirectory !== dir.trim()) {
      directoryStore.setDirectory(dir.trim())
    }

    // Refresh diff after directory resolution so cross-directory sessions use the correct scope.
    void refreshSessionDiff(sid, { silent: true })

    if (!messagesHydratedBySession.value[sid]) {
      await refreshMessages(sid)
    } else {
      // Restore pending permission/question prompts when we reuse cached timeline.
      void refreshAttention(sid)
    }
  }

  async function refreshMessages(sessionId: string, opts?: { silent?: boolean; limit?: number }) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    const isSelected = selectedSessionId.value === sid
    const hasCache = (messagesBySession.value[sid]?.length ?? 0) > 0

    const silent = Boolean(opts?.silent)
    if (!silent && isSelected && !hasCache) {
      messagesLoading.value = true
    }
    if (isSelected) {
      messagesError.value = null
    }
    try {
      const prevWindow =
        typeof historyLimitBySession.value[sid] === 'number' ? Number(historyLimitBySession.value[sid]) : 0

      const baseLimit = sessionMessageLimit(sid)
      const requested = typeof opts?.limit === 'number' && Number.isFinite(opts.limit) ? Math.floor(opts.limit) : 0
      const limit = Math.max(baseLimit, prevWindow, requested)

      if (limit > 0) {
        historyLimitBySession.value = { ...historyLimitBySession.value, [sid]: limit }
      }

      const messagePage = await chatApi.listMessages(sessionId, limit, getDirectoryForSession(sessionId), 0)
      const ordered = normalizeMessageList(messagePage.entries)
      const degraded = messagePage.consistency?.degraded === true
      const retryAfterMs =
        typeof messagePage.consistency?.retryAfterMs === 'number' &&
        Number.isFinite(messagePage.consistency.retryAfterMs)
          ? Math.max(60, Math.floor(messagePage.consistency.retryAfterMs))
          : 180

      if (degraded && ordered.length === 0 && hasCache) {
        scheduleMessageRefreshRetry(sid, retryAfterMs, { limit })
        return
      }

      if (degraded) {
        scheduleMessageRefreshRetry(sid, retryAfterMs, { limit })
      } else {
        clearMessageRefreshRetry(sid)
      }

      setSessionMessages(sid, ordered)
      pruneSessionMessages(sid)
      markMessagesHydrated(sid)

      // Capture the last known model/agent/provider for this session.
      for (let i = ordered.length - 1; i >= 0; i -= 1) {
        const info = ordered[i]?.info
        const patch = extractRunConfigFromMessageInfo(info)
        if (patch.agent || patch.providerID || patch.modelID || patch.variant) {
          upsertSessionRunConfig(sid, patch)
          break
        }
      }

      const afterLen = messagesBySession.value[sid]?.length ?? ordered.length
      const exhausted = limit > 0 && afterLen < limit
      historyExhaustedBySession.value = { ...historyExhaustedBySession.value, [sid]: exhausted }

      // Re-run session diff once messages hydrate so the panel can pick up the
      // latest backend-authoritative snapshot after initial timeline load.
      if (!hasCache) {
        const current = sessionDiffBySession.value[sid]
        if (!Array.isArray(current) || current.length === 0) {
          void refreshSessionDiff(sid, { silent: true })
        }
      }

      // Messages refresh is a good time to rehydrate pending prompts (page refresh / missed SSE).
      void refreshAttention(sid)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const authRequired =
        err instanceof ApiError && err.status === 401 && (err.code || '').trim().toLowerCase() === 'auth_required'

      if (isSelected) {
        // Transport/auth failures should not become timeline messages.
        messagesError.value = null

        if (authRequired) {
          // The global auth-required handler will toast + switch to LoginPage.
          // Stop retry loops while locked to avoid spamming the backend.
          clearMessageRefreshRetry(sid)
        } else {
          pushErrorToastWithDedupe(
            `messages:${sid}`,
            msg || 'Failed to load messages',
            silent ? 3500 : 4500,
            // Refresh retries can happen frequently; keep this heavily throttled.
            silent ? 20_000 : 8000,
          )
        }
      }

      if (!authRequired && hasCache) {
        scheduleMessageRefreshRetry(sid, 240, { limit: opts?.limit })
      }
      if (!hasCache && !silent) {
        // No cache: keep UI consistent with the empty state.
        setSessionMessages(sid, [])
      }
    } finally {
      if (!silent && isSelected) {
        messagesLoading.value = false
      }
    }
  }

  function clearSessionDiffCache(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    if (Object.prototype.hasOwnProperty.call(sessionDiffBySession.value, sid)) {
      const next = { ...sessionDiffBySession.value }
      delete next[sid]
      sessionDiffBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffLoadingBySession.value, sid)) {
      const next = { ...sessionDiffLoadingBySession.value }
      delete next[sid]
      sessionDiffLoadingBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffLoadingMoreBySession.value, sid)) {
      const next = { ...sessionDiffLoadingMoreBySession.value }
      delete next[sid]
      sessionDiffLoadingMoreBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffHasMoreBySession.value, sid)) {
      const next = { ...sessionDiffHasMoreBySession.value }
      delete next[sid]
      sessionDiffHasMoreBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffNextOffsetBySession.value, sid)) {
      const next = { ...sessionDiffNextOffsetBySession.value }
      delete next[sid]
      sessionDiffNextOffsetBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffLimitBySession.value, sid)) {
      const next = { ...sessionDiffLimitBySession.value }
      delete next[sid]
      sessionDiffLimitBySession.value = next
    }

    if (Object.prototype.hasOwnProperty.call(sessionDiffErrorBySession.value, sid)) {
      const next = { ...sessionDiffErrorBySession.value }
      delete next[sid]
      sessionDiffErrorBySession.value = next
    }
  }

  function resolveSessionDiffSources(primary: SessionFileDiff[]): SessionFileDiff[] {
    return [...primary].sort((a, b) => a.file.localeCompare(b.file))
  }

  function applySessionDiffSnapshot(sessionId: string, list: SessionFileDiff[]) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    sessionDiffBySession.value = {
      ...sessionDiffBySession.value,
      [sid]: resolveSessionDiffSources(list),
    }
    sessionDiffHasMoreBySession.value = { ...sessionDiffHasMoreBySession.value, [sid]: false }
    sessionDiffNextOffsetBySession.value = { ...sessionDiffNextOffsetBySession.value, [sid]: 0 }
    sessionDiffLimitBySession.value = { ...sessionDiffLimitBySession.value, [sid]: SESSION_DIFF_PAGE_SIZE }
  }

  function mergeSessionDiffEntries(base: SessionFileDiff[], incoming: SessionFileDiff[]): SessionFileDiff[] {
    const merged = new Map<string, SessionFileDiff>()
    for (const entry of base) {
      const file = String(entry?.file || '').trim()
      if (!file) continue
      merged.set(file, entry)
    }
    for (const entry of incoming) {
      const file = String(entry?.file || '').trim()
      if (!file) continue
      merged.set(file, entry)
    }
    return Array.from(merged.values()).sort((a, b) => a.file.localeCompare(b.file))
  }

  function applySessionDiffPage(sessionId: string, page: chatApi.SessionDiffPageResponse, opts?: { append?: boolean }) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    const append = Boolean(opts?.append)
    const existing = Array.isArray(sessionDiffBySession.value[sid]) ? sessionDiffBySession.value[sid] : []
    const incoming = Array.isArray(page.items) ? page.items : []
    const nextList = append ? mergeSessionDiffEntries(existing, incoming) : resolveSessionDiffSources(incoming)

    sessionDiffBySession.value = {
      ...sessionDiffBySession.value,
      [sid]: nextList,
    }

    const resolvedLimit = Math.max(
      1,
      Math.floor(page.limit || sessionDiffLimitBySession.value[sid] || SESSION_DIFF_PAGE_SIZE),
    )
    const resolvedOffset = Math.max(0, Math.floor(page.offset || 0))
    const fallbackNext = resolvedOffset + incoming.length
    const nextOffset =
      typeof page.nextOffset === 'number' && Number.isFinite(page.nextOffset)
        ? Math.max(fallbackNext, Math.floor(page.nextOffset))
        : fallbackNext
    const hasMore = Boolean(page.hasMore && incoming.length > 0)

    sessionDiffHasMoreBySession.value = {
      ...sessionDiffHasMoreBySession.value,
      [sid]: hasMore,
    }
    sessionDiffNextOffsetBySession.value = {
      ...sessionDiffNextOffsetBySession.value,
      [sid]: nextOffset,
    }
    sessionDiffLimitBySession.value = {
      ...sessionDiffLimitBySession.value,
      [sid]: resolvedLimit,
    }
  }

  async function refreshSessionDiff(sessionId: string, opts?: { silent?: boolean; messageID?: string }) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    const selected = selectedSessionId.value === sid
    const silent = Boolean(opts?.silent)

    if (!silent || !sessionDiffBySession.value[sid]) {
      sessionDiffLoadingBySession.value = { ...sessionDiffLoadingBySession.value, [sid]: true }
    }
    sessionDiffLoadingMoreBySession.value = { ...sessionDiffLoadingMoreBySession.value, [sid]: false }
    sessionDiffErrorBySession.value = { ...sessionDiffErrorBySession.value, [sid]: null }

    try {
      const directory = getDirectoryForSession(sid)
      const page = await chatApi.getSessionDiff(sid, directory, {
        offset: 0,
        limit: sessionDiffLimitBySession.value[sid] || SESSION_DIFF_PAGE_SIZE,
        ...(typeof opts?.messageID === 'string' && opts.messageID.trim() ? { messageID: opts.messageID.trim() } : {}),
      })
      applySessionDiffPage(sid, page, { append: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sessionDiffErrorBySession.value = {
        ...sessionDiffErrorBySession.value,
        [sid]: msg || 'Failed to load session file changes',
      }
      if (selected && !silent) {
        pushErrorToastWithDedupe(`session-diff:${sid}`, msg || 'Failed to load session file changes', 4500, 5000)
      }
    } finally {
      sessionDiffLoadingBySession.value = { ...sessionDiffLoadingBySession.value, [sid]: false }
    }
  }

  async function loadMoreSessionDiff(sessionId: string, opts?: { silent?: boolean }) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (sessionDiffLoadingBySession.value[sid] || sessionDiffLoadingMoreBySession.value[sid]) return
    if (!sessionDiffHasMoreBySession.value[sid]) return

    const selected = selectedSessionId.value === sid
    const silent = Boolean(opts?.silent)
    const offset = Math.max(
      0,
      Math.floor(sessionDiffNextOffsetBySession.value[sid] || sessionDiffBySession.value[sid]?.length || 0),
    )
    const limit = Math.max(1, Math.floor(sessionDiffLimitBySession.value[sid] || SESSION_DIFF_PAGE_SIZE))

    sessionDiffLoadingMoreBySession.value = { ...sessionDiffLoadingMoreBySession.value, [sid]: true }

    try {
      const directory = getDirectoryForSession(sid)
      const page = await chatApi.getSessionDiff(sid, directory, { offset, limit })
      applySessionDiffPage(sid, page, { append: true })
      sessionDiffErrorBySession.value = { ...sessionDiffErrorBySession.value, [sid]: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sessionDiffErrorBySession.value = {
        ...sessionDiffErrorBySession.value,
        [sid]: msg || 'Failed to load session file changes',
      }
      if (selected && !silent) {
        pushErrorToastWithDedupe(`session-diff:${sid}:more`, msg || 'Failed to load session file changes', 4500, 5000)
      }
    } finally {
      sessionDiffLoadingMoreBySession.value = { ...sessionDiffLoadingMoreBySession.value, [sid]: false }
    }
  }

  async function ensureMessagePartDetail(part: JsonValue): Promise<void> {
    const partRecord = asRecord(part)
    const sid = typeof partRecord?.sessionID === 'string' ? partRecord.sessionID.trim() : ''
    const mid = typeof partRecord?.messageID === 'string' ? partRecord.messageID.trim() : ''
    const pidRaw =
      typeof partRecord?.partID === 'string'
        ? partRecord.partID
        : typeof partRecord?.id === 'string'
          ? partRecord.id
          : ''
    const pid = typeof pidRaw === 'string' ? pidRaw.trim() : ''
    if (!sid || !mid || !pid) return

    // Only fetch when the backend explicitly marked this as a lazy summary.
    if (partRecord?.ocLazy !== true) return

    const key = `${sid}:${mid}:${pid}`
    const existing = partDetailInFlight.get(key)
    if (existing) return await existing

    const task = (async () => {
      const dir = getDirectoryForSession(sid)
      const detail = await chatApi.getMessagePartDetail(sid, mid, pid, dir)
      if (!detail || typeof detail !== 'object') return

      const list = messagesBySession.value[sid]
      if (!Array.isArray(list)) return
      const msg = list.find((m) => String(m?.info?.id || '').trim() === mid)
      if (!msg || !Array.isArray(msg.parts)) return
      const parts = msg.parts
      const target =
        parts.find((p) => String(p?.id || '').trim() === pid) ??
        parts.find((p) => {
          const alt = asRecord(p)?.partID
          return typeof alt === 'string' && alt.trim() === pid
        }) ??
        null
      if (!target) return

      Object.assign(target as UnknownRecord, detail)
      // Mark hydrated so we don't refetch.
      try {
        const targetRecord = target as UnknownRecord
        targetRecord.ocLazy = false
        delete targetRecord.ocTruncated
      } catch {
        // ignore
      }
    })()

    partDetailInFlight.set(key, task)
    try {
      await task
    } catch (err) {
      // Keep quiet by default; this should be best-effort.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg) toasts.push('error', msg)
    } finally {
      partDetailInFlight.delete(key)
    }
  }

  const selectedHistory = computed(() => {
    const sid = selectedSessionId.value
    if (!sid) return { loading: false, exhausted: false, limit: 0 }
    return {
      loading: Boolean(historyLoadingBySession.value[sid]),
      exhausted: Boolean(historyExhaustedBySession.value[sid]),
      limit: typeof historyLimitBySession.value[sid] === 'number' ? Number(historyLimitBySession.value[sid]) : 0,
    }
  })

  async function loadOlderMessages(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return false
    if (historyLoadingBySession.value[sid]) return false
    if (historyExhaustedBySession.value[sid]) return false

    const current = ensureSessionMessages(sid)
    const currentLen = current.length
    const maxWindow = 2000
    const remaining = Math.max(0, maxWindow - currentLen)
    const pageSize = Math.min(MESSAGE_PAGE_SIZE, remaining)
    if (pageSize <= 0) {
      historyExhaustedBySession.value = { ...historyExhaustedBySession.value, [sid]: true }
      return false
    }

    historyLoadingBySession.value = { ...historyLoadingBySession.value, [sid]: true }
    try {
      const page = await chatApi.listMessages(sid, pageSize, getDirectoryForSession(sid), currentLen)
      const normalized = normalizeMessageList(page.entries)
      const degraded = page.consistency?.degraded === true
      const retryAfterMs =
        typeof page.consistency?.retryAfterMs === 'number' && Number.isFinite(page.consistency.retryAfterMs)
          ? Math.max(60, Math.floor(page.consistency.retryAfterMs))
          : 180
      if (!normalized.length) {
        if (degraded) {
          scheduleMessageRefreshRetry(sid, retryAfterMs)
          return false
        }
        historyExhaustedBySession.value = { ...historyExhaustedBySession.value, [sid]: true }
        return false
      }

      if (degraded) {
        scheduleMessageRefreshRetry(sid, retryAfterMs)
      }

      const merged = mergeMessageLists(normalized, current)
      setSessionMessages(sid, merged)
      historyLimitBySession.value = { ...historyLimitBySession.value, [sid]: merged.length }

      const exhausted = normalized.length < pageSize
      historyExhaustedBySession.value = { ...historyExhaustedBySession.value, [sid]: exhausted }
      return true
    } finally {
      historyLoadingBySession.value = { ...historyLoadingBySession.value, [sid]: false }
    }
  }

  function clearAttention(sessionId: string) {
    const next = { ...attentionBySession.value }
    delete next[sessionId]
    attentionBySession.value = next
  }

  async function createSession() {
    // Prevent accidental double-creates from rapid clicks/shortcuts while the request is in-flight.
    if (createSessionInFlight) {
      return await createSessionInFlight
    }

    createSessionInFlight = (async () => {
      const created = await chatApi.createSession(directoryStore.currentDirectory)
      if (created && typeof created === 'object') {
        upsertSessionCache(created, { insertIfMissing: true })
      }
      scheduleSessionsRefresh(1200)
      if (created?.id) {
        await selectSession(created.id)
      }
      return created
    })()

    try {
      return await createSessionInFlight
    } finally {
      createSessionInFlight = null
    }
  }

  async function deleteSession(sessionId: string, opts?: { directory?: string | null }) {
    const sid = (sessionId || '').trim()
    if (!sid) return

    clearMessageRefreshRetry(sid)

    const dirHint = typeof opts?.directory === 'string' ? opts.directory.trim() : ''
    const cached = sessionsById.value[sid]
    const cachedDir = typeof cached?.directory === 'string' ? cached.directory.trim() : ''
    const mappedDir = typeof sessionDirectoryById.value[sid] === 'string' ? sessionDirectoryById.value[sid].trim() : ''
    const dir = dirHint || mappedDir || cachedDir || directoryStore.currentDirectory

    await chatApi.deleteSession(sid, dir)

    if (selectedSessionId.value === sid) {
      selectedSessionId.value = null
    }

    clearAttention(sid)

    // Drop cached session metadata + directory mapping.
    {
      const nextById = { ...sessionsById.value }
      delete nextById[sid]
      sessionsById.value = nextById

      const nextDir = { ...sessionDirectoryById.value }
      delete nextDir[sid]
      sessionDirectoryById.value = nextDir
    }

    // Drop cached session status so "running" UI clears immediately.
    {
      const next = { ...sessionStatusBySession.value }
      delete next[sid]
      sessionStatusBySession.value = next
    }

    // Drop cached timeline + drafts.
    clearMessagesHydrated(sid)
    clearComposerDraft(sid)
    clearSessionDiffCache(sid)
    {
      const next = { ...messagesBySession.value }
      delete next[sid]
      messagesBySession.value = next
    }

    {
      const next = { ...historyLimitBySession.value }
      delete next[sid]
      historyLimitBySession.value = next
    }
    {
      const next = { ...historyLoadingBySession.value }
      delete next[sid]
      historyLoadingBySession.value = next
    }
    {
      const next = { ...historyExhaustedBySession.value }
      delete next[sid]
      historyExhaustedBySession.value = next
    }
    {
      const next = { ...sessionRunConfigBySession.value }
      delete next[sid]
      sessionRunConfigBySession.value = next
      runConfigPersister.persistSoon()
    }

    // Optimistic list removal (avoid waiting for a refresh to reflect deletion).
    sessions.value = sessions.value.filter((s) => s?.id !== sid)
    {
      const next = { ...sessionsByDirectory.value }
      for (const [k, list] of Object.entries(next)) {
        if (!Array.isArray(list)) continue
        if (!list.some((s) => s?.id === sid)) continue
        next[k] = list.filter((s) => s?.id !== sid)
      }
      sessionsByDirectory.value = next
    }

    // Reconcile lists.
    if (dir && (directoryStore.currentDirectory || '').trim() !== String(dir || '').trim()) {
      void refreshSessionsForDirectory(String(dir)).catch(() => {})
    }
    directorySessions.removeSessionFromAggregates(sid)
    scheduleSessionsRefresh(1200)
  }

  function upsertSessionCache(
    updated: (Partial<Session> & { id: string }) | null | undefined,
    opts?: { insertIfMissing?: boolean },
  ) {
    if (!updated || typeof updated !== 'object') return
    const sid = typeof updated.id === 'string' ? updated.id.trim() : ''
    if (!sid) return

    const merged = {
      ...(sessionsById.value[sid] || {}),
      ...updated,
      id: sid,
    } as Session

    const updatedDir = typeof merged.directory === 'string' ? merged.directory.trim() : ''
    const resolvedDir =
      updatedDir ||
      (typeof sessionDirectoryById.value[sid] === 'string' ? sessionDirectoryById.value[sid].trim() : '') ||
      (directoryStore.currentDirectory || '').trim()

    if (resolvedDir) {
      sessionDirectoryById.value = {
        ...sessionDirectoryById.value,
        [sid]: resolvedDir,
      }
    }

    sessionsById.value = { ...sessionsById.value, [sid]: merged }
    const hasInCurrent = sessions.value.some((s) => s.id === sid)
    if (hasInCurrent) {
      sessions.value = sessions.value.map((s) => (s.id === sid ? { ...s, ...merged } : s))
    } else if (opts?.insertIfMissing) {
      const currentDir = (directoryStore.currentDirectory || '').trim()
      if (!resolvedDir || resolvedDir === currentDir) {
        sessions.value = [{ ...merged }, ...sessions.value].slice(0, SESSION_PAGE_SIZE)
      }
    }

    const nextByDir = { ...sessionsByDirectory.value }
    for (const [dir, list] of Object.entries(nextByDir)) {
      if (!Array.isArray(list)) continue
      if (!list.some((s) => s?.id === sid)) continue
      nextByDir[dir] = list.map((s) => (s?.id === sid ? { ...s, ...merged } : s))
    }
    if (opts?.insertIfMissing && resolvedDir && Array.isArray(nextByDir[resolvedDir])) {
      const list = nextByDir[resolvedDir] || []
      if (!list.some((s) => s?.id === sid)) {
        nextByDir[resolvedDir] = [{ ...merged }, ...list].slice(0, SESSION_PAGE_SIZE)
      }
    }
    sessionsByDirectory.value = nextByDir

    // Keep sidebar/session index in sync for immediate title/share updates.
    directorySessions.upsertSessionSummaryPatch(merged)
  }

  async function renameSession(sessionId: string, title: string) {
    const sid = (sessionId || '').trim()
    const trimmed = (title || '').trim()
    if (!sid || !trimmed) return null
    const updated = await chatApi.patchSessionTitle(sid, trimmed, getDirectoryForSession(sid))
    upsertSessionCache(updated)
    scheduleSessionsRefresh(1200)
    return updated
  }

  async function shareSession(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return null
    const updated = await chatApi.shareSession(sid, getDirectoryForSession(sid))
    upsertSessionCache(updated)
    scheduleSessionsRefresh(1200)
    return updated
  }

  async function unshareSession(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return null
    const updated = await chatApi.unshareSession(sid, getDirectoryForSession(sid))
    upsertSessionCache(updated)
    scheduleSessionsRefresh(1200)
    return updated
  }

  async function summarizeSession(sessionId: string, providerID: string, modelID: string) {
    const sid = (sessionId || '').trim()
    const pid = (providerID || '').trim()
    const mid = (modelID || '').trim()
    if (!sid || !pid || !mid) return false
    await chatApi.summarizeSession(sid, pid, mid, getDirectoryForSession(sid))
    return true
  }

  async function abortSession(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return false
    try {
      // Upstream OpenCode API is proxied; keep directory scoping consistent.
      await chatApi.abortSession(sid, getDirectoryForSession(sid))

      // Immediately clear any blocking UI prompts; abort means the run is over.
      clearAttention(sid)
      sessionStatusBySession.value = {
        ...sessionStatusBySession.value,
        [sid]: {
          at: Date.now(),
          payload: { type: 'session.status', properties: { sessionID: sid, status: { type: 'idle' } } },
          status: { type: 'idle' },
        },
      }

      return true
    } catch {
      return false
    }
  }

  async function sendMessage(
    sessionId: string,
    opts: {
      text?: string
      parts?: JsonValue[]
      providerID?: string
      modelID?: string
      agent?: string
      variant?: string
    },
  ) {
    clearSessionError(sessionId)
    await sendMessageToSession(sessionId, opts, getDirectoryForSession)
  }

  async function sendText(sessionId: string, text: string) {
    clearSessionError(sessionId)
    await sendTextToSession(sessionId, text, getDirectoryForSession)
  }

  async function replyPermission(
    sessionId: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message?: string,
  ) {
    const ok = await replyPermissionToSession(sessionId, requestId, reply, getDirectoryForSession, message)
    if (ok) clearAttention((sessionId || '').trim())
    return ok
  }

  async function replyQuestion(sessionId: string, requestId: string, answers: string[][]) {
    const ok = await replyQuestionToSession(sessionId, requestId, answers, getDirectoryForSession)
    if (ok) clearAttention((sessionId || '').trim())
    return ok
  }

  async function rejectQuestion(sessionId: string, requestId: string) {
    const ok = await rejectQuestionForSession(sessionId, requestId, getDirectoryForSession)
    if (ok) clearAttention((sessionId || '').trim())
    return ok
  }

  function applyEvent(evt: SseEvent) {
    const t = evt.type || ''
    if (!t) return
    const sid = extractSessionId(evt)

    if (sid && t === 'session.deleted') {
      const nextById = { ...sessionsById.value }
      delete nextById[sid]
      sessionsById.value = nextById

      const nextDir = { ...sessionDirectoryById.value }
      delete nextDir[sid]
      sessionDirectoryById.value = nextDir

      sessions.value = sessions.value.filter((session) => session.id !== sid)
      const nextByDir = { ...sessionsByDirectory.value }
      for (const [dir, list] of Object.entries(nextByDir)) {
        if (!Array.isArray(list)) continue
        if (!list.some((session) => session.id === sid)) continue
        nextByDir[dir] = list.filter((session) => session.id !== sid)
      }
      sessionsByDirectory.value = nextByDir

      clearAttention(sid)
      clearMessagesHydrated(sid)
      clearComposerDraft(sid)
      clearSessionDiffCache(sid)
      if (selectedSessionId.value === sid) {
        selectedSessionId.value = null
      }

      const nextStatus = { ...sessionStatusBySession.value }
      delete nextStatus[sid]
      sessionStatusBySession.value = nextStatus

      const nextErrors = { ...sessionErrorBySession.value }
      delete nextErrors[sid]
      sessionErrorBySession.value = nextErrors

      const nextMessages = { ...messagesBySession.value }
      delete nextMessages[sid]
      messagesBySession.value = nextMessages

      const nextHistoryLimit = { ...historyLimitBySession.value }
      delete nextHistoryLimit[sid]
      historyLimitBySession.value = nextHistoryLimit

      const nextHistoryLoading = { ...historyLoadingBySession.value }
      delete nextHistoryLoading[sid]
      historyLoadingBySession.value = nextHistoryLoading

      const nextHistoryExhausted = { ...historyExhaustedBySession.value }
      delete nextHistoryExhausted[sid]
      historyExhaustedBySession.value = nextHistoryExhausted

      const nextRunConfig = { ...sessionRunConfigBySession.value }
      delete nextRunConfig[sid]
      sessionRunConfigBySession.value = nextRunConfig
      runConfigPersister.persistSoon()

      directorySessions.removeSessionFromAggregates(sid)
    }

    if (t === 'session.created') {
      const props = readEventProperties(evt)
      const raw = props.session ?? props.value ?? props.data ?? null
      const maybeId = readSessionId(raw)
      if (asRecord(raw) && maybeId) {
        upsertSessionCache(raw as Partial<Session> & { id: string })
      }
    }

    // Some OpenCode emitters include the updated session snapshot on session.updated.
    // Apply it immediately so the sidebar can reflect renames without waiting for list refresh.
    if (t === 'session.updated') {
      const props = readEventProperties(evt)
      const raw = props.session ?? props.value ?? props.data ?? null
      const maybeId = readSessionId(raw)
      if (asRecord(raw) && maybeId) {
        upsertSessionCache(raw as Partial<Session> & { id: string })
      } else if (sid) {
        const title = typeof props?.title === 'string' ? props.title.trim() : ''
        const slug = typeof props?.slug === 'string' ? props.slug.trim() : ''
        if (title || slug) {
          upsertSessionCache({ id: sid, ...(title ? { title } : {}), ...(slug ? { slug } : {}) })
        }
      }
    }

    // Track session status so the UI can show retry/backoff details.
    if (sid && t === 'session.status') {
      const raw = asRecord(readEventProperties(evt).status)
      const parsed: SessionStatus | null = (() => {
        const ty = typeof raw?.type === 'string' ? raw.type : ''
        if (ty === 'idle') return { type: 'idle' }
        if (ty === 'busy') return { type: 'busy' }
        if (ty === 'retry') {
          const attempt = Number(raw?.attempt)
          const message = typeof raw?.message === 'string' ? raw.message : ''
          const next = Number(raw?.next)
          if (Number.isFinite(attempt) && Number.isFinite(next)) {
            return { type: 'retry', attempt, message, next }
          }
        }
        return null
      })()
      if (parsed) {
        sessionStatusBySession.value = {
          ...sessionStatusBySession.value,
          [sid]: { at: Date.now(), payload: evt, status: parsed },
        }

        if (parsed.type === 'busy' || parsed.type === 'retry') {
          clearSessionError(sid)
        }

        if (parsed.type === 'idle') {
          clearAttention(sid)
        }
      }
    }

    // OpenCode CLI treats session.idle as the authoritative end-of-run signal.
    if (sid && t === 'session.idle') {
      sessionStatusBySession.value = {
        ...sessionStatusBySession.value,
        [sid]: { at: Date.now(), payload: evt, status: { type: 'idle' } },
      }

      clearAttention(sid)

      // Best-effort reconcile after completion (compaction/tool summaries may land at the end).
      if (selectedSessionId.value === sid) {
        if (refreshMessagesTimer) window.clearTimeout(refreshMessagesTimer)
        refreshMessagesTimer = window.setTimeout(() => {
          void refreshMessages(sid, { silent: true })
        }, 120)
      }

      void refreshSessionDiff(sid, { silent: true })
    }

    if (sid && t === 'session.diff') {
      const props = readEventProperties(evt)
      if (Object.prototype.hasOwnProperty.call(props, 'diff')) {
        const live = chatApi.normalizeSessionDiffPayload((props.diff ?? null) as JsonValue)
        applySessionDiffSnapshot(sid, live)
        sessionDiffErrorBySession.value = { ...sessionDiffErrorBySession.value, [sid]: null }
        sessionDiffLoadingBySession.value = { ...sessionDiffLoadingBySession.value, [sid]: false }
      }
      void refreshSessionDiff(sid, { silent: true })
    }

    if (sid && t === 'session.error') {
      const normalized = normalizeSessionError(evt)
      const at = Date.now()
      const selected = selectedSessionId.value === sid

      // Errors terminate the active run; reset status so UI doesn't get stuck.
      sessionStatusBySession.value = {
        ...sessionStatusBySession.value,
        [sid]: { at, payload: evt, status: { type: 'idle' } },
      }

      sessionErrorBySession.value = {
        ...sessionErrorBySession.value,
        [sid]: {
          at,
          payload: evt,
          error: normalized.details,
        },
      }

      clearAttention(sid)

      if (selected) {
        if (refreshMessagesTimer) window.clearTimeout(refreshMessagesTimer)
        refreshMessagesTimer = window.setTimeout(() => {
          void refreshMessages(sid, { silent: true })
        }, 200)
      }

      scheduleSessionsRefresh(500)
    }

    // Global session.error (no sessionID) happens in OpenCode as well; surface it.
    if (!sid && t === 'session.error') {
      const rendered = normalizeSessionError(evt).rendered

      const now = Date.now()
      if (now - lastGlobalErrorToastAt > 1500) {
        lastGlobalErrorToastAt = now
        pushErrorToastWithDedupe('__global__', rendered, 4500)
      }

      scheduleSessionsRefresh(500)
    }

    if (sid && (t === 'permission.replied' || t === 'question.replied' || t === 'question.rejected')) {
      clearAttention(sid)
    }

    if (sid && (t === 'permission.asked' || t === 'question.asked')) {
      attentionBySession.value = {
        ...attentionBySession.value,
        [sid]: {
          kind: t === 'permission.asked' ? 'permission' : 'question',
          at: Date.now(),
          payload: evt,
        },
      }
      // Ensure the user sees the updated timeline quickly.
      if (selectedSessionId.value === sid) {
        if (refreshMessagesTimer) window.clearTimeout(refreshMessagesTimer)
        refreshMessagesTimer = window.setTimeout(() => {
          void refreshMessages(sid)
        }, 80)
      }
    }

    // Keep session list fresh for renamed/new sessions.
    // session.* events usually carry enough data for optimistic updates; keep
    // a delayed full refresh as fallback only.
    if (t === 'session.created' || t === 'session.updated' || t === 'session.deleted') {
      scheduleSessionsRefresh(1200)
    }

    // Apply lightweight removals in-place.
    if (sid && t === 'message.removed') {
      const props = readEventProperties(evt)
      const mid = typeof props?.messageID === 'string' ? props.messageID : ''
      if (mid) {
        const list = messagesBySession.value[sid]
        if (list) {
          const idx = list.findIndex((m) => m?.info?.id === mid)
          if (idx >= 0) {
            list.splice(idx, 1)
            return
          }
        }
      }
    }

    if (sid && t === 'message.part.removed') {
      const props = readEventProperties(evt)
      const mid = typeof props?.messageID === 'string' ? props.messageID : ''
      const pid = typeof props?.partID === 'string' ? props.partID : ''
      if (mid && pid) {
        const list = messagesBySession.value[sid]
        if (list) {
          const msg = list.find((m) => m?.info?.id === mid)
          if (msg && Array.isArray(msg.parts)) {
            const parts = msg.parts
            const pidx = parts.findIndex((p) => p?.id === pid)
            if (pidx >= 0) {
              parts.splice(pidx, 1)
              return
            }
          }
        }
      }
    }

    // Keep per-session timelines updated in-place via SSE.
    if (sid) {
      if (t === 'message.part.updated' || t === 'message.part.created') {
        if (applyStreamingEventToMessages({ evt, ensureSessionMessages, pruneSessionMessages })) return
      }
      if (t === 'message.updated') {
        const info = normalizeMessageInfoFromSse(evt)
        if (info?.id) {
          const list = ensureSessionMessages(sid)
          upsertMessageEntryIn(list, info)

          const patch = extractRunConfigFromMessageInfo(info)
          if (patch.agent || patch.providerID || patch.modelID || patch.variant) {
            upsertSessionRunConfig(sid, patch)
          }
        }
        // No refresh: rely on SSE, like OpenCode TUI.
      }
    }

    // When assistant finishes, clear any pending attention for that session.
    if (sid && t === 'message.updated') {
      const info = normalizeMessageInfoFromSse(evt)
      if (info && info.role === 'assistant' && typeof info.finish === 'string' && info.finish.trim()) {
        clearAttention(sid)
      }
    }
  }

  async function revertToMessage(
    sessionId: string,
    messageId: string,
    opts?: {
      // Default true: restore the user message into the composer.
      // For OpenCode-style redo (move the revert boundary forward), set false.
      restoreComposer?: boolean
    },
  ) {
    const sid = (sessionId || '').trim()
    const mid = (messageId || '').trim()
    if (!sid || !mid) return

    const restoreComposer = opts?.restoreComposer !== false

    // Reverting while a run is active can hang (server-side lock). Best-effort stop first.
    const st = sessionStatusBySession.value[sid]?.status?.type
    if (st && st !== 'idle') {
      await abortSession(sid)
    }

    // Grab the message content before reverting so we can restore it into the composer.
    let messageText = ''
    const fileParts: Array<{ type: 'file'; url: string; mime?: string; filename?: string }> = []
    if (restoreComposer) {
      const sessionMessages = messagesBySession.value[sid] ?? []
      const target = sessionMessages.find((m) => m?.info?.id === mid) ?? null
      if (target && target.info?.role === 'user') {
        const textParts = (target.parts || []).filter((p) => p?.type === 'text')
        messageText = textParts
          .map((p) => {
            if (typeof p?.text === 'string') return p.text
            const content = asRecord(p)?.content
            return typeof content === 'string' ? content : ''
          })
          .join('\n')
          .trim()
        for (const p of target.parts || []) {
          const record = asRecord(p)
          if (p?.type === 'file' && typeof record?.url === 'string' && record.url) {
            fileParts.push({
              type: 'file',
              url: record.url,
              mime: typeof record.mime === 'string' ? record.mime : undefined,
              filename: typeof record.filename === 'string' ? record.filename : undefined,
            })
          }
        }
      }
    }

    const updatedSession = await chatApi.revertSession(sid, mid, getDirectoryForSession(sid))

    // Update session cache so the UI can render revert state.
    const updatedSessionRecord = asRecord(updatedSession)
    if (updatedSessionRecord && typeof updatedSessionRecord.id === 'string') {
      upsertSessionCache(updatedSessionRecord as Partial<Session> & { id: string })
    }

    // Note: we do not delete messages beyond the revert boundary. OpenCode keeps them
    // in storage so the UI can show a revert marker and allow redo/unrevert.

    if (restoreComposer && (messageText || fileParts.length > 0)) {
      setPendingComposer(messageText, fileParts)
    }

    // Keep sessions list in sync (title/updated time/revert state).
    scheduleSessionsRefresh(1200)
  }

  async function unrevertSession(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return null

    const updatedSession = await chatApi.unrevertSession(sid, getDirectoryForSession(sid))

    const updatedSessionRecord = asRecord(updatedSession)
    if (updatedSessionRecord && typeof updatedSessionRecord.id === 'string') {
      upsertSessionCache(updatedSessionRecord as Partial<Session> & { id: string })
    }

    // Keep sessions list in sync (title/updated time/revert state).
    scheduleSessionsRefresh(1200)

    // Best-effort reconcile the selected timeline.
    if (selectedSessionId.value === sid) {
      void refreshMessages(sid, { silent: true })
    }

    return updatedSession
  }

  return {
    sessions,
    sessionsByDirectory,
    sessionsLoading,
    sessionsError,
    selectedSessionId,
    selectedSession,
    selectedSessionDirectory,
    messages,
    messagesLoading,
    messagesError,
    selectedAttention,
    selectedSessionStatus,
    selectedSessionError,
    selectedSessionDiff,
    selectedSessionDiffLoaded,
    selectedSessionDiffLoading,
    selectedSessionDiffLoadingMore,
    selectedSessionDiffHasMore,
    selectedSessionDiffError,
    selectedSessionRunConfig,
    sessionStatusBySession,
    sessionErrorBySession,
    sessionRunConfigBySession,
    attentionBySession,
    refreshSessions,
    refreshSessionsForDirectory,
    selectSession,
    refreshMessages,
    refreshSessionDiff,
    loadMoreSessionDiff,
    ensureMessagePartDetail,
    loadOlderMessages,
    selectedHistory,
    createSession,
    deleteSession,
    renameSession,
    shareSession,
    unshareSession,
    summarizeSession,
    abortSession,
    sendText,
    sendMessage,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    getSessionById,
    consumePendingComposer,
    getComposerDraft,
    setComposerDraft,
    clearSessionError,
    revertToMessage,
    unrevertSession,
    applyEvent,
  }
})
