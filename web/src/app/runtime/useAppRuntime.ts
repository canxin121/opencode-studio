import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useHealthStore } from '@/stores/health'
import { useSettingsStore } from '@/stores/settings'
import { useSessionActivityStore } from '@/stores/sessionActivity'
import { useChatStore } from '@/stores/chat'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import { useDirectoryStore } from '@/stores/directory'
import { useDirectorySessionStore } from '@/stores/directorySessionStore'
import { usePluginHostStore } from '@/stores/pluginHost'

import { connectSse } from '@/lib/sse'
import type { SseClientStats } from '@/lib/sse'
import { subscribeAppBroadcast } from '@/lib/appBroadcast'
import { applyDeviceClasses, getDeviceInfo } from '@/lib/device'
import { installKeyboardInsets } from '@/lib/keyboardInsets'
import { installKeyboardTapFix } from '@/lib/keyboardTapFix'
import { installKeyboardShortcuts } from '@/app/runtime/installKeyboardShortcuts'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import { readSessionIdFromFullPath, readSessionIdFromQuery } from '@/app/navigation/sessionQuery'

export function useAppRuntime() {
  const route = useRoute()

  const ui = useUiStore()
  const health = useHealthStore()
  const settings = useSettingsStore()
  const activity = useSessionActivityStore()
  const chat = useChatStore()
  const updates = useUpdatesStore()
  const directoryStore = useDirectoryStore()
  const directorySessions = useDirectorySessionStore()
  const pluginHost = usePluginHostStore()

  let sse: ReturnType<typeof connectSse> | null = null
  let visibilityHandler: (() => void) | null = null
  let onlineHandler: (() => void) | null = null
  let focusHandler: (() => void) | null = null
  let blurHandler: (() => void) | null = null
  let pageShowHandler: ((evt: PageTransitionEvent) => void) | null = null
  let pageHideHandler: ((evt: PageTransitionEvent) => void) | null = null
  let freezeHandler: (() => void) | null = null
  let resumeHandler: (() => void) | null = null
  let cleanupKeyboard: (() => void) | null = null
  let cleanupShortcuts: (() => void) | null = null
  let cleanupKeyboardTapFix: (() => void) | null = null
  let cleanupBroadcast: (() => void) | null = null
  let stopSettingsDirectorySync: (() => void) | null = null
  let updateTimer: number | null = null
  let sseDebugTimer: number | null = null
  let lastSseDebugAt = 0
  let lastSseDebugErrorSum = 0
  let lastSseErrorAt = 0
  let lastSseGapAt = 0

  let globalSseCursor = ''

  let lastResumeSyncAt = 0
  let lastVisibilityState: DocumentVisibilityState | null = null

  // Watchdog for system sleep/background timer throttling.
  let clockWatchdogTimer: number | null = null
  let lastClockWatchdogAt = Date.now()
  let pendingResumeReason: string | null = null
  let pendingResumeGapMs = 0

  function sseMaxChunkAgeMs(): number {
    const now = Date.now()
    const stats = [readSseStats(sse)]
    let maxAge = 0
    for (const st of stats) {
      const lastChunkAtRaw = (st as Partial<SseClientStats> | null)?.lastChunkAt
      const lastChunkAt = typeof lastChunkAtRaw === 'number' && Number.isFinite(lastChunkAtRaw) ? lastChunkAtRaw : 0
      if (!Number.isFinite(lastChunkAt) || lastChunkAt <= 0) continue
      maxAge = Math.max(maxAge, now - lastChunkAt)
    }
    return maxAge
  }

  function shouldForceReconnectAfterResume(opts: { reason: string; gapMs?: number }) {
    const gapMs = Math.max(0, Math.floor(opts.gapMs || 0))

    // If the JS thread was paused for a while, fetch-stream SSE can silently stall.
    if (gapMs >= 20000) return true

    // If we haven't seen any SSE bytes in a long time while visible, treat it as stalled.
    // (Some browsers keep the JS context active but stop delivering stream chunks.)
    const maxAge = sseMaxChunkAgeMs()
    if (document.visibilityState === 'visible' && maxAge >= 45000) return true

    // BFCache restores a fully-rendered page but network connections are dead.
    if (opts.reason === 'pageshow') return true
    if (opts.reason === 'resume') return true

    return false
  }

  function computeSidebarLimitPerDirectory(opts?: { reason?: string; gapMs?: number }): number {
    // Start from the server default; clamp within server limits.
    let limit = 80
    if (document.visibilityState !== 'visible') {
      return 40
    }

    // visibleDirectories is a computed array (Pinia unwraps refs). Guard in case of partial init.
    const dirs = Array.isArray((directorySessions as unknown as { visibleDirectories?: unknown }).visibleDirectories)
      ? ((directorySessions as unknown as { visibleDirectories: unknown[] }).visibleDirectories as unknown[])
      : []
    const collapsed = Array.isArray(directorySessions.uiPrefs?.collapsedDirectoryIds)
      ? directorySessions.uiPrefs.collapsedDirectoryIds.length
      : 0
    const expandedCount = Math.max(0, dirs.length - collapsed)

    // If the user only has a few expanded directories, fetch deeper so the sidebar
    // can recover without needing extra paging requests after gaps/resume.
    if (expandedCount <= 3) limit = Math.max(limit, 160)
    else if (expandedCount <= 8) limit = Math.max(limit, 120)

    const gapMs = Math.max(0, Math.floor(opts?.gapMs || 0))
    if (gapMs >= 20000) limit = Math.max(limit, 140)

    const reason = String(opts?.reason || '').trim()
    if (reason === 'sse-gap' || reason === 'replay-gap') limit = Math.max(limit, 120)

    return Math.min(200, Math.max(40, Math.floor(limit)))
  }

  function resyncAfterResume(reason: string, opts?: { gapMs?: number }) {
    const now = Date.now()
    if (now - lastResumeSyncAt < 1500) return
    lastResumeSyncAt = now

    // Mobile/desktop browsers can pause fetch/SSE streams in the background.
    // On resume, prefer preserving Last-Event-ID cursors but do not assume streams are still alive.
    const forceReconnect = shouldForceReconnectAfterResume({ reason, gapMs: opts?.gapMs })
    if (forceReconnect || !sse) {
      connectActivity()
    }

    // Reconcile all data sources that can drift while suspended.
    void settings.refresh().catch(() => {})
    void chat.refreshSessions().catch(() => {})
    const sid = chat.selectedSessionId
    if (sid) {
      void chat.refreshMessages(sid, { silent: true }).catch(() => {})
    }
    void activity.refresh().catch(() => {})
    void directorySessions
      .revalidateFromApi({ limitPerDirectory: computeSidebarLimitPerDirectory({ reason, gapMs: opts?.gapMs }) })
      .catch(() => {})
    void directorySessions.revalidateUiPrefsFromApi().catch(() => {})

    try {
      console.debug('[sse] resync after resume:', reason)
    } catch {
      // ignore
    }

    // Helpful in dev when diagnosing background stalls.
    logSseStats({ force: true, reason: `resume:${reason}` })
  }

  function readSseStats(client: { getStats?: () => unknown } | null): unknown {
    if (!client) return null
    if (typeof client.getStats === 'function') {
      try {
        return client.getStats()
      } catch {
        return null
      }
    }
    return null
  }

  function logSseStats(opts?: { force?: boolean; reason?: string }) {
    if (!import.meta.env.DEV) return
    const now = Date.now()
    if (!opts?.force && now - lastSseDebugAt < 15000) return

    const globalStats = readSseStats(sse)

    const errorSum = Number((globalStats as { errorCount?: number } | null)?.errorCount || 0)

    const maxAgeMs = Math.max(
      globalStats && typeof (globalStats as { lastChunkAt?: number }).lastChunkAt === 'number'
        ? now - Number((globalStats as { lastChunkAt?: number }).lastChunkAt || 0)
        : 0,
    )

    // Only log periodically when something looks suspicious, or when errors increase.
    if (!opts?.force && errorSum === lastSseDebugErrorSum && maxAgeMs < 45000) return

    lastSseDebugAt = now
    lastSseDebugErrorSum = errorSum
    try {
      console.debug('[sse] stats', {
        reason: opts?.reason || '',
        visibility: document.visibilityState,
        global: globalStats,
      })
    } catch {
      // ignore
    }
  }

  function handleVisibilityEvent() {
    const state = document.visibilityState
    const visible = state === 'visible'

    // Only trigger a resync on hidden -> visible transitions.
    if (visible && lastVisibilityState && lastVisibilityState !== 'visible') {
      if (pendingResumeReason) {
        const reason = pendingResumeReason
        const gapMs = pendingResumeGapMs
        pendingResumeReason = null
        pendingResumeGapMs = 0
        resyncAfterResume(reason, { gapMs })
      } else {
        resyncAfterResume('visibility')
      }
    }
    lastVisibilityState = state
  }

  function connectActivity() {
    sse?.close()
    sse = null

    try {
      sse = connectSse({
        endpoint: '/api/global/event',
        initialLastEventId: globalSseCursor,
        debugLabel: 'sse:global',
        onCursor: (lastEventId) => {
          globalSseCursor = lastEventId
        },
        onSequenceGap: () => {
          const now = Date.now()
          if (now - lastSseGapAt < 1500) return
          lastSseGapAt = now

          const sid = chat.selectedSessionId
          if (sid) {
            void chat.refreshMessages(sid, { silent: true }).catch(() => {})
          }
          void settings.refresh().catch(() => {})
          void activity.refresh().catch(() => {})
          void directorySessions.revalidateUiPrefsFromApi().catch(() => {})
          void directorySessions
            .revalidateFromApi({ limitPerDirectory: computeSidebarLimitPerDirectory({ reason: 'sse-gap' }) })
            .catch(() => {})
        },
        onEvent: (evt) => {
          if (evt.type === 'config.settings.replace') {
            void settings.refresh().catch(() => {})
            return
          }
          if (evt.type === 'opencode-studio:replay-gap') {
            const now = Date.now()
            if (now - lastSseGapAt >= 1500) {
              lastSseGapAt = now
              const sid = chat.selectedSessionId
              if (sid) {
                void chat.refreshMessages(sid, { silent: true }).catch(() => {})
              }
              void settings.refresh().catch(() => {})
              void activity.refresh().catch(() => {})
              void directorySessions.revalidateUiPrefsFromApi().catch(() => {})
              void directorySessions
                .revalidateFromApi({ limitPerDirectory: computeSidebarLimitPerDirectory({ reason: 'replay-gap' }) })
                .catch(() => {})
            }
            return
          }
          activity.applyEvent(evt)
          chat.applyEvent(evt)
          directorySessions.applyGlobalEvent(evt)
        },
        onError: (err) => {
          // When the stream drops mid-run the UI can get stuck on partial output.
          // Throttle a best-effort resync.
          const now = Date.now()
          if (now - lastSseErrorAt < 1500) return
          lastSseErrorAt = now

          // Keep this silent to avoid UI flicker while reconnecting.
          const sid = chat.selectedSessionId
          if (sid) {
            void chat.refreshMessages(sid, { silent: true }).catch(() => {})
          }
          void settings.refresh().catch(() => {})
          void activity.refresh().catch(() => {})
          void directorySessions.revalidateUiPrefsFromApi().catch(() => {})
          void directorySessions
            .revalidateFromApi({ limitPerDirectory: computeSidebarLimitPerDirectory({ reason: 'sse-error' }) })
            .catch(() => {})

          // Surface in devtools for debugging.
          try {
            console.warn('[sse] connection error', err)
          } catch {
            // ignore
          }
        },
      })
    } catch (err) {
      sse = null
      try {
        console.error('[sse] failed to start', err)
      } catch {
        // ignore
      }
    }
  }

  function applyDevice() {
    const info = getDeviceInfo()
    applyDeviceClasses(info)
    ui.setIsMobile(info.isMobile)
    ui.setIsMobilePointer(info.isMobilePointer)
  }

  // Prime device state before first paint so mobile/desktop side panels mount
  // against the correct layout branch during refresh.
  applyDevice()

  // Keep the directory session store in sync even if the sidebar component
  // isn't mounted (mobile layout, route changes) so other UI pieces stay up to date.
  stopSettingsDirectorySync = watch(
    () => settings.data,
    (next) => {
      if (!next) return
      const list = normalizeDirectories(next?.directories ?? next?.projects)
      directorySessions.setDirectoryEntries(list)
    },
    { immediate: true, deep: true },
  )

  async function ensureSelectedSessionFromQuery() {
    const sid = readSessionIdFromQuery(route.query) || readSessionIdFromFullPath(route.fullPath)

    // If the URL includes a session id, treat it as an explicit deep link.
    // Don't strip it just because the in-memory flag wasn't restored yet.
    if (sid && !ui.sessionQueryEnabled) {
      ui.enableSessionQuery()
    }

    if (sid) {
      if (sid !== chat.selectedSessionId) {
        await chat.selectSession(sid)
      }
      return
    }

    ui.disableSessionQuery()

    const selected = chat.selectedSessionId
    const selectedExists = selected ? !!chat.selectedSession : false
    if (!selectedExists) {
      await chat.selectSession(null)
    }
  }

  onMounted(async () => {
    window.addEventListener('resize', applyDevice)

    cleanupKeyboard = installKeyboardInsets({ enabled: true })
    cleanupShortcuts = installKeyboardShortcuts()
    cleanupKeyboardTapFix = installKeyboardTapFix({ enabled: true })

    await Promise.all([
      health.refresh().catch(() => {}),
      directoryStore.refreshHome().catch(() => {}),
      settings.refresh().catch(() => {}),
      activity.refresh().catch(() => {}),
      directorySessions.bootstrapWithStaleWhileRevalidate().catch(() => {}),
    ])

    await pluginHost.bootstrap().catch(() => {})

    // Check for updates a few seconds after mount.
    updateTimer = window.setTimeout(() => {
      void updates.checkForUpdates()
    }, 3000)

    // Keep sessions available for all views.
    await chat.refreshSessions().catch(() => {})
    if (readSessionIdFromQuery(route.query) || readSessionIdFromFullPath(route.fullPath)) {
      ui.enableSessionQuery()
    }
    await ensureSelectedSessionFromQuery().catch(() => {})

    connectActivity()

    cleanupBroadcast?.()
    cleanupBroadcast = subscribeAppBroadcast((msg) => {
      if (!msg?.type) return
      if (msg.type === 'settings.updated') {
        void settings.refresh().catch(() => {})
        return
      }
      if (msg.type === 'opencodeConfig.updated') {
        void pluginHost.bootstrap().catch(() => {})
        return
      }
      if (msg.type === 'chatSidebarUiPrefs.updated') {
        void directorySessions.revalidateUiPrefsFromApi().catch(() => {})
      }
    })

    if (import.meta.env.DEV && sseDebugTimer === null) {
      sseDebugTimer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        logSseStats({ force: false, reason: 'interval' })
      }, 20000)
    }

    lastVisibilityState = document.visibilityState
    handleVisibilityEvent()
    visibilityHandler = () => handleVisibilityEvent()
    document.addEventListener('visibilitychange', visibilityHandler)

    // BFCache: pageshow can resume without a visibilitychange transition.
    pageShowHandler = (evt) => {
      // When restored from BFCache, network connections are not preserved.
      // Always force a reconnect + reconcile.
      if (evt && (evt as { persisted?: boolean }).persisted) {
        resyncAfterResume('pageshow', { gapMs: 60000 })
      } else if (document.visibilityState === 'visible') {
        // Cheap best-effort reconcile on normal pageshow (Safari quirks).
        resyncAfterResume('pageshow')
      }
    }
    pageHideHandler = (evt) => {
      // When entering BFCache, proactively close streams.
      if (evt && (evt as { persisted?: boolean }).persisted) {
        sse?.close()
      }
    }
    window.addEventListener('pageshow', pageShowHandler)
    window.addEventListener('pagehide', pageHideHandler)

    // Page Lifecycle API (Chrome, some Chromium-based browsers).
    freezeHandler = () => {
      try {
        console.debug('[lifecycle] freeze')
      } catch {
        // ignore
      }
      sse?.close()
    }
    resumeHandler = () => {
      resyncAfterResume('resume', { gapMs: 60000 })
    }
    document.addEventListener('freeze', freezeHandler as EventListener)
    document.addEventListener('resume', resumeHandler as EventListener)

    // Clock-jump watchdog: detects system sleep or heavy background throttling.
    lastClockWatchdogAt = Date.now()
    if (clockWatchdogTimer === null) {
      const intervalMs = 2000
      const jumpThresholdMs = 8000
      clockWatchdogTimer = window.setInterval(() => {
        const now = Date.now()
        const delta = now - lastClockWatchdogAt
        lastClockWatchdogAt = now

        if (delta < jumpThresholdMs) return
        const reason = 'clock-jump'
        if (document.visibilityState === 'visible') {
          resyncAfterResume(reason, { gapMs: delta })
        } else {
          // Defer until we become visible.
          pendingResumeReason = reason
          pendingResumeGapMs = Math.max(pendingResumeGapMs, delta)
        }
      }, intervalMs)
    }

    // Some mobile browsers don't reliably emit visibilitychange on resume; focus/online are cheap extra signals.
    focusHandler = () => {
      handleVisibilityEvent()
      if (document.visibilityState === 'visible') resyncAfterResume('focus')
    }
    blurHandler = () => {
      handleVisibilityEvent()
    }
    window.addEventListener('focus', focusHandler)
    window.addEventListener('blur', blurHandler)
    onlineHandler = () => {
      if (document.visibilityState === 'visible') resyncAfterResume('online')
    }
    window.addEventListener('online', onlineHandler)
  })

  watch(
    () => directoryStore.currentDirectory,
    async () => {
      await chat.refreshSessions().catch(() => {})
      await ensureSelectedSessionFromQuery().catch(() => {})
    },
  )

  watch(
    () => `${readSessionIdFromQuery(route.query)}|${readSessionIdFromFullPath(route.fullPath)}`,
    () => {
      void ensureSelectedSessionFromQuery()
    },
  )

  onBeforeUnmount(() => {
    sse?.close()
    sse = null
    cleanupKeyboard?.()
    cleanupKeyboard = null
    cleanupShortcuts?.()
    cleanupShortcuts = null
    cleanupKeyboardTapFix?.()
    cleanupKeyboardTapFix = null
    if (updateTimer !== null) {
      window.clearTimeout(updateTimer)
      updateTimer = null
    }
    if (sseDebugTimer !== null) {
      window.clearInterval(sseDebugTimer)
      sseDebugTimer = null
    }
    window.removeEventListener('resize', applyDevice)

    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    if (focusHandler) {
      window.removeEventListener('focus', focusHandler)
      focusHandler = null
    }
    if (blurHandler) {
      window.removeEventListener('blur', blurHandler)
      blurHandler = null
    }
    if (onlineHandler) {
      window.removeEventListener('online', onlineHandler)
      onlineHandler = null
    }

    if (pageShowHandler) {
      window.removeEventListener('pageshow', pageShowHandler)
      pageShowHandler = null
    }
    if (pageHideHandler) {
      window.removeEventListener('pagehide', pageHideHandler)
      pageHideHandler = null
    }
    if (freezeHandler) {
      document.removeEventListener('freeze', freezeHandler as EventListener)
      freezeHandler = null
    }
    if (resumeHandler) {
      document.removeEventListener('resume', resumeHandler as EventListener)
      resumeHandler = null
    }
    if (clockWatchdogTimer !== null) {
      window.clearInterval(clockWatchdogTimer)
      clockWatchdogTimer = null
    }

    cleanupBroadcast?.()
    cleanupBroadcast = null
    stopSettingsDirectorySync?.()
    stopSettingsDirectorySync = null
  })
}
