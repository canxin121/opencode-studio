import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLoginLocalePickerOptions } from '../src/pages/loginLocaleOptions'

test('builds login language switcher options for all supported locales', () => {
  const labels: Record<string, string> = {
    'settings.appearance.language.options.zhCN': 'Simplified Chinese',
    'settings.appearance.language.options.enUS': 'English',
    'settings.appearance.language.options.esES': 'Spanish (Spain)',
    'settings.appearance.language.options.hiIN': 'Hindi (India)',
    'settings.appearance.language.options.arSA': 'Arabic (Saudi Arabia)',
    'settings.appearance.language.options.ptBR': 'Portuguese (Brazil)',
    'settings.appearance.language.options.frFR': 'French (France)',
  }
  const t = (key: string) => labels[key] || key

  const options = buildLoginLocalePickerOptions(t)

  assert.deepEqual(options, [
    { value: 'zh-CN', label: 'Simplified Chinese' },
    { value: 'en-US', label: 'English' },
    { value: 'es-ES', label: 'Spanish (Spain)' },
    { value: 'hi-IN', label: 'Hindi (India)' },
    { value: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
    { value: 'pt-BR', label: 'Portuguese (Brazil)' },
    { value: 'fr-FR', label: 'French (France)' },
  ])
})
