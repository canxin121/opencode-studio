<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  RiPlugLine,
  RiAddLine,
  RiCheckLine,
  RiListCheck3,
  RiStopCircleLine,
  RiRefreshLine,
  RiDeleteBinLine,
  RiCloseLine,
  RiStarFill,
  RiStarLine,
  RiEditLine,
  RiQuestionLine,
} from '@remixicon/vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ListItemFrame from '@/components/ui/ListItemFrame.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import ListItemSelectionIndicator from '@/components/ui/ListItemSelectionIndicator.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import SearchInput from '@/components/ui/SearchInput.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import TerminalKeybar from '@/components/TerminalKeybar.vue'
import { useUnifiedMultiSelect } from '@/composables/useUnifiedMultiSelect'
import { consumeTrustedTerminalHandoffPayload, type TerminalHandoffTarget } from '@/lib/terminalHandoff'
import { getLocalString, removeLocalKey, removeSessionKey, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'
import { ApiError } from '@/lib/api'
import { copyTextToClipboard, readTextFromClipboard } from '@/lib/clipboard'
import { connectSse } from '@/lib/sse'
import {
  createTerminalSession,
  deleteTerminalSession,
  getTerminalUiState,
  getTerminalSessionInfo,
  putTerminalUiState,
  resizeTerminal,
  sendTerminalInput,
  startTerminalSession,
  stopTerminalSession,
  terminalStreamUrl,
  terminalUiStateEventsUrl,
  type TerminalUiState,
} from '@/features/terminal/api/terminalApi'
import {
  createUniqueTerminalSessionName,
  ensureTerminalSessionNames,
  normalizeTerminalSessionName,
  resolveSessionIdByName,
  type TerminalSessionMeta as NameKeyedTerminalSessionMeta,
} from '@/features/terminal/lib/sessionNameKey'
import { handleTerminalKeyboardShortcut } from '@/features/terminal/lib/terminalKeyboardShortcuts'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()

type TerminalStreamEvent =
  | { type: 'connected'; runtime?: string; ptyBackend?: string }
  | { type: 'data'; data?: string; seq?: number }
  | { type: 'resync'; reason?: string; since?: number; firstAvailableSeq?: number; lastSeq?: number }
  | { type: 'exit'; exitCode?: number | null; signal?: number | null }

type TerminalUiStatePatchOp = {
  type: 'state.replace'
  state?: TerminalUiState
}

type TerminalUiStateEvent =
  | {
      type: 'terminal-ui-state.snapshot'
      state?: TerminalUiState
      seq?: number
    }
  | {
      type: 'terminal-ui-state.patch'
      seq?: number
      properties?: {
        ops?: TerminalUiStatePatchOp[]
      }
    }

const STORAGE_GIT_HANDOFF_SESSION_NAME = localStorageKeys.terminal.gitHandoffSessionName
const STORAGE_GIT_HANDOFF_SESSION_ID_DEPRECATED = 'studio.terminal.git-handoff-session-id'

function clearDeprecatedGitHandoffStorage() {
  removeLocalKey(STORAGE_GIT_HANDOFF_SESSION_ID_DEPRECATED)
  removeSessionKey(STORAGE_GIT_HANDOFF_SESSION_ID_DEPRECATED)
}

clearDeprecatedGitHandoffStorage()

const TERMINAL_STATE_REMOTE_SAVE_DEBOUNCE_MS = 250

const DEFAULT_TERMINAL_CWD = '/home'
const DEFAULT_TERMINAL_SESSION_NAME = 'Terminal'

const GIT_HANDOFF_SESSION_NAME = String(t('terminal.defaults.gitTerminal'))

type TerminalSessionMeta = NameKeyedTerminalSessionMeta

function normalizeSessionMetaName(input: unknown): string {
  return normalizeTerminalSessionName(input)
}

function normalizeFolderId(input: unknown): string {
  return String(input || '')
    .trim()
    .slice(0, 80)
}

function compactSessionMeta(input: unknown): TerminalSessionMeta | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const meta = input as Record<string, unknown>
  const name = normalizeSessionMetaName(meta.name)
  const folderId = normalizeFolderId(meta.folderId ?? meta.group)
  const pinned = meta.pinned === true

  const rawLastUsedAt = Number(meta.lastUsedAt)
  const lastUsedAt = Number.isFinite(rawLastUsedAt) && rawLastUsedAt > 0 ? Math.floor(rawLastUsedAt) : 0

  const out: TerminalSessionMeta = {}
  if (name) out.name = name
  if (folderId) out.folderId = folderId
  if (pinned) out.pinned = true
  if (lastUsedAt > 0) out.lastUsedAt = lastUsedAt
  return Object.keys(out).length > 0 ? out : null
}

type TerminalSidebarSession = {
  id: string
  name: string
  pinned: boolean
  lastUsedAt: number
}

function normalizeSessionId(input: string | null | undefined): string {
  return String(input || '').trim()
}

function normalizeSessionList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of input) {
    const id = normalizeSessionId(typeof item === 'string' ? item : '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function readStoredGitHandoffSessionName(): string {
  return normalizeSessionMetaName(getLocalString(STORAGE_GIT_HANDOFF_SESSION_NAME) || '')
}

function persistGitHandoffSessionName(next: string | null) {
  const name = normalizeSessionMetaName(next || '')
  if (!name) {
    removeLocalKey(STORAGE_GIT_HANDOFF_SESSION_NAME)
    return
  }
  setLocalString(STORAGE_GIT_HANDOFF_SESSION_NAME, name)
}

const ui = useUiStore()
const directoryStore = useDirectoryStore()
const { startDesktopSidebarResize } = useDesktopSidebarResize()

const route = useRoute()
const router = useRouter()

const pendingSend = ref<string | null>(null)
const pendingSendTarget = ref<TerminalHandoffTarget | null>(null)

function firstQueryValue(raw: string | null | Array<string | null> | undefined): string {
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) return item.trim()
    }
  }
  return ''
}

function hydratePendingSendFromQuery() {
  const token = firstQueryValue(route.query.sendToken)
  const legacySend = firstQueryValue(route.query.send)

  if (token) {
    const handoff = consumeTrustedTerminalHandoffPayload(token)
    pendingSend.value = handoff?.send || null
    pendingSendTarget.value = handoff?.target || null
  } else {
    pendingSend.value = null
    pendingSendTarget.value = null
  }

  if (!token && legacySend) {
    // Legacy raw query payloads are intentionally blocked.
    pendingSend.value = null
    pendingSendTarget.value = null
  }

  if (token || legacySend) {
    void router.replace({ path: '/terminal', query: {} }).catch(() => {})
  }
}

const useShellSidebar = computed(() => (ui.isMobile ? ui.isSessionSwitcherOpen : ui.isSidebarOpen))
const sessionId = ref<string | null>(null)
const sessionList = ref<string[]>([])
const sessionMetaById = ref<Record<string, TerminalSessionMeta>>({})
const streamSeqById = ref<Record<string, number>>({})
const sessionListRefreshing = ref(false)
const status = ref<string>('disconnected')
const errorMsg = ref<string | null>(null)

const terminalStateVersion = ref(0)
const terminalStateUpdatedAt = ref(0)
const terminalStateHydrated = ref(false)

let terminalStatePersistTimer: number | null = null
let terminalStatePersistInFlight = false
let terminalStatePersistQueued = false
let terminalStateApplyInProgress = false

let terminalStateEventsSource: ReturnType<typeof connectSse> | null = null
let terminalStateEventSeq = 0

if (sessionId.value && !sessionList.value.includes(sessionId.value)) {
  sessionList.value = [sessionId.value, ...sessionList.value]
}
if (!sessionId.value && sessionList.value.length > 0) {
  const first = sessionList.value[0] || null
  sessionId.value = first
}

function sessionMetaFor(id: string): TerminalSessionMeta {
  const sid = normalizeSessionId(id)
  if (!sid) return {}
  return sessionMetaById.value[sid] || {}
}

function ensureUniqueSessionNames(opts?: { remote?: boolean }) {
  const normalizedSessionIds = normalizeSessionList(sessionList.value)
  const ensured = ensureTerminalSessionNames(normalizedSessionIds, sessionMetaById.value, {
    fallbackBase: DEFAULT_TERMINAL_SESSION_NAME,
  })
  if (!ensured.changed) return
  sessionMetaById.value = ensured.sessionMetaById
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
}

function resolveUniqueSessionName(name: string, opts?: { excludeSid?: string | null }): string {
  const excludeSid = normalizeSessionId(opts?.excludeSid || '')
  const used = new Set<string>()
  for (const rawSid of sessionList.value) {
    const sid = normalizeSessionId(rawSid)
    if (!sid || sid === excludeSid) continue
    const existing = normalizeSessionMetaName(sessionMetaFor(sid).name)
    if (!existing) continue
    used.add(existing.toLowerCase())
  }
  return createUniqueTerminalSessionName(name, used, {
    fallbackBase: DEFAULT_TERMINAL_SESSION_NAME,
  })
}

function resolveSessionIdByStoredName(name: string): string | null {
  return resolveSessionIdByName(sessionList.value, sessionMetaById.value, name)
}

function buildTerminalUiStatePayload(): TerminalUiState {
  const normalizedSessionIds = normalizeSessionList(sessionList.value)
  const allowedSessionIds = new Set(normalizedSessionIds)

  const normalizedMetaById: Record<string, TerminalSessionMeta> = {}
  for (const [rawSid, rawMeta] of Object.entries(sessionMetaById.value)) {
    const sid = normalizeSessionId(rawSid)
    if (!sid || !allowedSessionIds.has(sid)) continue
    const compact = compactSessionMeta(rawMeta)
    if (!compact) continue
    normalizedMetaById[sid] = compact
  }

  const ensured = ensureTerminalSessionNames(normalizedSessionIds, normalizedMetaById, {
    fallbackBase: DEFAULT_TERMINAL_SESSION_NAME,
  })

  const active = normalizeSessionId(sessionId.value || '')

  return {
    version: Math.max(0, Math.floor(Number(terminalStateVersion.value) || 0)),
    updatedAt: Math.max(0, Math.floor(Number(terminalStateUpdatedAt.value) || 0)),
    activeSessionId: active || null,
    sessionIds: normalizedSessionIds,
    sessionMetaById: ensured.sessionMetaById,
    folders: [],
  }
}

