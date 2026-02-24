import type { JsonValue as JsonLike } from '@/types/json'
import type { PluginManifestResponse } from '@/plugins/host/types'
import { apiUrl } from '@/lib/api'

export type ChatMountSurface = 'chat.sidebar' | 'chat.activity.inline' | 'chat.message.footer' | 'chat.overlay.bottom'

export type PluginMountMode = 'iframe' | 'module'

export type ChatMount = {
  pluginId: string
  surface: ChatMountSurface
  entry: string
  title: string
  titleI18n?: Record<string, string>
  mode: PluginMountMode
  // Optional UI hints for the host renderer.
  height?: number
  // Runtime context for this mount. For iframe mounts this becomes query params.
  context?: Record<string, string>
  // Used for cache-busting module imports and debugging.
  pluginVersion?: string
}

export type ChatMountMap = Record<ChatMountSurface, ChatMount[]>

const CHAT_SURFACES: ChatMountSurface[] = [
  'chat.sidebar',
  'chat.activity.inline',
  'chat.message.footer',
  'chat.overlay.bottom',
]

function asObject(value: JsonLike): Record<string, JsonLike> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, JsonLike>
}

function normalizeSurface(value: string): ChatMountSurface | null {
  const v = String(value || '')
    .trim()
    .toLowerCase()
  if (CHAT_SURFACES.includes(v as ChatMountSurface)) return v as ChatMountSurface
  return null
}

function normalizeEntry(value: JsonLike): string {
  return typeof value === 'string' ? value.trim() : ''
}

type LocalizedText = {
  text: string
  i18n?: Record<string, string>
}

function parseI18nMap(value: JsonLike): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, JsonLike>)) {
    const mapKey = String(key || '').trim()
    if (!mapKey) continue
    const mapValue = typeof raw === 'string' ? raw.trim() : ''
    if (!mapValue) continue
    out[mapKey] = mapValue
  }
  return out
}

function normalizeLocalizedText(primary: JsonLike, i18n?: JsonLike): LocalizedText {
  const fromPrimaryMap = parseI18nMap(primary)
  const fromI18n = parseI18nMap(i18n ?? null)
  const mergedMap: Record<string, string> = {
    ...fromPrimaryMap,
    ...fromI18n,
  }

  const fromPrimaryText = typeof primary === 'string' ? primary.trim() : ''
  const fallback = mergedMap['en-US'] || mergedMap['zh-CN'] || Object.values(mergedMap)[0] || ''
  const text = fromPrimaryText || fallback

  return {
    text,
    i18n: Object.keys(mergedMap).length > 0 ? mergedMap : undefined,
  }
}

function normalizeMode(value: JsonLike, fallback: PluginMountMode): PluginMountMode {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'module' || raw === 'embedded') return 'module'
  if (raw === 'iframe' || raw === 'frame') return 'iframe'
  return fallback
}

function normalizeHeight(value: JsonLike): number | undefined {
  const raw = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return Math.max(80, Math.floor(raw))
}

function defaultModeFromManifest(manifest: PluginManifestResponse): PluginMountMode {
  const ui = asObject(asObject(manifest.manifest).ui)
  const uiMode = normalizeMode(ui.mode as JsonLike, 'iframe')
  return uiMode
}

function basenameLike(path: string): string {
  const normalized = String(path || '')
    .trim()
    .replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : ''
}

function defaultEntryFromManifest(manifest: PluginManifestResponse): string {
  const ui = asObject(asObject(manifest.manifest).ui)
  const entry = normalizeEntry(ui.entry)
  if (!entry) return ''

  // Server-side asset routing uses ui.assetsDir when present. When assetsDir is
  // missing, the server infers the asset root as the parent directory of ui.entry.
  // In that case, the client must request the entry relative to that inferred
  // root (i.e., basename only), not the full path.
  const assetsDir = normalizeEntry(ui.assetsDir)
  const assetsPath = normalizeEntry(ui.assetsPath)
  if (!assetsDir && !assetsPath && (entry.includes('/') || entry.includes('\\'))) {
    return basenameLike(entry)
  }

  return entry
}

