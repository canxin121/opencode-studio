export type WorkspacePreviewViewport = 'desktop' | 'mobile'

const PREVIEW_PROXY_PATH = '/api/workspace/preview/proxy'

export function normalizePreviewUrl(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''

  if (/^[a-zA-Z][\w+.-]*:\/\//.test(raw) && !/^https?:\/\//i.test(raw)) {
    return ''
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    return ''
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return ''
  }
  if (!parsed.hostname) {
    return ''
  }
  return parsed.toString()
}

export function resolvePreviewTarget(manualUrl: string, detectedUrl: string): string {
  const manual = normalizePreviewUrl(manualUrl)
  if (manual) return manual
  return normalizePreviewUrl(detectedUrl)
}

export function buildPreviewProxyPath(url: string): string {
  const normalized = normalizePreviewUrl(url)
  if (!normalized) return ''
  const params = new URLSearchParams()
  params.set('target', normalized)
  return `${PREVIEW_PROXY_PATH}?${params.toString()}`
}

export function buildPreviewFrameSrc(url: string, refreshToken: number): string {
  const proxyPath = buildPreviewProxyPath(url)
  if (!proxyPath) return ''
  const token = String(Math.max(0, Math.floor(refreshToken)))
  return `${proxyPath}&__oc_preview_refresh=${encodeURIComponent(token)}`
}
