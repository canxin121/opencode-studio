import type { JsonValue as JsonLike } from '@/types/json'

export type PluginRuntimeStatus = 'ready' | 'manifest_missing' | 'manifest_invalid' | 'resolve_error'

export type PluginListItem = {
  id: string
  spec: string
  status: PluginRuntimeStatus
  rootPath?: string
  manifestPath?: string
  displayName?: string
  version?: string
  capabilities: string[]
  error?: string
  hasManifest: boolean
}

export type PluginListResponse = {
  updatedAt: number
  sourceSpecs: string[]
  plugins: PluginListItem[]
}

export type PluginManifestResponse = {
  id: string
  spec: string
  rootPath?: string
  manifestPath: string
  manifest: JsonLike
}

export type PluginActionError = {
  code: string
  message: string
  details?: JsonLike
}

export type PluginActionResponse = {
  ok: boolean
  data?: JsonLike
  error?: PluginActionError
}
