import type { JsonValue as JsonLike } from '@/types/json'

import { apiUrl } from './api'
import { readActiveUiAuthToken } from './uiAuthToken'
import { advanceSseCursor } from './sse'
import type { SseClient, SseClientOptions, SseClientStats, SseEvent } from './sse'

type UnknownRecord = Record<string, JsonLike>

function isRecord(value: JsonLike): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function getRecord(value: JsonLike, key: string): UnknownRecord | null {
  if (!isRecord(value)) return null
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function getString(value: JsonLike, key: string): string {
  if (!isRecord(value)) return ''
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : ''
}

function parsePositiveSeq(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw)
  }
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function toWsUrl(baseHttpUrl: string, opts?: { cursor?: string; directory?: string | null; token?: string }): string {
  const url = new URL(baseHttpUrl)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'

  const cursor = typeof opts?.cursor === 'string' ? opts.cursor.trim() : ''
  if (cursor) {
    url.searchParams.set('cursor', cursor)
  }

  const directory = typeof opts?.directory === 'string' ? opts.directory.trim() : ''
  if (directory) {
    url.searchParams.set('directory', directory)
  }

  const token = typeof opts?.token === 'string' ? opts.token.trim() : ''
  if (token) {
    url.searchParams.set('uiAuthToken', token)
  }

  return url.toString()
}