function scheduleTerminalStateRemotePersist() {
  if (terminalStateApplyInProgress) return
  if (!terminalStateHydrated.value) return
  terminalStatePersistQueued = true

  if (terminalStatePersistTimer !== null) {
    window.clearTimeout(terminalStatePersistTimer)
  }

  terminalStatePersistTimer = window.setTimeout(() => {
    terminalStatePersistTimer = null
    void persistTerminalStateRemote()
  }, TERMINAL_STATE_REMOTE_SAVE_DEBOUNCE_MS)
}

async function persistTerminalStateRemote() {
  if (!terminalStateHydrated.value) return
  if (terminalStatePersistInFlight) {
    terminalStatePersistQueued = true
    return
  }

  terminalStatePersistInFlight = true
  terminalStatePersistQueued = false

  try {
    const saved = await putTerminalUiState(buildTerminalUiStatePayload())
    applyTerminalUiStateSnapshot(saved)
  } catch {
    terminalStatePersistQueued = true
  } finally {
    terminalStatePersistInFlight = false
    if (terminalStatePersistQueued) {
      scheduleTerminalStateRemotePersist()
    }
  }
}

function isGitHandoffSession(id: string): boolean {
  const sid = normalizeSessionId(id)
  if (!sid) return false
  const storedName = readStoredGitHandoffSessionName()

  const meta = sessionMetaFor(sid)
  const name = normalizeSessionMetaName(meta.name)
  if (storedName && name === storedName) return true
  return name === GIT_HANDOFF_SESSION_NAME
}

function gitHandoffSessionCandidates(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const storedName = readStoredGitHandoffSessionName()

  function push(rawId: string | null | undefined) {
    const sid = normalizeSessionId(rawId || '')
    if (!sid || seen.has(sid)) return
    seen.add(sid)
    out.push(sid)
  }

  push(resolveSessionIdByStoredName(storedName))
  for (const sid of sessionList.value) {
    if (isGitHandoffSession(sid)) {
      push(sid)
    }
  }

  return out
}

async function ensureGitHandoffSessionExists(): Promise<string> {
  for (const sid of gitHandoffSessionCandidates()) {
    const exists = await getSessionInfo(sid)
    if (!exists) {
      removeTrackedSession(sid)
      continue
    }

    patchSessionMeta(sid, {
      name: GIT_HANDOFF_SESSION_NAME,
    })
    persistGitHandoffSessionName(GIT_HANDOFF_SESSION_NAME)
    return sid
  }

  const createCwd = sessionStartCwd()
  setError(null)
  status.value = 'creating'

  const json = await createTerminalSession({ cwd: createCwd, cols: 80, rows: 24 })
  const sid = normalizeSessionId(json.sessionId)
  if (sid && !sessionList.value.includes(sid)) {
    sessionList.value = [sid, ...sessionList.value]
    persistSessionList({ remote: false })
  }
  patchSessionMeta(json.sessionId, {
    name: GIT_HANDOFF_SESSION_NAME,
    pinned: undefined,
    lastUsedAt: Date.now(),
  })
  persistGitHandoffSessionName(GIT_HANDOFF_SESSION_NAME)
  clearSessionOutput(json.sessionId)
  setStreamStatusForSession(json.sessionId, 'disconnected')
  return json.sessionId
}

function persistSessionMetaById(opts?: { remote?: boolean }) {
  const compacted: Record<string, TerminalSessionMeta> = {}
  for (const [key, value] of Object.entries(sessionMetaById.value)) {
    const sid = normalizeSessionId(key)
    if (!sid) continue
    const compact = compactSessionMeta(value)
    if (!compact) continue
    compacted[sid] = compact
  }
  const ensured = ensureTerminalSessionNames(normalizeSessionList(sessionList.value), compacted, {
    fallbackBase: DEFAULT_TERMINAL_SESSION_NAME,
  })
  sessionMetaById.value = ensured.sessionMetaById
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
}

function patchSessionMeta(id: string, patch: Partial<TerminalSessionMeta>, opts?: { remote?: boolean }) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const nextPatch: Partial<TerminalSessionMeta> = { ...patch }
  if (typeof patch.name === 'string') {
    nextPatch.name = resolveUniqueSessionName(patch.name, { excludeSid: sid })
  }
  const current = sessionMetaById.value[sid] || {}
  const merged = {
    ...current,
    ...nextPatch,
  }
  const compact = compactSessionMeta(merged)
  if (!compact) {
    if (Object.prototype.hasOwnProperty.call(sessionMetaById.value, sid)) {
      const next = { ...sessionMetaById.value }
      delete next[sid]
      sessionMetaById.value = next
      persistSessionMetaById(opts)
    }
    return
  }

  sessionMetaById.value = {
    ...sessionMetaById.value,
    [sid]: compact,
  }
  persistSessionMetaById(opts)
}

function removeSessionMeta(id: string, opts?: { remote?: boolean }) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (!Object.prototype.hasOwnProperty.call(sessionMetaById.value, sid)) return
  const next = { ...sessionMetaById.value }
  delete next[sid]
  sessionMetaById.value = next
  persistSessionMetaById(opts)
}

function seedSessionRecencyFromList(opts?: { remote?: boolean }) {
  const base = Date.now()
  let changed = false
  const next = { ...sessionMetaById.value }

  for (let i = 0; i < sessionList.value.length; i += 1) {
    const sid = normalizeSessionId(sessionList.value[i])
    if (!sid) continue
    const current = compactSessionMeta(next[sid]) || {}
    const hasLastUsedAt =
      typeof current.lastUsedAt === 'number' && Number.isFinite(current.lastUsedAt) && current.lastUsedAt > 0
    if (hasLastUsedAt) continue
    next[sid] = {
      ...current,
      lastUsedAt: Math.max(1, base - i),
    }
    changed = true
  }

  if (changed) {
    sessionMetaById.value = next
    persistSessionMetaById(opts)
  }
}

function pruneSessionMetaToTrackedSessions(opts?: { remote?: boolean }) {
  const allowed = new Set(sessionList.value.map((id) => normalizeSessionId(id)).filter(Boolean))
  let changed = false
  const next: Record<string, TerminalSessionMeta> = {}

  for (const [sid, meta] of Object.entries(sessionMetaById.value)) {
    if (!allowed.has(sid)) {
      changed = true
      continue
    }
    const compact = compactSessionMeta(meta)
    if (!compact) {
      changed = true
      continue
    }
    next[sid] = compact
  }

  if (!changed && Object.keys(next).length === Object.keys(sessionMetaById.value).length) return
  sessionMetaById.value = next
  persistSessionMetaById(opts)
}

function persistSessionList(opts?: { remote?: boolean }) {
  const normalized = normalizeSessionList(sessionList.value)
  sessionList.value = normalized
  pruneSessionMetaToTrackedSessions({ remote: false })
  ensureUniqueSessionNames({ remote: false })
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
}

function setActiveSession(next: string | null, opts?: { remote?: boolean }) {
  const sid = normalizeSessionId(next)
  if (!sid) {
    sessionId.value = null
    status.value = 'disconnected'
    if (opts?.remote !== false) {
      scheduleTerminalStateRemotePersist()
    }
    return
  }

  sessionId.value = sid
  if (!sessionList.value.includes(sid)) {
    sessionList.value = [sid, ...sessionList.value]
    persistSessionList({ remote: false })
  }
  lastSentResizeSig = null
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
  if (status.value !== 'creating' && status.value !== 'restarting') {
    status.value = streamStatusForSession(sid)
  }
}

function defaultTerminalUiState(): TerminalUiState {
  return {
    version: 0,
    updatedAt: 0,
    activeSessionId: null,
    sessionIds: [],
    sessionMetaById: {},
    folders: [],
  }
}

function applyTerminalUiStateSnapshot(snapshot: TerminalUiState) {
  const incomingVersion = Math.max(0, Math.floor(Number(snapshot.version) || 0))
  const incomingUpdatedAt = Math.max(0, Math.floor(Number(snapshot.updatedAt) || 0))

  if (terminalStateHydrated.value && incomingVersion < terminalStateVersion.value) {
    return
  }
  if (
    terminalStateHydrated.value &&
    incomingVersion <= terminalStateVersion.value &&
    (terminalStatePersistInFlight || terminalStatePersistQueued || terminalStatePersistTimer !== null)
  ) {
    // Keep local unsaved edits while a remote save is pending.
    return
  }

  const normalizedSessionIds = normalizeSessionList(snapshot.sessionIds)
  const allowedSessionIds = new Set(normalizedSessionIds)

  const compactedSessionMetaById: Record<string, TerminalSessionMeta> = {}
  for (const [rawSid, rawMeta] of Object.entries(snapshot.sessionMetaById || {})) {
    const sid = normalizeSessionId(rawSid)
    if (!sid || !allowedSessionIds.has(sid)) continue
    const compact = compactSessionMeta(rawMeta)
    if (!compact) continue
    compactedSessionMetaById[sid] = compact
  }

  const ensured = ensureTerminalSessionNames(normalizedSessionIds, compactedSessionMetaById, {
    fallbackBase: DEFAULT_TERMINAL_SESSION_NAME,
  })

  const requestedActive = normalizeSessionId(snapshot.activeSessionId || '')
  const nextActive =
    requestedActive && allowedSessionIds.has(requestedActive) ? requestedActive : normalizedSessionIds[0] || ''

  const previousSessionIds = sessionList.value.slice()

  terminalStateApplyInProgress = true
  try {
    sessionMetaById.value = ensured.sessionMetaById
    sessionList.value = normalizedSessionIds
    seedSessionRecencyFromList({ remote: false })

    for (const sid of previousSessionIds) {
      if (allowedSessionIds.has(sid)) continue
      removeTrackedSession(sid, { persist: false })
    }

    sessionId.value = nextActive || null
    terminalStateVersion.value = incomingVersion
    terminalStateUpdatedAt.value = incomingUpdatedAt
  } finally {
    terminalStateApplyInProgress = false
  }

  if (ensured.changed) {
    if (terminalStateHydrated.value) {
      scheduleTerminalStateRemotePersist()
    } else {
      terminalStatePersistQueued = true
    }
  }

  if (!sessionId.value) {
    status.value = 'disconnected'
  } else if (status.value !== 'creating' && status.value !== 'restarting') {
    status.value = streamStatusForSession(sessionId.value)
  }

  if (sessionId.value) {
    renderSessionOutput(sessionId.value)
  }
  void refreshTrackedSessions()
  ensureTrackedSessionStreams()
}

