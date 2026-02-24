type TranslateFn = (key: string) => string

export type LocalePickerOption = {
  value: 'zh-CN' | 'en-US'
  label: string
}

export function buildLoginLocalePickerOptions(t: TranslateFn): LocalePickerOption[] {
  return [
    { value: 'zh-CN', label: String(t('settings.appearance.language.options.zhCN')) },
    { value: 'en-US', label: String(t('settings.appearance.language.options.enUS')) },
  ]
}
