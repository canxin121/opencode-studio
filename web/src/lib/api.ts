import type { JsonValue as JsonLike } from '@/types/json'

export class ApiError extends Error {
  status: number
  bodyText?: string
  bodyJson?: JsonLike
  code?: string
  hint?: string

  constructor(message: string, status: number, bodyText?: string) {
    super(message)
    this.status = status
    this.bodyText = bodyText
  }
}

async function readBodyText(resp: Response): Promise<string> {
  return await resp.text().catch(() => '')
}

function asRecord(value: JsonLike): Record<string, JsonLike> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, JsonLike>
}

export function apiErrorBodyRecord(error: Error | JsonLike): Record<string, JsonLike> | null {
  if (!(error instanceof ApiError)) return null
  return asRecord(error.bodyJson)
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      accept: 'application/json',
    },
  })

  if (!resp.ok) {
    const txt = await readBodyText(resp)

    // Best-effort parse structured backend errors so the UI can show something actionable.
    let bodyJson: JsonLike = undefined
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    const looksJson = ct.includes('application/json') || txt.trim().startsWith('{') || txt.trim().startsWith('[')
    if (txt && looksJson) {
      try {
        bodyJson = JSON.parse(txt)
      } catch {
        bodyJson = undefined
      }
    }

    let message = txt || `Request failed (${resp.status})`
    const bodyRecord = asRecord(bodyJson)
    if (bodyRecord) {
      const errorValue = bodyRecord.error
      const errorRecord = asRecord(errorValue)
      const extracted =
        (typeof errorValue === 'string' && errorValue) ||
        (typeof bodyRecord.message === 'string' && bodyRecord.message) ||
        (typeof errorRecord?.message === 'string' && errorRecord.message)
      if (extracted && extracted.trim()) message = extracted.trim()

      const hint = typeof bodyRecord.hint === 'string' ? bodyRecord.hint.trim() : ''
      if (hint) {
        // Keep the primary message first; hint is extra guidance.
        message = `${message}\n${hint}`
      }
    }

    const err = new ApiError(message, resp.status, txt)
    if (bodyJson !== undefined) {
      err.bodyJson = bodyJson
      const bodyRecord = asRecord(bodyJson)
      if (bodyRecord) {
        if (typeof bodyRecord.code === 'string') err.code = bodyRecord.code
        if (typeof bodyRecord.hint === 'string') err.hint = bodyRecord.hint
      }
    }
    throw err
  }

  return (await resp.json()) as T
}

export async function apiText(url: string, init?: RequestInit): Promise<string> {
  const resp = await fetch(url, init)
  if (!resp.ok) {
    const txt = await readBodyText(resp)
    throw new ApiError(txt || `Request failed (${resp.status})`, resp.status, txt)
  }
  return await resp.text()
}
