import { computed, nextTick, onBeforeUnmount, ref, watch, type Component, type ComponentPublicInstance } from 'vue'
import { RiClipboardLine, RiEditLine, RiFileUploadLine, RiLinkM, RiShareLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import type { DirectoryEntry } from '@/features/sessions/model/types'

type SessionLike = {
  id: string
  share?: { url?: string | null } | null
}

export type SessionActionItem = {
  id: string
  label: string
  description?: string
  icon?: Component
  disabled?: boolean
}

type TFunction = (key: string, params?: Record<string, unknown>) => string

function shareUrlForSession(session: SessionLike | null | undefined): string {
  return typeof session?.share?.url === 'string' ? String(session.share.url) : ''
}

export function buildSessionActionItemsForSession(session: SessionLike | null | undefined): SessionActionItem[] {
  const { t } = useI18n()
  return buildSessionActionItemsForSessionI18n(t, session)
}

export function buildSessionActionItemsForSessionI18n(
  t: TFunction,
  session: SessionLike | null | undefined,
): SessionActionItem[] {
  const shareUrl = shareUrlForSession(session)
  return [
    {
      id: 'rename',
      label: String(t('chat.sidebar.sessionActions.rename.label')),
      description: String(t('chat.sidebar.sessionActions.rename.description')),
      icon: RiEditLine,
    },
    {
      id: 'copy-transcript',
      label: String(t('chat.sidebar.sessionActions.copyTranscript.label')),
      description: String(t('chat.sidebar.sessionActions.copyTranscript.description')),
      icon: RiClipboardLine,
    },
    {
      id: 'export-transcript',
      label: String(t('chat.sidebar.sessionActions.exportTranscript.label')),
      description: String(t('chat.sidebar.sessionActions.exportTranscript.description')),
      icon: RiFileUploadLine,
    },
    {
      id: 'share',
      label: String(t('chat.sidebar.sessionActions.share.label')),
      description: String(t('chat.sidebar.sessionActions.share.description')),
      icon: RiShareLine,
      disabled: Boolean(shareUrl),
    },
    {
      id: 'unshare',
      label: String(t('chat.sidebar.sessionActions.unshare.label')),
      description: String(t('chat.sidebar.sessionActions.unshare.description')),
      icon: RiLinkM,
      disabled: !shareUrl,
    },
    {
      id: 'copy-share',
      label: String(t('chat.sidebar.sessionActions.copyShareLink.label')),
      description: String(t('chat.sidebar.sessionActions.copyShareLink.description')),
      icon: RiClipboardLine,
      disabled: !shareUrl,
    },
    {
      id: 'open-share',
      label: String(t('chat.sidebar.sessionActions.openShareLink.label')),
      description: String(t('chat.sidebar.sessionActions.openShareLink.description')),
      icon: RiLinkM,
      disabled: !shareUrl,
    },
  ]
}

export function useSessionActionMenu(opts: {
  chat: { selectedSessionId: string | null }
  ui: { requestSessionAction: (id: string) => void }
  selectSession: (sessionId: string) => Promise<void>
}) {
  const { t } = useI18n()

  type MenuRefLike = { containsTarget: (target: Node | null) => boolean; focusSearch?: () => void }
  type MaybeMenuComponent = ComponentPublicInstance<{ $el?: Element | null }> &
    Partial<{ containsTarget: (target: Node | null) => boolean; focusSearch: () => void }>

  // Session action menu (desktop-only trigger)
  const sessionActionMenuTarget = ref<{ directory: DirectoryEntry; session: SessionLike } | null>(null)
  const sessionActionMenuQuery = ref('')
  const sessionActionMenuRef = ref<MenuRefLike | null>(null)
  const sessionActionMenuAnchorRef = ref<HTMLElement | null>(null)
  const sessionActionMenuOpen = computed(() => Boolean(sessionActionMenuTarget.value))

  let sessionActionMenuPointerHandler: ((event: MouseEvent | TouchEvent) => void) | null = null
  let sessionActionMenuClickHandler: ((event: MouseEvent) => void) | null = null

  const sessionActionItems = computed<SessionActionItem[]>(() =>
    buildSessionActionItemsForSessionI18n(t, sessionActionMenuTarget.value?.session),
  )

  const filteredSessionActionItems = computed<SessionActionItem[]>(() => {
    const q = sessionActionMenuQuery.value.trim().toLowerCase()
    const list = sessionActionItems.value
    if (!q) return list
    return list.filter((item) => {
      const label = item.label.toLowerCase()
      const desc = String(item.description || '').toLowerCase()
      return label.includes(q) || desc.includes(q) || item.id.includes(q)
    })
  })

  function openSessionActionMenu(directory: DirectoryEntry, session: SessionLike, event?: MouseEvent | PointerEvent) {
    const sid = String(session?.id || '').trim()
    if (!sid) return
    if (sessionActionMenuTarget.value?.session?.id === sid) {
      sessionActionMenuTarget.value = null
      sessionActionMenuAnchorRef.value = null
      return
    }
    sessionActionMenuTarget.value = { directory, session }
    sessionActionMenuAnchorRef.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
    sessionActionMenuQuery.value = ''
    void nextTick(() => sessionActionMenuRef.value?.focusSearch?.())
  }

  function setSessionActionMenuRef(el: Element | ComponentPublicInstance | null) {
    if (!el) {
      sessionActionMenuRef.value = null
      return
    }

    const maybeComponent = el as MaybeMenuComponent
    const containsTarget = maybeComponent?.containsTarget
    const focusSearch = maybeComponent?.focusSearch

    if (typeof containsTarget === 'function') {
      sessionActionMenuRef.value = {
        containsTarget: (target: Node | null) => Boolean(containsTarget(target)),
        focusSearch:
          typeof focusSearch === 'function'
            ? () => {
                focusSearch()
              }
            : undefined,
      }
      return
    }

    const dom = el instanceof HTMLElement ? el : maybeComponent?.$el instanceof HTMLElement ? maybeComponent.$el : null
    sessionActionMenuRef.value = dom
      ? {
          containsTarget: (target: Node | null) => Boolean(target && dom.contains(target)),
          focusSearch: () => {
            const input = dom.querySelector('input')
            if (input instanceof HTMLElement) {
              input.focus()
            }
          },
        }
      : null
  }

  async function runSessionActionMenu(item: SessionActionItem) {
    if (item.disabled) return
    const target = sessionActionMenuTarget.value
    sessionActionMenuTarget.value = null
    sessionActionMenuAnchorRef.value = null
    sessionActionMenuQuery.value = ''
    const targetSessionId = typeof target?.session?.id === 'string' ? target.session.id.trim() : ''
    if (targetSessionId && targetSessionId !== opts.chat.selectedSessionId) {
      await opts.selectSession(targetSessionId)
    }
    opts.ui.requestSessionAction(item.id)
  }

  watch(sessionActionMenuOpen, (open) => {
    if (!open) {
      if (sessionActionMenuPointerHandler) {
        document.removeEventListener('pointerdown', sessionActionMenuPointerHandler, true)
        sessionActionMenuPointerHandler = null
      }
      if (sessionActionMenuClickHandler) {
        document.removeEventListener('click', sessionActionMenuClickHandler, true)
        sessionActionMenuClickHandler = null
      }
      return
    }

    const closeIfOutside = (target: Node | null) => {
      if (!target) return
      if (sessionActionMenuRef.value?.containsTarget(target)) return
      if (sessionActionMenuAnchorRef.value && sessionActionMenuAnchorRef.value.contains(target)) return
      sessionActionMenuTarget.value = null
      sessionActionMenuAnchorRef.value = null
    }

    sessionActionMenuPointerHandler = (event: MouseEvent | TouchEvent) => {
      closeIfOutside(event.target as Node | null)
    }
    sessionActionMenuClickHandler = (event: MouseEvent) => {
      closeIfOutside(event.target as Node | null)
    }
    document.addEventListener('pointerdown', sessionActionMenuPointerHandler, true)
    document.addEventListener('click', sessionActionMenuClickHandler, true)
  })

  onBeforeUnmount(() => {
    if (sessionActionMenuPointerHandler) {
      document.removeEventListener('pointerdown', sessionActionMenuPointerHandler, true)
      sessionActionMenuPointerHandler = null
    }
    if (sessionActionMenuClickHandler) {
      document.removeEventListener('click', sessionActionMenuClickHandler, true)
      sessionActionMenuClickHandler = null
    }
  })

  return {
    sessionActionMenuAnchorRef,
    sessionActionMenuOpen,
    sessionActionMenuQuery,
    sessionActionMenuRef,
    sessionActionMenuTarget,
    filteredSessionActionItems,
    openSessionActionMenu,
    runSessionActionMenu,
    setSessionActionMenuRef,
  }
}
