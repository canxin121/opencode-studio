<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { RiAddLine, RiArrowDownSLine, RiPlugLine, RiRefreshLine, RiStopCircleLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import NameInputPrompt from '@/components/ui/NameInputPrompt.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { connectSse } from '@/lib/sse'
import {
  createTerminalSession,
  getTerminalSessionInfo,
  getTerminalUiState,
  putTerminalUiState,
  resizeTerminal,
  sendTerminalInput,
  startTerminalSession,
  stopTerminalSession,
  terminalStreamUrl,
  type TerminalSessionInfo,
  type TerminalUiState,
} from '@/features/terminal/api/terminalApi'
import { useDirectoryStore } from '@/stores/directory'
import { useUiStore } from '@/stores/ui'

type TerminalStreamEvent =
  | { type: 'connected'; seq?: number }
  | { type: 'data'; data?: string; seq?: number }
  | { type: 'exit'; seq?: number }
  | { type: string; data?: unknown; seq?: number }

type SessionBuffer = {
  chunks: string[]
  bytes: number
}

const SESSION_OUTPUT_MAX_BYTES = 192 * 1024

const { t } = useI18n()
const directoryStore = useDirectoryStore()
const ui = useUiStore()

const loading = ref(false)
const refreshing = ref(false)
const creating = ref(false)
const togglingConnection = ref(false)
const error = ref<string | null>(null)
const status = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

const uiState = ref<TerminalUiState | null>(null)
const activeSessionInfo = ref<TerminalSessionInfo | null>(null)

const el = ref<HTMLDivElement | null>(null)
const term = shallowRef<Terminal | null>(null)
const fit = shallowRef<FitAddon | null>(null)

const streamClient = shallowRef<ReturnType<typeof connectSse> | null>(null)
const streamSessionId = ref('')
const streamSeqById = ref<Record<string, number>>({})
const outputById = new Map<string, SessionBuffer>()
const sessionMenuOpen = ref(false)
const sessionMenuQuery = ref('')
const sessionCreateOpen = ref(false)
const sessionCreateDraft = ref('')

let resizeObserver: ResizeObserver | null = null
let resizeTimer: number | null = null
let pollTimer: number | null = null
let lastResizeSignature = ''
let sessionInfoRequest = 0

const sessionIds = computed(() => uiState.value?.sessionIds || [])
const activeSessionId = computed(() => {
  const active = String(uiState.value?.activeSessionId || '').trim()
  if (active) return active
  return sessionIds.value[0] || ''
})

const sessionItems = computed(() => {
  return sessionIds.value.map((sid) => {
    const custom = String(uiState.value?.sessionMetaById?.[sid]?.name || '').trim()
    return {
      id: sid,
      label: custom || sid.slice(0, 8),
    }
  })
})

const sessionMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'terminal-sessions',
    items: sessionItems.value.map((session) => ({
      id: session.id,
      label: session.label,
      checked: session.id === activeSessionId.value,
      monospace: true,
      keywords: `${session.label} ${session.id}`,
    })),
  },
])

const activeSessionLabel = computed(() => {
  const active = sessionItems.value.find((session) => session.id === activeSessionId.value)
  return active?.label || String(t('workspaceDock.terminal.none'))
})

const sessionPickerLabel = computed(() => String(t('workspaceDock.terminal.sessions')))

const activeSessionRunning = computed(() => activeSessionInfo.value?.running === true)

const connectionToggleMode = computed<'connect' | 'disconnect'>(() =>
  activeSessionRunning.value ? 'disconnect' : 'connect',
)

const connectionToggleLabel = computed(() =>
  connectionToggleMode.value === 'disconnect'
    ? String(t('terminal.connection.disconnectLabel'))
    : String(t('terminal.connection.connectLabel')),
)

const connectionToggleDisabled = computed(() => {
  if (!activeSessionId.value) return true
  return loading.value || refreshing.value || creating.value || togglingConnection.value
})