function pushMount(
  out: ChatMount[],
  pluginId: string,
  pluginTitle: string,
  surface: string,
  entry: string,
  title?: JsonLike,
  mode: PluginMountMode = 'iframe',
  height?: number,
  pluginVersion?: string,
  titleI18n?: JsonLike,
) {
  const normalizedSurface = normalizeSurface(surface)
  const normalizedEntry = normalizeEntry(entry)
  if (!normalizedSurface || !normalizedEntry) return
  const localizedTitle = normalizeLocalizedText(title ?? null, titleI18n)
  const normalizedTitle = localizedTitle.text || String(pluginTitle || pluginId).trim() || pluginId
  out.push({
    pluginId,
    surface: normalizedSurface,
    entry: normalizedEntry,
    title: normalizedTitle,
    ...(localizedTitle.i18n ? { titleI18n: localizedTitle.i18n } : {}),
    mode,
    height,
    pluginVersion,
  })
}

function mountsFromManifest(manifest: PluginManifestResponse): ChatMount[] {
  const root = asObject(manifest.manifest)
  const mountsValue = root.mounts
  const defaultEntry = defaultEntryFromManifest(manifest)
  const defaultMode = defaultModeFromManifest(manifest)
  const pluginTitle = String(root.displayName || root.id || manifest.id || '').trim() || manifest.id
  const pluginVersion = typeof root.version === 'string' ? root.version.trim() : ''
  const out: ChatMount[] = []

  if (Array.isArray(mountsValue)) {
    for (const item of mountsValue) {
      if (typeof item === 'string') {
        pushMount(out, manifest.id, pluginTitle, item, defaultEntry, undefined, defaultMode, undefined, pluginVersion)
        continue
      }
      const obj = asObject(item)
      const surface = String(obj.surface || '').trim()
      const entry = normalizeEntry(obj.entry) || defaultEntry
      const title = (obj.title ?? null) as JsonLike
      const titleI18n = (obj.titleI18n ?? null) as JsonLike

      const mode = normalizeMode(obj.mode as JsonLike, defaultMode)
      const height = normalizeHeight((obj.height ?? obj.frameHeight ?? obj.heightPx) as JsonLike)
      pushMount(out, manifest.id, pluginTitle, surface, entry, title, mode, height, pluginVersion, titleI18n)
    }
    return out
  }

  const mountsObj = asObject(mountsValue)
  const mountKeys = Object.keys(mountsObj)
  if (mountKeys.length > 0) {
    for (const surface of mountKeys) {
      const raw = mountsObj[surface]
      if (raw === true) {
        pushMount(
          out,
          manifest.id,
          pluginTitle,
          surface,
          defaultEntry,
          undefined,
          defaultMode,
          undefined,
          pluginVersion,
        )
        continue
      }
      if (typeof raw === 'string') {
        pushMount(out, manifest.id, pluginTitle, surface, raw, undefined, defaultMode, undefined, pluginVersion)
        continue
      }
      const obj = asObject(raw)
      if (!Object.keys(obj).length) continue
      const entry = normalizeEntry(obj.entry) || defaultEntry
      const title = (obj.title ?? null) as JsonLike
      const titleI18n = (obj.titleI18n ?? null) as JsonLike

      const mode = normalizeMode(obj.mode as JsonLike, defaultMode)
      const height = normalizeHeight((obj.height ?? obj.frameHeight ?? obj.heightPx) as JsonLike)
      pushMount(out, manifest.id, pluginTitle, surface, entry, title, mode, height, pluginVersion, titleI18n)
    }
    return out
  }

  // Fallback: if plugin declares chat.sidebar capability and has a UI entry,
  // mount it by default.
  const capabilities = Array.isArray(root.capabilities) ? root.capabilities : []
  const hasSidebarCapability = capabilities.some((item) => String(item || '').trim() === 'chat.sidebar')
  if (hasSidebarCapability && defaultEntry) {
    pushMount(
      out,
      manifest.id,
      pluginTitle,
      'chat.sidebar',
      defaultEntry,
      undefined,
      defaultMode,
      undefined,
      pluginVersion,
    )
  }

  return out
}

export function resolveChatMounts(manifestsById: Record<string, PluginManifestResponse>): ChatMountMap {
  const result: ChatMountMap = {
    'chat.sidebar': [],
    'chat.activity.inline': [],
    'chat.message.footer': [],
    'chat.overlay.bottom': [],
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
  const rawEntry = String(entry || '')
    .trim()
    .replace(/^\/+/, '')
  const encodedPath = rawEntry
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return apiUrl(`/api/plugins/${encodeURIComponent(id)}/assets/${encodedPath}`)
}
