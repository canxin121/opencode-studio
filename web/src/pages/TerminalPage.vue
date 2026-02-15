<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import {
  RiPlugLine,
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiStopCircleLine,
  RiRefreshLine,
  RiDeleteBinLine,
  RiCloseLine,
  RiSearchLine,
  RiStarFill,
  RiStarLine,
  RiEditLine,
  RiMore2Line,
} from '@remixicon/vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import MobileSidebarEmptyState from '@/components/ui/MobileSidebarEmptyState.vue'
import SidebarTextButton from '@/components/ui/SidebarTextButton.vue'
import TextActionButton from '@/components/ui/TextActionButton.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionMenu, { type OptionMenuGroup, type OptionMenuItem } from '@/components/ui/OptionMenu.vue'
import TerminalKeybar from '@/components/TerminalKeybar.vue'
import { consumeTrustedTerminalHandoffPayload, type TerminalHandoffTarget } from '@/lib/terminalHandoff'
import { getLocalString, removeLocalKey, setLocalString } from '@/lib/persist'
import { ApiError } from '@/lib/api'
import {
  createTerminalSession,
  deleteTerminalSession,
  getTerminalUiState,
  getTerminalSessionInfo,
  putTerminalUiState,
  resizeTerminal,
  sendTerminalInput,
  terminalStreamUrl,
  terminalUiStateEventsUrl,
  type TerminalUiState,
} from '@/features/terminal/api/terminalApi'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'

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

const STORAGE_SESSION = 'oc2.terminal.sessionId'
const STORAGE_SESSION_LIST = 'oc2.terminal.sessionIds'
const STORAGE_SESSION_META = 'oc2.terminal.sessionMetaById'
const STORAGE_FOLDER_LIST = 'oc2.terminal.folderList'
const STORAGE_GIT_HANDOFF_SESSION = 'oc2.terminal.gitHandoffSessionId'

const TERMINAL_STATE_REMOTE_SAVE_DEBOUNCE_MS = 250

const DEFAULT_FOLDER_ID = 'terminal-default'
const DEFAULT_FOLDER_NAME = 'Default'
const DEFAULT_TERMINAL_CWD = '/home'

const GIT_HANDOFF_FOLDER_ID = 'terminal-folder-git'
const GIT_HANDOFF_FOLDER_NAME = 'Git'
const GIT_HANDOFF_SESSION_NAME = 'Git Terminal'

type TerminalFolder = {
  id: string
  name: string
}

type TerminalSessionMeta = {
  name?: string
  pinned?: boolean
  folderId?: string
  lastUsedAt?: number
}

function normalizeSessionMetaName(input: unknown): string {
  const collapsed = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  return collapsed.slice(0, 80)
}

function normalizeFolderName(input: unknown): string {
  const collapsed = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  return collapsed.slice(0, 40)
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

function normalizeFolder(input: unknown): TerminalFolder | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const id = normalizeFolderId(raw.id)
  const name = normalizeFolderName(raw.name)
  if (!id || !name) return null
  return { id, name }
}

function normalizeFolderList(input: unknown): TerminalFolder[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: TerminalFolder[] = []
  for (const item of input) {
    const folder = normalizeFolder(item)
    if (!folder) continue
    if (seen.has(folder.id)) continue
    seen.add(folder.id)
    out.push(folder)
  }
  return out
}

function generateFolderId(name: string): string {
  const slug = normalizeFolderName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const suffix = Math.random().toString(36).slice(2, 8)
  const seed = slug || 'folder'
  return `terminal-folder-${seed}-${suffix}`
}

type TerminalSidebarSession = {
  id: string
  name: string
  folderId: string
  pinned: boolean
  lastUsedAt: number
}

type TerminalSidebarFolder = {
  id: string
  name: string
  pinnedSessions: TerminalSidebarSession[]
  recentSessions: TerminalSidebarSession[]
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

function readStoredSessionList(): string[] {
  const raw = getLocalString(STORAGE_SESSION_LIST)
  if (!raw) return []
  try {
    return normalizeSessionList(JSON.parse(raw))
  } catch {
    return []
  }
}

function readStoredSessionMetaById(): Record<string, TerminalSessionMeta> {
  const raw = getLocalString(STORAGE_SESSION_META)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const out: Record<string, TerminalSessionMeta> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const sid = normalizeSessionId(key)
      if (!sid) continue
      const compact = compactSessionMeta(value)
      if (!compact) continue
      out[sid] = compact
    }
    return out
  } catch {
    return {}
  }
}

function readStoredFolderList(): TerminalFolder[] {
  const raw = getLocalString(STORAGE_FOLDER_LIST)
  if (!raw) return []
  try {
    return normalizeFolderList(JSON.parse(raw))
  } catch {
    return []
  }
}

function readStoredGitHandoffSessionId(): string {
  return normalizeSessionId(getLocalString(STORAGE_GIT_HANDOFF_SESSION) || '')
}

