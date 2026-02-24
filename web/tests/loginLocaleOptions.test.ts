import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLoginLocalePickerOptions } from '../src/pages/loginLocaleOptions'

test('builds login language switcher options for zh/en', () => {
  const labels: Record<string, string> = {
    'settings.appearance.language.options.zhCN': 'Simplified Chinese',
    'settings.appearance.language.options.enUS': 'English',
  }
  const t = (key: string) => labels[key] || key

  const options = buildLoginLocalePickerOptions(t)

  assert.deepEqual(options, [
    { value: 'zh-CN', label: 'Simplified Chinese' },
    { value: 'en-US', label: 'English' },
  ])
})
