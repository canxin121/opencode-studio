import { createI18n } from 'vue-i18n'

import enUS from './messages/en-US'
import zhCN from './messages/zh-CN'
import { readStoredLocale, storeLocale, DEFAULT_LOCALE, type AppLocale } from './locale'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: readStoredLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
    'zh-CN': zhCN,
  },
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
  const current = String(i18n.global.locale.value || '')
  if (current !== 'zh-CN' && current !== 'en-US') {
    setAppLocale(DEFAULT_LOCALE)
  }
}
