import { getLocalJson, removeLocalKey, setLocalJson } from './persist'
import { readActiveBackendBaseUrl } from './backend'
import { localStorageKeys } from './persistence/storageKeys'

type TokenMap = Record<string, string>

const STORAGE_KEY = localStorageKeys.auth.uiTokenByBaseUrl

function normalizeKey(baseUrl: string): string {
  const trimmed = String(baseUrl || '').trim()
  return trimmed.replace(/\/+$/g, '')
}

function readMap(): TokenMap {
  const local = getLocalJson<TokenMap>(STORAGE_KEY, {})
  return local
}

function writeMap(next: TokenMap) {
  setLocalJson(STORAGE_KEY, next)
}

export function readUiAuthTokenForBaseUrl(baseUrl: string): string {
  const key = normalizeKey(baseUrl)
  if (!key) return ''
  const map = readMap()
  const token = typeof map[key] === 'string' ? map[key].trim() : ''
  return token
}

export function writeUiAuthTokenForBaseUrl(baseUrl: string, token: string) {
  const key = normalizeKey(baseUrl)
  const value = String(token || '').trim()
  if (!key) return
  if (!value) {
    clearUiAuthTokenForBaseUrl(key)
    return
  }
  const map = readMap()
  writeMap({ ...map, [key]: value })
}

export function clearUiAuthTokenForBaseUrl(baseUrl: string) {
  const key = normalizeKey(baseUrl)
  if (!key) return
  const map = readMap()
  if (!Object.prototype.hasOwnProperty.call(map, key)) return
  const next: TokenMap = { ...map }
  delete next[key]
  // Keep storage tidy.
  if (Object.keys(next).length === 0) {
    removeLocalKey(STORAGE_KEY)
    return
  }
  writeMap(next)
}

export function readActiveUiAuthToken(): string {
  const baseUrl = readActiveBackendBaseUrl()
  return readUiAuthTokenForBaseUrl(baseUrl)
}

export function buildActiveUiAuthHeaders(): Record<string, string> {
  const token = readActiveUiAuthToken()
  if (!token) return {}
  return { authorization: `Bearer ${token}` }
}
