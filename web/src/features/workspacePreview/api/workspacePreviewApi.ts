import { apiJson } from '@/lib/api'

import { normalizePreviewUrl } from '../model/previewUrl'

type PreviewEndpointResponse = {
  url?: unknown
  previewUrl?: unknown
  urls?: unknown
  targets?: unknown
  target?: unknown
}

const PREVIEW_ENDPOINTS = ['/api/workspace/preview', '/api/workspace/preview-url']

function pickFirstString(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item
    if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
      const nested = String((item as { url?: unknown }).url || '').trim()
      if (nested) return nested
    }
  }
  return ''
}

function extractPreviewUrl(payload: PreviewEndpointResponse): string {
  const candidate =
    (typeof payload.url === 'string' ? payload.url : '') ||
    (typeof payload.previewUrl === 'string' ? payload.previewUrl : '') ||
    pickFirstString(payload.urls) ||
    pickFirstString(payload.targets) ||
    (payload.target && typeof payload.target === 'object'
      ? pickFirstString([(payload.target as { url?: unknown }).url])
      : '')
  return normalizePreviewUrl(candidate)
}

function readMockPreviewUrl(): string {
  const globalRecord = globalThis as Record<string, unknown>
  return normalizePreviewUrl(
    typeof globalRecord.__OC_WORKSPACE_PREVIEW_URL__ === 'string' ? globalRecord.__OC_WORKSPACE_PREVIEW_URL__ : '',
  )
}

export async function resolveWorkspacePreviewUrl(directory: string): Promise<string> {
  const encodedDirectory = encodeURIComponent(String(directory || '').trim())

  for (const endpoint of PREVIEW_ENDPOINTS) {
    try {
      const payload = await apiJson<PreviewEndpointResponse>(`${endpoint}?directory=${encodedDirectory}`)
      const resolved = extractPreviewUrl(payload)
      if (resolved) return resolved
    } catch {
      // Keep trying known endpoints, then fall back to the local mock target.
    }
  }

  return readMockPreviewUrl()
}
