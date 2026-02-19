export const OC_AUTH_REQUIRED_EVENT = 'oc.auth-required'

export type AuthRequiredDetail = {
  message?: string
  status?: number
  code?: string
  url?: string
}

export function extractAuthRequiredMessageFromBodyText(bodyText: string): string {
  const txt = String(bodyText || '').trim()
  if (!txt) return ''

  try {
    const parsed = JSON.parse(txt) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    const record = parsed as Record<string, unknown>

    const message = typeof record.message === 'string' ? record.message.trim() : ''
    if (message) return message

    const errorValue = record.error
    if (typeof errorValue === 'string') {
      const err = errorValue.trim()
      if (err) return err
    }
    if (errorValue && typeof errorValue === 'object' && !Array.isArray(errorValue)) {
      const nested = errorValue as Record<string, unknown>
      const nestedMessage = typeof nested.message === 'string' ? nested.message.trim() : ''
      if (nestedMessage) return nestedMessage
    }
  } catch {
    // ignore non-json payloads
  }

  return ''
}

export function emitAuthRequired(detail: AuthRequiredDetail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent<AuthRequiredDetail>(OC_AUTH_REQUIRED_EVENT, { detail }))
  } catch {
    // ignore
  }
}
