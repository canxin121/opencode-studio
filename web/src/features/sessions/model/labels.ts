import { formatMonthDay } from '@/i18n/intl'

export function normalizeDirForCompare(p: string): string {
  const trimmed = (p || '').trim()
  if (!trimmed) return ''

  const decoded = trimmed.includes('%')
    ? (() => {
        try {
          return decodeURIComponent(trimmed)
        } catch {
          return trimmed
        }
      })()
    : trimmed

  const slashNormalized = decoded.replace(/\\/g, '/')
  if (!slashNormalized) return ''

  const canonical = slashNormalized.length > 1 ? slashNormalized.replace(/\/+$/g, '') : slashNormalized
  if (/^[A-Za-z]:/.test(canonical)) return canonical.toLowerCase()
  return canonical
}

export function includesQuery(haystack: string | null | undefined, q: string): boolean {
  const h = typeof haystack === 'string' ? haystack.toLowerCase() : ''
  return Boolean(q) && Boolean(h) && h.includes(q)
}

export function formatTime(ms?: number): string {
  return formatMonthDay(ms)
}

type DirectoryLike = { label?: string | null; path?: string | null } | null | undefined
type SessionLike = { title?: string | null; slug?: string | null; id?: string | number | null } | null | undefined

export function directoryEntryLabel(p: DirectoryLike): string {
  const label = typeof p?.label === 'string' ? p.label.trim() : ''
  if (label) return label
  const path = typeof p?.path === 'string' ? p.path.trim() : ''
  if (!path) return 'Project'
  const norm = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  const seg = norm.split('/').filter(Boolean).pop()
  return seg || norm
}

export const projectLabel = directoryEntryLabel

export function sessionLabel(s: SessionLike): string {
  return String(s?.title || s?.slug || s?.id || '').trim()
}
