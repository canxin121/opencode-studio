import type { JsonValue as JsonLike } from '@/types/json'
import type { PluginManifestResponse } from '@/plugins/host/types'

export type ChatMountSurface = 'chat.sidebar' | 'chat.activity.inline' | 'chat.message.footer'

export type ChatMount = {
  pluginId: string
  surface: ChatMountSurface
  entry: string
  title: string
}

export type ChatMountMap = Record<ChatMountSurface, ChatMount[]>

const CHAT_SURFACES: ChatMountSurface[] = ['chat.sidebar', 'chat.activity.inline', 'chat.message.footer']

function asObject(value: JsonLike): Record<string, JsonLike> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, JsonLike>
}

function normalizeSurface(value: string): ChatMountSurface | null {
  const v = String(value || '').trim().toLowerCase()
  if (CHAT_SURFACES.includes(v as ChatMountSurface)) return v as ChatMountSurface
  return null
}

function normalizeEntry(value: JsonLike): string {
  return typeof value === 'string' ? value.trim() : ''
}

function defaultEntryFromManifest(manifest: PluginManifestResponse): string {
  const ui = asObject(asObject(manifest.manifest).ui)
  return normalizeEntry(ui.entry)
}

function pushMount(
  out: ChatMount[],
  pluginId: string,
  pluginTitle: string,
  surface: string,
  entry: string,
  title?: string,
) {
  const normalizedSurface = normalizeSurface(surface)
  const normalizedEntry = normalizeEntry(entry)
  if (!normalizedSurface || !normalizedEntry) return
  out.push({
    pluginId,
    surface: normalizedSurface,
    entry: normalizedEntry,
    title: String(title || pluginTitle || pluginId).trim() || pluginId,
  })
}

function mountsFromManifest(manifest: PluginManifestResponse): ChatMount[] {
  const root = asObject(manifest.manifest)
  const mountsValue = root.mounts
  const defaultEntry = defaultEntryFromManifest(manifest)
  const pluginTitle = String(root.displayName || root.id || manifest.id || '').trim() || manifest.id
  const out: ChatMount[] = []

  if (Array.isArray(mountsValue)) {
    for (const item of mountsValue) {
      if (typeof item === 'string') {
        pushMount(out, manifest.id, pluginTitle, item, defaultEntry)
        continue
      }
      const obj = asObject(item)
      const surface = String(obj.surface || '').trim()
      const entry = normalizeEntry(obj.entry) || defaultEntry
      const title = typeof obj.title === 'string' ? obj.title : undefined
      pushMount(out, manifest.id, pluginTitle, surface, entry, title)
    }
    return out
  }

  const mountsObj = asObject(mountsValue)
  const mountKeys = Object.keys(mountsObj)
  if (mountKeys.length > 0) {
    for (const surface of mountKeys) {
      const raw = mountsObj[surface]
      if (raw === true) {
        pushMount(out, manifest.id, pluginTitle, surface, defaultEntry)
        continue
      }
      if (typeof raw === 'string') {
        pushMount(out, manifest.id, pluginTitle, surface, raw)
        continue
      }
      const obj = asObject(raw)
      if (!Object.keys(obj).length) continue
      const entry = normalizeEntry(obj.entry) || defaultEntry
      const title = typeof obj.title === 'string' ? obj.title : undefined
      pushMount(out, manifest.id, pluginTitle, surface, entry, title)
    }
    return out
  }

  // Fallback: if plugin declares chat.sidebar capability and has a UI entry,
  // mount it by default.
  const capabilities = Array.isArray(root.capabilities) ? root.capabilities : []
  const hasSidebarCapability = capabilities.some((item) => String(item || '').trim() === 'chat.sidebar')
  if (hasSidebarCapability && defaultEntry) {
    pushMount(out, manifest.id, pluginTitle, 'chat.sidebar', defaultEntry)
  }

  return out
}

export function resolveChatMounts(manifestsById: Record<string, PluginManifestResponse>): ChatMountMap {
  const result: ChatMountMap = {
    'chat.sidebar': [],
    'chat.activity.inline': [],
    'chat.message.footer': [],
  }

  for (const manifest of Object.values(manifestsById || {})) {
    const mounts = mountsFromManifest(manifest)
    for (const mount of mounts) {
      result[mount.surface].push(mount)
    }
  }

  return result
}

export function pluginAssetEntryUrl(pluginId: string, entry: string): string {
  const id = String(pluginId || '').trim()
  const rawEntry = String(entry || '').trim().replace(/^\/+/, '')
  const encodedPath = rawEntry
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/plugins/${encodeURIComponent(id)}/assets/${encodedPath}`
}
