import { getLocalString, setLocalString } from '@/lib/persist'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

const STORAGE_KEY = 'oc2.ui.locale'

function normalizeLocale(raw: string): AppLocale {
  const v = String(raw || '').trim()
  if (v === 'zh-CN' || v === 'en-US') return v
  return DEFAULT_LOCALE
}

export function readStoredLocale(): AppLocale {
  return normalizeLocale(getLocalString(STORAGE_KEY))
}

export function storeLocale(locale: AppLocale) {
  setLocalString(STORAGE_KEY, locale)
}
