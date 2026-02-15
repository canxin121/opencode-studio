import * as chatApi from './api'
import type { JsonObject, JsonValue } from '@/types/json'

function isRecord(value: JsonValue): value is JsonObject {
  return Boolean(value && typeof value === 'object')
}

export async function sendMessageToSession(
  sessionId: string,
  opts: {
    text?: string
    parts?: JsonValue[]
    providerID?: string
    modelID?: string
    agent?: string
    variant?: string
  },
  getDirectoryForSession: (sessionId: string) => string | null,
) {
  const trimmed = (opts.text || '').trim()
  const providedParts = Array.isArray(opts.parts) ? opts.parts : []
  if (!trimmed && providedParts.length === 0) return

  const providerID = (opts.providerID || '').trim()
  const modelID = (opts.modelID || '').trim()
  const agent = (opts.agent || '').trim()
  const variant = (opts.variant || '').trim()

  // v2 contract:
  // - If caller passes parts, they are sent as-is.
  // - Otherwise, text becomes a single {type:'text'} part.
  const parts = providedParts.length > 0 ? providedParts : [{ type: 'text', text: trimmed }]
  if (providedParts.length > 0 && trimmed) {
    const hasText = providedParts.some((p) => isRecord(p) && p.type === 'text')
    if (!hasText) {
      throw new Error('Invalid message payload: parts provided but missing text part')
    }
  }

  const payload: {
    parts: JsonValue[]
    model?: { providerID: string; modelID: string }
    agent?: string
    variant?: string
  } = { parts }
  if (providerID && modelID) {
    payload.model = { providerID, modelID }
  }
  if (agent) payload.agent = agent
  if (variant) payload.variant = variant

  await chatApi.sendMessage(sessionId, payload, getDirectoryForSession(sessionId))
}

export async function sendTextToSession(
  sessionId: string,
  text: string,
  getDirectoryForSession: (id: string) => string | null,
) {
  await sendMessageToSession(sessionId, { text }, getDirectoryForSession)
}

export async function replyPermissionToSession(
  sessionId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  getDirectoryForSession: (id: string) => string | null,
  message?: string,
): Promise<boolean> {
  const sid = (sessionId || '').trim()
  const rid = (requestId || '').trim()
  if (!sid || !rid) return false

  await chatApi.replyPermission(rid, reply, getDirectoryForSession(sid), message)
  return true
}

export async function replyQuestionToSession(
  sessionId: string,
  requestId: string,
  answers: string[][],
  getDirectoryForSession: (id: string) => string | null,
): Promise<boolean> {
  const sid = (sessionId || '').trim()
  const rid = (requestId || '').trim()
  if (!sid || !rid) return false

  await chatApi.replyQuestion(rid, answers, getDirectoryForSession(sid))
  return true
}

export async function rejectQuestionForSession(
  sessionId: string,
  requestId: string,
  getDirectoryForSession: (id: string) => string | null,
): Promise<boolean> {
  const sid = (sessionId || '').trim()
  const rid = (requestId || '').trim()
  if (!sid || !rid) return false

  await chatApi.rejectQuestion(rid, getDirectoryForSession(sid))
  return true
}
