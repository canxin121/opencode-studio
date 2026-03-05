import { createI18n } from 'vue-i18n'

import enUS from './messages/en-US'
import {
  readStoredLocale,
  storeLocale,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeAppLocale,
  type AppLocale,
} from './locale'

type MessageSchema = typeof enUS

const messageModules = import.meta.glob('./messages/*.ts', { eager: true }) as Record<string, { default?: unknown }>

const loadedMessages: Record<string, MessageSchema> = {}
for (const [path, mod] of Object.entries(messageModules)) {
  const match = path.match(/\/([^/]+)\.ts$/)
  if (!match) continue
  const locale = match[1]
  if (locale && mod?.default && typeof mod.default === 'object') {
    loadedMessages[locale] = mod.default as MessageSchema
  }
}

const enUSMessages = loadedMessages['en-US'] || enUS
const messages = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, loadedMessages[locale] || enUSMessages]),
) as Record<AppLocale, MessageSchema>

export const i18n = createI18n({
  legacy: false as const,
  globalInjection: true,
  locale: readStoredLocale(),
  fallbackLocale: 'en-US',
  messages,
})

export function setAppLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  storeLocale(locale)
  if (typeof document !== 'undefined') {
    try {
      document.documentElement.lang = locale
    } catch {
      // ignore
    }
  }
}

export function ensureDefaultLocale() {
  const current = normalizeAppLocale(i18n.global.locale.value)
  if (!current) {
    setAppLocale(DEFAULT_LOCALE)
    return
  }
  if (String(i18n.global.locale.value || '') !== current) {
    setAppLocale(current)
  }
}
