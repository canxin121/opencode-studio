import { computed, ref, watch } from 'vue'

export type OptimisticUserMessage = {
  key: string
  sessionId: string
  createdAt: number
  status: 'sending' | 'sent'
  text: string
  files: Array<{ filename: string; mime: string; url?: string; serverPath?: string }>
  // Last user message id visible in the timeline when the send started.
  // Used to avoid falsely acknowledging against an older (updated) message.
  baselineUserMessageId: string
}

type MessagePartLike = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
  text?: string
  content?: string
  url?: string
  serverPath?: string
  filename?: string
  id?: string
}

type MessageInfoLike = {
  role?: string
  id?: string
  time?: { created?: number }
}

type MessageLike = {
  info?: MessageInfoLike
  parts?: MessagePartLike[]
}

function textFromMessageParts(parts: MessagePartLike[]): string {
  return (parts || [])
    .filter((p) => p?.type === 'text' && !p?.synthetic && !p?.ignored)
    .map((p) => (typeof p?.text === 'string' ? p.text : typeof p?.content === 'string' ? p.content : ''))
    .join('\n')
    .trim()
}

function filePartsFromMessageParts(parts: MessagePartLike[]): MessagePartLike[] {
  return (parts || []).filter((p) => {
    if (!p) return false
    if (p.type !== 'file') return false
    if (p.synthetic || p.ignored) return false
    const url = typeof p.url === 'string' ? p.url.trim() : ''
    const serverPath = typeof p.serverPath === 'string' ? p.serverPath.trim() : ''
    const filename = typeof p.filename === 'string' ? p.filename.trim() : ''
    return Boolean(url || serverPath || filename)
  })
}

function normalizeComparableText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function textsRoughlyMatch(a: string, b: string): boolean {
  const collapse = (s: string) => normalizeComparableText(s).replace(/\s+/g, ' ')
  const aa = collapse(a)
  const bb = collapse(b)
  if (!aa || !bb) return false
  if (aa === bb) return true
  // Allow partial matches to handle long messages or minor server normalization.
  return aa.startsWith(bb) || bb.startsWith(aa) || aa.includes(bb) || bb.includes(aa)
}

function assistantAppearedSince(messages: MessageLike[], cutoff: number): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info
    if (!info) continue
    if (String(info.role || '') !== 'assistant') continue
    const created = typeof info.time?.created === 'number' ? info.time.created : 0
    if (created && created >= cutoff) return true
  }
  return false
}

