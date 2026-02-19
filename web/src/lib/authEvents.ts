export const OC_AUTH_REQUIRED_EVENT = 'oc.auth-required'

export const OC_AUTH_REQUIRED_STORAGE_KEY = 'oc2.authRequired'

export type AuthRequiredDetail = {
  message?: string
  status?: number
  code?: string
  url?: string
}

export type StoredAuthRequired = {
  at: number
  detail: AuthRequiredDetail
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

export function readAuthRequiredFromStorage(): StoredAuthRequired | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(OC_AUTH_REQUIRED_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const at = typeof record.at === 'number' && Number.isFinite(record.at) ? Math.floor(record.at) : 0
    const detail = record.detail
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
    return { at, detail: detail as AuthRequiredDetail }
  } catch {
    return null
  }
}

export function clearAuthRequiredFromStorage() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(OC_AUTH_REQUIRED_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function persistAuthRequired(detail: AuthRequiredDetail) {
  if (typeof sessionStorage === 'undefined') return
  try {
    const payload: StoredAuthRequired = { at: Date.now(), detail }
    sessionStorage.setItem(OC_AUTH_REQUIRED_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

function dispatchAuthRequired(target: EventTarget, detail: AuthRequiredDetail) {
  try {
    // Prefer CustomEvent so listeners can read `evt.detail`.
    if (typeof CustomEvent === 'function') {
      target.dispatchEvent(new CustomEvent<AuthRequiredDetail>(OC_AUTH_REQUIRED_EVENT, { detail }))
      return
    }
  } catch {
    // ignore
  }

  try {
    // Fallback for environments where CustomEvent isn't available.
    const evt = new Event(OC_AUTH_REQUIRED_EVENT)
    ;(evt as unknown as { detail?: AuthRequiredDetail }).detail = detail
    target.dispatchEvent(evt)
  } catch {
    // ignore
  }
}

export function emitAuthRequired(detail: AuthRequiredDetail) {
  persistAuthRequired(detail)

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    dispatchAuthRequired(window, detail)
  }
  if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
    dispatchAuthRequired(document, detail)
  }
}
