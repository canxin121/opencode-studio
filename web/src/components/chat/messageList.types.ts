import type { JsonValue } from '@/types/json'

export type MessagePartLike = {
  id?: string
  type?: string
  tool?: string
  state?: JsonValue
  text?: string
  url?: string
  filename?: string
  mime?: string
  synthetic?: boolean
  ignored?: boolean
  [k: string]: JsonValue
}

export type MessageLike = {
  info: {
    id?: string
    role?: string
    time?: { created?: number }
    finish?: string
    agent?: string
    modelID?: string
  }
  parts: MessagePartLike[]
}

export type RevertLike = {
  messageID: string
  revertedUserCount: number
  diffFiles: Array<{ filename: string; additions: number; deletions: number }>
}

export type RetryStatusLike = {
  next?: number
  attempt?: number
  message?: string
  [k: string]: JsonValue
} | null

export type SessionErrorLike = {
  at: number
  error: {
    message: string
    rendered?: string
    code?: string
    classification?: string
  }
} | null

export type RenderBlock =
  | { kind: 'message'; key: string; message: MessageLike; textParts: MessagePartLike[] }
  | {
      kind: 'activity'
      key: string
      parts: MessagePartLike[]
      fromId: string | null
      toId: string | null
      timeLabel: string
    }
  | { kind: 'revert'; key: string; revert: RevertLike }
