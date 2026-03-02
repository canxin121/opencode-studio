import type { JsonValue } from '../../types/json'

export type ChatSidebarStateWire = {
  preferences?: JsonValue
  seq?: number
  directoriesPage?: JsonValue
  sessionPagesByDirectoryId?: JsonValue
  runtimeBySessionId?: JsonValue
  recentPage?: JsonValue
  runningPage?: JsonValue
  focus?: JsonValue
  view?: JsonValue
}

export const DIRECTORIES_PAGE_SIZE_DEFAULT = 15
