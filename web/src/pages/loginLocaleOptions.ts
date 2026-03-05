import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locale'

type TranslateFn = (key: string) => string

export type LocalePickerOption = {
  value: AppLocale
  label: string
}

const localeOptionKeyByLocale: Record<AppLocale, string> = {
  'zh-CN': 'zhCN',
  'en-US': 'enUS',
  'es-ES': 'esES',
  'hi-IN': 'hiIN',
  'ar-SA': 'arSA',
  'pt-BR': 'ptBR',
  'fr-FR': 'frFR',
}

export function buildLocalePickerOptions(t: TranslateFn): LocalePickerOption[] {
  return SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: String(t(`settings.appearance.language.options.${localeOptionKeyByLocale[locale]}`)),
  }))
}

export function buildLoginLocalePickerOptions(t: TranslateFn): LocalePickerOption[] {
  return buildLocalePickerOptions(t)
}
