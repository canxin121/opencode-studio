import { getLocalString, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'es-ES', 'hi-IN', 'ar-SA', 'pt-BR', 'fr-FR'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

const STORAGE_KEY = localStorageKeys.ui.locale

export function normalizeAppLocale(raw: unknown): AppLocale | null {
  const v = String(raw || '').trim()
  if (!v) return null

  // Accept a few common variants (case-insensitive, '_' separators, base language).
  const norm = v.replace(/_/g, '-').toLowerCase()
  if (norm === 'zh-cn' || norm === 'zh-hans' || norm.startsWith('zh-')) return 'zh-CN'
  if (norm === 'zh') return 'zh-CN'
  if (norm === 'en-us' || norm.startsWith('en-')) return 'en-US'
  if (norm === 'en') return 'en-US'
  if (norm === 'es-es' || norm.startsWith('es-')) return 'es-ES'
  if (norm === 'es') return 'es-ES'
  if (norm === 'hi-in' || norm.startsWith('hi-')) return 'hi-IN'
  if (norm === 'hi') return 'hi-IN'
  if (norm === 'ar-sa' || norm.startsWith('ar-')) return 'ar-SA'
  if (norm === 'ar') return 'ar-SA'
  if (norm === 'pt-br' || norm.startsWith('pt-')) return 'pt-BR'
  if (norm === 'pt') return 'pt-BR'
  if (norm === 'fr-fr' || norm.startsWith('fr-')) return 'fr-FR'
  if (norm === 'fr') return 'fr-FR'
  return null
}

function detectBrowserLocale(): AppLocale | null {
  if (typeof navigator === 'undefined') return null

  const candidates: string[] = []
  if (typeof navigator.language === 'string' && navigator.language.trim()) {
    candidates.push(navigator.language)
  }
  const langs = Array.isArray(navigator.languages) ? navigator.languages : []
  for (const item of langs) {
    if (typeof item === 'string' && item.trim()) candidates.push(item)
  }

  for (const raw of candidates) {
    const matched = normalizeAppLocale(raw)
    if (matched) return matched
  }
  return null
}

export function readStoredLocale(): AppLocale {
  const storedRaw = getLocalString(STORAGE_KEY)
  const stored = normalizeAppLocale(storedRaw)
  if (stored) return stored

  // No stored preference yet; best-effort detect browser language.
  if (!String(storedRaw || '').trim()) {
    const detected = detectBrowserLocale()
    if (detected) return detected
  }

  return DEFAULT_LOCALE
}

export function storeLocale(locale: AppLocale) {
  setLocalString(STORAGE_KEY, locale)
}