export function connectGlobalWs(opts: SseClientOptions): SseClient {
  const endpoint = (opts.endpoint || '/api/global/ws').trim() || '/api/global/ws'
  const baseHttpUrl = apiUrl(endpoint)
  const dir = typeof opts.directory === 'string' ? opts.directory.trim() : ''

  const label = (opts.debugLabel || '').trim() || 'ws:global'
  const dev = Boolean(import.meta.env && import.meta.env.DEV)
  const debugEnabled = dev && (opts.debug === true || Boolean(opts.debugLabel))
  let lastDebugAt = 0
  function debugLog(message: string, data?: unknown, optsLog?: { force?: boolean }) {
    if (!debugEnabled) return
    const now = Date.now()
    if (!optsLog?.force && now - lastDebugAt < 15000) return
    lastDebugAt = now
    try {
      if (data !== undefined) console.debug(`[${label}] ${message}`, data)
      else console.debug(`[${label}] ${message}`)
    } catch {
      // ignore
    }
  }

  let closed = false
  let reconnectTimer: number | null = null
  let activeSocket: WebSocket | null = null
  let lastEventId: string | undefined =
    typeof opts.initialLastEventId === 'string' && opts.initialLastEventId.trim()
      ? opts.initialLastEventId.trim()
      : undefined
  let retryDelay = 1000
  let attempt = 0

  const stats: SseClientStats = {
    label,
    url: toWsUrl(baseHttpUrl, { cursor: lastEventId, directory: dir, token: readActiveUiAuthToken() }),
    startedAt: Date.now(),
    lastChunkAt: 0,
    lastEventAt: 0,
    lastCursor: lastEventId || null,
    connectCount: 0,
    reconnectCount: 0,
    errorCount: 0,
    stallCount: 0,
    lastBackoffMs: 0,
    lastErrorAt: 0,
    lastErrorMessage: '',
  }

  const queue: Array<SseEvent | undefined> = []
  const coalesced = new Map<string, number>()
  let flushTimer: number | null = null
  let lastFlushAt = 0

  function eventKey(evt: SseEvent): string | null {
    const directory = getString(evt, 'directory') || opts.directory || 'global'
    if (evt.type === 'session.status') {
      const sid = getString(evt.properties, 'sessionID')
      return sid ? `session.status:${directory}:${String(sid)}` : null
    }
    if (evt.type === 'opencode-studio:session-activity') {
      const sid = getString(evt.properties, 'sessionID')
      return sid ? `opencode-studio:session-activity:${directory}:${String(sid)}` : null
    }
    if (evt.type === 'message.part.updated') {
      const props = isRecord(evt.properties) ? evt.properties : {}
      const part = getRecord(props, 'part')
      const mid = getString(part, 'messageID') || getString(props, 'messageID')
      const pid = getString(part, 'id') || getString(part, 'partID') || getString(props, 'partID')
      const sid = getString(part, 'sessionID') || getString(props, 'sessionID')
      if (!mid || !pid) return null
      const sessionKey = sid ? `:${String(sid)}` : ''
      return `message.part.updated:${directory}${sessionKey}:${String(mid)}:${String(pid)}`
    }
    if (evt.type === 'chat-sidebar.state') {
      return `chat-sidebar.state:${directory}`
    }
    if (evt.type === 'chat-sidebar.patch') {
      return `chat-sidebar.patch:${directory}`
    }
    return null
  }

  function mergeEvent(prev: SseEvent, next: SseEvent): SseEvent {
    if (prev.type !== next.type) return next

    if (next.type === 'session.status' || next.type === 'opencode-studio:session-activity') {
      return next
    }

    if (next.type === 'message.part.updated') {
      const prevProps = isRecord(prev.properties) ? prev.properties : {}
      const nextProps = isRecord(next.properties) ? next.properties : {}
      const prevPart = getRecord(prevProps, 'part') || {}
      const nextPart = getRecord(nextProps, 'part') || {}
      const mergedPart = {
        ...prevPart,
        ...nextPart,
      }
      const prevDelta = getString(prevProps, 'delta')
      const nextDelta = getString(nextProps, 'delta')

      const merged: SseEvent = {
        ...prev,
        ...next,
        properties: {
          ...prevProps,
          ...nextProps,
          part: mergedPart,
        },
      }
      if (prevDelta || nextDelta) {
        if (!isRecord(merged.properties)) merged.properties = {}
        merged.properties.delta = `${prevDelta}${nextDelta}`
      }
      return merged
    }

    return next
  }

  function flush() {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer)
      flushTimer = null
    }
    if (queue.length === 0) return

    const events = queue.splice(0, queue.length)
    coalesced.clear()
    lastFlushAt = Date.now()

    for (const evt of events) {
      if (!evt) continue
      stats.lastEventAt = Date.now()
      opts.onEvent(evt)
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null) return
    const elapsed = Date.now() - lastFlushAt
    flushTimer = window.setTimeout(flush, Math.max(0, 16 - elapsed))
  }

  function pushEvent(evt: SseEvent) {
    const key = eventKey(evt)
    if (key) {
      const idx = coalesced.get(key)
      if (idx !== undefined) {
        const prev = queue[idx]
        queue[idx] = prev ? mergeEvent(prev, evt) : evt
      } else {
        coalesced.set(key, queue.length)
        queue.push(evt)
      }
    } else {
      queue.push(evt)
    }
    scheduleFlush()
  }

  function normalizeAndQueue(raw: JsonLike, meta?: { directory?: string; lastEventId?: string }) {
    if (!isRecord(raw)) return

    let evt: UnknownRecord = raw
    if (typeof raw.type !== 'string') {
      const payload = raw.payload
      if (isRecord(payload) && typeof payload.type === 'string') {
        evt = payload
        const wrapperDir = getString(raw, 'directory').trim()
        if (wrapperDir && !('directory' in evt)) {
          evt.directory = wrapperDir
        }
      } else {
        return
      }
    }

    const directory =
      typeof evt.directory === 'string'
        ? String(evt.directory)
        : typeof meta?.directory === 'string' && meta.directory.trim()
          ? meta.directory
          : typeof opts.directory === 'string' && opts.directory.trim()
            ? opts.directory
            : undefined
    if (directory && !('directory' in evt)) {
      evt.directory = directory
    }
    if (typeof meta?.lastEventId === 'string' && meta.lastEventId) {
      evt.lastEventId = meta.lastEventId
    }
    if (typeof evt.type !== 'string') return
    pushEvent(evt as SseEvent)
  }

  function scheduleReconnect() {
    if (closed) return
    if (opts.autoReconnect === false) {
      closed = true
      return
    }
    const backoff = Math.min(retryDelay * 2 ** Math.max(0, attempt - 1), 30000)
    stats.lastBackoffMs = backoff
    stats.reconnectCount += 1
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoff)
  }

  function handleSocketMessage(rawData: unknown) {
    if (typeof rawData !== 'string') return

    let parsed: JsonLike
    try {
      parsed = JSON.parse(rawData)
    } catch {
      return
    }
    if (!isRecord(parsed)) return

    const seq = parsePositiveSeq(parsed.seq)
    let seenId: string | undefined
    if (seq !== null) {
      const transition = advanceSseCursor(lastEventId, String(seq))
      if (!transition.accepted) {
        return
      }
      if (transition.gap) {
        opts.onSequenceGap?.(transition.gap)
      }
      if (transition.nextCursor) {
        lastEventId = transition.nextCursor
        stats.lastCursor = transition.nextCursor
        opts.onCursor?.(transition.nextCursor)
        seenId = transition.nextCursor
      }
    }

    const payload = parsed.payload
    normalizeAndQueue(payload ?? parsed, { directory: opts.directory ?? undefined, lastEventId: seenId })
  }

  function connect() {
    if (closed) return
    attempt += 1

    const token = readActiveUiAuthToken()
    const wsUrl = toWsUrl(baseHttpUrl, {
      cursor: lastEventId,
      directory: dir,
      token,
    })
    stats.url = wsUrl

    debugLog('connect attempt', { attempt, lastEventId: lastEventId || '' })

    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
    } catch (err) {
      const nextError: Error | string = err instanceof Error ? err : String(err)
      stats.errorCount += 1
      stats.lastErrorAt = Date.now()
      stats.lastErrorMessage = nextError instanceof Error ? nextError.message : String(nextError)
      opts.onError?.(nextError)
      scheduleReconnect()
      return
    }

    activeSocket = socket

    socket.onopen = () => {
      if (closed || activeSocket !== socket) return
      stats.connectCount += 1
      attempt = 0
      debugLog('connected', { lastEventId: lastEventId || '' }, { force: true })
    }

    socket.onmessage = (evt) => {
      if (closed || activeSocket !== socket) return
      const now = Date.now()
      stats.lastChunkAt = now
      handleSocketMessage(evt.data)
    }

    socket.onerror = () => {
      // Most browsers surface meaningful details only on close.
    }

    socket.onclose = (evt) => {
      if (activeSocket === socket) {
        activeSocket = null
      }
      flush()
      if (closed) return

      const reason = evt.reason?.trim() || `WebSocket closed (${evt.code || 0})`
      const nextError = new Error(reason)
      stats.errorCount += 1
      stats.lastErrorAt = Date.now()
      stats.lastErrorMessage = nextError.message
      opts.onError?.(nextError)

      debugLog('closed', { code: evt.code, reason: evt.reason || '' }, { force: true })
      scheduleReconnect()
    }
  }

  connect()

  return {
    close: () => {
      closed = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const socket = activeSocket
      activeSocket = null
      if (socket) {
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
      flush()
    },
    getStats: () => {
      return {
        ...stats,
        lastCursor: typeof lastEventId === 'string' && lastEventId.trim() ? lastEventId.trim() : stats.lastCursor,
      }
    },
  }
}
