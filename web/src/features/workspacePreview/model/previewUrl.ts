export type WorkspacePreviewViewport = 'desktop' | 'mobile'

const PREVIEW_PROXY_BASE_PREFIX = '/api/workspace/preview/s/'
const PREVIEW_ORIGIN = 'https://preview.local'

export function normalizePreviewProxyBasePath(input: string): string {
  const raw = String(input || '').trim()
  if (!raw || !raw.startsWith('/')) return ''

  let parsed: URL
  try {
    parsed = new URL(raw, PREVIEW_ORIGIN)
  } catch {
    return ''
  }

  if (parsed.origin !== PREVIEW_ORIGIN) return ''
  if (!parsed.pathname.startsWith(PREVIEW_PROXY_BASE_PREFIX)) return ''

  const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
  return `${pathname}${parsed.search}${parsed.hash}`
}

export function buildPreviewFrameSrc(proxyBasePath: string, refreshToken: number): string {
  const normalized = normalizePreviewProxyBasePath(proxyBasePath)
  if (!normalized) return ''

  const parsed = new URL(normalized, PREVIEW_ORIGIN)
  parsed.searchParams.set('__oc_preview_refresh', String(Math.max(0, Math.floor(refreshToken))))
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
