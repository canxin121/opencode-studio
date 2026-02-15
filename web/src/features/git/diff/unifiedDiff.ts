import type { GitDiffMeta, GitDiffHunkMeta, GitDiffSummary } from '@/types/git'

export type ParsedUnifiedDiffHunk = {
  id: string
  header: string
  range: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
  anchorLine: number
  lines: string[]
  patch: string
  patchReady: boolean
}

export type ParsedUnifiedDiffModel = {
  fileHeader: string[]
  hasPatchHeader: boolean
  hunks: ParsedUnifiedDiffHunk[]
  summary: GitDiffSummary
}

type ParsedHunkHeader = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

const FALLBACK_CACHE_LIMIT = 24
const fallbackDiffCache = new Map<string, ParsedUnifiedDiffModel>()

function asSafeInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

function normalizeLine(line: unknown): string {
  return String(line || '').replace(/\r$/, '')
}

function parseHunkHeader(header: string): ParsedHunkHeader {
  const match = header.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/)
  if (!match) {
    return {
      oldStart: 0,
      oldCount: 0,
      newStart: 0,
      newCount: 0,
    }
  }
  return {
    oldStart: asSafeInt(match[1], 0),
    oldCount: asSafeInt(match[2], 1),
    newStart: asSafeInt(match[3], 0),
    newCount: asSafeInt(match[4], 1),
  }
}

function formatHunkRange(header: string): string {
  const parsed = parseHunkHeader(header)
  return `-${parsed.oldStart},${parsed.oldCount} +${parsed.newStart},${parsed.newCount}`
}

