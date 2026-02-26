import type { MessageEntry, SessionFileDiff } from '../../types/chat'
import type { GitDiffMeta } from '@/types/git'

type UnknownRecord = Record<string, unknown>

type DiffStats = {
  file: string
  additions: number
  deletions: number
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstTrimmed(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const text = trimmed(record[key])
    if (text) return text
  }
  return ''
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function firstCount(record: UnknownRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value))
    }
  }
  return 0
}

function readDiffMeta(record: UnknownRecord): GitDiffMeta | null {
  const candidate = record.meta ?? record.diffMeta ?? record.diff_meta
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? (candidate as GitDiffMeta) : null
}

function normalizeDiffPath(rawPath: string, directory?: string | null): string {
  let out = (rawPath || '').trim()
  if (!out || out === '/dev/null') return ''

  if (out.startsWith('"') && out.endsWith('"') && out.length > 1) {
    out = out.slice(1, -1)
  }

  const tabIdx = out.indexOf('\t')
  if (tabIdx > 0) out = out.slice(0, tabIdx)

  out = out.replace(/\\/g, '/')
  if (out.startsWith('a/') || out.startsWith('b/')) {
    out = out.slice(2)
  }

  const dir = (directory || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (dir && out.startsWith(`${dir}/`)) {
    out = out.slice(dir.length + 1)
  }

  return out.trim()
}

function parseUnifiedDiffStats(diffText: string, directory?: string | null): DiffStats[] {
  const text = (diffText || '').trim()
  if (!text) return []

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const byFile = new Map<string, { additions: number; deletions: number }>()
  let current = ''

  const ensure = (rawName: string): string => {
    const file = normalizeDiffPath(rawName, directory)
    if (!file) return ''
    if (!byFile.has(file)) {
      byFile.set(file, { additions: 0, deletions: 0 })
    }
    return file
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git\s+(\S+)\s+(\S+)$/)
      if (match) {
        const right = typeof match[2] === 'string' ? match[2] : ''
        const left = typeof match[1] === 'string' ? match[1] : ''
        current = ensure(right || left)
      }
      continue
    }

    if (line.startsWith('Index: ')) {
      current = ensure(line.replace(/^Index:\s+/, ''))
      continue
    }

    if (line.startsWith('+++ ')) {
      current = ensure(line.replace(/^\+\+\+\s+/, '')) || current
      continue
    }

    if (!current && line.startsWith('--- ')) {
      current = ensure(line.replace(/^---\s+/, ''))
      continue
    }

    if (!current) continue
    const counts = byFile.get(current)
    if (!counts) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      counts.additions += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      counts.deletions += 1
    }
  }

  return [...byFile.entries()]
    .map(([file, counts]) => ({
      file,
      additions: counts.additions,
      deletions: counts.deletions,
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

function parseMetadataFileEntry(row: unknown, directory?: string | null): SessionFileDiff | null {
  const record = asRecord(row)
  const file = normalizeDiffPath(
    firstTrimmed(record, ['file', 'path', 'filename', 'name', 'target', 'filePath', 'filepath', 'relativePath']),
    directory,
  )
  if (!file) return null
  const diff = firstString(record, ['diff', 'patch'])
  const meta = readDiffMeta(record)
  return {
    file,
    before: firstString(record, ['before', 'old', 'oldText', 'original', 'previous', 'prev', 'from', 'left', 'a']),
    after: firstString(record, ['after', 'new', 'newText', 'modified', 'current', 'next', 'to', 'right', 'b']),
    additions: firstCount(record, ['additions', 'added', 'insertions', 'linesAdded', 'add']),
    deletions: firstCount(record, ['deletions', 'removed', 'linesDeleted', 'del']),
    ...(diff ? { diff } : {}),
    ...(meta ? { meta } : {}),
  }
}

function parsePartFallbackDiff(part: unknown, directory?: string | null): SessionFileDiff[] {
  const partRecord = asRecord(part)
  const type = trimmed(partRecord.type).toLowerCase()
  if (type !== 'tool' && type !== 'patch') return []

  const state = asRecord(partRecord.state)
  const metadata = (() => {
    const fromState = asRecord(state.metadata)
    if (Object.keys(fromState).length) return fromState
    return asRecord(partRecord.metadata)
  })()

  const byFile = new Map<string, SessionFileDiff>()

  const rawFiles = Array.isArray(metadata.files) ? metadata.files : []
  for (const row of rawFiles) {
    const parsed = parseMetadataFileEntry(row, directory)
    if (!parsed) continue
    byFile.set(parsed.file, parsed)
  }

  const diffText = firstString(metadata, ['diff', 'patch'])
  const parsedStats = parseUnifiedDiffStats(diffText, directory)
  for (const stat of parsedStats) {
    const previous = byFile.get(stat.file)
      byFile.set(stat.file, {
        file: stat.file,
        before: previous?.before || '',
        after: previous?.after || '',
        additions: stat.additions,
        deletions: stat.deletions,
        ...(previous?.diff || diffText ? { diff: previous?.diff || diffText } : {}),
        ...(previous?.meta ? { meta: previous.meta } : {}),
      })
  }

  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file))
}

export function buildSessionDiffFallbackFromMessages(
  messages: MessageEntry[],
  directory?: string | null,
): SessionFileDiff[] {
  if (!Array.isArray(messages) || messages.length === 0) return []

  const byFile = new Map<string, SessionFileDiff>()

  for (const message of messages) {
    const parts = Array.isArray(message?.parts) ? message.parts : []
    for (const part of parts) {
      const entries = parsePartFallbackDiff(part, directory)
      if (!entries.length) continue
      for (const entry of entries) {
        const previous = byFile.get(entry.file)
        byFile.set(entry.file, {
          file: entry.file,
          before: entry.before || previous?.before || '',
          after: entry.after || previous?.after || '',
          additions: entry.additions,
          deletions: entry.deletions,
          ...(entry.diff || previous?.diff ? { diff: entry.diff || previous?.diff } : {}),
          ...(entry.meta || previous?.meta ? { meta: entry.meta || previous?.meta } : {}),
        })
      }
    }
  }

  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file))
}