function applyTerminalUiStateEventMessage(raw: string, lastEventId: string) {
  if (!raw) return

  const seqFromLastEventId = Number.parseInt(String(lastEventId || '').trim(), 10)
  if (Number.isFinite(seqFromLastEventId) && seqFromLastEventId > terminalStateEventSeq) {
    terminalStateEventSeq = seqFromLastEventId
  }

  let parsed: TerminalUiStateEvent
  try {
    parsed = JSON.parse(raw) as TerminalUiStateEvent
  } catch {
    return
  }

  if (parsed.type === 'terminal-ui-state.snapshot') {
    const seq = typeof parsed.seq === 'number' && Number.isFinite(parsed.seq) ? Math.floor(parsed.seq) : 0
    if (seq > 0 && seq <= terminalStateEventSeq) return
    if (seq > 0) terminalStateEventSeq = seq
    if (parsed.state) {
      applyTerminalUiStateSnapshot(parsed.state)
    }
    return
  }

  if (parsed.type !== 'terminal-ui-state.patch') return

  const seq = typeof parsed.seq === 'number' && Number.isFinite(parsed.seq) ? Math.floor(parsed.seq) : 0
  if (seq > 0 && seq <= terminalStateEventSeq) return
  if (seq > 0) terminalStateEventSeq = seq

  const ops = Array.isArray(parsed.properties?.ops) ? parsed.properties.ops : []
  for (const op of ops) {
    if (!op || op.type !== 'state.replace') continue
    if (!op.state) continue
    applyTerminalUiStateSnapshot(op.state)
  }
}

function closeTerminalUiStateEvents() {
  if (!terminalStateEventsSource) return
  try {
    terminalStateEventsSource.close()
  } catch {
    // ignore
  }
  terminalStateEventsSource = null
}

function openTerminalUiStateEvents() {
  closeTerminalUiStateEvents()
  const client = connectSse({
    endpoint: terminalUiStateEventsUrl(terminalStateEventSeq > 0 ? terminalStateEventSeq : undefined),
    debugLabel: 'sse:terminal-ui-state',
    onEvent: (evt) => {
      const lastEventId =
        typeof (evt as unknown as { lastEventId?: unknown }).lastEventId === 'string'
          ? String((evt as unknown as { lastEventId?: string }).lastEventId || '')
          : ''
      applyTerminalUiStateEventMessage(JSON.stringify(evt), lastEventId)
    },
    onError: () => {
      // connectSse handles reconnects.
    },
  })
  terminalStateEventsSource = client
}

async function bootstrapTerminalUiState() {
  try {
    const remote = await getTerminalUiState()
    applyTerminalUiStateSnapshot(remote)
    terminalStateHydrated.value = true
  } catch {
    applyTerminalUiStateSnapshot(defaultTerminalUiState())
    terminalStateHydrated.value = true
    scheduleTerminalStateRemotePersist()
  }

  if (terminalStatePersistQueued) {
    scheduleTerminalStateRemotePersist()
  }
}

function streamSeqForSession(id: string): number {
  const sid = normalizeSessionId(id)
  if (!sid) return 0
  return streamSeqById.value[sid] || 0
}

function rememberStreamSeq(id: string, seq: unknown) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return
  const n = Math.max(0, Math.floor(seq))
  if (n <= 0) return
  const prev = streamSeqById.value[sid] || 0
  if (n <= prev) return
  streamSeqById.value = {
    ...streamSeqById.value,
    [sid]: n,
  }
}

function dropStreamSeq(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (!Object.prototype.hasOwnProperty.call(streamSeqById.value, sid)) return
  const next = { ...streamSeqById.value }
  delete next[sid]
  streamSeqById.value = next
}

function removeTrackedSession(id: string, opts?: { persist?: boolean }) {
  const shouldPersist = opts?.persist !== false
  const sid = normalizeSessionId(id)
  if (!sid) return
  closeSessionStream(sid, { manual: true })
  streamManuallyDisconnected.delete(sid)
  streamGenerationById.delete(sid)
  streamReconnectAttemptsById.delete(sid)
  clearStreamStatusForSession(sid)
  clearSessionOutput(sid)
  dropStreamSeq(sid)
  const removedName = normalizeSessionMetaName(sessionMetaFor(sid).name)
  if (removedName && removedName === readStoredGitHandoffSessionName()) {
    persistGitHandoffSessionName(null)
  }
  removeSessionMeta(sid, { remote: shouldPersist })
  if (sessionRenamingId.value === sid) cancelSessionRename()
  if (mobileSessionActionTargetId.value === sid) {
    mobileSessionActionTargetId.value = null
    mobileSessionActionOpen.value = false
    mobileSessionActionQuery.value = ''
  }
  if (sessionList.value.includes(sid)) {
    sessionList.value = sessionList.value.filter((item) => item !== sid)
    if (shouldPersist) {
      persistSessionList()
    }
  }
  if (sessionId.value === sid) {
    sessionId.value = null
    lastSentResizeSig = null
    status.value = 'disconnected'
    if (shouldPersist) {
      scheduleTerminalStateRemotePersist()
    }
  }
}

seedSessionRecencyFromList()
ensureUniqueSessionNames()

const sidebarQuery = ref('')
const sidebarQueryNorm = computed(() => sidebarQuery.value.trim().toLowerCase())

const sessionCreateOpen = ref(false)
const sessionCreateDraft = ref('')
const sessionCreateBusy = ref(false)

const sessionRenamingId = ref<string | null>(null)
const sessionRenameDraft = ref('')
const mobileSessionActionTargetId = ref<string | null>(null)
const mobileSessionActionOpen = ref(false)
const mobileSessionActionQuery = ref('')

const mobileSessionCreateDialogOpen = computed(() => ui.isMobilePointer && sessionCreateOpen.value)
const mobileSessionRenameDialogOpen = computed(
  () => ui.isMobilePointer && Boolean(normalizeSessionId(sessionRenamingId.value)),
)

const terminalMultiSelect = useUnifiedMultiSelect()
const allTerminalSelectableIds = computed(() => sidebarSessions.value.map((item) => item.id))

function sidebarSessionLabel(item: TerminalSidebarSession): string {
  return item.name || DEFAULT_TERMINAL_SESSION_NAME
}

function compareSidebarSessionOrder(a: TerminalSidebarSession, b: TerminalSidebarSession): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt
  return a.id.localeCompare(b.id)
}

function sessionMatchesQuery(item: TerminalSidebarSession, q: string): boolean {
  const label = sidebarSessionLabel(item).toLowerCase()
  return label.includes(q)
}

const sidebarSessions = computed<TerminalSidebarSession[]>(() => {
  return sessionList.value.map((id) => {
    const meta = sessionMetaFor(id)
    const lastUsedAt =
      typeof meta.lastUsedAt === 'number' && Number.isFinite(meta.lastUsedAt) ? Math.floor(meta.lastUsedAt) : 0
    return {
      id,
      name: normalizeSessionMetaName(meta.name) || DEFAULT_TERMINAL_SESSION_NAME,
      pinned: meta.pinned === true,
      lastUsedAt,
    }
  })
})

const totalSessionCount = computed(() => sidebarSessions.value.length)

const visibleSidebarSessions = computed<TerminalSidebarSession[]>(() => {
  const q = sidebarQueryNorm.value
  const filtered = !q
    ? sidebarSessions.value.slice()
    : sidebarSessions.value.filter((item) => sessionMatchesQuery(item, q))
  return filtered.sort(compareSidebarSessionOrder)
})

const visibleTerminalSelectableIds = computed(() => visibleSidebarSessions.value.map((item) => item.id))

function startSessionCreate() {
  cancelSessionRename()
  sessionCreateOpen.value = true
  sessionCreateDraft.value = ''
  sessionCreateBusy.value = false
}

function sessionStartCwd(): string {
  const projectDir = String(directoryStore.currentDirectory || '').trim()
  if (projectDir) return projectDir
  return DEFAULT_TERMINAL_CWD
}

function cancelSessionCreate() {
  sessionCreateOpen.value = false
  sessionCreateDraft.value = ''
  sessionCreateBusy.value = false
}

