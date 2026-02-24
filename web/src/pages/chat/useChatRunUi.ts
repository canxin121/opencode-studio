import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AttachedFile } from './useChatAttachments'
import type { RenderBlock } from './useChatRenderBlocks'
import { i18n } from '@/i18n'
import { formatCompactNumber, formatCurrencyUSD, formatNumber, formatTimeHMS } from '@/i18n/intl'
import { resolveComposerPrimaryActions } from './composerPrimaryActions'

type ToastsStore = { push: (kind: 'success' | 'error', message: string) => void }

type ModelMetaLike = {
  limit?: {
    context?: number | null
  } | null
}

type ModelSelectionForUsage = {
  modelMetaFor: (providerID: string, modelID: string) => ModelMetaLike | null
  selectedProviderId: Ref<string>
  selectedModelId: Ref<string>
}

type SessionStatusLike = {
  type?: string
  attempt?: number
  message?: string
  next?: number
}

type ActivitySnapshotEntry = {
  type?: string
}

type Phase = 'idle' | 'busy' | 'cooldown'

type SessionUsage = {
  tokensValue?: number | null
  tokensLabel: string
  percentUsed: number | null
  costLabel: string
  modelLabel?: string
}

type RetryStatus = { type: 'retry'; attempt: number; message: string; next: number }

type TokenUsageLike = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number } | null
  cache_read?: number
  cache_write?: number
  cacheRead?: number
  cacheWrite?: number
}

type MessagePartLike = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
  text?: string
  content?: string
}

type MessageInfoLike = {
  role?: string
  id?: string
  cost?: number
  tokens?: TokenUsageLike | null
  providerID?: string
  modelID?: string
  finish?: string
  time?: { created?: number }
}

type MessageLike = {
  info?: MessageInfoLike
  parts?: MessagePartLike[]
}

type ChatLike = {
  selectedSessionId: string | null
  selectedSessionStatus?: { status?: SessionStatusLike | null } | null
  messages: MessageLike[]
  selectedAttention?: { kind?: string } | null
  abortSession: (sid: string) => Promise<boolean>
}

type ActivityLike = {
  snapshot?: Record<string, ActivitySnapshotEntry> | null
}

function formatClockTime(ms?: number): string {
  return formatTimeHMS(ms)
}

