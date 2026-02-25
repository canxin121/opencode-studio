import type { JsonValue } from '@/types/json'

export type ChatActivityType =
  | 'tool'
  | 'step-start'
  | 'step-finish'
  | 'snapshot'
  | 'patch'
  | 'agent'
  | 'retry'
  | 'compaction'

// Controls UI default expansion and (optionally) backend detail transport.
// These include activity-like parts that aren't part of ChatActivityType filters.
export type ChatActivityExpandKey = ChatActivityType | 'thinking' | 'justification'

export type KnownChatToolActivityType =
  | 'read'
  | 'list'
  | 'glob'
  | 'grep'
  | 'edit'
  | 'write'
  | 'apply_patch'
  | 'multiedit'
  | 'bash'
  | 'task'
  | 'webfetch'
  | 'websearch'
  | 'codesearch'
  | 'skill'
  | 'lsp'
  | 'todowrite'
  | 'todoread'
  | 'question'
  | 'batch'
  | 'plan_enter'
  | 'plan_exit'
  | 'unknown'

export type ChatToolActivityType = KnownChatToolActivityType | (string & {})

export const DEFAULT_CHAT_ACTIVITY_FILTERS: ChatActivityType[] = ['tool', 'snapshot', 'patch', 'retry', 'compaction']

export const DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS: ChatActivityExpandKey[] = [
  'snapshot',
  'patch',
  'retry',
  'compaction',
  'thinking',
  'justification',
]

export const DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS: ChatToolActivityType[] = [
  'read',
  'list',
  'glob',
  'grep',
  'edit',
  'write',
  'apply_patch',
  'multiedit',
  'bash',
  'task',
  'webfetch',
  'websearch',
  'codesearch',
  'skill',
  'lsp',
  'todowrite',
  'todoread',
  'question',
  'batch',
  'plan_enter',
  'plan_exit',
  'unknown',
]

const CHAT_ACTIVITY_SET = new Set(DEFAULT_CHAT_ACTIVITY_FILTERS)
const CHAT_TOOL_ACTIVITY_SET = new Set(DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS)
const CHAT_ACTIVITY_EXPAND_SET = new Set(DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS)

export function isKnownChatToolActivityType(value: string): value is KnownChatToolActivityType {
  return CHAT_TOOL_ACTIVITY_SET.has(value as KnownChatToolActivityType)
}

export function normalizeChatActivityFilters(value: JsonValue): ChatActivityType[] {
  const requested = new Set<string>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue
      const key = item.trim().toLowerCase()
      if (!CHAT_ACTIVITY_SET.has(key as ChatActivityType)) continue
      requested.add(key)
    }
  }

  // Tool activity is controlled by chatActivityToolFilters; keep top-level tool
  // activity always enabled.
  requested.add('tool')

  const out: ChatActivityType[] = []
  for (const key of DEFAULT_CHAT_ACTIVITY_FILTERS) {
    if (requested.has(key)) out.push(key)
  }
  return out
}

export function normalizeChatToolActivityFilters(value: JsonValue): ChatToolActivityType[] {
  const out: ChatToolActivityType[] = []
  const seen = new Set<string>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue
      let key = item.trim().toLowerCase()
      // Backward compatibility with older builds.
      if (key === 'invalid') key = 'unknown'
      if (!key) continue
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

export function normalizeChatActivityDefaultExpanded(value: JsonValue): ChatActivityExpandKey[] {
  const requested = new Set<string>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue
      const key = item.trim().toLowerCase()
      if (!CHAT_ACTIVITY_EXPAND_SET.has(key as ChatActivityExpandKey)) continue
      requested.add(key)
    }
  }

  const out: ChatActivityExpandKey[] = []
  for (const key of DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS) {
    if (requested.has(key)) out.push(key)
  }
  return out
}

export const ACTIVITY_DEFAULT_EXPANDED_OPTIONS: Array<{
  id: ChatActivityExpandKey
  label: string
  description: string
}> = [
  { id: 'snapshot', label: 'Snapshots', description: 'Snapshot payloads.' },
  { id: 'patch', label: 'Patches', description: 'Patch payloads.' },
  { id: 'retry', label: 'Retries', description: 'Retry state metadata.' },
  { id: 'compaction', label: 'Compaction', description: 'Memory compaction markers.' },
  { id: 'thinking', label: 'Thinking', description: 'Reasoning / thinking traces.' },
  { id: 'justification', label: 'Justification', description: 'Text justification activity.' },
]

export const TOOL_ACTIVITY_OPTIONS: Array<{
  id: ChatToolActivityType
  label: string
  description: string
}> = [
  { id: 'read', label: 'Read', description: 'Read a file.' },
  { id: 'list', label: 'List', description: 'List directory contents.' },
  { id: 'glob', label: 'Glob', description: 'Match files by glob.' },
  { id: 'grep', label: 'Grep', description: 'Search file contents.' },
  { id: 'edit', label: 'Edit', description: 'Edit file content.' },
  { id: 'write', label: 'Write', description: 'Create or overwrite files.' },
  { id: 'apply_patch', label: 'Apply Patch', description: 'Apply patch sets.' },
  { id: 'multiedit', label: 'Multi-Edit', description: 'Batch file edits.' },
  { id: 'bash', label: 'Bash', description: 'Shell commands.' },
  { id: 'task', label: 'Task', description: 'Sub-agent execution.' },
  { id: 'webfetch', label: 'Web Fetch', description: 'Fetch a URL.' },
  { id: 'websearch', label: 'Web Search', description: 'Search the web.' },
  { id: 'codesearch', label: 'Code Search', description: 'Search code on the web.' },
  { id: 'skill', label: 'Skill', description: 'Run a skill tool.' },
  { id: 'lsp', label: 'LSP', description: 'Language server queries.' },
  { id: 'todowrite', label: 'Todo Write', description: 'Update todo list.' },
  { id: 'todoread', label: 'Todo Read', description: 'Read todo list.' },
  { id: 'question', label: 'Question', description: 'Ask user questions.' },
  { id: 'batch', label: 'Batch', description: 'Batch tool execution.' },
  { id: 'plan_enter', label: 'Plan Enter', description: 'Enter plan mode.' },
  { id: 'plan_exit', label: 'Plan Exit', description: 'Exit plan mode.' },
  { id: 'unknown', label: 'Unknown', description: 'Unknown/custom plugin tools.' },
]