async function createSessionWithName(name: string) {
  const sessionName = resolveUniqueSessionName(name)
  if (!sessionName) return
  const createCwd = sessionStartCwd()

  setError(null)
  status.value = 'creating'

  const json = await createTerminalSession({ cwd: createCwd, cols: 80, rows: 24 })
  // Ensure the newly created session is tracked before persisting meta.
  // `patchSessionMeta` compacts meta against `sessionList`, so ordering matters.
  setActiveSession(json.sessionId, { remote: false })
  patchSessionMeta(json.sessionId, {
    name: sessionName,
    pinned: undefined,
    lastUsedAt: Date.now(),
  })
  clearSessionOutput(json.sessionId)
  setStreamStatusForSession(json.sessionId, 'disconnected')
  renderSessionOutput(json.sessionId)
  connectSessionStream(json.sessionId)
  ensureTrackedSessionStreams()
}

async function saveSessionCreate() {
  if (!sessionCreateOpen.value) return
  const name = normalizeSessionMetaName(sessionCreateDraft.value)
  if (!name || sessionCreateBusy.value) return

  sessionCreateBusy.value = true
  try {
    await createSessionWithName(name)
    cancelSessionCreate()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    status.value = 'error'
    setError(msg)
  } finally {
    sessionCreateBusy.value = false
  }
}

function startSessionRename(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  cancelSessionCreate()
  sessionRenamingId.value = sid
  sessionRenameDraft.value = normalizeSessionMetaName(sessionMetaFor(sid).name) || DEFAULT_TERMINAL_SESSION_NAME
}

function cancelSessionRename() {
  sessionRenamingId.value = null
  sessionRenameDraft.value = ''
}

function saveSessionRename() {
  const sid = normalizeSessionId(sessionRenamingId.value)
  if (!sid) return
  const name = normalizeSessionMetaName(sessionRenameDraft.value)
  if (!name) return
  patchSessionMeta(sid, { name: resolveUniqueSessionName(name, { excludeSid: sid }) })
  cancelSessionRename()
}

function isSessionRenaming(id: string): boolean {
  const sid = normalizeSessionId(id)
  return Boolean(sid) && sessionRenamingId.value === sid
}

function toggleSessionPinned(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const nextPinned = !Boolean(sessionMetaFor(sid).pinned)
  patchSessionMeta(sid, {
    pinned: nextPinned ? true : undefined,
  })
}

const activeSessionName = computed(() => {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) return String(t('terminal.active.noneSelected'))
  const customName = normalizeSessionMetaName(sessionMetaFor(sid).name)
  if (customName) return customName
  return DEFAULT_TERMINAL_SESSION_NAME
})

function openTerminalSidebar() {
  if (ui.isMobile) {
    ui.setSessionSwitcherOpen(true)
    return
  }
  if (!ui.isSidebarOpen) {
    ui.toggleSidebar()
  }
}

function statusDotClassForSession(id: string): string {
  const streamStatus = streamStatusForSession(id)
  if (streamStatus === 'connected') return 'bg-emerald-500'
  if (streamStatus === 'connecting' || streamStatus === 'reconnecting') {
    return 'bg-amber-500'
  }
  if (streamStatus === 'error' || streamStatus === 'exited') return 'bg-rose-500'
  return 'bg-muted-foreground/35'
}

function canDisconnectSession(id: string): boolean {
  const sid = normalizeSessionId(id)
  if (!sid) return false
  const streamStatus = streamStatusForSession(sid)
  return streamStatus === 'connected' || streamStatus === 'connecting' || streamStatus === 'reconnecting'
}

async function disconnectSessionFromSidebar(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (!canDisconnectSession(sid)) return

  try {
    await stopTerminalSession(sid)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToStopSession')), err, sid)
    return
  }

  closeSessionStream(sid, { manual: true })
  if (sessionId.value === sid) {
    status.value = 'disconnected'
  }
}

function mobileSessionActionTitle(id: string): string {
  const sid = normalizeSessionId(id)
  if (!sid) return String(t('terminal.actions.title'))
  const customName = normalizeSessionMetaName(sessionMetaFor(sid).name)
  const label = customName || DEFAULT_TERMINAL_SESSION_NAME
  return String(t('terminal.actions.titleWithName', { name: label }))
}

function mobileSessionActionItems(id: string): OptionMenuItem[] {
  const sid = normalizeSessionId(id)
  if (!sid) return []

  const pinned = Boolean(sessionMetaFor(sid).pinned)
  return [
    {
      id: 'rename',
      label: String(t('terminal.actions.rename')),
      icon: RiEditLine,
    },
    {
      id: 'disconnect',
      label: String(t('terminal.actions.disconnectStream')),
      icon: RiStopCircleLine,
      disabled: !canDisconnectSession(sid),
      confirmTitle: String(t('terminal.actions.disconnectConfirmTitle')),
      confirmDescription: String(t('terminal.actions.disconnectConfirmDescription')),
      confirmText: String(t('terminal.actions.disconnect')),
      cancelText: String(t('common.cancel')),
    },
    {
      id: 'pin',
      label: pinned ? String(t('terminal.actions.unpin')) : String(t('terminal.actions.pin')),
      icon: pinned ? RiStarFill : RiStarLine,
    },
    {
      id: 'delete',
      label: String(t('terminal.actions.delete')),
      icon: RiDeleteBinLine,
      variant: 'destructive',
      confirmTitle: String(t('terminal.actions.deleteConfirmTitle')),
      confirmDescription: String(t('terminal.actions.deleteConfirmDescription')),
      confirmText: String(t('terminal.actions.deleteConfirmText')),
      cancelText: String(t('common.cancel')),
    },
  ]
}

function mobileSessionActionGroups(id: string): OptionMenuGroup[] {
  return [
    {
      id: 'terminal-session-actions',
      items: mobileSessionActionItems(id),
    },
  ]
}

function openMobileSessionActionMenu(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid || !ui.isMobilePointer) return
  mobileSessionActionTargetId.value = sid
  mobileSessionActionQuery.value = ''
  mobileSessionActionOpen.value = true
}

function handleMobileSessionActionTrigger(id: string) {
  openMobileSessionActionMenu(id)
}

function isMobileSessionActionMenuOpen(id: string): boolean {
  const sid = normalizeSessionId(id)
  return Boolean(sid) && mobileSessionActionOpen.value && mobileSessionActionTargetId.value === sid
}

function setMobileSessionActionMenuOpen(id: string, open: boolean) {
  const sid = normalizeSessionId(id)
  if (!sid) return

  if (open) {
    mobileSessionActionTargetId.value = sid
    mobileSessionActionOpen.value = true
    return
  }

  if (mobileSessionActionTargetId.value === sid) {
    mobileSessionActionOpen.value = false
    mobileSessionActionTargetId.value = null
    mobileSessionActionQuery.value = ''
  }
}

function runMobileSessionAction(id: string, item: OptionMenuItem) {
  const sid = normalizeSessionId(id)
  if (!sid) return

  if (item.id === 'rename') {
    startSessionRename(sid)
    return
  }
  if (item.id === 'disconnect') {
    disconnectSessionFromSidebar(sid)
    return
  }
  if (item.id === 'pin') {
    toggleSessionPinned(sid)
    return
  }
  if (item.id === 'delete') {
    void closeTrackedSession(sid)
  }
}

async function refreshTrackedSessions() {
  if (sessionListRefreshing.value) return
  sessionListRefreshing.value = true
  try {
    const tracked = sessionList.value.slice()
    const missing = new Set<string>()

    await Promise.all(
      tracked.map(async (id) => {
        const sid = normalizeSessionId(id)
        if (!sid) return
        try {
          const exists = await getSessionInfo(sid)
          if (!exists) {
            missing.add(sid)
          }
        } catch {
          // Keep session optimistic when probe fails.
        }
      }),
    )

    if (missing.size > 0) {
      for (const sid of missing) {
        removeTrackedSession(sid)
      }
      if (sessionId.value && missing.has(sessionId.value)) {
        status.value = 'disconnected'
      }
    }
  } finally {
    sessionListRefreshing.value = false
  }
}

const activeSessionStreamStatus = computed<SessionStreamStatus>(() => {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) return 'disconnected'
  return streamStatusForSession(sid)
})

const connectionToggleMode = computed<'connect' | 'disconnect'>(() => {
  const state = activeSessionStreamStatus.value
  return state === 'connected' || state === 'connecting' || state === 'reconnecting' ? 'disconnect' : 'connect'
})

const connectionToggleDisabled = computed(() => {
  if (!sessionId.value) return true
  return status.value === 'creating' || status.value === 'restarting'
})

const connectionToggleLabel = computed(() =>
  connectionToggleMode.value === 'disconnect'
    ? String(t('terminal.connection.disconnectLabel'))
    : String(t('terminal.connection.connectLabel')),
)

const shortcutHelpOpen = ref(false)
const terminalShortcutRows = computed(() => [
  {
    keys: 'Ctrl+C',
    description: String(t('terminal.shortcuts.copyOrInterrupt')),
  },
  {
    keys: 'Ctrl+Shift+C / Ctrl+Insert',
    description: String(t('terminal.shortcuts.copySelection')),
  },
  {
    keys: 'Ctrl+V / Ctrl+Shift+V / Shift+Insert',
    description: String(t('terminal.shortcuts.pasteInput')),
  },
  {
    keys: 'Cmd+C / Cmd+V',
    description: String(t('terminal.shortcuts.macMetaCompat')),
  },
])

function toggleConnection() {
  if (connectionToggleDisabled.value) return
  if (connectionToggleMode.value === 'disconnect') {
    void disconnect()
    return
  }
  void connect()
}

const keyMods = ref<{ ctrl: boolean; alt: boolean; shift: boolean }>({ ctrl: false, alt: false, shift: false })

function setKeyMods(m: { ctrl: boolean; alt: boolean; shift: boolean }) {
  keyMods.value = m
}