function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.ceil(ms / 1000)}s`
}

function numberOrZero(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function totalTokensFromUsage(tokens: TokenUsageLike | null | undefined): number | null {
  if (!tokens) return null

  const input = numberOrZero(tokens.input)
  const output = numberOrZero(tokens.output)
  const reasoning = numberOrZero(tokens.reasoning)

  const cacheRead = numberOrZero(tokens.cache?.read ?? tokens.cache_read ?? tokens.cacheRead)
  const cacheWrite = numberOrZero(tokens.cache?.write ?? tokens.cache_write ?? tokens.cacheWrite)

  const total = input + output + reasoning + cacheRead + cacheWrite
  return total > 0 ? total : null
}

function textFromMessageParts(parts: MessagePartLike[]): string {
  return (parts || [])
    .filter((p) => p?.type === 'text' && !p?.synthetic && !p?.ignored)
    .map((p) => (typeof p?.text === 'string' ? p.text : typeof p?.content === 'string' ? p.content : ''))
    .join('\n')
    .trim()
}

export function useChatRunUi(opts: {
  chat: ChatLike
  activity: ActivityLike
  toasts: ToastsStore
  modelSelection: ModelSelectionForUsage

  draft: Ref<string>
  attachedFiles: Ref<AttachedFile[]>
  sending: Ref<boolean>

  awaitingAssistant: Ref<boolean>
  pendingSendAt: Ref<number | null>
  renderBlocks: ComputedRef<RenderBlock[]>

  getRevertId: () => string
  onSend: () => Promise<void>
  collapseAllActivities: () => void
  activityAutoCollapseOnIdle: ComputedRef<boolean>
}) {
  const {
    chat,
    activity,
    toasts,
    modelSelection,
    draft,
    attachedFiles,
    sending,
    awaitingAssistant,
    pendingSendAt,
    renderBlocks,
    getRevertId,
    onSend,
    collapseAllActivities,
    activityAutoCollapseOnIdle,
  } = opts

  const sessionStatus = computed<SessionStatusLike | null>(() => chat.selectedSessionStatus?.status ?? null)
  const statusType = computed(() => {
    const ty = sessionStatus.value?.type
    return typeof ty === 'string' ? ty : ''
  })

  const currentPhase = computed<Phase>(() => {
    const sid = String(chat.selectedSessionId || '').trim()
    if (!sid) return 'idle'

    // session.status is authoritative; activity can be stale (missed SSE / background tab).
    if (statusType.value === 'idle') return 'idle'
    if (statusType.value === 'busy' || statusType.value === 'retry') return 'busy'

    const snapshot = activity.snapshot || {}
    const phaseRaw = snapshot[sid]?.type
    return phaseRaw === 'busy' || phaseRaw === 'cooldown' ? phaseRaw : 'idle'
  })

  const retryStatus = computed<RetryStatus | null>(() => {
    const s = sessionStatus.value
    if (!s || s.type !== 'retry') return null
    return {
      type: 'retry',
      attempt: typeof s.attempt === 'number' ? s.attempt : 0,
      message: typeof s.message === 'string' ? s.message : '',
      next: typeof s.next === 'number' ? s.next : 0,
    }
  })

  const retryNowMs = ref(Date.now())
  let retryTimer: number | null = null

  function stopRetryTimer() {
    if (retryTimer !== null) {
      window.clearInterval(retryTimer)
      retryTimer = null
    }
  }

  function startRetryTimer() {
    if (retryTimer !== null) return
    retryNowMs.value = Date.now()
    retryTimer = window.setInterval(() => {
      retryNowMs.value = Date.now()
    }, 200)
  }

  watch(
    () => retryStatus.value?.next,
    (next) => {
      if (typeof next === 'number' && Number.isFinite(next)) startRetryTimer()
      else stopRetryTimer()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopRetryTimer()
  })

  watch(
    () => statusType.value,
    (ty, prev) => {
      // Match OpenCode CLI semantics: session.idle means the run is complete.
      if (ty === 'idle') {
        awaitingAssistant.value = false
        pendingSendAt.value = null

        // Auto-collapse activity once the assistant finishes, so the chat stays readable.
        if (prev && prev !== 'idle' && activityAutoCollapseOnIdle.value) {
          collapseAllActivities()
        }
      }
    },
    { immediate: true },
  )

  const retryRemainingMs = computed(() => {
    const next = retryStatus.value?.next
    if (!next) return 0
    return Math.max(0, Math.round(next - retryNowMs.value))
  })

  const retryCountdownLabel = computed(() => formatCountdown(retryRemainingMs.value))
  const retryNextLabel = computed(() => formatClockTime(retryStatus.value?.next))

  const sessionUsage = computed<SessionUsage | null>(() => {
    const sid = chat.selectedSessionId
    if (!sid) return null

    const revertId = getRevertId()
    const list = Array.isArray(chat.messages) ? chat.messages : []

    let costTotal = 0
    let sawCost = false
    for (const m of list) {
      const info = m?.info
      if (!info) continue
      const role = String(info.role || '')
      if (role !== 'assistant') continue
      const mid = typeof info.id === 'string' ? info.id : ''
      if (revertId && mid && mid >= revertId) continue

      const cost = typeof info.cost === 'number' && Number.isFinite(info.cost) ? info.cost : null
      if (cost != null) {
        costTotal += cost
        sawCost = true
      }
    }

    let tokenTotal: number | null = null
    let providerID = ''
    let modelID = ''
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i]
      const info = m?.info
      if (!info) continue
      if (String(info.role || '') !== 'assistant') continue
      const mid = typeof info.id === 'string' ? info.id : ''
      if (revertId && mid && mid >= revertId) continue

      const total = totalTokensFromUsage(info.tokens)
      if (total != null) {
        tokenTotal = total
        providerID = typeof info.providerID === 'string' ? info.providerID.trim() : ''
        modelID = typeof info.modelID === 'string' ? info.modelID.trim() : ''
        break
      }
    }

    if (tokenTotal == null && !sawCost) return null

    const costLabel = formatCurrencyUSD(costTotal)

    let percentUsed: number | null = null
    if (tokenTotal != null && providerID && modelID) {
      const meta = modelSelection.modelMetaFor(providerID, modelID)
      const contextLimit = meta?.limit?.context
      const limit = typeof contextLimit === 'number' && Number.isFinite(contextLimit) ? contextLimit : 0
      if (limit > 0) {
        percentUsed = Math.round((tokenTotal / limit) * 100)
      }
    }

    return {
      tokensValue: tokenTotal,
      tokensLabel: tokenTotal != null ? formatNumber(tokenTotal) : '--',
      percentUsed,
      costLabel,
      modelLabel: providerID && modelID ? `${providerID}/${modelID}` : undefined,
    }
  })

  const hasStreamingAssistantText = computed(() => {
    const sid = chat.selectedSessionId
    if (!sid) return false

    const revertId = getRevertId()
    const cutoff = pendingSendAt.value ? pendingSendAt.value - 500 : null

    const list = Array.isArray(chat.messages) ? chat.messages : []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i]
      const info = m?.info
      if (!info) continue
      if (String(info.role) !== 'assistant') continue
      const mid = typeof info.id === 'string' ? String(info.id) : ''
      if (revertId && mid && mid >= revertId) continue
      const finish = typeof info.finish === 'string' ? info.finish.trim() : ''
      if (finish) continue
      const created = typeof info.time?.created === 'number' ? info.time.created : 0
      if (cutoff != null && created && created < cutoff) continue
      if (textFromMessageParts(Array.isArray(m.parts) ? m.parts : [])) return true
    }
    return false
  })

  const hasTailActivity = computed(() => {
    // If we already have visible activity rows at the end of the timeline, they are
    // a better "working" indicator than a separate assistant placeholder bubble.
    const blocks = renderBlocks.value
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const b = blocks[i]
      if (!b) continue
      if (b.kind === 'activity') {
        const parts = b.parts
        return Array.isArray(parts) && parts.length > 0
      }
      if (b.kind === 'message' || b.kind === 'revert') {
        return false
      }
    }
    return false
  })

  const showAssistantPlaceholder = computed(() => {
    if (!chat.selectedSessionId) return false
    if (chat.selectedAttention) return false
    // Retry already has a dedicated banner near the composer.
    if (retryStatus.value) return false
    // Don't show a second "working" indicator once we have streaming text.
    if (hasStreamingAssistantText.value) return false
    // If activity is visible, that *is* the working indicator.
    if (hasTailActivity.value) return false

    const phase = currentPhase.value
    const busyLike = phase === 'busy' || statusType.value === 'busy'
    return Boolean(awaitingAssistant.value || busyLike)
  })

  const sessionEnded = computed(() => {
    return statusType.value === 'idle'
  })

  const aborting = ref(false)
  const canAbort = computed(() => {
    if (!chat.selectedSessionId) return false
    return (
      aborting.value === false &&
      (currentPhase.value === 'busy' ||
        awaitingAssistant.value ||
        statusType.value === 'busy' ||
        statusType.value === 'retry')
    )
  })

  async function abortRun() {
    const sid = chat.selectedSessionId
    if (!sid) return
    aborting.value = true
    try {
      const ok = await chat.abortSession(sid)
      if (ok) {
        toasts.push('success', i18n.global.t('chat.toasts.abortedRun'))
      } else {
        toasts.push('error', i18n.global.t('chat.toasts.failedToAbortRun'))
      }
    } catch (err) {
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      aborting.value = false
    }
  }

  const canSend = computed(() => {
    if (!chat.selectedSessionId) return false
    if (sending.value) return false
    return Boolean(String(draft.value || '').trim() || attachedFiles.value.length > 0)
  })

  const composerActions = computed(() =>
    resolveComposerPrimaryActions({
      canAbort: canAbort.value,
      aborting: aborting.value,
      canSend: canSend.value,
      sending: sending.value,
    }),
  )

  const showComposerStopAction = computed(() => composerActions.value.showStop)
  const composerStopDisabled = computed(() => composerActions.value.stopDisabled)
  const composerPrimaryDisabled = computed(() => composerActions.value.sendDisabled)

  async function handleComposerPrimaryAction() {
    if (composerPrimaryDisabled.value) return
    await onSend()
  }

  async function handleComposerStopAction() {
    if (composerStopDisabled.value) return
    await abortRun()
  }

  return {
    currentPhase,
    sessionStatus,
    retryStatus,
    retryCountdownLabel,
    retryNextLabel,
    sessionUsage,
    formatCompactNumber,
    showAssistantPlaceholder,
    sessionEnded,
    aborting,
    canAbort,
    abortRun,
    showComposerStopAction,
    composerStopDisabled,
    composerPrimaryDisabled,
    handleComposerPrimaryAction,
    handleComposerStopAction,
  }
}
