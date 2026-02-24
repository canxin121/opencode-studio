import { router } from '@/router'
import { useChatStore } from '@/stores/chat'
import { useSessionActivityStore } from '@/stores/sessionActivity'
import { useSettingsStore } from '@/stores/settings'
import { useToastsStore } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'
import { patchSessionIdInQuery } from '@/app/navigation/sessionQuery'
import { i18n } from '@/i18n'

type ModifierLabel = 'cmd' | 'ctrl'
type SessionStatusLike = { type?: string } | null
type ChatStatusSource = { selectedSessionStatus?: { status?: SessionStatusLike } }

function hasModifier(e: KeyboardEvent): boolean {
  // Treat Meta on macOS, Ctrl elsewhere.
  return e.metaKey || e.ctrlKey
}

function modifierLabel(): ModifierLabel {
  if (typeof navigator === 'undefined') return 'ctrl'
  return /Macintosh|Mac OS X/.test(navigator.userAgent || '') ? 'cmd' : 'ctrl'
}

function keyLower(e: KeyboardEvent): string {
  return (e.key || '').toLowerCase()
}

export function installKeyboardShortcuts(): () => void {
  const ui = useUiStore()
  const chat = useChatStore()
  const settings = useSettingsStore()
  const activity = useSessionActivityStore()
  const toasts = useToastsStore()

  const mod = modifierLabel()

  let abortPrimedUntil: number | null = null
  let abortPrimedTimer: number | null = null

  const resetAbortPriming = () => {
    if (abortPrimedTimer !== null) {
      window.clearTimeout(abortPrimedTimer)
      abortPrimedTimer = null
    }
    abortPrimedUntil = null
    ui.clearAbortPrompt()
  }

  const isOnSettingsPage = () => router.currentRoute.value.path.startsWith('/settings')

  const isOverlayOpen = () => {
    return Boolean(ui.isHelpDialogOpen || (ui.isMobile && ui.isSessionSwitcherOpen) || isOnSettingsPage())
  }

  const canAbortNow = (): boolean => {
    const sid = chat.selectedSessionId
    if (!sid) return false

    const st = (chat as ChatStatusSource).selectedSessionStatus?.status ?? null
    const statusType = typeof st?.type === 'string' ? st.type : ''
    if (statusType === 'busy' || statusType === 'retry') return true
    if (statusType === 'idle') return false

    const phase = activity.snapshot[sid]?.type
    return phase === 'busy'
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl+.: help dialog
    if (hasModifier(e) && !e.shiftKey && keyLower(e) === '.') {
      e.preventDefault()
      ui.toggleHelpDialog()
      return
    }

    // Cmd/Ctrl+,: settings
    if (hasModifier(e) && !e.shiftKey && e.key === ',') {
      e.preventDefault()
      ui.setSessionSwitcherOpen(false)
      if (isOnSettingsPage()) {
        void router.push('/chat')
      } else {
        void router.push('/settings/opencode/general')
      }
      return
    }

    // Cmd/Ctrl+L: sessions list (desktop sidebar or mobile drilldown)
    if (hasModifier(e) && !e.shiftKey && keyLower(e) === 'l') {
      e.preventDefault()
      ui.toggleSidebar()
      return
    }

    // Cmd/Ctrl+I: focus chat input
    if (hasModifier(e) && !e.shiftKey && keyLower(e) === 'i') {
      e.preventDefault()
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input="true"]')
      textarea?.focus()
      return
    }

    // Cmd/Ctrl+N: create session
    if (hasModifier(e) && keyLower(e) === 'n') {
      e.preventDefault()
      ui.setActiveMainTab('chat')
      ui.setSessionSwitcherOpen(false)
      void (async () => {
        const created = await chat.createSession().catch(() => null)
        const sid = (created?.id || chat.selectedSessionId || '').trim()
        const cur = router.currentRoute.value

        if (sid) {
          ui.enableSessionQuery()
          const nextQuery = patchSessionIdInQuery(cur.query || {}, sid)
          if ((cur.path || '').startsWith('/chat')) {
            await router.replace({ query: nextQuery })
          } else {
            await router.push({ path: '/chat', query: nextQuery })
          }
        } else {
          await router.push('/chat')
        }
      })()
      return
    }

    // Cmd/Ctrl+/: cycle theme (Light -> Dark -> System)
    if (hasModifier(e) && !e.shiftKey && keyLower(e) === '/') {
      e.preventDefault()
      const useSystem = Boolean(settings.data?.useSystemTheme)
      const variant = settings.data?.themeVariant === 'dark' ? 'dark' : 'light'
      if (useSystem) {
        void settings.save({ useSystemTheme: false, themeVariant: 'light' }).catch(() => {})
      } else if (variant === 'light') {
        void settings.save({ useSystemTheme: false, themeVariant: 'dark' }).catch(() => {})
      } else {
        void settings.save({ useSystemTheme: true }).catch(() => {})
      }
      return
    }

    // Cmd/Ctrl + number: switch tabs by index.
    if (hasModifier(e) && !e.shiftKey && !e.altKey) {
      const n = Number.parseInt(e.key, 10)
      if (Number.isFinite(n) && n >= 1 && n <= 9) {
        // NOTE: The exact mapping depends on whether Plan is available.
        // The Header will enforce parity mapping; here we only prevent default when
        // a mapping exists.
        // Keep the browser from focusing the tab bar / address bar.
        e.preventDefault()
      }
    }

    // Esc: close settings, else double-Esc abort gating.
    if (e.key === 'Escape') {
      if (isOnSettingsPage()) {
        e.preventDefault()
        void router.push('/chat')
        resetAbortPriming()
        return
      }

      if (isOverlayOpen() || ui.activeMainTab !== 'chat') {
        resetAbortPriming()
        return
      }

      const sid = chat.selectedSessionId
      if (!sid || !canAbortNow()) {
        resetAbortPriming()
        return
      }

      const now = Date.now()
      if (abortPrimedUntil && now < abortPrimedUntil) {
        e.preventDefault()
        resetAbortPriming()
        void chat
          .abortSession(sid)
          .then((ok) => {
            if (!ok) {
              toasts.push('error', i18n.global.t('chat.toasts.failedToAbortRun'))
            }
          })
          .catch(() => {
            toasts.push('error', i18n.global.t('chat.toasts.failedToAbortRun'))
          })
        return
      }

      e.preventDefault()
      const expiresAt = ui.armAbortPrompt(sid, 3000)
      abortPrimedUntil = expiresAt
      toasts.push(
        'info',
        i18n.global.t('chat.toasts.pressEscAgainToAbort', { modKey: mod === 'cmd' ? 'Cmd' : 'Ctrl' }),
        2000,
      )
      if (abortPrimedTimer !== null) {
        window.clearTimeout(abortPrimedTimer)
      }
      abortPrimedTimer = window.setTimeout(
        () => {
          if (abortPrimedUntil && Date.now() >= abortPrimedUntil) {
            resetAbortPriming()
          }
        },
        Math.max(0, expiresAt - now),
      )
      return
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    resetAbortPriming()
  }
}
