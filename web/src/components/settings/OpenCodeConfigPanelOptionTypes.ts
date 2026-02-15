import type { JsonValue as JsonLike } from '@/types/json'

export type AgentListItem = {
  name: string
  description?: string
  mode?: string
  hidden?: boolean
  disable?: boolean
}

export type ProviderListItem = {
  id: string
  name?: string
  source?: string
  env?: string[]
  key?: string
  options?: JsonLike
  models?: JsonLike
}

export type RemoteModel = {
  id: string
  providerID?: string
  api?: string
  name?: string
  family?: string
  status?: string
  release_date?: string
  limit?: { context?: number; input?: number; output?: number }
  capabilities?: {
    reasoning?: boolean
    toolcall?: boolean
    attachment?: boolean
    input?: { image?: boolean; pdf?: boolean; audio?: boolean; video?: boolean; text?: boolean }
    output?: { image?: boolean; pdf?: boolean; audio?: boolean; video?: boolean; text?: boolean }
    interleaved?: boolean | { field?: string }
  }
  cost?: {
    input?: number
    output?: number
    cache?: { read?: number; write?: number }
    experimentalOver200K?: { input?: number; output?: number; cache?: { read?: number; write?: number } }
  }
  options?: JsonLike
  headers?: Record<string, string>
}