function persistGitHandoffSessionId(next: string | null) {
  const sid = normalizeSessionId(next || '')
  if (!sid) {
    removeLocalKey(STORAGE_GIT_HANDOFF_SESSION)
    return
  }
  setLocalString(STORAGE_GIT_HANDOFF_SESSION, sid)
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
const folders = ref<TerminalFolder[]>([{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }])
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

let terminalStateEventsSource: EventSource | null = null
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

function folderFor(id: string): TerminalFolder | null {
  const fid = normalizeFolderId(id)
  if (!fid) return null
  return folders.value.find((item) => item.id === fid) || null
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

  const normalizedFolders = normalizeFolderList(folders.value)
  const withDefaultFolders =
    normalizedFolders.length > 0 ? normalizedFolders : [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]

  const active = normalizeSessionId(sessionId.value || '')

  return {
    version: Math.max(0, Math.floor(Number(terminalStateVersion.value) || 0)),
    updatedAt: Math.max(0, Math.floor(Number(terminalStateUpdatedAt.value) || 0)),
    activeSessionId: active || null,
    sessionIds: normalizedSessionIds,
    sessionMetaById: normalizedMetaById,
    folders: withDefaultFolders,
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

function persistFolderList(opts?: { remote?: boolean }) {
  const normalized = normalizeFolderList(folders.value)
  folders.value = normalized.length > 0 ? normalized : [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
}

function ensureDefaultFolderExists(): string {
  if (folders.value.length === 0) {
    folders.value = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]
    persistFolderList()
    return DEFAULT_FOLDER_ID
  }

  const existingDefault = folderFor(DEFAULT_FOLDER_ID)
  if (!existingDefault) {
    folders.value = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }, ...folders.value]
    persistFolderList()
  }
  return DEFAULT_FOLDER_ID
}

function ensureFolderExists(id: string, preferredName?: string): string {
  const fid = normalizeFolderId(id)
  if (!fid) return ensureDefaultFolderExists()
  if (folderFor(fid)) return fid

  const fallbackName = normalizeFolderName(preferredName || fid) || DEFAULT_FOLDER_NAME
  folders.value = [...folders.value, { id: fid, name: fallbackName }]
  persistFolderList()
  return fid
}

function syncFoldersWithSessionMeta() {
  ensureDefaultFolderExists()

  const existing = new Set(folders.value.map((folder) => folder.id))
  let changed = false

  for (const meta of Object.values(sessionMetaById.value)) {
    const folderId = normalizeFolderId(meta.folderId)
    if (!folderId) continue
    if (existing.has(folderId)) continue
    existing.add(folderId)
    folders.value = [...folders.value, { id: folderId, name: normalizeFolderName(folderId) || folderId }]
    changed = true
  }

  if (changed) {
    persistFolderList()
  }
}

function fallbackFolderId(): string {
  const defaultFolder = folderFor(DEFAULT_FOLDER_ID)
  if (defaultFolder) return defaultFolder.id
  const first = folders.value[0]
  if (first) return first.id
  return DEFAULT_FOLDER_ID
}

function sessionFolderId(id: string): string {
  const sid = normalizeSessionId(id)
  if (!sid) return fallbackFolderId()
  const folderId = normalizeFolderId(sessionMetaFor(sid).folderId)
  if (!folderId) return fallbackFolderId()
  if (folderFor(folderId)) return folderId
  return fallbackFolderId()
}

function isGitHandoffSession(id: string): boolean {
  const sid = normalizeSessionId(id)
  if (!sid) return false
  if (readStoredGitHandoffSessionId() === sid) return true

  const meta = sessionMetaFor(sid)
  const name = normalizeSessionMetaName(meta.name)
  const folderId = normalizeFolderId(meta.folderId)
  return name === GIT_HANDOFF_SESSION_NAME && folderId === GIT_HANDOFF_FOLDER_ID
}

function gitHandoffSessionCandidates(): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  function push(rawId: string | null | undefined) {
    const sid = normalizeSessionId(rawId || '')
    if (!sid || seen.has(sid)) return
    seen.add(sid)
    out.push(sid)
  }

  push(readStoredGitHandoffSessionId())
  for (const sid of sessionList.value) {
    if (isGitHandoffSession(sid)) {
      push(sid)
    }
  }

  return out
}

async function ensureGitHandoffSessionExists(): Promise<string> {
  const folderId = ensureFolderExists(GIT_HANDOFF_FOLDER_ID, GIT_HANDOFF_FOLDER_NAME)

  for (const sid of gitHandoffSessionCandidates()) {
    const exists = await getSessionInfo(sid)
    if (!exists) {
      removeTrackedSession(sid)
      continue
    }

    patchSessionMeta(sid, {
      name: GIT_HANDOFF_SESSION_NAME,
      folderId,
    })
    persistGitHandoffSessionId(sid)
    return sid
  }

  const createCwd = sessionStartCwd()
  setError(null)
  status.value = 'creating'

  const json = await createTerminalSession({ cwd: createCwd, cols: 80, rows: 24 })
  patchSessionMeta(json.sessionId, {
    name: GIT_HANDOFF_SESSION_NAME,
    folderId,
    pinned: undefined,
    lastUsedAt: Date.now(),
  })
  persistGitHandoffSessionId(json.sessionId)
  clearSessionOutput(json.sessionId)
  setStreamStatusForSession(json.sessionId, 'disconnected')
  return json.sessionId
}

function persistSessionMetaById(opts?: { remote?: boolean }) {
  const next: Record<string, TerminalSessionMeta> = {}
  for (const [key, value] of Object.entries(sessionMetaById.value)) {
    const sid = normalizeSessionId(key)
    if (!sid) continue
    const compact = compactSessionMeta(value)
    if (!compact) continue
    next[sid] = compact
  }
  sessionMetaById.value = next
  if (opts?.remote !== false) {
    scheduleTerminalStateRemotePersist()
  }
}

function patchSessionMeta(id: string, patch: Partial<TerminalSessionMeta>, opts?: { remote?: boolean }) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  const current = sessionMetaById.value[sid] || {}
  const merged = {
    ...current,
    ...patch,
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
  const folderId = normalizeFolderId(compact.folderId)
  if (folderId) {
    ensureFolderExists(folderId)
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
    folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }],
  }
}

function readLegacyTerminalUiStateSnapshot(): TerminalUiState | null {
  const active = normalizeSessionId(getLocalString(STORAGE_SESSION) || '')
  const sessionIds = readStoredSessionList()
  const sessionMeta = readStoredSessionMetaById()
  const folderList = readStoredFolderList()

  const mergedSessionIds = normalizeSessionList(active ? [active, ...sessionIds] : sessionIds)
  const hasData =
    mergedSessionIds.length > 0 || Object.keys(sessionMeta).length > 0 || folderList.length > 0 || Boolean(active)
  if (!hasData) return null

  return {
    version: 0,
    updatedAt: 0,
    activeSessionId: active || mergedSessionIds[0] || null,
    sessionIds: mergedSessionIds,
    sessionMetaById: sessionMeta,
    folders: folderList,
  }
}

