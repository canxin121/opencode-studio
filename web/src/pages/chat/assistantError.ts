import type { JsonValue } from '@/types/json'

type JsonRecord = Record<string, JsonValue>

export type AssistantErrorInfo = {
  interrupted: boolean
  message: string
  name?: string
  type?: string
  code?: string
  classification?: string
  statusCode?: number
  retryable?: boolean
  retries?: number
  providerID?: string
  modelID?: string
  requestID?: string
  responseMessage?: string
  responseBody?: string
  metadata?: JsonRecord
  raw: JsonRecord
}

export type AssistantErrorMetaEntry = { label: string; value: string }

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readString(record: JsonRecord | null, key: string): string {
  if (!record) return ''
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(record: JsonRecord | null, key: string): number | undefined {
  if (!record) return undefined
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function readBoolean(record: JsonRecord | null, key: string): boolean | undefined {
  if (!record) return undefined
  const value = record[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return undefined
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

function firstFiniteNumber(values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function firstDefinedBoolean(values: Array<boolean | undefined>): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function jsonMessageFromText(text: string): string {
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message.trim()
    const nested = parsed?.error
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedMessage = (nested as Record<string, unknown>).message
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim()
    }
  } catch {
    // ignore non-json payloads
  }
  return ''
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

export function getAssistantErrorInfo(
  input: { role?: unknown; error?: unknown } | null | undefined,
): AssistantErrorInfo | null {
  if (!input || String(input.role || '') !== 'assistant') return null
  const error = asRecord(input.error)
  if (!error) return null

  const data = asRecord(error.data)
  const nested = asRecord(error.error)
  const metadata = asRecord(data?.metadata) || asRecord(error.metadata) || asRecord(nested?.metadata)

  const name = firstNonEmpty([
    readString(error, 'name'),
    readString(error, 'type'),
    readString(nested, 'name'),
    readString(nested, 'type'),
  ])
  const explicitType = firstNonEmpty([readString(error, 'type'), readString(nested, 'type')])
  const code = firstNonEmpty([
    readString(data, 'code'),
    readString(error, 'code'),
    readString(nested, 'code'),
    readString(metadata, 'code'),
  ])

  const responseBody = firstNonEmpty([
    readString(data, 'responseBody'),
    readString(error, 'responseBody'),
    readString(nested, 'responseBody'),
  ])
  const responseMessage = firstNonEmpty([
    readString(data, 'responseMessage'),
    readString(error, 'responseMessage'),
    readString(nested, 'responseMessage'),
    jsonMessageFromText(responseBody),
  ])

  const message = firstNonEmpty([
    readString(data, 'message'),
    readString(error, 'message'),
    readString(nested, 'message'),
    responseMessage,
    code,
    name,
  ])

  if (!message && !name && !code) return null

  const info: AssistantErrorInfo = {
    interrupted: name === 'MessageAbortedError',
    message,
    raw: error,
  }

  if (name) info.name = name
  if (explicitType && explicitType !== name) info.type = explicitType
  if (code) info.code = code

  const classification = firstNonEmpty([
    readString(error, 'classification'),
    readString(data, 'classification'),
    readString(nested, 'classification'),
  ])
  if (classification) info.classification = classification

  const statusCode = firstFiniteNumber([
    readNumber(data, 'statusCode'),
    readNumber(data, 'status'),
    readNumber(error, 'statusCode'),
    readNumber(error, 'status'),
    readNumber(nested, 'statusCode'),
    readNumber(nested, 'status'),
  ])
  if (typeof statusCode === 'number') info.statusCode = statusCode

  const retryable = firstDefinedBoolean([
    readBoolean(data, 'isRetryable'),
    readBoolean(data, 'retryable'),
    readBoolean(error, 'isRetryable'),
    readBoolean(error, 'retryable'),
    readBoolean(nested, 'isRetryable'),
    readBoolean(nested, 'retryable'),
  ])
  if (typeof retryable === 'boolean') info.retryable = retryable

  const retries = firstFiniteNumber([
    readNumber(data, 'retries'),
    readNumber(data, 'retryCount'),
    readNumber(error, 'retries'),
    readNumber(error, 'retryCount'),
    readNumber(nested, 'retries'),
    readNumber(nested, 'retryCount'),
  ])
  if (typeof retries === 'number') info.retries = retries

  const providerID = firstNonEmpty([
    readString(data, 'providerID'),
    readString(data, 'providerId'),
    readString(error, 'providerID'),
    readString(error, 'providerId'),
    readString(error, 'provider'),
    readString(nested, 'providerID'),
    readString(nested, 'providerId'),
    readString(nested, 'provider'),
  ])
  if (providerID) info.providerID = providerID

  const modelID = firstNonEmpty([
    readString(data, 'modelID'),
    readString(data, 'modelId'),
    readString(error, 'modelID'),
    readString(error, 'modelId'),
    readString(error, 'model'),
    readString(nested, 'modelID'),
    readString(nested, 'modelId'),
    readString(nested, 'model'),
  ])
  if (modelID) info.modelID = modelID

  const requestID = firstNonEmpty([
    readString(data, 'requestID'),
    readString(data, 'requestId'),
    readString(data, 'request_id'),
    readString(error, 'requestID'),
    readString(error, 'requestId'),
    readString(error, 'request_id'),
    readString(nested, 'requestID'),
    readString(nested, 'requestId'),
    readString(nested, 'request_id'),
    readString(metadata, 'requestID'),
    readString(metadata, 'requestId'),
    readString(metadata, 'request_id'),
  ])
  if (requestID) info.requestID = requestID

  if (responseMessage) info.responseMessage = responseMessage
  if (responseBody) info.responseBody = responseBody
  if (metadata && Object.keys(metadata).length) info.metadata = metadata

  return info
}

export function hasDisplayableAssistantError(input: { role?: unknown; error?: unknown } | null | undefined): boolean {
  const info = getAssistantErrorInfo(input)
  return Boolean(info && !info.interrupted && info.message)
}

export function buildAssistantErrorMetaEntries(info: AssistantErrorInfo): AssistantErrorMetaEntry[] {
  const out: AssistantErrorMetaEntry[] = []
  if (info.name) out.push({ label: 'name', value: info.name })
  if (info.code) out.push({ label: 'code', value: info.code })
  if (info.classification) out.push({ label: 'classification', value: info.classification })
  if (typeof info.statusCode === 'number') out.push({ label: 'status', value: String(info.statusCode) })
  if (typeof info.retryable === 'boolean') out.push({ label: 'retryable', value: info.retryable ? 'yes' : 'no' })
  if (typeof info.retries === 'number') out.push({ label: 'retries', value: String(info.retries) })
  if (info.providerID) out.push({ label: 'provider', value: info.providerID })
  if (info.modelID) out.push({ label: 'model', value: info.modelID })
  if (info.requestID) out.push({ label: 'request_id', value: info.requestID })
  return out
}

export function buildAssistantErrorDetailsText(info: AssistantErrorInfo): string {
  const sections: string[] = []
  if (info.responseMessage && info.responseMessage !== info.message) {
    sections.push(`response_message: ${info.responseMessage}`)
  }
  if (info.responseBody) {
    sections.push(`response_body:\n${info.responseBody}`)
  }
  if (info.metadata && Object.keys(info.metadata).length) {
    sections.push(`metadata:\n${stringifyJson(info.metadata)}`)
  }
  const raw = stringifyJson(info.raw)
  if (raw && raw !== '{}') {
    sections.push(`raw:\n${raw}`)
  }
  return sections.join('\n\n')
}

export function buildAssistantErrorCopyText(input: { role?: unknown; error?: unknown } | null | undefined): string {
  const info = getAssistantErrorInfo(input)
  if (!info || info.interrupted || !info.message) return ''

  const lines: string[] = ['assistant_error', `message: ${info.message}`]
  for (const meta of buildAssistantErrorMetaEntries(info)) {
    lines.push(`${meta.label}: ${meta.value}`)
  }
  const details = buildAssistantErrorDetailsText(info)
  if (details) {
    lines.push('', details)
  }
  return lines.join('\n')
}
