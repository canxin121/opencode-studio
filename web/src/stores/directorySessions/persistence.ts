export const SNAPSHOT_SAVE_DEBOUNCE_MS = 300
export const UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS = 300
export const CHAT_SIDEBAR_STATE_ENDPOINT = '/api/chat-sidebar/state'
export const CHAT_SIDEBAR_BOOTSTRAP_ENDPOINT = '/api/chat-sidebar/bootstrap'
export const CHAT_SIDEBAR_UI_PREFS_ENDPOINT = '/api/ui/chat-sidebar/preferences'

// Backward-compatible aliases for in-progress naming migration.
export const SIDEBAR_STATE_ENDPOINT = CHAT_SIDEBAR_STATE_ENDPOINT
export const SIDEBAR_BOOTSTRAP_ENDPOINT = CHAT_SIDEBAR_BOOTSTRAP_ENDPOINT
export const UI_PREFS_ENDPOINT = CHAT_SIDEBAR_UI_PREFS_ENDPOINT

type PersistValue = unknown
type PersistRecord = Record<string, PersistValue>

export function metricNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function isPlainObject(value: PersistValue): value is PersistRecord {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function jsonLikeDeepEqual(left: PersistValue, right: PersistValue): boolean {
  if (left === right) return true
  if (left == null || right == null) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (!jsonLikeDeepEqual(left[i], right[i])) return false
    }
    return true
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false
      if (!jsonLikeDeepEqual(left[key], right[key])) return false
    }
    return true
  }

  return false
}