function normalizeSessionName(input: unknown): string {
  const collapsed = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  return collapsed.slice(0, 80)
}

function sessionBuffer(id: string): SessionBuffer {
  const sid = String(id || '').trim()
  if (!sid) return { chunks: [], bytes: 0 }
  const existing = outputById.get(sid)
  if (existing) return existing
  const next: SessionBuffer = { chunks: [], bytes: 0 }
  outputById.set(sid, next)
  return next
}

function appendSessionOutput(id: string, chunk: string) {
  const sid = String(id || '').trim()
  if (!sid || !chunk) return
  const buffer = sessionBuffer(sid)
  buffer.chunks.push(chunk)
  buffer.bytes += chunk.length
  while (buffer.bytes > SESSION_OUTPUT_MAX_BYTES) {
    const removed = buffer.chunks.shift()
    if (!removed) break
    buffer.bytes = Math.max(0, buffer.bytes - removed.length)
  }
}

function renderSessionOutput(id: string) {
  const sid = String(id || '').trim()
  if (!sid || !term.value) return
  term.value.reset()
  const buffer = outputById.get(sid)
  if (buffer && buffer.chunks.length > 0) {
    term.value.write(buffer.chunks.join(''))
  }
}

function rememberSeq(id: string, seq: unknown) {
  const sid = String(id || '').trim()
  if (!sid) return
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return
  const n = Math.max(0, Math.floor(seq))
  const prev = streamSeqById.value[sid] || 0
  if (n <= prev) return
  streamSeqById.value = {
    ...streamSeqById.value,
    [sid]: n,
  }
}

function closeStream() {
  if (!streamClient.value) return
  try {
    streamClient.value.close()
  } catch {
    // ignore
  }
  streamClient.value = null
  streamSessionId.value = ''
}

function setTerminalStdinEnabled(enabled: boolean) {
  if (!term.value) return
  try {
    term.value.options.disableStdin = !enabled
  } catch {
    // ignore
  }
}

function ensureTerminalMounted() {
  if (!el.value || term.value) return

  const t = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
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

  t.onData((data) => {
    const sid = activeSessionId.value
    if (!sid) return
    if (!activeSessionRunning.value) return
    void sendTerminalInput(sid, data).catch((err) => {
      status.value = 'error'
      error.value = err instanceof Error ? err.message : String(err)
    })
  })

  term.value = t
  fit.value = f
}

async function sendResize() {
  const sid = activeSessionId.value
  if (!sid || !term.value) return
  const signature = `${sid}:${term.value.cols}x${term.value.rows}`
  if (signature === lastResizeSignature) return
  try {
    await resizeTerminal(sid, term.value.cols, term.value.rows)
    lastResizeSignature = signature
  } catch {
    // ignore
  }
}

function scheduleResize() {
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer)
  }
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null
    if (!fit.value || !term.value) return
    fit.value.fit()
    try {
      term.value.refresh(0, Math.max(0, term.value.rows - 1))
    } catch {
      // ignore
    }
    void sendResize()
  }, 80)
}

function openStream(id: string) {
  const sid = String(id || '').trim()
  if (!sid) {
    closeStream()
    status.value = 'disconnected'
    return
  }

  if (!activeSessionRunning.value) {
    closeStream()
    status.value = 'disconnected'
    return
  }

  if (streamSessionId.value === sid && streamClient.value) return

  closeStream()
  streamSessionId.value = sid
  status.value = 'connecting'

  const since = streamSeqById.value[sid] || 0
  const client = connectSse({
    endpoint: terminalStreamUrl(sid, since > 0 ? since : undefined),
    debugLabel: `sse:workspace-dock-terminal:${sid}`,
    autoReconnect: true,
    onEvent: (evt) => {
      if (streamSessionId.value !== sid) return
      const event = evt as unknown as TerminalStreamEvent
      rememberSeq(sid, event.seq)

      if (event.type === 'connected') {
        status.value = 'connected'
        error.value = null
        scheduleResize()
        return
      }

      if (event.type === 'data' && typeof event.data === 'string') {
        appendSessionOutput(sid, event.data)
        if (activeSessionId.value === sid && term.value) {
          term.value.write(event.data)
        }
        return
      }

      if (event.type === 'exit') {
        closeStream()
        if (activeSessionId.value === sid) {
          activeSessionInfo.value = {
            sessionId: sid,
            cwd: activeSessionInfo.value?.cwd || '',
            running: false,
          }
          setTerminalStdinEnabled(false)
        }
        status.value = 'disconnected'
      }
    },
    onError: (err) => {
      if (streamSessionId.value !== sid) return
      status.value = 'error'
      error.value = err instanceof Error ? err.message : String(err)
    },
  })

  streamClient.value = client
}

