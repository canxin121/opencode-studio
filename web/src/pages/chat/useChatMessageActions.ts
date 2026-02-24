import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { apiJson } from '@/lib/api'
import { patchSessionIdInQuery } from '@/app/navigation/sessionQuery'
import type { JsonValue } from '@/types/json'
import { buildAssistantErrorCopyText } from './assistantError'

type ToastKind = 'info' | 'success' | 'error'
type ToastsStore = { push: (kind: ToastKind, message: string) => void }

type ComposerExpose = {
  textareaEl?: HTMLTextAreaElement | { value: HTMLTextAreaElement | null } | null
}

function getComposerTextareaEl(composer: ComposerExpose | null): HTMLTextAreaElement | null {
  const textarea = composer?.textareaEl
  if (!textarea) return null
  return textarea instanceof HTMLTextAreaElement ? textarea : textarea.value
}

type AttachedFile = {
  id: string
  filename: string
  size: number
  mime: string
  url?: string
  serverPath?: string
}

type MessagePartLike = {
  type?: string
  text?: string
  filename?: string
  mime?: string
  url?: string
}

type PendingComposer = {
  text?: string
  parts?: JsonValue[]
}

type MessageLike = {
  info?: {
    id?: string
    role?: string
    error?: JsonValue
  }
  parts?: MessagePartLike[]
}

type ChatLike = {
  selectedSessionId: string | null
  selectSession: (sessionId: string) => Promise<void>
  revertToMessage: (sessionId: string, messageId: string, opts?: { restoreComposer?: boolean }) => Promise<void>
  consumePendingComposer: () => PendingComposer
  refreshMessages: (sessionId: string, opts?: { silent?: boolean }) => Promise<void>
}

function filePartLabel(part: MessagePartLike): string {
  const name = typeof part?.filename === 'string' ? part.filename.trim() : ''
  if (name) return name
  const url = typeof part?.url === 'string' ? part.url : ''
  if (!url) return 'file'
  if (url.startsWith('data:')) return 'attachment'
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last || 'file'
  } catch {
    return 'file'
  }
}

export function useChatMessageActions(opts: {
  chat: ChatLike
  toasts: ToastsStore
  route: RouteLocationNormalizedLoaded
  router: Router
  sessionDirectory: Ref<string>

  draft: Ref<string>
  attachedFiles: Ref<AttachedFile[]>
  clearAttachments: () => void
  composerRef: Ref<ComposerExpose | null>

  getTextParts: (parts: MessagePartLike[]) => Array<{ text?: string }>
  copyToClipboard: (text: string) => Promise<void>
  scrollToBottom: (behavior: 'auto' | 'smooth') => void
}) {
  const { t } = useI18n()

  const {
    chat,
    toasts,
    route,
    router,
    sessionDirectory,
    draft,
    attachedFiles,
    clearAttachments,
    composerRef,
    getTextParts,
    copyToClipboard,
    scrollToBottom,
  } = opts

  const copiedMessageId = ref('')
  let copiedTimer: number | null = null

  onBeforeUnmount(() => {
    if (copiedTimer) {
      window.clearTimeout(copiedTimer)
      copiedTimer = null
    }
  })

  async function handleCopyMessage(message: MessageLike) {
    const id = typeof message?.info?.id === 'string' ? message.info.id : ''
    let text = getTextParts(Array.isArray(message?.parts) ? message.parts : [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .filter((t) => t.trim())
      .join('\n\n')
    if (!text) {
      text = buildAssistantErrorCopyText(message?.info ?? null)
    }
    if (!text) return
    try {
      await copyToClipboard(text)
    } catch {
      toasts.push('error', t('common.copyFailed'))
      return
    }
    copiedMessageId.value = id
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copiedMessageId.value = ''
      copiedTimer = null
    }, 1200)
  }

  function dirQueryForSession(): string {
    const dir = sessionDirectory.value
    return dir ? `?directory=${encodeURIComponent(dir)}` : ''
  }

  async function handleForkFromMessage(messageId: string) {
    const sid = chat.selectedSessionId
    if (!sid) return
    const resp = await apiJson<{ id?: string }>(`/api/session/${encodeURIComponent(sid)}/fork${dirQueryForSession()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageID: messageId }),
    })
    const newId = typeof resp?.id === 'string' ? resp.id : ''
    if (!newId) return
    await router.replace({ path: '/chat', query: patchSessionIdInQuery(route.query, newId) })
    await chat.selectSession(newId).catch(() => {})
    await nextTick()
    scrollToBottom('auto')
  }

  const revertBusyMessageId = ref('')

  async function handleRevertFromMessage(messageId: string) {
    const sid = chat.selectedSessionId
    if (!sid) return

    revertBusyMessageId.value = messageId
    await chat.revertToMessage(sid, messageId)
    // Pull pending input from the store.
    const pending = chat.consumePendingComposer()
    if (pending.text || (pending.parts || []).length) {
      draft.value = pending.text || ''
      clearAttachments()
      for (const p of pending.parts || []) {
        const part = p && typeof p === 'object' ? (p as MessagePartLike) : null
        if (part?.type === 'file' && typeof part.url === 'string' && part.url) {
          attachedFiles.value = [
            ...attachedFiles.value,
            {
              id: `revert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              filename:
                typeof part.filename === 'string' && part.filename.trim() ? part.filename.trim() : filePartLabel(part),
              size: 0,
              mime: typeof part.mime === 'string' && part.mime.trim() ? part.mime.trim() : 'application/octet-stream',
              url: String(part.url),
            },
          ]
        }
      }
      await nextTick()
      getComposerTextareaEl(composerRef.value)?.focus()
    }

    // Ensure the view reflects the reverted state.
    await chat.refreshMessages(sid, { silent: true }).catch(() => {})
    await nextTick()
    scrollToBottom('auto')
    revertBusyMessageId.value = ''
  }

  return {
    copiedMessageId,
    revertBusyMessageId,
    handleCopyMessage,
    handleForkFromMessage,
    handleRevertFromMessage,
  }
}