function clearLegacyTerminalStorage() {
  removeLocalKey(STORAGE_SESSION)
  removeLocalKey(STORAGE_SESSION_LIST)
  removeLocalKey(STORAGE_SESSION_META)
  removeLocalKey(STORAGE_FOLDER_LIST)
}

function remoteTerminalStateHasData(snapshot: TerminalUiState): boolean {
  if (snapshot.sessionIds.length > 0) return true
  if (Object.keys(snapshot.sessionMetaById || {}).length > 0) return true
  return (snapshot.folders || []).some((folder) => normalizeFolderId(folder.id) !== DEFAULT_FOLDER_ID)
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

  const nextSessionMetaById: Record<string, TerminalSessionMeta> = {}
  for (const [rawSid, rawMeta] of Object.entries(snapshot.sessionMetaById || {})) {
    const sid = normalizeSessionId(rawSid)
    if (!sid || !allowedSessionIds.has(sid)) continue
    const compact = compactSessionMeta(rawMeta)
    if (!compact) continue
    nextSessionMetaById[sid] = compact
  }

  const normalizedFolders = normalizeFolderList(snapshot.folders)
  const nextFolders =
    normalizedFolders.length > 0 ? normalizedFolders : [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]

  const requestedActive = normalizeSessionId(snapshot.activeSessionId || '')
  const nextActive = requestedActive && allowedSessionIds.has(requestedActive) ? requestedActive : normalizedSessionIds[0] || ''

  const previousSessionIds = sessionList.value.slice()

  terminalStateApplyInProgress = true
  try {
    folders.value = nextFolders
    sessionMetaById.value = nextSessionMetaById
    sessionList.value = normalizedSessionIds
    seedSessionRecencyFromList({ remote: false })
    syncFoldersWithSessionMeta()

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
  const source = new EventSource(
    terminalUiStateEventsUrl(terminalStateEventSeq > 0 ? terminalStateEventSeq : undefined),
  )
  terminalStateEventsSource = source

  source.onmessage = (evt) => {
    applyTerminalUiStateEventMessage(String(evt.data || ''), String(evt.lastEventId || ''))
  }

  source.onerror = () => {
    // Browser EventSource reconnects automatically.
  }
}

async function bootstrapTerminalUiState() {
  const legacy = readLegacyTerminalUiStateSnapshot()

  try {
    const remote = await getTerminalUiState()
    applyTerminalUiStateSnapshot(remote)
    terminalStateHydrated.value = true

    if (legacy && !remoteTerminalStateHasData(remote)) {
      applyTerminalUiStateSnapshot({
        ...legacy,
        version: remote.version,
        updatedAt: remote.updatedAt,
      })
      scheduleTerminalStateRemotePersist()
    }
  } catch {
    applyTerminalUiStateSnapshot(legacy || defaultTerminalUiState())
    terminalStateHydrated.value = true
    scheduleTerminalStateRemotePersist()
  }

  clearLegacyTerminalStorage()

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
  if (readStoredGitHandoffSessionId() === sid) {
    persistGitHandoffSessionId(null)
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
syncFoldersWithSessionMeta()
ensureDefaultFolderExists()

const sidebarQuery = ref('')
const sidebarQueryNorm = computed(() => sidebarQuery.value.trim().toLowerCase())

const folderCollapsedById = ref<Record<string, boolean>>({})
const folderCreateOpen = ref(false)
const folderCreateDraft = ref('')
const folderRenamingId = ref<string | null>(null)
const folderRenameDraft = ref('')

const sessionCreatingFolderId = ref<string | null>(null)
const sessionCreateDraft = ref('')
const sessionCreateBusy = ref(false)

const sessionRenamingId = ref<string | null>(null)
const sessionRenameDraft = ref('')
const mobileSessionActionTargetId = ref<string | null>(null)
const mobileSessionActionOpen = ref(false)
const mobileSessionActionQuery = ref('')

const mobileSessionCreateDialogOpen = computed(
  () => ui.isMobilePointer && Boolean(normalizeFolderId(sessionCreatingFolderId.value)),
)
const mobileSessionRenameDialogOpen = computed(
  () => ui.isMobilePointer && Boolean(normalizeSessionId(sessionRenamingId.value)),
)

const sessionCreateTargetFolderName = computed(() => {
  const fid = normalizeFolderId(sessionCreatingFolderId.value)
  const folder = folderFor(fid)
  return folder?.name || DEFAULT_FOLDER_NAME
})

function sidebarSessionLabel(item: TerminalSidebarSession): string {
  return item.name || item.id.slice(0, 8)
}

function compareSidebarSessionRecency(a: TerminalSidebarSession, b: TerminalSidebarSession): number {
  if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt
  return a.id.localeCompare(b.id)
}

function sessionMatchesQuery(item: TerminalSidebarSession, q: string): boolean {
  const sid = item.id.toLowerCase()
  const label = sidebarSessionLabel(item).toLowerCase()
  return sid.includes(q) || label.includes(q)
}

const sidebarSessions = computed<TerminalSidebarSession[]>(() => {
  return sessionList.value.map((id) => {
    const meta = sessionMetaFor(id)
    const folderId = sessionFolderId(id)
    const lastUsedAt =
      typeof meta.lastUsedAt === 'number' && Number.isFinite(meta.lastUsedAt) ? Math.floor(meta.lastUsedAt) : 0
    return {
      id,
      name: normalizeSessionMetaName(meta.name),
      folderId,
      pinned: meta.pinned === true,
      lastUsedAt,
    }
  })
})

const totalSessionCount = computed(() => sidebarSessions.value.length)

const visibleSidebarFolders = computed<TerminalSidebarFolder[]>(() => {
  const q = sidebarQueryNorm.value
  const out: TerminalSidebarFolder[] = []

  for (const folder of folders.value) {
    const all = sidebarSessions.value
      .filter((item) => item.folderId === folder.id)
      .slice()
      .sort(compareSidebarSessionRecency)

    const folderMatch = folder.name.toLowerCase().includes(q)
    const filtered = !q || folderMatch ? all : all.filter((item) => sessionMatchesQuery(item, q))
    const pinnedSessions = filtered.filter((item) => item.pinned)
    const recentSessions = filtered.filter((item) => !item.pinned)

    const shouldShow =
      !q ||
      folderMatch ||
      filtered.length > 0 ||
      folderRenamingId.value === folder.id ||
      sessionCreatingFolderId.value === folder.id

    if (!shouldShow) continue

    out.push({
      id: folder.id,
      name: folder.name,
      pinnedSessions,
      recentSessions,
    })
  }

  return out
})

function isFolderCollapsed(folderId: string): boolean {
  const fid = normalizeFolderId(folderId)
  if (!fid) return false
  return Boolean(folderCollapsedById.value[fid])
}

function toggleFolderCollapsed(folderId: string) {
  const fid = normalizeFolderId(folderId)
  if (!fid) return
  folderCollapsedById.value = {
    ...folderCollapsedById.value,
    [fid]: !isFolderCollapsed(fid),
  }
}

function stopFolderCreate() {
  folderCreateOpen.value = false
  folderCreateDraft.value = ''
}

function startFolderCreate() {
  folderRenamingId.value = null
  folderRenameDraft.value = ''
  folderCreateOpen.value = true
  folderCreateDraft.value = ''
}

function saveFolderCreate() {
  const name = normalizeFolderName(folderCreateDraft.value)
  if (!name) return

  const existing = folders.value.find((folder) => folder.name.toLowerCase() === name.toLowerCase())
  if (existing) {
    stopFolderCreate()
    sessionCreatingFolderId.value = existing.id
    sessionCreateDraft.value = ''
    return
  }

  const folderId = generateFolderId(name)
  folders.value = [...folders.value, { id: folderId, name }]
  persistFolderList()
  stopFolderCreate()
}

function startFolderRename(folderId: string) {
  const fid = normalizeFolderId(folderId)
  const folder = folderFor(fid)
  if (!folder) return
  stopFolderCreate()
  cancelSessionCreate()
  folderRenamingId.value = folder.id
  folderRenameDraft.value = folder.name
}

function cancelFolderRename() {
  folderRenamingId.value = null
  folderRenameDraft.value = ''
}

function saveFolderRename() {
  const fid = normalizeFolderId(folderRenamingId.value)
  if (!fid) return
  const name = normalizeFolderName(folderRenameDraft.value)
  if (!name) return

  folders.value = folders.value.map((folder) => (folder.id === fid ? { ...folder, name } : folder))
  persistFolderList()
  cancelFolderRename()
}

async function removeFolder(folderId: string) {
  const fid = normalizeFolderId(folderId)
  if (!fid) return
  if (!folderFor(fid)) return

  const sessionIds = sidebarSessions.value.filter((item) => item.folderId === fid).map((item) => item.id)
  for (const sid of sessionIds) {
    await closeTrackedSession(sid)
  }

  const stillHasSessions = sidebarSessions.value.some((item) => item.folderId === fid)
  if (stillHasSessions) {
    setError('Failed to delete all terminals in this folder')
    return
  }

  let nextFolders = folders.value.filter((folder) => folder.id !== fid)
  if (nextFolders.length === 0) {
    nextFolders = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }]
  }
  if (!nextFolders.some((folder) => folder.id === DEFAULT_FOLDER_ID)) {
    nextFolders = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }, ...nextFolders]
  }

  folders.value = nextFolders
  persistFolderList()

  if (sessionCreatingFolderId.value === fid) {
    cancelSessionCreate()
  }
  if (folderRenamingId.value === fid) {
    cancelFolderRename()
  }
}