function normalizeState(next: TerminalUiState): TerminalUiState {
  const ids = Array.isArray(next.sessionIds) ? next.sessionIds : []
  const activeRaw = String(next.activeSessionId || '').trim()
  const active = activeRaw && ids.includes(activeRaw) ? activeRaw : ids[0] || null
  return {
    version: next.version,
    updatedAt: next.updatedAt,
    activeSessionId: active,
    sessionIds: ids,
    sessionMetaById: next.sessionMetaById || {},
    folders: Array.isArray(next.folders) ? next.folders : [],
  }
}

async function refreshActiveSessionInfo() {
  const sid = String(activeSessionId.value || '').trim()
  if (!sid) {
    activeSessionInfo.value = null
    setTerminalStdinEnabled(false)
    closeStream()
    status.value = 'disconnected'
    return
  }

  const requestId = (sessionInfoRequest += 1)
  try {
    const info = await getTerminalSessionInfo(sid)
    if (requestId !== sessionInfoRequest) return
    if (activeSessionId.value !== sid) return

    activeSessionInfo.value = info
    const running = info?.running === true
    setTerminalStdinEnabled(running)

    if (!running) {
      closeStream()
      status.value = 'disconnected'
      return
    }

    openStream(sid)
    scheduleResize()
  } catch {
    // peek errors should not block the dock panel
  }
}

