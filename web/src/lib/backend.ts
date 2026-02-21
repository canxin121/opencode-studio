import { getLocalJson, getLocalString, removeLocalKey, setLocalJson } from './persist'

export type BackendTarget = {
  id: string
  label: string
  baseUrl: string
  createdAt: number
  lastUsedAt?: number
}

export type BackendsConfigV1 = {
  version: 1
  activeBackendId: string | null
  backends: BackendTarget[]
}

const STORAGE_KEY = 'oc2.backends.v1'

// Legacy single-backend keys (kept for migration / compatibility).
const LEGACY_BASE_URL_KEY = 'oc2.backend.baseUrl'

function nowMs(): number {
  return Date.now()
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function currentOrigin(): string {
  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.origin === 'string') {
      const origin = window.location.origin
      // `file://` and some sandboxed contexts return "null".
      if (origin === 'null') return ''
      if (!origin.startsWith('http://') && !origin.startsWith('https://')) return ''
      return origin
    }
  } catch {
    // ignore
  }
  return ''
}

export function normalizeBackendBaseUrl(raw: string): string {
  const txt = String(raw || '').trim()
  if (!txt) return ''

  let candidate = txt
  // Accept host:port inputs by assuming http://.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return ''
  }

  const proto = String(url.protocol || '').toLowerCase()
  if (proto !== 'http:' && proto !== 'https:') return ''

  // Drop query/hash; keep path prefix if user intentionally provided one.
  url.hash = ''
  url.search = ''

  // Normalize trailing slash (but keep root as origin).
  const path = String(url.pathname || '')
  if (path && path !== '/' && path.endsWith('/')) {
    url.pathname = path.replace(/\/+$/g, '')
  }

  let out = url.toString()
  // URL.toString() always includes a trailing slash for origin-only URLs.
  if (out.endsWith('/')) out = out.slice(0, -1)
  return out
}

export function resolveBackendUrl(path: string, baseUrl?: string | null): string {
  const rawPath = String(path || '').trim()
  if (!rawPath) return ''

  // Absolute URL passthrough.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawPath)) return rawPath

  const base = String(baseUrl || '').trim()
  if (!base) return rawPath

  const b = base.replace(/\/+$/g, '')
  const p = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return `${b}${p}`
}

function normalizeBackendTarget(raw: unknown): BackendTarget | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const baseUrl = typeof raw.baseUrl === 'string' ? normalizeBackendBaseUrl(raw.baseUrl) : ''
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? Math.floor(raw.createdAt) : 0
  const lastUsedAt =
    typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt) ? Math.floor(raw.lastUsedAt) : undefined
  if (!id || !label || !baseUrl || createdAt <= 0) return null
  return { id, label, baseUrl, createdAt, lastUsedAt }
}

function normalizeConfigV1(raw: unknown): BackendsConfigV1 | null {
  if (!isRecord(raw)) return null
  if (raw.version !== 1) return null

  const backendsRaw = raw.backends
  const arr = Array.isArray(backendsRaw) ? backendsRaw : []
  const backends: BackendTarget[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    const normalized = normalizeBackendTarget(item)
    if (!normalized) continue
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    backends.push(normalized)
  }

  const activeBackendIdRaw = typeof raw.activeBackendId === 'string' ? raw.activeBackendId.trim() : ''
  const activeBackendId = activeBackendIdRaw || null

  if (backends.length === 0) return null

  return { version: 1, activeBackendId, backends }
}

export function readBackendsConfigFromStorage(): BackendsConfigV1 | null {
  const raw = getLocalJson<unknown>(STORAGE_KEY, null)
  return normalizeConfigV1(raw)
}

export function writeBackendsConfigToStorage(next: BackendsConfigV1) {
  setLocalJson(STORAGE_KEY, next)
}

export function getActiveBackendTarget(config: BackendsConfigV1 | null): BackendTarget | null {
  const cfg = config
  if (!cfg || cfg.backends.length === 0) return null
  const id = String(cfg.activeBackendId || '').trim()
  if (!id) return cfg.backends[0] || null
  return cfg.backends.find((b) => b.id === id) || cfg.backends[0] || null
}

export function ensureBackendsConfigInStorage(): BackendsConfigV1 {
  const existing = readBackendsConfigFromStorage()
  if (existing) return existing

  // Migration path from older single-backend storage.
  const legacyBaseUrl = normalizeBackendBaseUrl(getLocalString(LEGACY_BASE_URL_KEY))
  if (legacyBaseUrl) {
    removeLocalKey(LEGACY_BASE_URL_KEY)
    const now = nowMs()
    const backend: BackendTarget = {
      id: randomId(),
      label: 'Backend',
      baseUrl: legacyBaseUrl,
      createdAt: now,
      lastUsedAt: now,
    }
    const cfg: BackendsConfigV1 = {
      version: 1,
      activeBackendId: backend.id,
      backends: [backend],
    }
    writeBackendsConfigToStorage(cfg)
    return cfg
  }

  // Default: preserve the historical behavior (single backend on this origin).
  const origin = normalizeBackendBaseUrl(currentOrigin())
  const now = nowMs()
  const backend: BackendTarget = {
    id: randomId(),
    label: origin ? 'This server' : 'Backend',
    baseUrl: origin || normalizeBackendBaseUrl('http://127.0.0.1:3000'),
    createdAt: now,
    lastUsedAt: now,
  }
  const cfg: BackendsConfigV1 = {
    version: 1,
    activeBackendId: backend.id,
    backends: [backend],
  }
  writeBackendsConfigToStorage(cfg)
  return cfg
}

export function readActiveBackendBaseUrl(): string {
  const cfg = ensureBackendsConfigInStorage()
  const active = getActiveBackendTarget(cfg)
  return active?.baseUrl || ''
}
