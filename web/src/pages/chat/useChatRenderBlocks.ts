import { computed, ref, type ComputedRef } from 'vue'

import {
  DEFAULT_CHAT_ACTIVITY_FILTERS,
  DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS,
  isKnownChatToolActivityType,
  normalizeChatActivityFilters,
  normalizeChatToolActivityFilters,
  type ChatActivityType,
  type ChatToolActivityType,
} from '@/lib/chatActivity'
import { hasDisplayableAssistantError } from './assistantError'

type RenderValue = unknown
type UnknownRecord = Record<string, RenderValue>

export type ChatPart = {
  id?: string
  type?: string
  tool?: string
  state?: UnknownRecord | null
  synthetic?: boolean
  ignored?: boolean
  text?: string
  content?: string
  time?: { start?: number; end?: number } | null
}

export type ChatMessage = {
  info: {
    id?: string
    role?: string
    time?: { created?: number }
    finish?: string
    error?: RenderValue
    agent?: string
    modelID?: string
  }
  parts: ChatPart[]
}

export type RevertStateLike = {
  messageID: string
  revertedUserCount?: number
  diffFiles?: Array<{ filename?: string; additions?: number; deletions?: number }>
}

type ActivityBlock = {
  kind: 'activity'
  key: string
  parts: ChatPart[]
  fromId: string | null
  toId: string | null
  timeLabel: string
}

type MessageBlock = {
  kind: 'message'
  key: string
  message: ChatMessage
  textParts: ChatPart[]
}

type RevertBlock = {
  kind: 'revert'
  key: string
  revert: RevertMarker
}

export type RenderBlock = ActivityBlock | MessageBlock | RevertBlock

type ChatLike = {
  messages: ChatMessage[]
}

type RevertMarker = {
  messageID: string
  revertedUserCount: number
  diffFiles: Array<{ filename: string; additions: number; deletions: number }>
}

type SettingsLike = {
  data?: RenderValue
}

const CHAT_ACTIVITY_TYPES = new Set<string>(DEFAULT_CHAT_ACTIVITY_FILTERS)

function isRecord(value: RenderValue): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: RenderValue): UnknownRecord {
  return isRecord(value) ? value : {}
}

function isChatPart(value: RenderValue): value is ChatPart {
  if (!isRecord(value)) return false
  const type = value.type
  const tool = value.tool
  if (type !== undefined && typeof type !== 'string') return false
  if (tool !== undefined && typeof tool !== 'string') return false
  return true
}

function isChatActivityType(value: string): value is ChatActivityType {
  return CHAT_ACTIVITY_TYPES.has(value)
}

function asParts(value: RenderValue): ChatPart[] {
  if (!Array.isArray(value)) return []
  return value.filter((part): part is ChatPart => isChatPart(part))
}

function normalizeRevertState(input: RevertStateLike | null): RevertMarker | null {
  if (!input) return null
  const messageID = String(input.messageID || '').trim()
  if (!messageID) return null

  const revertedUserCount = Number.isFinite(input.revertedUserCount)
    ? Math.max(0, Math.floor(Number(input.revertedUserCount)))
    : 0

  const diffFiles = Array.isArray(input.diffFiles)
    ? input.diffFiles
        .map((row) => {
          const filename = String(row?.filename || '').trim()
          if (!filename) return null
          const additions = Number.isFinite(row?.additions) ? Math.max(0, Math.floor(Number(row?.additions))) : 0
          const deletions = Number.isFinite(row?.deletions) ? Math.max(0, Math.floor(Number(row?.deletions))) : 0
          return { filename, additions, deletions }
        })
        .filter((row): row is { filename: string; additions: number; deletions: number } => Boolean(row))
    : []

  return { messageID, revertedUserCount, diffFiles }
}

