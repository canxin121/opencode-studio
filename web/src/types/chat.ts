import type { SseEvent } from '../lib/sse'
import type { JsonValue as JsonLike } from './json'

export type Session = {
  id: string
  title?: string
  directory?: string
  slug?: string
  time?: { created?: number; updated?: number }
  summary?: { additions?: number; deletions?: number; files?: number }
  revert?: { messageID?: string }
  [k: string]: JsonLike
}

export type MessageInfo = {
  id: string
  sessionID: string
  role: 'user' | 'assistant' | 'system' | string
  time?: { created?: number; completed?: number }
  finish?: string
  error?: MessageError
  agent?: string
  modelID?: string
  providerID?: string
  [k: string]: JsonLike
}

export type MessageError = {
  name?: string
  type?: string
  message?: string
  code?: string
  classification?: string
  statusCode?: number | string
  isRetryable?: boolean
  retries?: number
  providerID?: string
  modelID?: string
  requestID?: string
  responseMessage?: string
  responseBody?: string
  metadata?: Record<string, JsonLike>
  data?: {
    message?: string
    code?: string
    statusCode?: number | string
    isRetryable?: boolean
    retries?: number
    providerID?: string
    modelID?: string
    requestID?: string
    responseMessage?: string
    responseBody?: string
    metadata?: Record<string, JsonLike>
    [k: string]: JsonLike
  }
  [k: string]: JsonLike
}

export type MessagePart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  [k: string]: JsonLike
}

export type MessageEntry = {
  info: MessageInfo
  parts: MessagePart[]
}

export type AttentionEvent = {
  kind: 'permission' | 'question'
  at: number
  payload: SseEvent
}

export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number }

export type SessionStatusEvent = {
  at: number
  payload: SseEvent
  status: SessionStatus
}

export type SessionErrorClassification = 'context_overflow' | 'provider_auth' | 'network' | 'provider_api' | 'unknown'

export type SessionError = {
  message: string
  rendered?: string
  code?: string
  name?: string
  classification?: SessionErrorClassification
  raw: JsonLike
}

export type SessionErrorEvent = {
  at: number
  payload: SseEvent
  error: SessionError
}

export type SessionRunConfig = {
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  at: number
}