function ctrlify(ch: string): string {
  if (!ch) return ch
  const c = ch.toUpperCase().charCodeAt(0)
  if (c >= 65 && c <= 90) return String.fromCharCode(c - 64) // ^A..^Z
  if (ch === ' ') return String.fromCharCode(0)
  if (ch === '[') return String.fromCharCode(27)
  if (ch === '\\') return String.fromCharCode(28)
  if (ch === ']') return String.fromCharCode(29)
  if (ch === '^') return String.fromCharCode(30)
  if (ch === '_') return String.fromCharCode(31)
  return ch
}

function applyKeyMods(data: string): string {
  // Only rewrite single-character inputs from the mobile IME.
  if (!data || data.length !== 1) return data

  const mods = keyMods.value
  if (!mods.ctrl && !mods.alt && !mods.shift) return data

  let out = data
  if (mods.shift && /[a-z]/.test(out)) out = out.toUpperCase()
  if (mods.ctrl) out = ctrlify(out)
  if (mods.alt) out = `\x1b${out}`
  return out
}

const el = ref<HTMLDivElement | null>(null)
const term = shallowRef<Terminal | null>(null)
const fit = shallowRef<FitAddon | null>(null)

let resizeObserver: ResizeObserver | null = null

let resizeTimer: number | null = null
let lastSentResizeSig: string | null = null

type SessionStreamStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'exited'
type SessionOutputBuffer = { chunks: string[]; bytes: number }

const SESSION_OUTPUT_MAX_BYTES = 256 * 1024

const streamStatusById = ref<Record<string, SessionStreamStatus>>({})
const streamSourceById = new Map<string, ReturnType<typeof connectSse>>()
const streamReconnectTimerById = new Map<string, number>()
const streamReconnectAttemptsById = new Map<string, number>()
const streamGenerationById = new Map<string, number>()
const streamManuallyDisconnected = new Set<string>()
const streamOutputById = new Map<string, SessionOutputBuffer>()
let sessionSwitchToken = 0

function nextSessionSwitchToken(): number {
  sessionSwitchToken += 1
  return sessionSwitchToken
}

function setError(msg: string | null) {
  errorMsg.value = msg
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err)
  return String(err)
}

function streamStatusForSession(id: string): SessionStreamStatus {
  const sid = normalizeSessionId(id)
  if (!sid) return 'disconnected'
  return streamStatusById.value[sid] || 'disconnected'
}

function setStreamStatusForSession(id: string, next: SessionStreamStatus) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const prev = streamStatusById.value[sid] || 'disconnected'
  if (prev !== next) {
    streamStatusById.value = {
      ...streamStatusById.value,
      [sid]: next,
    }
  }
  if (sessionId.value === sid && status.value !== 'creating' && status.value !== 'restarting') {
    status.value = next
  }
}

function clearStreamStatusForSession(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (!Object.prototype.hasOwnProperty.call(streamStatusById.value, sid)) return
  const next = { ...streamStatusById.value }
  delete next[sid]
  streamStatusById.value = next
}

function bumpStreamGeneration(id: string): number {
  const sid = normalizeSessionId(id)
  if (!sid) return 0
  const next = (streamGenerationById.get(sid) || 0) + 1
  streamGenerationById.set(sid, next)
  return next
}

function streamGeneration(id: string): number {
  const sid = normalizeSessionId(id)
  if (!sid) return 0
  return streamGenerationById.get(sid) || 0
}

function clearReconnectTimerForSession(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const timer = streamReconnectTimerById.get(sid)
  if (typeof timer === 'number') {
    window.clearTimeout(timer)
  }
  streamReconnectTimerById.delete(sid)
}

function hasSessionStreamSource(id: string): boolean {
  const sid = normalizeSessionId(id)
  if (!sid) return false
  return streamSourceById.has(sid)
}

function outputBufferForSession(id: string): SessionOutputBuffer {
  const sid = normalizeSessionId(id)
  if (!sid) return { chunks: [], bytes: 0 }
  const existing = streamOutputById.get(sid)
  if (existing) return existing
  const next: SessionOutputBuffer = { chunks: [], bytes: 0 }
  streamOutputById.set(sid, next)
  return next
}

function appendSessionOutput(id: string, chunk: string) {
  const sid = normalizeSessionId(id)
  if (!sid || !chunk) return
  const buffer = outputBufferForSession(sid)
  buffer.chunks.push(chunk)
  buffer.bytes += chunk.length

  while (buffer.bytes > SESSION_OUTPUT_MAX_BYTES) {
    const removed = buffer.chunks.shift()
    if (!removed) break
    buffer.bytes = Math.max(0, buffer.bytes - removed.length)
  }
}

function clearSessionOutput(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  streamOutputById.delete(sid)
}

function renderSessionOutput(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid || !term.value) return
  const buffer = streamOutputById.get(sid)
  term.value.reset()
  if (buffer && buffer.chunks.length > 0) {
    term.value.write(buffer.chunks.join(''))
  }
  window.requestAnimationFrame(() => scheduleResize())
}

function maybeSendPendingForActiveSession() {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) return
  if (!pendingSend.value) return
  if (pendingSendTarget.value === 'git' && !isGitHandoffSession(sid)) return
  if (streamStatusForSession(sid) !== 'connected') return

  const toSend = pendingSend.value
  pendingSend.value = null
  pendingSendTarget.value = null
  window.setTimeout(() => {
    void sendInput(toSend.endsWith('\n') ? toSend : `${toSend}\n`)
  }, 50)
}

function closeSessionStream(id: string, opts?: { manual?: boolean; keepStatus?: boolean }) {
  const sid = normalizeSessionId(id)
  if (!sid) return

  if (opts?.manual) {
    streamManuallyDisconnected.add(sid)
  }

  clearReconnectTimerForSession(sid)
  bumpStreamGeneration(sid)

  const source = streamSourceById.get(sid)
  if (source) {
    try {
      source.close()
    } catch {
      // ignore
    }
    streamSourceById.delete(sid)
  }

  streamReconnectAttemptsById.delete(sid)

  if (!opts?.keepStatus) {
    setStreamStatusForSession(sid, 'disconnected')
  }
}

function closeAllSessionStreams() {
  for (const sid of Array.from(streamSourceById.keys())) {
    closeSessionStream(sid, { manual: true })
  }
  for (const sid of Array.from(streamReconnectTimerById.keys())) {
    clearReconnectTimerForSession(sid)
  }
  streamSourceById.clear()
  streamReconnectAttemptsById.clear()
  streamGenerationById.clear()
  streamManuallyDisconnected.clear()
}

function scheduleSessionReconnect(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (streamManuallyDisconnected.has(sid)) return
  if (streamReconnectTimerById.has(sid)) return

  const currentAttempts = streamReconnectAttemptsById.get(sid) || 0
  const nextAttempts = Math.min(10, currentAttempts + 1)
  streamReconnectAttemptsById.set(sid, nextAttempts)

  const delay = Math.min(15000, 600 * Math.pow(2, currentAttempts))
  setStreamStatusForSession(sid, 'reconnecting')

  const timer = window.setTimeout(async () => {
    streamReconnectTimerById.delete(sid)
    if (streamManuallyDisconnected.has(sid)) return

    try {
      const exists = await getSessionInfo(sid)
      if (!exists) {
        removeTrackedSession(sid)
        if (sessionId.value === sid) {
          await connect().catch(() => {})
        }
        return
      }
    } catch {
      // ignore probe failures; fall back to reconnect attempt.
    }

    connectSessionStream(sid)
  }, delay)

  streamReconnectTimerById.set(sid, timer)
}

function connectSessionStream(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (hasSessionStreamSource(sid)) return

  ensureTerminalMounted()
  streamManuallyDisconnected.delete(sid)
  clearReconnectTimerForSession(sid)

  const generation = bumpStreamGeneration(sid)
  const reconnectAttempts = streamReconnectAttemptsById.get(sid) || 0
  setStreamStatusForSession(sid, reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

  const resumeSince = streamSeqForSession(sid)
  const source = connectSse({
    endpoint: terminalStreamUrl(sid, resumeSince > 0 ? resumeSince : undefined),
    debugLabel: `sse:terminal:${sid}`,
    autoReconnect: false,
    onEvent: (evt) => {
      if (streamGeneration(sid) !== generation) return
      const e = evt as unknown as TerminalStreamEvent

      if (e.type === 'connected') {
        streamReconnectAttemptsById.set(sid, 0)
        setStreamStatusForSession(sid, 'connected')
        if (sessionId.value === sid) {
          window.requestAnimationFrame(() => scheduleResize())
          maybeSendPendingForActiveSession()
        }
        return
      }

      if (e.type === 'data') {
        rememberStreamSeq(sid, e.seq)
        if (typeof e.data === 'string') {
          appendSessionOutput(sid, e.data)
          if (sessionId.value === sid && term.value) {
            term.value.write(e.data)
          }
        }
        return
      }

      if (e.type === 'resync') {
        if (sessionId.value === sid) {
          setError(String(t('terminal.errors.streamRecoveredPartialHistory')))
        }
        return
      }

      if (e.type === 'exit') {
        setStreamStatusForSession(sid, 'exited')
        if (sessionId.value === sid) {
          setError(String(t('terminal.errors.terminalExited')))
        }
        closeSessionStream(sid, { keepStatus: true })
        removeTrackedSession(sid)
      }
    },
    onError: () => {
      if (streamGeneration(sid) !== generation) return

      const current = streamSourceById.get(sid)
      if (current === source) {
        try {
          source.close()
        } catch {
          // ignore
        }
        streamSourceById.delete(sid)
      }

      if (streamManuallyDisconnected.has(sid)) {
        setStreamStatusForSession(sid, 'disconnected')
        return
      }

      setStreamStatusForSession(sid, 'reconnecting')
      scheduleSessionReconnect(sid)
    },
  })
  streamSourceById.set(sid, source)
}

function ensureTrackedSessionStreams() {
  for (const rawId of sessionList.value) {
    const sid = normalizeSessionId(rawId)
    if (!sid) continue
    if (streamManuallyDisconnected.has(sid)) continue
    if (streamStatusForSession(sid) === 'exited') continue
    connectSessionStream(sid)
  }
}

function handleTerminalRequestError(action: string, err: unknown, targetSessionId?: string) {
  const sid = normalizeSessionId(targetSessionId || '')
  const wasActive = Boolean(sid) && sessionId.value === sid

  if (sid && err instanceof ApiError && err.status === 404) {
    removeTrackedSession(sid)
    if (wasActive) {
      status.value = 'disconnected'
    }
    setError(String(t('terminal.errors.sessionNoLongerExists')))
    return
  }

  const msg = describeError(err)
  setError(`${action}: ${msg}`)
  if ((!sid || wasActive) && status.value === 'connected') {
    status.value = 'error'
  }
}

function teardownTerminal() {
  closeAllSessionStreams()
  if (term.value) {
    term.value.dispose()
    term.value = null
  }
  fit.value = null
}

async function getSessionInfo(id: string): Promise<boolean> {
  const info = await getTerminalSessionInfo(id)
  return Boolean(info)
}

async function sendInput(data: string) {
  const id = sessionId.value
  if (!id) return
  try {
    await sendTerminalInput(id, data)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToSendInput')), err, id)
  }
}

async function sendResize() {
  const id = sessionId.value
  if (!id || !term.value) return

  const cols = term.value.cols
  const rows = term.value.rows
  const sig = `${id}:${cols}x${rows}`
  if (lastSentResizeSig === sig) return

  try {
    await resizeTerminal(id, cols, rows)
    lastSentResizeSig = sig
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToResize')), err, id)
  }
}

function scheduleResize() {
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer)
  }
  resizeTimer = window.setTimeout(async () => {
    resizeTimer = null
    if (!fit.value || !term.value) return
    fit.value.fit()
    // xterm occasionally renders a blank viewport when mounted while hidden or
    // when the container size changes (tab switch/restart). A refresh after fit
    // nudges it to paint immediately.
    try {
      term.value.refresh(0, Math.max(0, term.value.rows - 1))
    } catch {
      // ignore
    }
    await sendResize()
  }, 80)
}

