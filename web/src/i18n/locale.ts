import { getLocalString, setLocalString } from '@/lib/persist'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

const STORAGE_KEY = 'oc2.ui.locale'

function matchSupportedLocale(raw: string): AppLocale | null {
  const v = String(raw || '').trim()
  if (!v) return null

  // Accept a few common variants (case-insensitive, '_' separators, base language).
  const norm = v.replace(/_/g, '-').toLowerCase()
  if (norm === 'zh-cn' || norm === 'zh-hans' || norm.startsWith('zh-')) return 'zh-CN'
  if (norm === 'zh') return 'zh-CN'
  if (norm === 'en-us' || norm.startsWith('en-')) return 'en-US'
  if (norm === 'en') return 'en-US'
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
    const matched = matchSupportedLocale(raw)
    if (matched) return matched
  }
  return null
}

export function readStoredLocale(): AppLocale {
  const storedRaw = getLocalString(STORAGE_KEY)
  const stored = matchSupportedLocale(storedRaw)
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
