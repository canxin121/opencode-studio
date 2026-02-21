// Small local/sessionStorage helpers with safe fallbacks.

import type { JsonValue as JsonLike } from '@/types/json'

export function getStorageString(storage: Storage, key: string): string {
  try {
    return String(storage.getItem(key) || '')
  } catch {
    return ''
  }
}

export function setStorageString(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function removeStorageKey(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}

export function getStorageJson<T>(storage: Storage, key: string, fallback: T): T {
  const raw = getStorageString(storage, key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setStorageJson(storage: Storage, key: string, value: JsonLike) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function getSessionString(key: string): string {
  if (typeof sessionStorage === 'undefined') return ''
  return getStorageString(sessionStorage, key)
}

export function setSessionString(key: string, value: string) {
  if (typeof sessionStorage === 'undefined') return
  setStorageString(sessionStorage, key, value)
}

export function removeSessionKey(key: string) {
  if (typeof sessionStorage === 'undefined') return
  removeStorageKey(sessionStorage, key)
}

export function getSessionJson<T>(key: string, fallback: T): T {
  if (typeof sessionStorage === 'undefined') return fallback
  return getStorageJson<T>(sessionStorage, key, fallback)
}

export function setSessionJson(key: string, value: JsonLike) {
  if (typeof sessionStorage === 'undefined') return
  setStorageJson(sessionStorage, key, value)
}

export function getLocalJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  return getStorageJson<T>(localStorage, key, fallback)
}

export function setLocalJson(key: string, value: JsonLike) {
  if (typeof localStorage === 'undefined') return
  setStorageJson(localStorage, key, value)
}

export function getLocalString(key: string): string {
  if (typeof localStorage === 'undefined') return ''
  return getStorageString(localStorage, key)
}

export function setLocalString(key: string, value: string) {
  if (typeof localStorage === 'undefined') return
  setStorageString(localStorage, key, value)
}

export function removeLocalKey(key: string) {
  if (typeof localStorage === 'undefined') return
  removeStorageKey(localStorage, key)
}
