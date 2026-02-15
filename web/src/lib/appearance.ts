import type { JsonValue as JsonLike } from '@/types/json'

type AnySettings = Record<string, JsonLike> | null | undefined

function asRecord(value: JsonLike): Record<string, JsonLike> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function getSetting(settings: AnySettings, key: string): JsonLike {
  return asRecord(settings)?.[key]
}

const UI_FONT_PRESETS: Record<string, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  'ibm-plex-sans': '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  atkinson: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
}

const MONO_FONT_PRESETS: Record<string, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'ibm-plex-mono':
    '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'jetbrains-mono':
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
}

function getString(settings: AnySettings, key: string): string {
  const v = getSetting(settings, key)
  return typeof v === 'string' ? v : ''
}

function getNumber(settings: AnySettings, key: string): number | null {
  const v = getSetting(settings, key)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function getBool(settings: AnySettings, key: string): boolean | null {
  const v = getSetting(settings, key)
  return typeof v === 'boolean' ? v : null
}

function resolveFont(value: string, presets: Record<string, string>, fallback: string): string {
  const t = value.trim()
  if (!t) return fallback
  // Allow either a preset key or a raw CSS font-family stack.
  return presets[t] || t
}

export function applyAppearanceSettingsToDom(settings: AnySettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  const useSystemTheme = getBool(settings, 'useSystemTheme') ?? true
  const themeVariant = getString(settings, 'themeVariant')

  let variant: 'light' | 'dark' = 'dark'
  if (useSystemTheme) {
    try {
      variant = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    } catch {
      variant = 'dark'
    }
  } else if (themeVariant === 'light' || themeVariant === 'dark') {
    variant = themeVariant
  }

  // Tailwind + CSS in this repo use `.dark` on the root element.
  root.classList.toggle('dark', variant === 'dark')

  const uiFont = resolveFont(getString(settings, 'uiFont'), UI_FONT_PRESETS, UI_FONT_PRESETS['system']!)
  const monoFont = resolveFont(getString(settings, 'monoFont'), MONO_FONT_PRESETS, MONO_FONT_PRESETS['system']!)
  root.style.setProperty('--font-sans', uiFont)
  root.style.setProperty('--font-mono', monoFont)

  const fontSizePct = getNumber(settings, 'fontSize')
  if (fontSizePct) {
    const px = Math.round((16 * fontSizePct) / 100)
    root.style.setProperty('--base-font-size', `${px}px`)
  } else {
    root.style.removeProperty('--base-font-size')
  }

  const paddingPct = getNumber(settings, 'padding')
  if (paddingPct) {
    root.style.setProperty('--padding-scale', String(paddingPct / 100))
  } else {
    root.style.removeProperty('--padding-scale')
  }

  const radius = getNumber(settings, 'cornerRadius')
  if (radius != null) {
    root.style.setProperty('--radius', `${radius}px`)
  } else {
    root.style.removeProperty('--radius')
  }

  const inputBarOffset = getNumber(settings, 'inputBarOffset')
  if (inputBarOffset != null) {
    root.style.setProperty('--ui-input-offset', `${inputBarOffset}px`)
  } else {
    root.style.removeProperty('--ui-input-offset')
  }

  // Typography sizes are stored as CSS font-size strings (e.g. "13px").
  const sizes = asRecord(getSetting(settings, 'typographySizes'))
  if (sizes && typeof sizes === 'object') {
    const map: Record<string, string> = {
      markdown: '--text-markdown',
      code: '--text-code',
      uiHeader: '--text-ui-header',
      uiLabel: '--text-ui-label',
      meta: '--text-meta',
      micro: '--text-micro',
    }

    for (const key of Object.keys(map)) {
      const v = sizes[key]
      if (typeof v === 'string' && v.trim()) {
        root.style.setProperty(map[key]!, v.trim())
      }
    }
  }
}