export function useMessageStreaming(opts: {
  selectedSessionId: { value: string | null }
  messages: { value: MessageLike[] }
  revertBoundaryId: { value: string | null }
}) {
  const awaitingAssistant = ref(false)
  const pendingSendAt = ref<number | null>(null)
  const optimisticUser = ref<OptimisticUserMessage | null>(null)

  const optimisticUserAcked = computed(() => {
    const opt = optimisticUser.value
    const sid = opts.selectedSessionId.value
    if (!opt || !sid || opt.sessionId !== sid) return false

    const revertId = (opts.revertBoundaryId.value || '').trim()
    const wantText = normalizeComparableText(opt.text || '')
    const wantFiles = Array.isArray(opt.files) ? opt.files : []
    const wantAnyFiles = wantFiles.length > 0
    const baseline = String(opt.baselineUserMessageId || '').trim()

    for (let i = opts.messages.value.length - 1; i >= 0; i -= 1) {
      const m = opts.messages.value[i]
      const info = m?.info
      if (!info) continue
      if (String(info.role) !== 'user') continue
      const mid = typeof info.id === 'string' ? String(info.id) : ''
      if (baseline && mid && mid <= baseline) continue
      if (revertId && mid && mid >= revertId) continue

      const gotText = normalizeComparableText(textFromMessageParts(Array.isArray(m.parts) ? m.parts : []))
      const gotFiles = filePartsFromMessageParts(Array.isArray(m.parts) ? m.parts : [])

      // Don't acknowledge info-only messages (message.updated without parts) yet.
      // Keeping the optimistic bubble visible avoids flicker while the assistant is working.
      const hasVisibleContent = Boolean(gotText) || gotFiles.length > 0
      if (!hasVisibleContent) continue

      // Only clear the optimistic bubble once the server message is at least as "complete"
      // as the send payload (text and/or attachments).
      const textOk = !wantText || (gotText && textsRoughlyMatch(wantText, gotText))
      const filesOk = !wantAnyFiles || gotFiles.length >= wantFiles.length
      if (textOk && filesOk) return true
    }
    return false
  })

  const showOptimisticUser = computed(() => {
    const opt = optimisticUser.value
    const sid = opts.selectedSessionId.value
    if (!opt || !sid || opt.sessionId !== sid) return false
    return !optimisticUserAcked.value
  })

  const lastMessageKey = computed(() => {
    const msgs = opts.messages.value
    const last = msgs[msgs.length - 1]
    if (!last) return ''
    const lastPart = Array.isArray(last.parts) ? last.parts[last.parts.length - 1] : null
    const textLen =
      typeof lastPart?.text === 'string'
        ? String(lastPart.text).length
        : typeof lastPart?.content === 'string'
          ? String(lastPart.content).length
          : 0
    return `${last.info?.id || ''}:${Array.isArray(last.parts) ? last.parts.length : 0}:${lastPart?.id || ''}:${textLen}`
  })

  function resetForSessionSwitch() {
    awaitingAssistant.value = false
    pendingSendAt.value = null
    optimisticUser.value = null
  }

  function beginOptimisticSend(args: {
    sessionId: string
    text: string
    files: Array<{ filename: string; mime: string; url?: string; serverPath?: string }>
  }) {
    const sid = (args.sessionId || '').trim()
    if (!sid) return

    const revertId = (opts.revertBoundaryId.value || '').trim()
    let baselineUserMessageId = ''
    for (let i = opts.messages.value.length - 1; i >= 0; i -= 1) {
      const m = opts.messages.value[i]
      const info = m?.info
      if (!info) continue
      if (String(info.role) !== 'user') continue
      const mid = typeof info.id === 'string' ? String(info.id) : ''
      if (!mid) continue
      if (revertId && mid >= revertId) continue
      baselineUserMessageId = mid
      break
    }

    const now = Date.now()
    optimisticUser.value = {
      key: `optimistic-user-${now}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: sid,
      createdAt: now,
      status: 'sending',
      text: args.text,
      files: args.files,
      baselineUserMessageId,
    }
    awaitingAssistant.value = true
    pendingSendAt.value = Date.now()
  }

  function markOptimisticSent(sessionId: string) {
    const sid = (sessionId || '').trim()
    if (!sid) return
    if (optimisticUser.value && optimisticUser.value.sessionId === sid) {
      optimisticUser.value = { ...optimisticUser.value, status: 'sent' }
    }
  }

  function clearOnSendFailure() {
    optimisticUser.value = null
    awaitingAssistant.value = false
    pendingSendAt.value = null
  }

  watch(
    () => opts.messages.value.length,
    () => {
      // Stop showing the assistant placeholder once we have a newer assistant turn.
      if (awaitingAssistant.value && pendingSendAt.value) {
        const cutoff = pendingSendAt.value - 500
        if (assistantAppearedSince(opts.messages.value, cutoff)) {
          awaitingAssistant.value = false
          pendingSendAt.value = null
        }
      }

      if (optimisticUserAcked.value) {
        optimisticUser.value = null
      }
    },
  )

  watch(
    () => lastMessageKey.value,
    () => {
      if (optimisticUserAcked.value) {
        optimisticUser.value = null
      }

      if (awaitingAssistant.value && pendingSendAt.value) {
        const cutoff = pendingSendAt.value - 500
        if (assistantAppearedSince(opts.messages.value, cutoff)) {
          awaitingAssistant.value = false
          pendingSendAt.value = null
        }
      }
    },
  )

  return {
    awaitingAssistant,
    pendingSendAt,
    optimisticUser,
    optimisticUserAcked,
    showOptimisticUser,
    resetForSessionSwitch,
    beginOptimisticSend,
    markOptimisticSent,
    clearOnSendFailure,
  }
}