function ensureTerminalMounted() {
  if (!el.value) return
  if (term.value) return

  const t = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#101415',
      foreground: '#e9efe7',
      cursor: '#e9efe7',
      selectionBackground: 'rgba(111, 176, 255, 0.25)',
    },
  })
  const f = new FitAddon()
  t.loadAddon(f)
  t.open(el.value)
  f.fit()

  // On mobile, avoid auto-focus so the IME doesn't pop immediately.
  if (!ui.isMobilePointer) t.focus()

  // Force an initial paint. Without this, some browsers show a black viewport
  // until the first input/scroll.
  try {
    t.refresh(0, Math.max(0, t.rows - 1))
  } catch {
    // ignore
  }

  t.onData((d) => void sendInput(applyKeyMods(d)))
  t.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const handled = handleTerminalKeyboardShortcut(event, {
      terminal: t,
      copyTextToClipboard,
      readTextFromClipboard,
      sendInterrupt: () => {
        void sendInput('\x03')
      },
    })
    return !handled
  })

  term.value = t
  fit.value = f
}

async function connect() {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) {
    status.value = 'disconnected'
    return
  }

  try {
    await startTerminalSession(sid)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToStartSession')), err, sid)
    return
  }

  renderSessionOutput(sid)
  connectSessionStream(sid)
  ensureTrackedSessionStreams()

  const streamStatus = streamStatusForSession(sid)
  if (streamStatus === 'connected') {
    status.value = 'connected'
    maybeSendPendingForActiveSession()
  } else if (streamStatus === 'reconnecting' || streamStatus === 'connecting') {
    status.value = streamStatus
  } else if (streamStatus === 'exited') {
    status.value = 'exited'
  } else {
    status.value = 'connecting'
  }
}

async function disconnect() {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) {
    status.value = 'disconnected'
    return
  }

  try {
    await stopTerminalSession(sid)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToStopSession')), err, sid)
    return
  }
  closeSessionStream(sid, { manual: true })
  status.value = 'disconnected'
}

async function closeSession() {
  const id = sessionId.value
  if (!id) return
  try {
    await deleteTerminalSession(id)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToCloseSession')), err, id)
    return
  }
  removeTrackedSession(id)
  status.value = 'disconnected'
}

async function openSessionFromSidebar(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const switchToken = nextSessionSwitchToken()
  cancelSessionRename()
  cancelSessionCreate()

  if (sessionId.value === sid) {
    if (!hasSessionStreamSource(sid) || streamStatusForSession(sid) === 'disconnected') {
      await connect()
    } else {
      maybeSendPendingForActiveSession()
    }
    return
  }

  setActiveSession(sid)
  setError(null)
  renderSessionOutput(sid)

  try {
    await startTerminalSession(sid)
    if (switchToken !== sessionSwitchToken) return
  } catch (err) {
    if (switchToken !== sessionSwitchToken) return
    handleTerminalRequestError(String(t('terminal.errors.failedToStartSession')), err, sid)
    return
  }
  if (!hasSessionStreamSource(sid) || streamStatusForSession(sid) === 'disconnected') {
    connectSessionStream(sid)
  }
  ensureTrackedSessionStreams()

  const initialStatus = streamStatusForSession(sid)
  status.value = initialStatus === 'disconnected' ? 'connecting' : initialStatus

  // `terminal_start` already ensures the backend session exists.
  if (streamStatusForSession(sid) === 'connected') {
    status.value = 'connected'
    maybeSendPendingForActiveSession()
  } else {
    status.value = streamStatusForSession(sid)
  }
}

function toggleTerminalMultiSelectMode() {
  const next = !terminalMultiSelect.enabled.value
  if (next) {
    cancelSessionRename()
    mobileSessionActionTargetId.value = null
    mobileSessionActionOpen.value = false
    mobileSessionActionQuery.value = ''
  }
  terminalMultiSelect.setEnabled(next)
}

function handleSidebarSessionClick(item: TerminalSidebarSession, event?: MouseEvent) {
  if (isSessionRenaming(item.id)) return
  if (terminalMultiSelect.enabled.value) {
    terminalMultiSelect.selectByInteraction(item.id, visibleTerminalSelectableIds.value, event)
    return
  }
  void openSessionFromSidebar(item.id)
}

function selectAllTerminalSessions() {
  if (!terminalMultiSelect.enabled.value) return
  terminalMultiSelect.selectAll(visibleTerminalSelectableIds.value)
}

function invertTerminalSessionsSelection() {
  if (!terminalMultiSelect.enabled.value) return
  terminalMultiSelect.invertSelection(visibleTerminalSelectableIds.value)
}

async function deleteSelectedTerminalSessions() {
  const targets = [...terminalMultiSelect.selectedList.value]
  if (targets.length === 0) return
  for (const sid of targets) {
    await closeTrackedSession(sid)
  }
  terminalMultiSelect.setEnabled(false)
}

async function closeTrackedSession(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (sid === sessionId.value) {
    await closeSession()
    return
  }
  try {
    await deleteTerminalSession(sid)
  } catch (err) {
    handleTerminalRequestError(String(t('terminal.errors.failedToRemoveSession')), err, sid)
    return
  }
  removeTrackedSession(sid)
}

onMounted(() => {
  ensureTerminalMounted()

  hydratePendingSendFromQuery()

  void (async () => {
    await bootstrapTerminalUiState()
    openTerminalUiStateEvents()

    await refreshTrackedSessions()

    if (pendingSend.value && pendingSendTarget.value === 'git') {
      const gitSessionId = await ensureGitHandoffSessionExists()
      setActiveSession(gitSessionId)
    }

    if (sessionId.value) {
      await connect()
    } else {
      status.value = 'disconnected'
    }
    ensureTrackedSessionStreams()
  })().catch(() => {
    status.value = 'disconnected'
  })

  window.addEventListener('resize', scheduleResize)

  // ResizeObserver catches layout changes that don't trigger window resize
  // (e.g. switching tabs/panels).
  if ('ResizeObserver' in window) {
    try {
      resizeObserver = new ResizeObserver(() => scheduleResize())
      if (el.value) resizeObserver.observe(el.value)
    } catch {
      resizeObserver = null
    }
  }
})

watch(
  () => allTerminalSelectableIds.value,
  (ids) => {
    terminalMultiSelect.retain(ids)
  },
  { immediate: true },
)

watch(
  () => sessionList.value.join('|'),
  () => {
    void refreshTrackedSessions()
    ensureTrackedSessionStreams()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleResize)
  closeTerminalUiStateEvents()

  if (terminalStatePersistTimer !== null) {
    window.clearTimeout(terminalStatePersistTimer)
    terminalStatePersistTimer = null
  }

  if (terminalStateHydrated.value && terminalStatePersistQueued && !terminalStatePersistInFlight) {
    void persistTerminalStateRemote()
  }

  if (resizeObserver) {
    try {
      resizeObserver.disconnect()
    } catch {
      // ignore
    }
    resizeObserver = null
  }
  teardownTerminal()
})

watch(el, () => {
  if (el.value) {
    ensureTerminalMounted()
    scheduleResize()

    if (resizeObserver) {
      try {
        resizeObserver.disconnect()
        resizeObserver.observe(el.value)
      } catch {
        // ignore
      }
    }
  }
})
</script>