export function useChatRenderBlocks(opts: {
  chat: ChatLike
  settings: SettingsLike
  showThinking: ComputedRef<boolean>
  showJustification: ComputedRef<boolean>
  revertState: ComputedRef<RevertStateLike | null>
  formatTime: (ms?: number) => string
}) {
  const { chat, settings, showThinking, showJustification, revertState, formatTime } = opts

  const settingsData = computed<UnknownRecord>(() => asRecord(settings.data))

  const chatActivityFilters = computed<ChatActivityType[]>(() => {
    const s = settingsData.value
    if (Object.prototype.hasOwnProperty.call(s, 'chatActivityFilters')) {
      return normalizeChatActivityFilters(s.chatActivityFilters)
    }
    return DEFAULT_CHAT_ACTIVITY_FILTERS
  })

  const chatToolActivityFilters = computed<ChatToolActivityType[]>(() => {
    const s = settingsData.value
    if (Object.prototype.hasOwnProperty.call(s, 'chatActivityToolFilters')) {
      return normalizeChatToolActivityFilters(s.chatActivityToolFilters)
    }
    return DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS
  })

  const toolFiltersExplicit = computed(() => {
    const s = settingsData.value
    return Boolean(Object.prototype.hasOwnProperty.call(s, 'chatActivityToolFilters'))
  })

  const toolFilterSet = computed(() => {
    const set = new Set<string>()
    for (const raw of chatToolActivityFilters.value || []) {
      const key = String(raw || '')
        .trim()
        .toLowerCase()
      if (!key) continue
      set.add(key)
    }
    return set
  })

  function activityEnabled(id: ChatActivityType): boolean {
    return chatActivityFilters.value.includes(id)
  }

  function toolActivityEnabled(id: string): boolean {
    const key = id.trim().toLowerCase()
    if (!key) {
      if (!toolFiltersExplicit.value) return true
      return toolFilterSet.value.has('unknown')
    }
    if (!toolFiltersExplicit.value) return true
    if (toolFilterSet.value.has(key)) return true
    if (isKnownChatToolActivityType(key)) return false
    return toolFilterSet.value.has('unknown')
  }

  function isReasoningPart(part: ChatPart): boolean {
    const t = String(part?.type || '').toLowerCase()
    return t === 'reasoning' || t === 'thinking' || t === 'reasoning_content' || t === 'reasoning_details'
  }

  function isJustificationPart(part: ChatPart): boolean {
    const t = String(part?.type || '').toLowerCase()
    return t === 'justification'
  }

  function hasReasoningText(part: ChatPart): boolean {
    const raw = typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : ''
    return Boolean(raw && raw.trim())
  }

  function isMetaPart(part: ChatPart): boolean {
    const t = String(part?.type || '').toLowerCase()
    return t === 'snapshot' || t === 'patch' || t === 'retry' || t === 'compaction'
  }

  function getRenderableActivityParts(parts: ChatPart[]): ChatPart[] {
    return (parts || []).filter((p) => {
      const t = String(p?.type || '').toLowerCase()
      if (t === 'tool') {
        if (!activityEnabled('tool')) return false
        const toolId = typeof p?.tool === 'string' ? p.tool : ''
        return toolActivityEnabled(toolId)
      }
      if (t === 'snapshot' || t === 'patch' || t === 'retry' || t === 'compaction') {
        if (!isChatActivityType(t)) return false
        return activityEnabled(t)
      }
      // Some upstream tool parts may omit `type` but still carry tool/state.
      if (!t && typeof p?.tool === 'string' && p?.state) {
        if (!activityEnabled('tool')) return false
        return toolActivityEnabled(p.tool)
      }
      if (isReasoningPart(p)) {
        return showThinking.value && hasReasoningText(p)
      }
      if (isJustificationPart(p)) {
        return showJustification.value && hasReasoningText(p)
      }
      return false
    })
  }

  const MAX_VISIBLE_ACTIVITY_COLLAPSED = 6
  const activityExpandedByBlockKey = ref<Record<string, boolean>>({})

  // Used to force-close all Tool/Meta/Reasoning invocations.
  const activityCollapseSignal = ref(0)

  function collapseAllActivities() {
    activityCollapseSignal.value += 1
  }

  function isActivityExpanded(blockKey: string): boolean {
    return Boolean(activityExpandedByBlockKey.value[blockKey])
  }

  function setActivityExpanded(blockKey: string, expanded: boolean) {
    const next = { ...activityExpandedByBlockKey.value }
    next[blockKey] = expanded
    activityExpandedByBlockKey.value = next
  }

  function activityTimeLabelFromParts(parts: ChatPart[]): string {
    let minStart: number | null = null
    let maxEnd: number | null = null

    for (const p of parts || []) {
      const directTime = asRecord(p?.time)
      const stateTime = asRecord(asRecord(p?.state).time)
      const start =
        typeof directTime.start === 'number'
          ? directTime.start
          : typeof stateTime.start === 'number'
            ? stateTime.start
            : null
      const end =
        typeof directTime.end === 'number' ? directTime.end : typeof stateTime.end === 'number' ? stateTime.end : null
      if (start != null) {
        minStart = minStart == null ? start : Math.min(minStart, start)
      }
      if (end != null) {
        maxEnd = maxEnd == null ? end : Math.max(maxEnd, end)
      }
    }
    const at = maxEnd ?? minStart
    if (!at) return ''
    return formatTime(at)
  }

  function getTextParts(parts: ChatPart[]): ChatPart[] {
    const out: ChatPart[] = []
    for (const p of parts || []) {
      if (!p) continue
      if (p.type !== 'text') continue
      if (p.synthetic || p.ignored) continue
      const raw = typeof p.text === 'string' ? p.text : typeof p.content === 'string' ? p.content : ''
      if (!String(raw || '').trim()) continue
      // Ensure MessageItem can always render `p.text`.
      if (typeof p.text === 'string') out.push(p)
      else out.push({ ...p, text: String(raw) })
    }
    return out
  }

  function hasRenderableFileParts(parts: ChatPart[]): boolean {
    for (const p of parts || []) {
      if (!p) continue
      if (p.type !== 'file') continue
      if (p.synthetic || p.ignored) continue
      return true
    }
    return false
  }

  const renderBlocks = computed<RenderBlock[]>(() => {
    const blocks: RenderBlock[] = []
    let pendingActivity: ChatPart[] = []
    let fromId: string | null = null
    let lastTextId: string | null = null

    const revert = normalizeRevertState(revertState.value)
    const revertId = revert?.messageID || ''
    let insertedRevert = false

    const flushActivity = (toId: string | null) => {
      if (pendingActivity.length === 0) return
      // Keep key stable so activity rows can animate smoothly.
      const key = `activity:${fromId || 'start'}:${toId || 'end'}`
      blocks.push({
        kind: 'activity',
        key,
        parts: pendingActivity,
        fromId,
        toId,
        timeLabel: activityTimeLabelFromParts(pendingActivity),
      })
      pendingActivity = []
    }

    for (const m of chat.messages || []) {
      const id = typeof m?.info?.id === 'string' ? m.info.id : ''
      const parts = asParts(m?.parts)

      // Hide messages at/after the revert boundary (OpenCode TUI parity) and show
      // a marker instead.
      if (revert && revertId && !insertedRevert && id && id >= revertId) {
        flushActivity(revertId)
        blocks.push({ kind: 'revert', key: `revert:${revertId}`, revert })
        insertedRevert = true
        break
      }

      const textParts = getTextParts(parts)
      const activityParts = getRenderableActivityParts(parts)
      const hasFiles = hasRenderableFileParts(parts)
      const hasError = hasDisplayableAssistantError(m?.info)

      if (textParts.length > 0 || hasFiles || hasError) {
        // We reached the next text message: flush the activity between the last text and this one.
        flushActivity(id || null)
        blocks.push({ kind: 'message', key: `msg:${id || blocks.length}`, message: m, textParts })
        lastTextId = id || lastTextId
        fromId = lastTextId

        // Activity that belongs to this message lives between this message and the next text message.
        if (activityParts.length > 0) {
          pendingActivity.push(...activityParts)
        }
      } else {
        // Tool-only / reasoning-only messages: merge them into the between-message activity group.
        if (activityParts.length > 0) {
          // If we haven't seen a text message yet, treat this as activity at the start.
          if (!fromId) fromId = lastTextId
          pendingActivity.push(...activityParts)
        }
      }
    }

    // If the revert boundary isn't in the loaded window, still show a marker.
    if (revertId && !insertedRevert && revert) {
      flushActivity(revertId)
      blocks.push({ kind: 'revert', key: `revert:${revertId}`, revert })
      insertedRevert = true
    }

    flushActivity(null)
    return blocks
  })

  return {
    renderBlocks,
    getTextParts,
    isReasoningPart,
    isJustificationPart,
    isMetaPart,
    MAX_VISIBLE_ACTIVITY_COLLAPSED,
    activityExpandedByBlockKey,
    activityCollapseSignal,
    collapseAllActivities,
    isActivityExpanded,
    setActivityExpanded,
  }
}
