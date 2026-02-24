import { computed, type ComputedRef, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatTranscript } from '@/lib/transcript'
import type { JsonObject, JsonValue } from '@/types/json'

function asRecord(value: JsonValue): JsonObject {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : {}
}

type ModelSelectionForSessionActions = {
  shareDisabled: Ref<boolean>
  selectedProviderId: Ref<string>
  selectedModelId: Ref<string>
  effectiveDefaults: Ref<{ provider?: string; model?: string }>
}

type ToastKind = 'info' | 'success' | 'error'

type ToastsLike = {
  push: (kind: ToastKind, message: string, timeoutMs?: number) => void
}

type SessionLike = {
  id: string
  time?: { created?: number; updated?: number }
}

type ChatLike = {
  selectedSessionId: string | null
  selectedSession: SessionLike | null
  messages: JsonValue[]
  renameSession: (sessionId: string, title: string) => Promise<JsonValue>
  shareSession: (sessionId: string) => Promise<JsonValue>
  unshareSession: (sessionId: string) => Promise<JsonValue>
  summarizeSession: (sessionId: string, provider: string, model: string) => Promise<JsonValue>
}

export function useChatSessionActions(opts: {
  chat: ChatLike
  toasts: ToastsLike

  sessionTitle: ComputedRef<string>
  sessionShareUrl: ComputedRef<string>
  showThinking: Ref<boolean>
  showJustification: Ref<boolean>

  modelSelection: ModelSelectionForSessionActions

  copyToClipboard: (text: string) => Promise<void>
}) {
  const { t } = useI18n()

  const {
    chat,
    toasts,
    sessionTitle,
    sessionShareUrl,
    showThinking,
    showJustification,
    modelSelection,
    copyToClipboard,
  } = opts

  const renameDialogOpen = ref(false)
  const renameDraft = ref('')
  const renameBusy = ref(false)

  const shareBusy = ref(false)
  const unshareBusy = ref(false)
  const compactBusy = ref(false)

  function openRenameDialog() {
    renameDraft.value = sessionTitle.value || ''
    renameDialogOpen.value = true
  }

  async function saveRename() {
    const sid = chat.selectedSessionId
    const next = renameDraft.value.trim()
    if (!sid) return
    if (!next) {
      toasts.push('error', t('chat.toasts.titleCannotBeEmpty'))
      return
    }
    renameBusy.value = true
    try {
      await chat.renameSession(sid, next)
      renameDialogOpen.value = false
      toasts.push('success', t('chat.toasts.sessionRenamed'))
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      renameBusy.value = false
    }
  }

  const includeThinking = computed(() => Boolean(showThinking.value || showJustification.value))

  function buildTranscriptText(): string {
    const session = chat.selectedSession
    if (!session || !chat.messages?.length) return ''
    return formatTranscript(
      {
        id: session.id,
        title: sessionTitle.value || session.id,
        time: session.time,
      },
      (Array.isArray(chat.messages) ? chat.messages : []).map((m: JsonValue) => {
        const msg = asRecord(m)
        const info = asRecord(msg.info)
        const parts = Array.isArray(msg.parts) ? msg.parts : []
        return { info, parts }
      }),
      {
        thinking: includeThinking.value,
        toolDetails: false,
        assistantMetadata: true,
      },
    )
  }

  async function copyTranscript() {
    const text = buildTranscriptText()
    if (!text) {
      toasts.push('error', t('chat.toasts.noTranscriptAvailable'))
      return
    }
    try {
      await copyToClipboard(text)
      toasts.push('success', t('chat.toasts.transcriptCopied'))
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : t('common.copyFailed'))
    }
  }

  function downloadTranscript(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function exportTranscript() {
    const text = buildTranscriptText()
    if (!text) {
      toasts.push('error', t('chat.toasts.noTranscriptAvailable'))
      return
    }
    const sid = chat.selectedSessionId || 'session'
    const filename = `session-${String(sid).slice(0, 8)}.md`
    downloadTranscript(filename, text)
    toasts.push('success', t('chat.toasts.transcriptExportedAs', { filename }))
  }

  async function handleShareSession() {
    const sid = chat.selectedSessionId
    if (!sid) return
    if (modelSelection.shareDisabled.value) {
      toasts.push('error', t('chat.toasts.sharingDisabledInConfig'))
      return
    }
    shareBusy.value = true
    try {
      const updated = await chat.shareSession(sid)
      const share = asRecord(asRecord(updated).share)
      const url = typeof share.url === 'string' ? share.url : sessionShareUrl.value
      if (url) {
        await copyToClipboard(url)
        toasts.push('success', t('chat.toasts.shareLinkCopied'))
      } else {
        toasts.push('success', t('chat.toasts.sessionShared'))
      }
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      shareBusy.value = false
    }
  }

  async function copyShareLink() {
    if (!sessionShareUrl.value) return
    try {
      await copyToClipboard(sessionShareUrl.value)
      toasts.push('success', t('chat.toasts.shareLinkCopied'))
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : t('common.copyFailed'))
    }
  }

  function openShareLink() {
    if (!sessionShareUrl.value) return
    window.open(sessionShareUrl.value, '_blank')
  }

  async function handleUnshareSession() {
    const sid = chat.selectedSessionId
    if (!sid) return
    unshareBusy.value = true
    try {
      await chat.unshareSession(sid)
      toasts.push('success', t('chat.toasts.sessionUnshared'))
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      unshareBusy.value = false
    }
  }

  async function handleCompactSession() {
    const sid = chat.selectedSessionId
    if (!sid) return
    const provider = (
      modelSelection.selectedProviderId.value ||
      modelSelection.effectiveDefaults.value.provider ||
      ''
    ).trim()
    const model = (modelSelection.selectedModelId.value || modelSelection.effectiveDefaults.value.model || '').trim()
    if (!provider || !model) {
      toasts.push('error', t('chat.toasts.selectModelToCompact'))
      return
    }
    compactBusy.value = true
    try {
      await chat.summarizeSession(sid, provider, model)
      toasts.push('success', t('chat.toasts.compactionStarted'))
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      compactBusy.value = false
    }
  }

  return {
    renameDialogOpen,
    renameDraft,
    renameBusy,
    shareBusy,
    unshareBusy,
    compactBusy,
    openRenameDialog,
    saveRename,
    copyTranscript,
    exportTranscript,
    handleShareSession,
    copyShareLink,
    openShareLink,
    handleUnshareSession,
    handleCompactSession,
  }
}