function countHunkChanges(lines: string[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('\\')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function computeHunkAnchorLine(oldStart: number, newStart: number, lines: string[]): number {
  let nextNewLine = Math.max(1, newStart || 1)
  for (const line of lines) {
    if (!line) continue
    const prefix = line[0] || ''
    if (prefix === ' ') {
      nextNewLine += 1
      continue
    }
    if (prefix === '+' || prefix === '-') return Math.max(1, nextNewLine)
  }
  return Math.max(1, newStart || oldStart || 1)
}

function hasPatchHeader(fileHeader: string[]): boolean {
  return fileHeader.some((line) => line.startsWith('diff --git ') || line.startsWith('--- '))
}

function buildHunkPatch(fileHeader: string[], header: string, lines: string[]): string {
  return [...fileHeader, header, ...lines].join('\n') + '\n'
}

function normalizeSummary(value: unknown, fallback: GitDiffSummary): GitDiffSummary {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!input) return fallback
  return {
    files: asSafeInt(input.files, fallback.files),
    hunks: asSafeInt(input.hunks, fallback.hunks),
    changedLines: asSafeInt(input.changedLines, fallback.changedLines),
  }
}

function normalizeMetaHunk(fileHeader: string[], rawHunk: GitDiffHunkMeta | Record<string, unknown>, index: number): ParsedUnifiedDiffHunk {
  const header = String(rawHunk.header || '').trim()
  const parsedHeader = parseHunkHeader(header)
  const lines = Array.isArray(rawHunk.lines) ? rawHunk.lines.map((line) => normalizeLine(line)) : []
  const counted = countHunkChanges(lines)
  const patchAllowed = hasPatchHeader(fileHeader)
  const patch = typeof rawHunk.patch === 'string' ? rawHunk.patch : patchAllowed ? buildHunkPatch(fileHeader, header, lines) : ''
  const range = String(rawHunk.range || '').trim() || formatHunkRange(header)
  const oldStart = asSafeInt(rawHunk.oldStart, parsedHeader.oldStart)
  const oldCount = asSafeInt(rawHunk.oldCount, parsedHeader.oldCount)
  const newStart = asSafeInt(rawHunk.newStart, parsedHeader.newStart)
  const newCount = asSafeInt(rawHunk.newCount, parsedHeader.newCount)
  return {
    id: String(rawHunk.id || `${index + 1}`).trim() || `${index + 1}`,
    header,
    range,
    oldStart,
    oldCount,
    newStart,
    newCount,
    additions: asSafeInt(rawHunk.additions, counted.additions),
    deletions: asSafeInt(rawHunk.deletions, counted.deletions),
    anchorLine: asSafeInt(rawHunk.anchorLine, computeHunkAnchorLine(oldStart, newStart, lines)),
    lines,
    patch,
    patchReady: Boolean(rawHunk.patchReady) || (patchAllowed && Boolean(patch.trim())),
  }
}

function normalizeMeta(meta: GitDiffMeta): ParsedUnifiedDiffModel {
  const fileHeader = Array.isArray(meta.fileHeader) ? meta.fileHeader.map((line) => normalizeLine(line)) : []
  const hunksRaw = Array.isArray(meta.hunks) ? meta.hunks : []
  const hunks = hunksRaw.map((hunk, index) => normalizeMetaHunk(fileHeader, hunk, index))
  const changedLines = hunks.reduce((total, hunk) => total + hunk.additions + hunk.deletions, 0)
  const fallbackSummary: GitDiffSummary = {
    files: fileHeader.length || hunks.length ? 1 : 0,
    hunks: hunks.length,
    changedLines,
  }
  const summary = normalizeSummary(meta.summary, fallbackSummary)
  const normalized: ParsedUnifiedDiffModel = {
    fileHeader,
    hasPatchHeader: Boolean(meta.hasPatchHeader) || hasPatchHeader(fileHeader),
    hunks,
    summary,
  }

  if (!normalized.summary.hunks) {
    normalized.summary.hunks = hunks.length
  }
  if (!normalized.summary.changedLines) {
    normalized.summary.changedLines = changedLines
  }

  return normalized
}

function parseFallback(diff: string): ParsedUnifiedDiffModel {
  const source = String(diff || '')
  if (!source.trim()) {
    return {
      fileHeader: [],
      hasPatchHeader: false,
      hunks: [],
      summary: { files: 0, hunks: 0, changedLines: 0 },
    }
  }

  const lines = source.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const fileHeader: string[] = []
  const hunks: ParsedUnifiedDiffHunk[] = []

  let inHeader = false
  let currentHeader = ''
  let currentLines: string[] | null = null

  function pushCurrentHunk() {
    if (!currentLines || !currentHeader) return
    const parsedHeader = parseHunkHeader(currentHeader)
    const { additions, deletions } = countHunkChanges(currentLines)
    const patchAllowed = hasPatchHeader(fileHeader)
    hunks.push({
      id: `${hunks.length + 1}`,
      header: currentHeader,
      range: formatHunkRange(currentHeader),
      oldStart: parsedHeader.oldStart,
      oldCount: parsedHeader.oldCount,
      newStart: parsedHeader.newStart,
      newCount: parsedHeader.newCount,
      additions,
      deletions,
      anchorLine: computeHunkAnchorLine(parsedHeader.oldStart, parsedHeader.newStart, currentLines),
      lines: [...currentLines],
      patch: patchAllowed ? buildHunkPatch(fileHeader, currentHeader, currentLines) : '',
      patchReady: patchAllowed,
    })
  }

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)

    if (line.startsWith('diff --git ')) {
      if (currentLines) {
        pushCurrentHunk()
        currentLines = null
      }
      if (fileHeader.length && hunks.length) break
      fileHeader.length = 0
      fileHeader.push(line)
      inHeader = true
      continue
    }

    if (inHeader) {
      if (line.startsWith('@@')) {
        currentHeader = line
        currentLines = []
        inHeader = false
      } else {
        fileHeader.push(line)
      }
      continue
    }

    if (line.startsWith('@@')) {
      pushCurrentHunk()
      currentHeader = line
      currentLines = []
      continue
    }

    if (currentLines) {
      currentLines.push(line)
      continue
    }

    if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to') ||
      line.startsWith('copy from') ||
      line.startsWith('copy to')
    ) {
      fileHeader.push(line)
    }
  }

  pushCurrentHunk()

  const changedLines = hunks.reduce((total, hunk) => total + hunk.additions + hunk.deletions, 0)
  return {
    fileHeader,
    hasPatchHeader: hasPatchHeader(fileHeader),
    hunks,
    summary: {
      files: fileHeader.length || hunks.length ? 1 : 0,
      hunks: hunks.length,
      changedLines,
    },
  }
}

function getCachedFallback(diff: string): ParsedUnifiedDiffModel {
  const key = String(diff || '')
  const cached = fallbackDiffCache.get(key)
  if (cached) {
    fallbackDiffCache.delete(key)
    fallbackDiffCache.set(key, cached)
    return cached
  }

  const parsed = parseFallback(key)
  fallbackDiffCache.set(key, parsed)
  while (fallbackDiffCache.size > FALLBACK_CACHE_LIMIT) {
    const oldestKey = fallbackDiffCache.keys().next().value
    if (typeof oldestKey !== 'string') break
    fallbackDiffCache.delete(oldestKey)
  }
  return parsed
}

export function buildUnifiedDiffModel(diff: string, meta?: GitDiffMeta | null): ParsedUnifiedDiffModel {
  if (meta && typeof meta === 'object') {
    return normalizeMeta(meta)
  }
  return getCachedFallback(diff)
}