<template>
  <div class="h-full flex overflow-hidden bg-background">
    <aside
      v-if="useShellSidebar"
      class="relative flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
      :class="ui.isMobile ? 'w-full' : 'border-r border-sidebar-border/60'"
      :style="ui.isMobile ? undefined : { width: `${ui.sidebarWidth}px` }"
    >
      <div
        v-if="!ui.isMobile"
        class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
        @pointerdown="startDesktopSidebarResize"
      />
      <div class="h-9 flex-shrink-0 select-none pl-3.5 pr-2 pt-1">
        <div class="flex h-full items-center justify-between gap-2">
          <div class="min-w-0 flex items-center gap-2">
            <p class="typography-ui-label font-medium text-muted-foreground">{{ t('terminal.sidebar.title') }}</p>
            <span
              class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] text-foreground/80"
            >
              {{ totalSessionCount }}
            </span>
          </div>

          <div class="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="md"
              class="h-8 w-8"
              :tooltip="String(t('terminal.session.create'))"
              :is-mobile-pointer="ui.isMobilePointer"
              :title="String(t('terminal.session.create'))"
              :aria-label="String(t('terminal.session.create'))"
              @click="startSessionCreate"
            >
              <RiAddLine class="h-4 w-4" />
            </IconButton>

            <IconButton
              variant="ghost"
              size="md"
              class="h-8 w-8"
              :tooltip="String(t('terminal.sidebar.refreshSessions'))"
              :is-mobile-pointer="ui.isMobilePointer"
              :title="String(t('terminal.sidebar.refreshSessions'))"
              :aria-label="String(t('terminal.sidebar.refreshSessions'))"
              :disabled="sessionListRefreshing"
              @click="refreshTrackedSessions"
            >
              <RiRefreshLine class="h-4 w-4" :class="sessionListRefreshing ? 'animate-spin' : ''" />
            </IconButton>

            <IconButton
              variant="ghost"
              size="md"
              class="h-8 w-8"
              :class="terminalMultiSelect.enabled.value ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''"
              :tooltip="
                String(
                  terminalMultiSelect.enabled.value
                    ? t('terminal.actions.exitMultiSelect')
                    : t('terminal.actions.enterMultiSelect'),
                )
              "
              :is-mobile-pointer="ui.isMobilePointer"
              :title="
                String(
                  terminalMultiSelect.enabled.value
                    ? t('terminal.actions.exitMultiSelect')
                    : t('terminal.actions.enterMultiSelect'),
                )
              "
              :aria-label="
                String(
                  terminalMultiSelect.enabled.value
                    ? t('terminal.actions.exitMultiSelect')
                    : t('terminal.actions.enterMultiSelect'),
                )
              "
              @click="toggleTerminalMultiSelectMode"
            >
              <RiCloseLine v-if="terminalMultiSelect.enabled.value" class="h-4 w-4" />
              <RiListCheck3 v-else class="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 px-3 py-2">
        <SearchInput
          v-model="sidebarQuery"
          :placeholder="String(t('terminal.sidebar.searchPlaceholder'))"
          class="text-xs"
          input-class="h-8 text-xs"
          :input-aria-label="String(t('terminal.sidebar.searchAria'))"
          :input-title="String(t('terminal.sidebar.searchAria'))"
          :search-title="String(t('terminal.sidebar.searchAria'))"
          :clear-aria-label="String(t('terminal.sidebar.clearSearch'))"
          :clear-title="String(t('common.clear'))"
          :is-mobile-pointer="ui.isMobilePointer"
        />
      </div>

      <div
        v-if="terminalMultiSelect.enabled.value"
        class="flex-shrink-0 border-b border-sidebar-border/60 px-2.5 py-1.5"
      >
        <div class="flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex min-w-0 items-center">
            <span
              class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-foreground/80"
              :title="
                String(
                  t('terminal.sidebar.multiSelect.selectedCount', { count: terminalMultiSelect.selectedCount.value }),
                )
              "
              :aria-label="
                String(
                  t('terminal.sidebar.multiSelect.selectedCount', { count: terminalMultiSelect.selectedCount.value }),
                )
              "
            >
              {{ terminalMultiSelect.selectedCount.value }}
            </span>
          </div>

          <div class="flex items-center gap-1">
            <IconButton
              size="xs"
              :tooltip="String(t('common.selectAll'))"
              :title="String(t('common.selectAll'))"
              :aria-label="String(t('common.selectAll'))"
              :is-mobile-pointer="ui.isMobilePointer"
              :disabled="
                visibleTerminalSelectableIds.length === 0 ||
                terminalMultiSelect.selectedCount.value === visibleTerminalSelectableIds.length
              "
              @click="selectAllTerminalSessions"
            >
              <RiListCheck3 class="h-3.5 w-3.5" />
            </IconButton>

            <IconButton
              size="xs"
              :tooltip="String(t('common.invertSelection'))"
              :title="String(t('common.invertSelection'))"
              :aria-label="String(t('common.invertSelection'))"
              :is-mobile-pointer="ui.isMobilePointer"
              :disabled="visibleTerminalSelectableIds.length === 0"
              @click="invertTerminalSessionsSelection"
            >
              <RiRefreshLine class="h-3.5 w-3.5" />
            </IconButton>

            <ConfirmPopover
              :title="String(t('terminal.actions.deleteSelectedConfirmTitle'))"
              :description="
                String(
                  t('terminal.actions.deleteSelectedConfirmDescription', {
                    count: terminalMultiSelect.selectedCount.value,
                  }),
                )
              "
              :confirm-text="String(t('terminal.actions.deleteSelected'))"
              :cancel-text="String(t('common.cancel'))"
              variant="destructive"
              @confirm="deleteSelectedTerminalSessions"
            >
              <IconButton
                size="xs"
                variant="ghost-destructive"
                :tooltip="String(t('terminal.actions.deleteSelected'))"
                :title="String(t('terminal.actions.deleteSelected'))"
                :aria-label="String(t('terminal.actions.deleteSelected'))"
                :is-mobile-pointer="ui.isMobilePointer"
                :disabled="terminalMultiSelect.selectedCount.value === 0"
                @click.stop
              >
                <RiDeleteBinLine class="h-3.5 w-3.5" />
              </IconButton>
            </ConfirmPopover>

            <IconButton
              size="xs"
              :tooltip="String(t('terminal.actions.exitMultiSelect'))"
              :title="String(t('terminal.actions.exitMultiSelect'))"
              :aria-label="String(t('terminal.actions.exitMultiSelect'))"
              :is-mobile-pointer="ui.isMobilePointer"
              @click="toggleTerminalMultiSelectMode"
            >
              <RiCloseLine class="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </div>

      <div v-if="!ui.isMobilePointer && sessionCreateOpen" class="flex-shrink-0 px-3 pb-2">
        <div class="rounded-md border border-sidebar-border/70 bg-sidebar/95 p-2">
          <div class="mt-1 flex items-center gap-1">
            <Input
              v-model="sessionCreateDraft"
              class="h-7 min-w-0 flex-1 text-xs"
              :placeholder="String(t('terminal.session.namePlaceholder'))"
              @keydown.enter.prevent="saveSessionCreate"
              @keydown.esc.prevent="cancelSessionCreate"
            />
            <IconButton
              size="sm"
              class="text-muted-foreground hover:bg-primary/6"
              :title="String(t('common.cancel'))"
              :aria-label="String(t('common.cancel'))"
              :disabled="sessionCreateBusy"
              @click="cancelSessionCreate"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="sm"
              class="text-primary hover:bg-primary/10"
              :title="String(t('terminal.session.create'))"
              :aria-label="String(t('terminal.session.create'))"
              :disabled="sessionCreateBusy || !sessionCreateDraft.trim()"
              @click="saveSessionCreate"
            >
              <RiCheckLine class="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <div class="space-y-1 pb-1 pl-2.5 pr-1">
          <div v-if="!visibleSidebarSessions.length" class="px-2 py-6 text-center text-muted-foreground">
            <div class="typography-ui-label font-semibold">{{ t('terminal.sidebar.emptyTitle') }}</div>
            <div class="typography-meta mt-1">{{ t('terminal.sidebar.emptyHint') }}</div>
          </div>

          <div v-for="item in visibleSidebarSessions" :key="item.id" class="relative">
            <ListItemFrame
              :active="!terminalMultiSelect.enabled.value && sessionId === item.id"
              :as="isSessionRenaming(item.id) ? 'div' : 'button'"
              :action-visibility="
                terminalMultiSelect.enabled.value || ui.isMobilePointer || isSessionRenaming(item.id)
                  ? 'always'
                  : 'hover'
              "
              @click="handleSidebarSessionClick(item, $event)"
            >
              <template #leading>
                <div class="flex items-center gap-1.5">
                  <ListItemSelectionIndicator
                    v-if="terminalMultiSelect.enabled.value"
                    :selected="terminalMultiSelect.isSelected(item.id)"
                  />
                  <span
                    class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    :class="statusDotClassForSession(item.id)"
                  />
                </div>
              </template>

              <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                <Input
                  v-model="sessionRenameDraft"
                  class="h-7 min-w-0 flex-1 text-xs"
                  :placeholder="String(t('terminal.session.namePlaceholder'))"
                  @keydown.enter.prevent="saveSessionRename"
                  @keydown.esc.prevent="cancelSessionRename"
                  @click.stop
                />
              </template>

              <template v-else>
                <div class="flex w-full min-w-0 items-center gap-1">
                  <span
                    class="block min-w-0 flex-1 truncate typography-ui-label text-left"
                    :class="item.name ? 'font-medium' : 'font-mono'"
                  >
                    {{ sidebarSessionLabel(item) }}
                  </span>
                </div>
              </template>

              <template #actions>
                <template
                  v-if="!terminalMultiSelect.enabled.value && ui.isMobilePointer && !isSessionRenaming(item.id)"
                >
                  <ListItemOverflowActionButton
                    mobile
                    :label="String(t('terminal.actions.title'))"
                    @trigger="handleMobileSessionActionTrigger(item.id)"
                  />

                  <OptionMenu
                    :open="isMobileSessionActionMenuOpen(item.id)"
                    :query="mobileSessionActionQuery"
                    :groups="mobileSessionActionGroups(item.id)"
                    :title="mobileSessionActionTitle(item.id)"
                    :mobile-title="mobileSessionActionTitle(item.id)"
                    :searchable="true"
                    :is-mobile-pointer="ui.isMobilePointer"
                    @update:open="(v) => setMobileSessionActionMenuOpen(item.id, v)"
                    @update:query="(v) => (mobileSessionActionQuery = v)"
                    @select="(action) => runMobileSessionAction(item.id, action)"
                  />
                </template>

                <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:bg-primary/6"
                    :title="String(t('terminal.session.cancelRename'))"
                    :aria-label="String(t('terminal.session.cancelRename'))"
                    @click.stop="cancelSessionRename"
                  >
                    <RiCloseLine class="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="xs"
                    class="text-primary hover:bg-primary/10"
                    :title="String(t('terminal.session.saveRename'))"
                    :aria-label="String(t('terminal.session.saveRename'))"
                    @click.stop="saveSessionRename"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </IconButton>
                </template>

                <template v-else-if="!terminalMultiSelect.enabled.value && !ui.isMobilePointer">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6"
                    :title="String(t('terminal.actions.rename'))"
                    :aria-label="String(t('terminal.actions.rename'))"
                    @click.stop="startSessionRename(item.id)"
                  >
                    <RiEditLine class="h-4 w-4" />
                  </IconButton>
                  <ConfirmPopover
                    :title="String(t('terminal.actions.disconnectConfirmTitle'))"
                    :description="String(t('terminal.actions.disconnectConfirmDescription'))"
                    :confirm-text="String(t('terminal.actions.disconnect'))"
                    :cancel-text="String(t('common.cancel'))"
                    variant="destructive"
                    :anchor-to-cursor="false"
                    :confirm-disabled="!canDisconnectSession(item.id)"
                    @confirm="disconnectSessionFromSidebar(item.id)"
                  >
                    <IconButton
                      size="xs"
                      class="transition"
                      :class="
                        canDisconnectSession(item.id)
                          ? 'text-destructive hover:bg-destructive/10 hover:dark:bg-accent/40'
                          : 'text-muted-foreground/45'
                      "
                      :title="String(t('terminal.actions.disconnectStream'))"
                      :aria-label="String(t('terminal.actions.disconnectStream'))"
                      :disabled="!canDisconnectSession(item.id)"
                      @click.stop
                    >
                      <RiStopCircleLine class="h-4 w-4" />
                    </IconButton>
                  </ConfirmPopover>
                  <IconButton
                    size="xs"
                    class="transition hover:dark:bg-accent/40 hover:bg-primary/6"
                    :class="item.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'"
                    :title="item.pinned ? String(t('terminal.actions.unpin')) : String(t('terminal.actions.pin'))"
                    :aria-label="item.pinned ? String(t('terminal.actions.unpin')) : String(t('terminal.actions.pin'))"
                    @click.stop="toggleSessionPinned(item.id)"
                  >
                    <component :is="item.pinned ? RiStarFill : RiStarLine" class="h-4 w-4" />
                  </IconButton>
                  <ConfirmPopover
                    :title="String(t('terminal.actions.deleteConfirmTitle'))"
                    :description="String(t('terminal.actions.deleteConfirmDescription'))"
                    :confirm-text="String(t('terminal.actions.deleteConfirmText'))"
                    :cancel-text="String(t('common.cancel'))"
                    variant="destructive"
                    @confirm="closeTrackedSession(item.id)"
                  >
                    <IconButton
                      size="xs"
                      class="text-muted-foreground hover:text-destructive hover:dark:bg-accent/40 hover:bg-primary/6"
                      :title="String(t('terminal.actions.delete'))"
                      :aria-label="String(t('terminal.actions.delete'))"
                      @click.stop
                    >
                      <RiDeleteBinLine class="h-4 w-4" />
                    </IconButton>
                  </ConfirmPopover>
                </template>
              </template>
            </ListItemFrame>
          </div>
        </div>
      </div>
    </aside>

    <div class="min-w-0 flex-1 flex flex-col overflow-hidden" v-show="!ui.isMobile || !ui.isSessionSwitcherOpen">
      <MobileSidebarEmptyState
        v-if="!sessionId"
        :title="String(t('terminal.emptyState.title'))"
        :description="String(t('terminal.emptyState.description'))"
        :action-label="String(t('terminal.emptyState.actionLabel'))"
        :show-action="ui.isMobile"
        @action="openTerminalSidebar"
      />

      <template v-else>
        <!-- Top bar: active session + connect toggle. -->
        <div
          class="flex shrink-0 items-center gap-3 border-b border-border/60 bg-background/75 px-4 py-2.5 backdrop-blur"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-foreground" :title="activeSessionName">
              {{ activeSessionName }}
            </div>
          </div>

          <IconButton
            variant="ghost"
            size="md"
            class="h-8 w-8 shrink-0"
            :tooltip="String(t('terminal.shortcuts.openHelp'))"
            :is-mobile-pointer="ui.isMobilePointer"
            :aria-label="String(t('terminal.shortcuts.openHelp'))"
            :title="String(t('terminal.shortcuts.openHelp'))"
            @click="shortcutHelpOpen = !shortcutHelpOpen"
          >
            <RiQuestionLine class="h-4 w-4" />
          </IconButton>

          <ConfirmPopover
            v-if="connectionToggleMode === 'disconnect'"
            :title="String(t('terminal.actions.disconnectConfirmTitle'))"
            :description="String(t('terminal.connection.disconnectDescription'))"
            :confirm-text="String(t('terminal.actions.disconnect'))"
            :cancel-text="String(t('common.cancel'))"
            variant="destructive"
            :anchor-to-cursor="false"
            @confirm="toggleConnection"
          >
            <IconButton
              variant="destructive"
              size="md"
              class="h-8 w-8 shrink-0"
              :disabled="connectionToggleDisabled"
              :tooltip="connectionToggleLabel"
              :is-mobile-pointer="ui.isMobilePointer"
              :aria-label="connectionToggleLabel"
              :title="connectionToggleLabel"
            >
              <RiStopCircleLine class="h-4 w-4" />
            </IconButton>
          </ConfirmPopover>

          <IconButton
            v-else
            variant="outline"
            size="md"
            class="h-8 w-8 shrink-0 border-emerald-500/45 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            :disabled="connectionToggleDisabled"
            :tooltip="connectionToggleLabel"
            :is-mobile-pointer="ui.isMobilePointer"
            :aria-label="connectionToggleLabel"
            :title="connectionToggleLabel"
            @click="toggleConnection"
          >
            <RiPlugLine class="h-4 w-4" />
          </IconButton>
        </div>

        <div
          v-if="errorMsg"
          class="px-4 py-2 text-xs text-destructive border-b border-border/60 bg-destructive/5 shrink-0"
        >
          {{ errorMsg }}
        </div>

        <div
          v-if="shortcutHelpOpen"
          class="border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground"
        >
          <p class="font-medium text-foreground/85">{{ t('terminal.shortcuts.title') }}</p>
          <p class="mt-1">{{ t('terminal.shortcuts.description') }}</p>
          <ul class="mt-2 space-y-1">
            <li v-for="item in terminalShortcutRows" :key="item.keys" class="flex flex-wrap gap-1">
              <span class="font-mono text-[11px] text-foreground/90">{{ item.keys }}</span>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </div>

        <!-- Terminal Area -->
        <div class="flex-1 bg-[#101415] min-h-[300px] flex flex-col">
          <div class="relative flex-1 min-h-0">
            <div ref="el" class="absolute inset-0" />
          </div>
          <TerminalKeybar
            v-if="ui.isMobilePointer"
            :disabled="status !== 'connected'"
            @mods="setKeyMods"
            @send="(d) => void sendInput(d)"
          />
        </div>
      </template>
    </div>

    <FormDialog
      :open="mobileSessionCreateDialogOpen"
      :title="String(t('terminal.dialogs.newTerminal.title'))"
      :description="String(t('terminal.emptyState.description'))"
      @update:open="(v) => !v && cancelSessionCreate()"
    >
      <div class="space-y-3">
        <Input
          v-model="sessionCreateDraft"
          class="h-7 min-w-0 text-xs"
          :placeholder="String(t('terminal.session.namePlaceholder'))"
          @keydown.enter.prevent="saveSessionCreate"
          @keydown.esc.prevent="cancelSessionCreate"
        />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" :disabled="sessionCreateBusy" @click="cancelSessionCreate">{{
            t('common.cancel')
          }}</Button>
          <Button :disabled="sessionCreateBusy || !sessionCreateDraft.trim()" @click="saveSessionCreate">
            {{ sessionCreateBusy ? t('terminal.session.creating') : t('terminal.session.create') }}
          </Button>
        </div>
      </div>
    </FormDialog>

    <FormDialog
      :open="mobileSessionRenameDialogOpen"
      :title="String(t('terminal.dialogs.renameTerminal.title'))"
      :description="String(t('terminal.dialogs.renameTerminal.description'))"
      @update:open="(v) => !v && cancelSessionRename()"
    >
      <div class="space-y-3">
        <Input
          v-model="sessionRenameDraft"
          class="h-7 min-w-0 text-xs"
          :placeholder="String(t('terminal.session.namePlaceholder'))"
          @keydown.enter.prevent="saveSessionRename"
          @keydown.esc.prevent="cancelSessionRename"
        />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" @click="cancelSessionRename">{{ t('common.cancel') }}</Button>
          <Button :disabled="!sessionRenameDraft.trim()" @click="saveSessionRename">{{ t('common.save') }}</Button>
        </div>
      </div>
    </FormDialog>
  </div>
</template>
