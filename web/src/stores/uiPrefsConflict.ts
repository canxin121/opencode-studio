import { ApiError } from '../lib/api.ts'
import type { ChatSidebarUiPrefs } from '../data/chatSidebarUiPrefs.ts'
import type { JsonValue } from '@/types/json'

export function isUiPrefsConflictError(error: JsonValue): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 428)
}

export function readUiPrefsConflictCurrent(
  error: JsonValue,
): Partial<ChatSidebarUiPrefs> | null {
  if (!(error instanceof ApiError)) return null
  if (!isUiPrefsConflictError(error)) return null

  const body = error.bodyJson
  if (!body || typeof body !== 'object') return null
  const current = (body as { current?: JsonValue }).current
  if (!current || typeof current !== 'object') return null

  return current as Partial<ChatSidebarUiPrefs>
}