async function refreshState(opts?: { silent?: boolean }) {
  const silent = opts?.silent === true
  if (!silent) {
    refreshing.value = true
  }
  if (!uiState.value) {
    loading.value = true
  }

  try {
    const next = await getTerminalUiState()
    uiState.value = normalizeState(next)
    if (!activeSessionId.value) {
      closeStream()
      activeSessionInfo.value = null
      setTerminalStdinEnabled(false)
      status.value = 'disconnected'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function updateState(next: TerminalUiState) {
  const saved = await putTerminalUiState(next)
  uiState.value = normalizeState(saved)
}

async function activateSession(id: string) {
  const sid = String(id || '').trim()
  if (!sid || !uiState.value) return
  if (activeSessionId.value === sid) {
    void refreshActiveSessionInfo()
    return
  }

  const base = uiState.value
  error.value = null
  await updateState({
    version: base.version,
    updatedAt: base.updatedAt,
    activeSessionId: sid,
    sessionIds: base.sessionIds.slice(),
    sessionMetaById: { ...base.sessionMetaById },
    folders: base.folders.slice(),
  })
}

async function createSession(name?: string) {
  if (creating.value) return
  creating.value = true
  error.value = null
  try {
    const base = uiState.value || normalizeState(await getTerminalUiState())
    const cwd = String(directoryStore.currentDirectory || '').trim() || '/home'
    const created = await createTerminalSession({ cwd, cols: 80, rows: 24 })
    const sid = String(created.sessionId || '').trim()
    if (!sid) return

    const sessionName = normalizeSessionName(name)

    const now = Date.now()
    await updateState({
      version: base.version,
      updatedAt: base.updatedAt,
      activeSessionId: sid,
      sessionIds: [sid, ...base.sessionIds.filter((id) => id !== sid)],
      sessionMetaById: {
        ...base.sessionMetaById,
        [sid]: {
          ...(base.sessionMetaById?.[sid] || {}),
          name: sessionName || undefined,
          lastUsedAt: now,
        },
      },
      folders: base.folders.slice(),
    })

    activeSessionInfo.value = {
      sessionId: sid,
      cwd,
      running: true,
    }
    setTerminalStdinEnabled(true)

    sessionCreateOpen.value = false
    sessionCreateDraft.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

async function startActiveSession() {
  const sid = String(activeSessionId.value || '').trim()
  if (!sid || togglingConnection.value) return

  togglingConnection.value = true
  error.value = null
  try {
    const info = await startTerminalSession(sid)
    if (activeSessionId.value !== sid) return
    activeSessionInfo.value = info
    setTerminalStdinEnabled(info.running === true)
    renderSessionOutput(sid)
    lastResizeSignature = ''
    openStream(sid)
    scheduleResize()
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    error.value = `${String(t('terminal.errors.failedToStartSession'))}${details ? `: ${details}` : ''}`
  } finally {
    togglingConnection.value = false
  }
}

async function stopActiveSession() {
  const sid = String(activeSessionId.value || '').trim()
  if (!sid || togglingConnection.value) return

  togglingConnection.value = true
  error.value = null
  try {
    await stopTerminalSession(sid)
    if (activeSessionId.value !== sid) return
    closeStream()
    status.value = 'disconnected'
    activeSessionInfo.value = {
      sessionId: sid,
      cwd: activeSessionInfo.value?.cwd || '',
      running: false,
    }
    setTerminalStdinEnabled(false)
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    error.value = `${String(t('terminal.errors.failedToStopSession'))}${details ? `: ${details}` : ''}`
  } finally {
    togglingConnection.value = false
  }
}

function toggleConnection() {
  if (connectionToggleDisabled.value) return
  if (connectionToggleMode.value === 'disconnect') {
    void stopActiveSession()
    return
  }
  void startActiveSession()
}

function startCreateSession() {
  if (creating.value) return
  sessionMenuOpen.value = false
  sessionCreateDraft.value = ''
  sessionCreateOpen.value = true
}

function cancelCreateSession() {
  if (creating.value) return
  sessionCreateOpen.value = false
  sessionCreateDraft.value = ''
}

function saveCreateSession() {
  const name = normalizeSessionName(sessionCreateDraft.value)
  if (!name || creating.value) return
  void createSession(name)
}

function setSessionMenuOpen(value: boolean) {
  sessionMenuOpen.value = value
}

function setSessionMenuQuery(value: string) {
  sessionMenuQuery.value = String(value || '')
}

function onSessionMenuSelect(item: OptionMenuItem) {
  const sid = String(item.id || '').trim()
  if (!sid) return
  void activateSession(sid)
}

function startPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  pollTimer = window.setInterval(() => {
    void refreshState({ silent: true })
    void refreshActiveSessionInfo()
  }, 5000)
}

defineExpose({
  refresh: () => refreshState(),
  createSession: () => createSession(),
})

watch(activeSessionId, (sid) => {
  if (!sid) {
    closeStream()
    activeSessionInfo.value = null
    setTerminalStdinEnabled(false)
    return
  }

  if (streamSessionId.value && streamSessionId.value !== sid) {
    closeStream()
  }
  ensureTerminalMounted()
  renderSessionOutput(sid)
  lastResizeSignature = ''
  void refreshActiveSessionInfo()
})

watch(el, () => {
  if (!el.value) return
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
})

onMounted(() => {
  ensureTerminalMounted()
  void refreshState()
  void refreshActiveSessionInfo()
  startPolling()

  window.addEventListener('resize', scheduleResize)
  if ('ResizeObserver' in window) {
    try {
      resizeObserver = new ResizeObserver(() => scheduleResize())
      if (el.value) resizeObserver.observe(el.value)
    } catch {
      resizeObserver = null
    }
  }
})

onBeforeUnmount(() => {
  closeStream()
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer)
    resizeTimer = null
  }
  window.removeEventListener('resize', scheduleResize)
  if (resizeObserver) {
    try {
      resizeObserver.disconnect()
    } catch {
      // ignore
    }
    resizeObserver = null
  }

  if (term.value) {
    term.value.dispose()
    term.value = null
  }
  fit.value = null
  outputById.clear()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 p-3">
    <div>
      <div class="relative flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border-0 bg-transparent px-1.5 text-xs text-foreground transition-colors hover:bg-secondary/40 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loading || sessionItems.length === 0"
          :aria-label="sessionPickerLabel"
          @click.stop="setSessionMenuOpen(!sessionMenuOpen)"
        >
          <span class="min-w-0 truncate text-left font-mono">{{ activeSessionLabel }}</span>
          <RiArrowDownSLine class="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        <div class="flex h-8 items-center gap-0.5">
          <IconButton
            size="sm"
            :aria-label="connectionToggleLabel"
            :tooltip="connectionToggleLabel"
            :disabled="connectionToggleDisabled"
            @click="toggleConnection"
          >
            <RiStopCircleLine v-if="connectionToggleMode === 'disconnect'" class="h-4 w-4" />
            <RiPlugLine v-else class="h-4 w-4" />
          </IconButton>
          <IconButton
            size="sm"
            :aria-label="String(t('workspaceDock.refresh'))"
            :tooltip="String(t('workspaceDock.refresh'))"
            :disabled="refreshing"
            @click="refreshState"
          >
            <RiRefreshLine class="h-4 w-4" :class="refreshing ? 'animate-spin' : ''" />
          </IconButton>
          <IconButton
            size="sm"
            :aria-label="String(t('terminal.session.create'))"
            :tooltip="String(t('terminal.session.create'))"
            :disabled="creating"
            @click="startCreateSession"
          >
            <RiAddLine class="h-4 w-4" />
          </IconButton>
        </div>

        <OptionMenu
          :open="sessionMenuOpen"
          :query="sessionMenuQuery"
          :groups="sessionMenuGroups"
          :title="sessionPickerLabel"
          :mobile-title="sessionPickerLabel"
          :searchable="true"
          :is-mobile-pointer="ui.isMobilePointer"
          :paginated="true"
          :page-size="18"
          :loading="loading || refreshing"
          :refreshable="true"
          :on-refresh="refreshState"
          pagination-mode="item"
          desktop-placement="bottom-start"
          desktop-class="w-72"
          @update:open="setSessionMenuOpen"
          @update:query="setSessionMenuQuery"
          @select="onSessionMenuSelect"
        />
      </div>

      <NameInputPrompt
        :open="sessionCreateOpen"
        :model-value="sessionCreateDraft"
        :title="String(t('terminal.dialogs.newTerminal.title'))"
        :description="String(t('terminal.emptyState.description'))"
        :placeholder="String(t('terminal.session.namePlaceholder'))"
        :confirm-label="creating ? String(t('terminal.session.creating')) : String(t('terminal.session.create'))"
        :cancel-label="String(t('common.cancel'))"
        :busy="creating"
        :is-mobile-pointer="ui.isMobilePointer"
        @update:model-value="(v) => (sessionCreateDraft = v)"
        @update:open="(v) => (sessionCreateOpen = v)"
        @cancel="cancelCreateSession"
        @submit="saveCreateSession"
      />
    </div>

    <div v-if="error" class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
      {{ error }}
    </div>

    <div v-if="loading" class="rounded-md border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
      {{ t('workspaceDock.loading') }}
    </div>

    <div
      v-else-if="sessionItems.length === 0"
      class="rounded-md border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground"
    >
      {{ t('workspaceDock.terminal.empty') }}
    </div>

    <template v-else>
      <div class="min-h-[220px] flex-1 overflow-hidden rounded-md border border-border/60 bg-[#101415]">
        <div ref="el" class="h-full w-full" />
      </div>

      <div class="text-[11px] text-muted-foreground">
        {{ status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected' }}
      </div>
    </template>
  </div>
</template>