function startSessionCreate(folderId: string) {
  const fid = ensureFolderExists(folderId)
  stopFolderCreate()
  cancelFolderRename()
  cancelSessionRename()
  sessionCreatingFolderId.value = fid
  sessionCreateDraft.value = ''
  sessionCreateBusy.value = false
}

function sessionStartCwd(): string {
  const projectDir = String(directoryStore.currentDirectory || '').trim()
  if (projectDir) return projectDir
  return DEFAULT_TERMINAL_CWD
}

function cancelSessionCreate() {
  sessionCreatingFolderId.value = null
  sessionCreateDraft.value = ''
  sessionCreateBusy.value = false
}

async function createSessionWithName(folderId: string, name: string) {
  const fid = ensureFolderExists(folderId)
  const sessionName = normalizeSessionMetaName(name)
  if (!sessionName) return
  const createCwd = sessionStartCwd()

  setError(null)
  status.value = 'creating'

  const json = await createTerminalSession({ cwd: createCwd, cols: 80, rows: 24 })
  patchSessionMeta(json.sessionId, {
    name: sessionName,
    folderId: fid,
    pinned: undefined,
    lastUsedAt: Date.now(),
  })

  setActiveSession(json.sessionId)
  clearSessionOutput(json.sessionId)
  setStreamStatusForSession(json.sessionId, 'disconnected')
  renderSessionOutput(json.sessionId)
  connectSessionStream(json.sessionId)
  ensureTrackedSessionStreams()
}

