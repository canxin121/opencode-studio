import { i18n } from './index'
import { DEFAULT_LOCALE, type AppLocale } from './locale'

function normalizeAppLocale(raw: unknown): AppLocale {
  const v = String(raw || '').trim()
  if (v === 'zh-CN' || v === 'en-US') return v
  return DEFAULT_LOCALE
}

export function getIntlLocale(): AppLocale {
  return normalizeAppLocale(i18n.global.locale.value)
}

const numberFormatCache = new Map<string, Intl.NumberFormat>()

function getNumberFormat(key: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat | null {
  try {
    const locale = getIntlLocale()
    const cacheKey = `${locale}::${key}`
    const existing = numberFormatCache.get(cacheKey)
    if (existing) return existing
    const created = new Intl.NumberFormat(locale, options)
    numberFormatCache.set(cacheKey, created)
    return created
  } catch {
    return null
  }
}

export function formatNumber(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const fmt = getNumberFormat('number')
  if (fmt) return fmt.format(value)
  try {
    return value.toLocaleString(getIntlLocale())
  } catch {
    return String(value)
  }
}

export function formatCurrencyUSD(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const fmt = getNumberFormat('currency-usd', { style: 'currency', currency: 'USD' })
  if (fmt) return fmt.format(value)
  return String(value)
}

export function formatCompactNumber(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const fmt = getNumberFormat('compact', { notation: 'compact', maximumFractionDigits: 1 })
  if (fmt) return fmt.format(value)
  return String(value)
}

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()

function getDateTimeFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    const locale = getIntlLocale()
    const cacheKey = `${locale}::${key}`
    const existing = dateTimeFormatCache.get(cacheKey)
    if (existing) return existing
    const created = new Intl.DateTimeFormat(locale, options)
    dateTimeFormatCache.set(cacheKey, created)
    return created
  } catch {
    return null
  }
}

function asDate(value: string | number | Date): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function formatTimeHMS(ms?: number): string {
  if (!ms || typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const fmt = getDateTimeFormat('time-hms', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    if (fmt) return fmt.format(d)
  } catch {
    // ignore
  }
  try {
    return d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function formatTimeHM(ms?: number): string {
  if (!ms || typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const fmt = getDateTimeFormat('time-hm', { hour: '2-digit', minute: '2-digit' })
    if (fmt) return fmt.format(d)
  } catch {
    // ignore
  }
  try {
    return d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function formatMonthDay(ms?: number): string {
  if (!ms || typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const fmt = getDateTimeFormat('month-day', { month: 'short', day: 'numeric' })
    if (fmt) return fmt.format(d)
  } catch {
    // ignore
  }
  try {
    return d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function formatDateTimeYMDHM(value: string | number | Date): string {
  if (typeof value === 'string' && !value.trim()) return ''
  const d = asDate(value)
  if (!d) return typeof value === 'string' ? value : ''
  try {
    const fmt = getDateTimeFormat('ymdhm', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    if (fmt) return fmt.format(d)
  } catch {
    // ignore
  }
  try {
    return d.toLocaleString(getIntlLocale(), {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return typeof value === 'string' ? value : ''
  }
}

export function formatDateYMDShort2DigitYear(value: string | number | Date): string {
  if (typeof value === 'string' && !value.trim()) return ''
  const d = asDate(value)
  if (!d) return typeof value === 'string' ? value : ''
  try {
    const fmt = getDateTimeFormat('ymd-2y', { year: '2-digit', month: 'short', day: '2-digit' })
    if (fmt) return fmt.format(d)
  } catch {
    // ignore
  }
  try {
    return d.toLocaleDateString(getIntlLocale(), { year: '2-digit', month: 'short', day: '2-digit' })
  } catch {
    return typeof value === 'string' ? value : ''
  }
}
