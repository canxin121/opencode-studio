import type { Ref } from 'vue'
import type { AttentionEvent, SessionStatus, SessionStatusEvent } from '@/types/chat'
import type { JsonObject, JsonValue } from '@/types/json'

import * as chatApi from './api'

function asRecord(value: JsonValue): JsonObject {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : {}
}

function promptSessionId(value: JsonObject): string {
  const raw = asRecord(value).sessionID
  return typeof raw === 'string' ? raw : ''
}

function promptId(value: JsonObject): string {
  const raw = asRecord(value).id
  return typeof raw === 'string' ? raw : ''
}

export async function refreshAttentionForSession(opts: {
  sessionId: string
  getDirectoryForSession: (sessionId: string) => string | null
  attentionBySession: Ref<Record<string, AttentionEvent>>
  sessionStatusBySession: Ref<Record<string, SessionStatusEvent>>
}): Promise<void> {
  const sid = (opts.sessionId || '').trim()
  if (!sid) return

  // Only surface prompts when the session is actively running.
  // OpenCode's /session/status returns only non-idle sessions.
  const statusMap = await chatApi
    .listSessionStatus(opts.getDirectoryForSession(sid), { sessionId: sid })
    .catch(() => null)
  if (statusMap && typeof statusMap === 'object' && !Array.isArray(statusMap)) {
    const statusRecord = asRecord(statusMap)
    const rawStatus = asRecord(statusRecord[sid])
    const now = Date.now()

    if (!Object.prototype.hasOwnProperty.call(statusMap, sid)) {
      // Record as idle so the UI can mark any pending activity as stopped.
      opts.sessionStatusBySession.value = {
        ...opts.sessionStatusBySession.value,
        [sid]: {
          at: now,
          payload: { type: 'session.status', properties: { sessionID: sid, status: { type: 'idle' } } },
          status: { type: 'idle' },
        },
      }

      // Session is idle; clear any stale UI prompt.
      if (opts.attentionBySession.value[sid]) {
        const nextMap = { ...opts.attentionBySession.value }
        delete nextMap[sid]
        opts.attentionBySession.value = nextMap
      }
      return
    }

    // Session is active; keep a best-effort status snapshot.
    const ty = typeof rawStatus?.type === 'string' ? rawStatus.type : ''
    const parsed: SessionStatus | null = (() => {
      if (ty === 'busy') return { type: 'busy' }
      if (ty === 'retry') {
        const attempt = Number(rawStatus?.attempt)
        const message = typeof rawStatus?.message === 'string' ? rawStatus.message : ''
        const next = Number(rawStatus?.next)
        if (Number.isFinite(attempt) && Number.isFinite(next)) {
          return { type: 'retry', attempt, message, next }
        }
      }
      return null
    })()
    if (parsed) {
      opts.sessionStatusBySession.value = {
        ...opts.sessionStatusBySession.value,
        [sid]: {
          at: now,
          payload: { type: 'session.status', properties: { sessionID: sid, status: parsed } },
          status: parsed,
        },
      }
    }
  }

  const dir = opts.getDirectoryForSession(sid)
  const [permissions, questions] = await Promise.all([
    chatApi.listPermissions(dir, { sessionId: sid }).catch(() => []),
    chatApi.listQuestions(dir, { sessionId: sid }).catch(() => []),
  ])

  const perList = (Array.isArray(permissions) ? permissions : [])
    .filter((p) => promptSessionId(p) === sid)
    .sort((a, b) => promptId(a).localeCompare(promptId(b)))
  const per = perList.length ? perList[perList.length - 1] : null

  const queList = (Array.isArray(questions) ? questions : [])
    .filter((p) => promptSessionId(p) === sid)
    .sort((a, b) => promptId(a).localeCompare(promptId(b)))
  const que = queList.length ? queList[queList.length - 1] : null

  let next: AttentionEvent | null = null
  if (per) {
    next = {
      kind: 'permission',
      at: Date.now(),
      payload: { type: 'permission.asked', properties: asRecord(per) },
    }
  } else if (que) {
    next = {
      kind: 'question',
      at: Date.now(),
      payload: { type: 'question.asked', properties: asRecord(que) },
    }
  }

  if (next) {
    opts.attentionBySession.value = { ...opts.attentionBySession.value, [sid]: next }
  } else {
    // Clear stale UI after reload.
    if (opts.attentionBySession.value[sid]) {
      const nextMap = { ...opts.attentionBySession.value }
      delete nextMap[sid]
      opts.attentionBySession.value = nextMap
    }
  }
}