async function saveSessionCreate() {
  const fid = normalizeFolderId(sessionCreatingFolderId.value)
  if (!fid) return
  const name = normalizeSessionMetaName(sessionCreateDraft.value)
  if (!name || sessionCreateBusy.value) return

  sessionCreateBusy.value = true
  try {
    await createSessionWithName(fid, name)
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
  sessionRenameDraft.value = normalizeSessionMetaName(sessionMetaFor(sid).name) || sid.slice(0, 8)
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
  patchSessionMeta(sid, { name })
  cancelSessionRename()
}

function isSessionRenaming(id: string): boolean {
  const sid = normalizeSessionId(id)
  return Boolean(sid) && sessionRenamingId.value === sid
}

function isFolderRenaming(id: string): boolean {
  const fid = normalizeFolderId(id)
  return Boolean(fid) && folderRenamingId.value === fid
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
  if (!sid) return 'No terminal selected'
  const customName = normalizeSessionMetaName(sessionMetaFor(sid).name)
  if (customName) return customName
  return sid.slice(0, 8)
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

function disconnectSessionFromSidebar(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  if (!canDisconnectSession(sid)) return
  closeSessionStream(sid, { manual: true })
  if (sessionId.value === sid) {
    status.value = 'disconnected'
  }
}

function mobileSessionActionTitle(id: string): string {
  const sid = normalizeSessionId(id)
  if (!sid) return 'Terminal actions'
  const customName = normalizeSessionMetaName(sessionMetaFor(sid).name)
  const label = customName || sid.slice(0, 8)
  return `Terminal actions: ${label}`
}

function mobileSessionActionItems(id: string): OptionMenuItem[] {
  const sid = normalizeSessionId(id)
  if (!sid) return []

  const pinned = Boolean(sessionMetaFor(sid).pinned)
  return [
    {
      id: 'rename',
      label: 'Rename terminal',
      icon: RiEditLine,
    },
    {
      id: 'disconnect',
      label: 'Disconnect stream',
      icon: RiStopCircleLine,
      disabled: !canDisconnectSession(sid),
      confirmTitle: 'Disconnect terminal stream?',
      confirmDescription: 'Terminal session is kept and can reconnect later.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
    },
    {
      id: 'pin',
      label: pinned ? 'Unpin terminal' : 'Pin terminal',
      icon: pinned ? RiStarFill : RiStarLine,
    },
    {
      id: 'delete',
      label: 'Delete terminal',
      icon: RiDeleteBinLine,
      variant: 'destructive',
      confirmTitle: 'Delete terminal session?',
      confirmDescription: 'This will stop and remove this terminal session.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
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
  connectionToggleMode.value === 'disconnect' ? 'Disconnect terminal stream' : 'Connect terminal stream',
)

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
const streamSourceById = new Map<string, EventSource>()
const streamReconnectTimerById = new Map<string, number>()
const streamReconnectAttemptsById = new Map<string, number>()
const streamGenerationById = new Map<string, number>()
const streamManuallyDisconnected = new Set<string>()
const streamOutputById = new Map<string, SessionOutputBuffer>()

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
  const source = new EventSource(terminalStreamUrl(sid, resumeSince > 0 ? resumeSince : undefined))
  streamSourceById.set(sid, source)

  source.onmessage = (msg) => {
    if (streamGeneration(sid) !== generation) return
    try {
      const evt = JSON.parse(msg.data) as TerminalStreamEvent
      if (evt.type === 'connected') {
        streamReconnectAttemptsById.set(sid, 0)
        setStreamStatusForSession(sid, 'connected')
        if (sessionId.value === sid) {
          window.requestAnimationFrame(() => scheduleResize())
          maybeSendPendingForActiveSession()
        }
        return
      }

      if (evt.type === 'data') {
        rememberStreamSeq(sid, evt.seq)
        if (typeof evt.data === 'string') {
          appendSessionOutput(sid, evt.data)
          if (sessionId.value === sid && term.value) {
            term.value.write(evt.data)
          }
        }
        return
      }

      if (evt.type === 'resync') {
        if (sessionId.value === sid) {
          setError('Terminal stream recovered with partial history; some older output may be missing')
        }
        return
      }

      if (evt.type === 'exit') {
        setStreamStatusForSession(sid, 'exited')
        if (sessionId.value === sid) {
          setError('terminal exited')
        }
        closeSessionStream(sid, { keepStatus: true })
        removeTrackedSession(sid)
      }
    } catch {
      // ignore
    }
  }

  source.onerror = () => {
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
  }
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
    setError('Terminal session no longer exists')
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
    handleTerminalRequestError('Failed to send terminal input', err, id)
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
    handleTerminalRequestError('Failed to resize terminal', err, id)
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

  term.value = t
  fit.value = f
}

async function connect() {
  try {
    const sid = normalizeSessionId(sessionId.value || '')
    if (!sid) {
      status.value = 'disconnected'
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    status.value = 'error'
    setError(msg)
  }
}

async function disconnect() {
  const sid = normalizeSessionId(sessionId.value || '')
  if (!sid) {
    status.value = 'disconnected'
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
    handleTerminalRequestError('Failed to close terminal session', err, id)
    return
  }
  removeTrackedSession(id)
  status.value = 'disconnected'
}

async function openSessionFromSidebar(id: string) {
  const sid = normalizeSessionId(id)
  if (!sid) return
  cancelSessionRename()
  cancelSessionCreate()
  cancelFolderRename()

  if (sessionId.value === sid) {
    if (!hasSessionStreamSource(sid) || streamStatusForSession(sid) === 'disconnected') {
      await connect()
    } else {
      maybeSendPendingForActiveSession()
    }
    return
  }

  try {
    const exists = await getSessionInfo(sid)
    if (!exists) {
      removeTrackedSession(sid)
      setError('Terminal session no longer exists')
      return
    }
    setActiveSession(sid)
    setError(null)
    renderSessionOutput(sid)
    connectSessionStream(sid)
    ensureTrackedSessionStreams()
    if (streamStatusForSession(sid) === 'connected') {
      status.value = 'connected'
      maybeSendPendingForActiveSession()
    } else {
      status.value = streamStatusForSession(sid)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setError(msg)
  }
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
    handleTerminalRequestError('Failed to remove terminal session', err, sid)
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
            <p class="typography-ui-label font-medium text-muted-foreground">Terminals</p>
            <span
              class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] text-foreground/80"
            >
              {{ totalSessionCount }}
            </span>
          </div>

          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              title="New folder"
              aria-label="New folder"
              @click="startFolderCreate"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              title="Refresh sessions"
              aria-label="Refresh sessions"
              :disabled="sessionListRefreshing"
              @click="refreshTrackedSessions"
            >
              <RiRefreshLine class="h-4 w-4" :class="sessionListRefreshing ? 'animate-spin' : ''" />
            </Button>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 px-3 py-2">
        <div class="relative">
          <RiSearchLine
            class="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            v-model="sidebarQuery"
            placeholder="Search folders and sessions"
            class="h-8 pl-7 pr-7 text-xs"
            aria-label="Search terminal folders and sessions"
          />
          <IconButton
            v-if="sidebarQueryNorm"
            size="xs"
            class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Clear search"
            title="Clear"
            @click="sidebarQuery = ''"
          >
            <RiCloseLine class="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div v-if="folderCreateOpen" class="flex-shrink-0 px-3 pb-2">
        <div class="rounded-md border border-sidebar-border/70 bg-sidebar/95 p-2">
          <div class="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">New folder</div>
          <div class="mt-1 flex items-center gap-1">
            <Input
              v-model="folderCreateDraft"
              class="h-7 min-w-0 flex-1 text-xs"
              placeholder="Folder name"
              @keydown.enter.prevent="saveFolderCreate"
              @keydown.esc.prevent="stopFolderCreate"
            />
            <IconButton
              size="sm"
              class="text-muted-foreground hover:bg-primary/6"
              title="Cancel"
              aria-label="Cancel"
              @click="stopFolderCreate"
            >
              <RiCloseLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              size="sm"
              class="text-primary hover:bg-primary/10"
              title="Create folder"
              aria-label="Create folder"
              @click="saveFolderCreate"
            >
              <RiCheckLine class="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <div class="space-y-2 pb-1 pl-2.5 pr-1">
          <div v-if="!visibleSidebarFolders.length" class="px-2 py-6 text-center text-muted-foreground">
            <div class="typography-ui-label font-semibold">No matching folders or sessions</div>
            <div class="typography-meta mt-1">Try a different keyword.</div>
          </div>

          <div v-else class="space-y-1">
            <div v-for="folder in visibleSidebarFolders" :key="folder.id" class="relative">
              <div class="sticky top-0 z-20 pt-2 pb-1.5 w-full border-b bg-sidebar border-sidebar-border/60">
                <div v-if="isFolderRenaming(folder.id)" class="flex items-center gap-1 px-1">
                  <Input
                    v-model="folderRenameDraft"
                    class="h-7 min-w-0 flex-1 text-xs"
                    placeholder="Folder name"
                    @keydown.enter.prevent="saveFolderRename"
                    @keydown.esc.prevent="cancelFolderRename"
                  />
                  <IconButton
                    size="sm"
                    class="text-muted-foreground hover:bg-primary/6"
                    title="Cancel"
                    aria-label="Cancel"
                    @click="cancelFolderRename"
                  >
                    <RiCloseLine class="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    class="text-primary hover:bg-primary/10"
                    title="Save folder name"
                    aria-label="Save folder name"
                    @click="saveFolderRename"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </IconButton>
                </div>

                <div v-else class="group flex items-center gap-1 px-1">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:text-foreground"
                    :aria-label="isFolderCollapsed(folder.id) ? 'Expand folder' : 'Collapse folder'"
                    @click="toggleFolderCollapsed(folder.id)"
                  >
                    <RiArrowRightSLine v-if="isFolderCollapsed(folder.id)" class="h-4 w-4" />
                    <RiArrowDownSLine v-else class="h-4 w-4" />
                  </IconButton>

                  <SidebarTextButton
                    class="flex-1 rounded-sm"
                    @click="toggleFolderCollapsed(folder.id)"
                  >
                    <div class="typography-ui font-semibold truncate">{{ folder.name }}</div>
                  </SidebarTextButton>

                  <span class="font-mono text-[10px] text-muted-foreground/70">
                    {{ folder.pinnedSessions.length + folder.recentSessions.length }}
                  </span>

                  <div
                    class="flex items-center gap-1 w-0 overflow-hidden opacity-0 pointer-events-none transition-opacity group-hover:w-20 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:w-20 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                  >
                    <IconButton
                      size="xs"
                      class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                      title="New terminal in folder"
                      aria-label="New terminal in folder"
                      @click.stop="startSessionCreate(folder.id)"
                    >
                      <RiAddLine class="h-4 w-4" />
                    </IconButton>

                    <IconButton
                      size="xs"
                      class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                      title="Rename folder"
                      aria-label="Rename folder"
                      @click.stop="startFolderRename(folder.id)"
                    >
                      <RiEditLine class="h-4 w-4" />
                    </IconButton>

                    <ConfirmPopover
                      title="Delete folder?"
                      description="Sessions in this folder will move to another folder."
                      confirm-text="Delete"
                      cancel-text="Cancel"
                      variant="destructive"
                      @confirm="removeFolder(folder.id)"
                    >
                      <IconButton
                        size="xs"
                        class="text-muted-foreground hover:text-destructive hover:bg-primary/6"
                        title="Delete folder"
                        aria-label="Delete folder"
                        @click.stop
                      >
                        <RiDeleteBinLine class="h-4 w-4" />
                      </IconButton>
                    </ConfirmPopover>
                  </div>
                </div>
              </div>

              <div v-if="!isFolderCollapsed(folder.id)" class="py-1 pl-1 space-y-1">
                <template v-if="folder.pinnedSessions.length">
                  <div class="px-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Pinned
                  </div>
                  <div v-for="item in folder.pinnedSessions" :key="`pin:${item.id}`" class="relative">
                    <SidebarListItem
                      :active="sessionId === item.id"
                      :as="isSessionRenaming(item.id) ? 'div' : 'button'"
                      @click="!isSessionRenaming(item.id) && openSessionFromSidebar(item.id)"
                    >
                      <template #icon>
                        <span
                          class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          :class="statusDotClassForSession(item.id)"
                        />
                      </template>

                      <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                        <Input
                          v-model="sessionRenameDraft"
                          class="h-7 min-w-0 flex-1 text-xs"
                          placeholder="Terminal name"
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

                          <template v-if="ui.isMobilePointer">
                            <IconButton
                              size="sm"
                              class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                              title="Terminal actions"
                              aria-label="Terminal actions"
                              @click.stop="openMobileSessionActionMenu(item.id)"
                            >
                              <RiMore2Line class="h-4 w-4" />
                            </IconButton>

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
                        </div>
                      </template>

                      <template #actions>
                        <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                          <IconButton
                            size="sm"
                            class="text-muted-foreground hover:bg-primary/6"
                            title="Cancel rename"
                            aria-label="Cancel rename"
                            @click.stop="cancelSessionRename"
                          >
                            <RiCloseLine class="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            class="text-primary hover:bg-primary/10"
                            title="Save rename"
                            aria-label="Save rename"
                            @click.stop="saveSessionRename"
                          >
                            <RiCheckLine class="h-4 w-4" />
                          </IconButton>
                        </template>

                        <template v-else-if="!ui.isMobilePointer">
                          <IconButton
                            size="sm"
                            class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                            title="Rename terminal"
                            aria-label="Rename terminal"
                            @click.stop="startSessionRename(item.id)"
                          >
                            <RiEditLine class="h-4 w-4" />
                          </IconButton>
                          <ConfirmPopover
                            title="Disconnect terminal stream?"
                            description="Terminal session is kept and can reconnect later."
                            confirm-text="Disconnect"
                            cancel-text="Cancel"
                            variant="destructive"
                            :anchor-to-cursor="false"
                            :confirm-disabled="!canDisconnectSession(item.id)"
                            @confirm="disconnectSessionFromSidebar(item.id)"
                          >
                            <IconButton
                              size="sm"
                              class="transition"
                              :class="
                                canDisconnectSession(item.id)
                                  ? 'text-destructive hover:bg-destructive/10'
                                  : 'text-muted-foreground/45'
                              "
                              title="Disconnect stream"
                              aria-label="Disconnect stream"
                              :disabled="!canDisconnectSession(item.id)"
                              @click.stop
                            >
                              <RiStopCircleLine class="h-4 w-4" />
                            </IconButton>
                          </ConfirmPopover>
                          <IconButton
                            size="sm"
                            class="transition hover:bg-primary/6"
                            :class="item.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'"
                            :title="item.pinned ? 'Unpin terminal' : 'Pin terminal'"
                            :aria-label="item.pinned ? 'Unpin terminal' : 'Pin terminal'"
                            @click.stop="toggleSessionPinned(item.id)"
                          >
                            <component :is="item.pinned ? RiStarFill : RiStarLine" class="h-4 w-4" />
                          </IconButton>
                          <ConfirmPopover
                            title="Delete terminal session?"
                            description="This will stop and remove this terminal session."
                            confirm-text="Delete"
                            cancel-text="Cancel"
                            variant="destructive"
                            @confirm="closeTrackedSession(item.id)"
                          >
                            <IconButton
                              size="sm"
                              class="text-muted-foreground hover:text-destructive hover:bg-primary/6"
                              title="Delete terminal"
                              aria-label="Delete terminal"
                              @click.stop
                            >
                              <RiDeleteBinLine class="h-4 w-4" />
                            </IconButton>
                          </ConfirmPopover>
                        </template>
                      </template>
                    </SidebarListItem>
                  </div>
                </template>

                <template v-if="folder.recentSessions.length || (!ui.isMobilePointer && sessionCreatingFolderId === folder.id)">
                  <div class="px-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Recent
                  </div>

                  <div v-if="!ui.isMobilePointer && sessionCreatingFolderId === folder.id" class="group relative">
                    <div class="flex items-center gap-1 rounded-md transition-colors text-foreground hover:bg-primary/6">
                      <div class="flex-1 min-w-0 py-1 pl-2 pr-1.5">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full opacity-0" />
                          <Input
                            v-model="sessionCreateDraft"
                            class="h-7 min-w-0 flex-1 text-xs"
                            placeholder="Terminal name"
                            @keydown.enter.prevent="saveSessionCreate"
                            @keydown.esc.prevent="cancelSessionCreate"
                          />
                        </div>
                      </div>

                      <div class="flex items-center gap-1 pr-1">
                        <IconButton
                          size="sm"
                          class="text-muted-foreground hover:bg-primary/6"
                          title="Cancel"
                          aria-label="Cancel"
                          :disabled="sessionCreateBusy"
                          @click="cancelSessionCreate"
                        >
                          <RiCloseLine class="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          size="sm"
                          class="text-primary hover:bg-primary/10"
                          title="Create terminal"
                          aria-label="Create terminal"
                          :disabled="sessionCreateBusy || !sessionCreateDraft.trim()"
                          @click="saveSessionCreate"
                        >
                          <RiCheckLine class="h-4 w-4" />
                        </IconButton>
                      </div>
                    </div>
                  </div>

                  <div v-for="item in folder.recentSessions" :key="`recent:${item.id}`" class="relative">
                    <SidebarListItem
                      :active="sessionId === item.id"
                      :as="isSessionRenaming(item.id) ? 'div' : 'button'"
                      @click="!isSessionRenaming(item.id) && openSessionFromSidebar(item.id)"
                    >
                      <template #icon>
                        <span
                          class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          :class="statusDotClassForSession(item.id)"
                        />
                      </template>

                      <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                        <Input
                          v-model="sessionRenameDraft"
                          class="h-7 min-w-0 flex-1 text-xs"
                          placeholder="Terminal name"
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

                          <template v-if="ui.isMobilePointer">
                            <IconButton
                              size="sm"
                              class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                              title="Terminal actions"
                              aria-label="Terminal actions"
                              @click.stop="openMobileSessionActionMenu(item.id)"
                            >
                              <RiMore2Line class="h-4 w-4" />
                            </IconButton>

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
                        </div>
                      </template>

                      <template #actions>
                        <template v-if="!ui.isMobilePointer && isSessionRenaming(item.id)">
                          <IconButton
                            size="sm"
                            class="text-muted-foreground hover:bg-primary/6"
                            title="Cancel rename"
                            aria-label="Cancel rename"
                            @click.stop="cancelSessionRename"
                          >
                            <RiCloseLine class="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            size="sm"
                            class="text-primary hover:bg-primary/10"
                            title="Save rename"
                            aria-label="Save rename"
                            @click.stop="saveSessionRename"
                          >
                            <RiCheckLine class="h-4 w-4" />
                          </IconButton>
                        </template>

                        <template v-else-if="!ui.isMobilePointer">
                          <IconButton
                            size="sm"
                            class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                            title="Rename terminal"
                            aria-label="Rename terminal"
                            @click.stop="startSessionRename(item.id)"
                          >
                            <RiEditLine class="h-4 w-4" />
                          </IconButton>
                          <ConfirmPopover
                            title="Disconnect terminal stream?"
                            description="Terminal session is kept and can reconnect later."
                            confirm-text="Disconnect"
                            cancel-text="Cancel"
                            variant="destructive"
                            :anchor-to-cursor="false"
                            :confirm-disabled="!canDisconnectSession(item.id)"
                            @confirm="disconnectSessionFromSidebar(item.id)"
                          >
                            <IconButton
                              size="sm"
                              class="transition"
                              :class="
                                canDisconnectSession(item.id)
                                  ? 'text-destructive hover:bg-destructive/10'
                                  : 'text-muted-foreground/45'
                              "
                              title="Disconnect stream"
                              aria-label="Disconnect stream"
                              :disabled="!canDisconnectSession(item.id)"
                              @click.stop
                            >
                              <RiStopCircleLine class="h-4 w-4" />
                            </IconButton>
                          </ConfirmPopover>
                          <IconButton
                            size="sm"
                            class="transition hover:bg-primary/6"
                            :class="item.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'"
                            :title="item.pinned ? 'Unpin terminal' : 'Pin terminal'"
                            :aria-label="item.pinned ? 'Unpin terminal' : 'Pin terminal'"
                            @click.stop="toggleSessionPinned(item.id)"
                          >
                            <component :is="item.pinned ? RiStarFill : RiStarLine" class="h-4 w-4" />
                          </IconButton>
                          <ConfirmPopover
                            title="Delete terminal session?"
                            description="This will stop and remove this terminal session."
                            confirm-text="Delete"
                            cancel-text="Cancel"
                            variant="destructive"
                            @confirm="closeTrackedSession(item.id)"
                          >
                            <IconButton
                              size="sm"
                              class="text-muted-foreground hover:text-destructive hover:bg-primary/6"
                              title="Delete terminal"
                              aria-label="Delete terminal"
                              @click.stop
                            >
                              <RiDeleteBinLine class="h-4 w-4" />
                            </IconButton>
                          </ConfirmPopover>
                        </template>
                      </template>
                    </SidebarListItem>
                  </div>
                </template>

                <div
                  v-if="
                    folder.pinnedSessions.length + folder.recentSessions.length === 0 &&
                    sessionCreatingFolderId !== folder.id
                  "
                  class="px-1.5 py-1 text-xs text-muted-foreground"
                >
                  <TextActionButton class="inline-flex items-center gap-1" @click="startSessionCreate(folder.id)">
                    <RiAddLine class="h-3.5 w-3.5" />
                    New terminal in this folder
                  </TextActionButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <div class="min-w-0 flex-1 flex flex-col overflow-hidden" v-show="!ui.isMobile || !ui.isSessionSwitcherOpen">
      <MobileSidebarEmptyState
        v-if="!sessionId"
        title="Select a terminal session"
        description="Use the terminals panel to pick an existing session or create a new one."
        action-label="Open terminals panel"
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

          <ConfirmPopover
            v-if="connectionToggleMode === 'disconnect'"
            title="Disconnect terminal stream?"
            description="You can reconnect at any time. Terminal session itself will not be deleted."
            confirm-text="Disconnect"
            cancel-text="Cancel"
            variant="destructive"
            :anchor-to-cursor="false"
            @confirm="toggleConnection"
          >
            <Button
              variant="destructive"
              size="icon"
              class="h-8 w-8 shrink-0"
              :disabled="connectionToggleDisabled"
              :aria-label="connectionToggleLabel"
              :title="connectionToggleLabel"
            >
              <RiStopCircleLine class="h-4 w-4" />
            </Button>
          </ConfirmPopover>

          <Button
            v-else
            variant="outline"
            size="icon"
            class="h-8 w-8 shrink-0 border-emerald-500/45 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            :disabled="connectionToggleDisabled"
            :aria-label="connectionToggleLabel"
            :title="connectionToggleLabel"
            @click="toggleConnection"
          >
            <RiPlugLine class="h-4 w-4" />
          </Button>
        </div>

        <div
          v-if="errorMsg"
          class="px-4 py-2 text-xs text-destructive border-b border-border/60 bg-destructive/5 shrink-0"
        >
          {{ errorMsg }}
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
      title="New terminal"
      :description="`Create terminal in ${sessionCreateTargetFolderName}`"
      @update:open="(v) => !v && cancelSessionCreate()"
    >
      <div class="space-y-3">
        <Input
          v-model="sessionCreateDraft"
          class="h-7 min-w-0 text-xs"
          placeholder="Terminal name"
          @keydown.enter.prevent="saveSessionCreate"
          @keydown.esc.prevent="cancelSessionCreate"
        />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" :disabled="sessionCreateBusy" @click="cancelSessionCreate">Cancel</Button>
          <Button :disabled="sessionCreateBusy || !sessionCreateDraft.trim()" @click="saveSessionCreate">
            {{ sessionCreateBusy ? 'Creating...' : 'Create' }}
          </Button>
        </div>
      </div>
    </FormDialog>

    <FormDialog
      :open="mobileSessionRenameDialogOpen"
      title="Rename terminal"
      description="Update the terminal name"
      @update:open="(v) => !v && cancelSessionRename()"
    >
      <div class="space-y-3">
        <Input
          v-model="sessionRenameDraft"
          class="h-7 min-w-0 text-xs"
          placeholder="Terminal name"
          @keydown.enter.prevent="saveSessionRename"
          @keydown.esc.prevent="cancelSessionRename"
        />
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" @click="cancelSessionRename">Cancel</Button>
          <Button :disabled="!sessionRenameDraft.trim()" @click="saveSessionRename">Save</Button>
        </div>
      </div>
    </FormDialog>
  </div>
</template>
