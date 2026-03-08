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

export type UnifiedMonacoDiffModel = {
  modelId: string
  path: string
  original: string
  modified: string
  hasChanges: boolean
  initialTopLine: number | null
  originalStartLine: number | null
  modifiedStartLine: number | null
  originalLineNumbers: Array<number | null> | null
  modifiedLineNumbers: Array<number | null> | null
}

export type VirtualDiffInput = {
  modelId?: string | null
  path?: string | null
  original?: string | null
  modified?: string | null
  diff?: string | null
  meta?: GitDiffMeta | null
  preferPatch?: boolean
  compactSnapshots?: boolean
  contextLines?: number
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

function normalizeTextBlock(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function normalizePositiveLine(value: unknown): number | null {
  const line = Number(value)
  if (!Number.isFinite(line) || line <= 0) return null
  return Math.floor(line)
}

function hasMappedLines(map: Array<number | null>): boolean {
  return map.some((line) => Number.isFinite(line) && Number(line) > 0)
}

function normalizeLineNumberMap(map: Array<number | null>): Array<number | null> | null {
  if (!Array.isArray(map) || !map.length) return null
  if (!hasMappedLines(map)) return null
  return map
}

function firstMappedLine(map: Array<number | null> | null | undefined): number | null {
  if (!Array.isArray(map)) return null
  for (const entry of map) {
    const line = normalizePositiveLine(entry)
    if (line !== null) return line
  }
  return null
}

function compactSnapshotPair(
  originalText: string,
  modifiedText: string,
  contextLines: number,
): { original: string; modified: string } {
  const originalLines = normalizeTextBlock(originalText).split('\n')
  const modifiedLines = normalizeTextBlock(modifiedText).split('\n')

  const maxHead = Math.min(originalLines.length, modifiedLines.length)
  let sharedPrefix = 0
  while (sharedPrefix < maxHead && originalLines[sharedPrefix] === modifiedLines[sharedPrefix]) {
    sharedPrefix += 1
  }

  const maxTail = Math.min(originalLines.length - sharedPrefix, modifiedLines.length - sharedPrefix)
  let sharedSuffix = 0
  while (
    sharedSuffix < maxTail &&
    originalLines[originalLines.length - 1 - sharedSuffix] === modifiedLines[modifiedLines.length - 1 - sharedSuffix]
  ) {
    sharedSuffix += 1
  }

  if (sharedPrefix === originalLines.length && sharedPrefix === modifiedLines.length) {
    return {
      original: normalizeTextBlock(originalText),
      modified: normalizeTextBlock(modifiedText),
    }
  }

  const context = Math.max(0, Math.floor(contextLines))
  const start = Math.max(0, sharedPrefix - context)
  const originalEnd = Math.min(originalLines.length, originalLines.length - sharedSuffix + context)
  const modifiedEnd = Math.min(modifiedLines.length, modifiedLines.length - sharedSuffix + context)

  const originalSlice = originalLines.slice(start, originalEnd)
  const modifiedSlice = modifiedLines.slice(start, modifiedEnd)

  if (start > 0) {
    originalSlice.unshift('... (omitted)')
    modifiedSlice.unshift('... (omitted)')
  }

  if (originalEnd < originalLines.length || modifiedEnd < modifiedLines.length) {
    originalSlice.push('... (omitted)')
    modifiedSlice.push('... (omitted)')
  }

  return {
    original: originalSlice.join('\n'),
    modified: modifiedSlice.join('\n'),
  }
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

function normalizeMetaHunk(
  fileHeader: string[],
  rawHunk: GitDiffHunkMeta | Record<string, unknown>,
  index: number,
): ParsedUnifiedDiffHunk {
  const header = String(rawHunk.header || '').trim()
  const parsedHeader = parseHunkHeader(header)
  const lines = Array.isArray(rawHunk.lines) ? rawHunk.lines.map((line) => normalizeLine(line)) : []
  const counted = countHunkChanges(lines)
  const patchAllowed = hasPatchHeader(fileHeader)
  const patch =
    typeof rawHunk.patch === 'string' ? rawHunk.patch : patchAllowed ? buildHunkPatch(fileHeader, header, lines) : ''
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

function parseHeaderPath(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) return ''
  let raw = line.slice(prefix.length).trim()
  if (!raw || raw === '/dev/null') return ''

  const tabIdx = raw.indexOf('\t')
  if (tabIdx > 0) raw = raw.slice(0, tabIdx)

  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) {
    raw = raw.slice(1, -1)
  }

  if (raw.startsWith('a/') || raw.startsWith('b/')) {
    raw = raw.slice(2)
  }

  return raw.trim()
}

function extractHeaderPath(fileHeader: string[]): string {
  for (const line of fileHeader) {
    const parsed = parseHeaderPath(line, '+++ ')
    if (parsed) return parsed
  }

  for (const line of fileHeader) {
    const parsed = parseHeaderPath(line, '--- ')
    if (parsed) return parsed
  }

  for (const line of fileHeader) {
    const match = line.match(/^diff --git\s+(\S+)\s+(\S+)$/)
    if (!match) continue
    const right = parseHeaderPath(`+++ ${match[2] || ''}`, '+++ ')
    if (right) return right
    const left = parseHeaderPath(`--- ${match[1] || ''}`, '--- ')
    if (left) return left
  }

  return ''
}

function extractPathFromDiffSource(source: string): string {
  const lines = normalizeTextBlock(source).split('\n')

  for (const rawLine of lines) {
    const parsed = parseHeaderPath(normalizeLine(rawLine), '+++ ')
    if (parsed) return parsed
  }

  for (const rawLine of lines) {
    const parsed = parseHeaderPath(normalizeLine(rawLine), '--- ')
    if (parsed) return parsed
  }

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)
    const match = line.match(/^diff --git\s+(\S+)\s+(\S+)$/)
    if (!match) continue
    const right = parseHeaderPath(`+++ ${match[2] || ''}`, '+++ ')
    if (right) return right
    const left = parseHeaderPath(`--- ${match[1] || ''}`, '--- ')
    if (left) return left
  }

  return ''
}

export function resolveInitialTopLineFromParsedDiff(parsed: ParsedUnifiedDiffModel | null | undefined): number | null {
  if (!parsed || !Array.isArray(parsed.hunks) || !parsed.hunks.length) return null
  const firstHunk = parsed.hunks[0]
  if (!firstHunk) return null

  const candidates = [firstHunk.anchorLine, firstHunk.newStart, firstHunk.oldStart]
  for (const candidate of candidates) {
    const line = normalizePositiveLine(candidate)
    if (line !== null) return line
  }

  return null
}

export function resolveInitialTopLineFromUnifiedDiff(diff: string, meta?: GitDiffMeta | null): number | null {
  return resolveInitialTopLineFromParsedDiff(buildUnifiedDiffModel(diff, meta))
}

export function resolveInitialTopLineFromTextPair(originalText: string, modifiedText: string): number | null {
  const originalLines = normalizeTextBlock(originalText).split('\n')
  const modifiedLines = normalizeTextBlock(modifiedText).split('\n')
  const maxLength = Math.max(originalLines.length, modifiedLines.length)

  for (let index = 0; index < maxLength; index += 1) {
    const originalLine = index < originalLines.length ? originalLines[index] : null
    const modifiedLine = index < modifiedLines.length ? modifiedLines[index] : null
    if (originalLine !== modifiedLine) return index + 1
  }

  return null
}

function isUnifiedDiffMetaLine(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('dissimilarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('copy from') ||
    line.startsWith('copy to') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch')
  )
}

function isLikelyMultiFileUnifiedDiff(source: string): boolean {
  if (!source.trim()) return false
  const matches = normalizeTextBlock(source).match(/^diff --git\s+/gm)
  return Array.isArray(matches) && matches.length > 1
}

function buildMonacoDiffFromRawUnified(source: string): {
  original: string
  modified: string
  hasChanges: boolean
  initialTopLine: number | null
  originalStartLine: number | null
  modifiedStartLine: number | null
  originalLineNumbers: Array<number | null> | null
  modifiedLineNumbers: Array<number | null> | null
} | null {
  if (!source.trim()) return null

  const lines = source.split('\n')
  const original: string[] = []
  const modified: string[] = []
  const originalLineNumbers: Array<number | null> = []
  const modifiedLineNumbers: Array<number | null> = []
  let inHunk = false
  let sawHunkHeader = false
  let hasChanges = false
  let oldLineCursor = 1
  let newLineCursor = 1
  let initialTopLine: number | null = null

  const pushOriginal = (line: string, lineNumber: number | null) => {
    original.push(line)
    originalLineNumbers.push(lineNumber)
  }

  const pushModified = (line: string, lineNumber: number | null) => {
    modified.push(line)
    modifiedLineNumbers.push(lineNumber)
  }

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)

    if (line.startsWith('@@')) {
      const parsedHeader = parseHunkHeader(line)
      const nextOld = normalizePositiveLine(parsedHeader.oldStart)
      const nextNew = normalizePositiveLine(parsedHeader.newStart)
      if (nextOld !== null) oldLineCursor = nextOld
      if (nextNew !== null) newLineCursor = nextNew
      if (initialTopLine === null) {
        initialTopLine = nextNew || nextOld
      }

      sawHunkHeader = true
      inHunk = true
      pushOriginal(line, null)
      pushModified(line, null)
      continue
    }

    if (isUnifiedDiffMetaLine(line)) {
      inHunk = false
      pushOriginal(line, null)
      pushModified(line, null)
      continue
    }

    if (inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        pushModified(line.slice(1), newLineCursor)
        if (initialTopLine === null) initialTopLine = newLineCursor
        newLineCursor += 1
        hasChanges = true
        continue
      }

      if (line.startsWith('-') && !line.startsWith('---')) {
        pushOriginal(line.slice(1), oldLineCursor)
        if (initialTopLine === null) initialTopLine = newLineCursor
        oldLineCursor += 1
        hasChanges = true
        continue
      }

      if (line.startsWith('\\')) {
        continue
      }

      if (line.startsWith(' ') || line.startsWith('\t')) {
        const content = line.slice(1)
        pushOriginal(content, oldLineCursor)
        pushModified(content, newLineCursor)
        oldLineCursor += 1
        newLineCursor += 1
        continue
      }
    }

    pushOriginal(line, null)
    pushModified(line, null)
  }

  if (!sawHunkHeader || !hasChanges) {
    return null
  }

  const normalizedOriginalLineNumbers = normalizeLineNumberMap(originalLineNumbers)
  const normalizedModifiedLineNumbers = normalizeLineNumberMap(modifiedLineNumbers)
  const originalStartLine = firstMappedLine(normalizedOriginalLineNumbers)
  const modifiedStartLine = firstMappedLine(normalizedModifiedLineNumbers)

  return {
    original: original.join('\n'),
    modified: modified.join('\n'),
    hasChanges: true,
    initialTopLine: initialTopLine || modifiedStartLine || originalStartLine,
    originalStartLine,
    modifiedStartLine,
    originalLineNumbers: normalizedOriginalLineNumbers,
    modifiedLineNumbers: normalizedModifiedLineNumbers,
  }
}

export function buildUnifiedMonacoDiffModel(diff: string, meta?: GitDiffMeta | null): UnifiedMonacoDiffModel {
  const source = normalizeTextBlock(diff)
  const parsedFromMeta = meta && typeof meta === 'object' ? normalizeMeta(meta) : null
  const parsed = parsedFromMeta || (source.trim() ? getCachedFallback(source) : null)
  const initialTopLineFromParsed = resolveInitialTopLineFromParsedDiff(parsed)
  const pathFromSource = extractPathFromDiffSource(source)
  const pathFromMeta = parsedFromMeta ? extractHeaderPath(parsedFromMeta.fileHeader) : ''
  const path = pathFromSource || pathFromMeta || 'activity.patch'

  const rawMonaco = buildMonacoDiffFromRawUnified(source)
  const shouldPreferRaw = Boolean(rawMonaco) && isLikelyMultiFileUnifiedDiff(source)
  if (rawMonaco && (shouldPreferRaw || !parsed || !parsed.hunks.length)) {
    return {
      modelId: `diff:${path}`,
      path,
      original: rawMonaco.original,
      modified: rawMonaco.modified,
      hasChanges: true,
      initialTopLine: rawMonaco.initialTopLine || initialTopLineFromParsed,
      originalStartLine: rawMonaco.originalStartLine,
      modifiedStartLine: rawMonaco.modifiedStartLine,
      originalLineNumbers: rawMonaco.originalLineNumbers,
      modifiedLineNumbers: rawMonaco.modifiedLineNumbers,
    }
  }

  if (!parsed || !parsed.hunks.length) {
    if (rawMonaco) {
      return {
        modelId: `diff:${path}`,
        path,
        original: rawMonaco.original,
        modified: rawMonaco.modified,
        hasChanges: true,
        initialTopLine: rawMonaco.initialTopLine,
        originalStartLine: rawMonaco.originalStartLine,
        modifiedStartLine: rawMonaco.modifiedStartLine,
        originalLineNumbers: rawMonaco.originalLineNumbers,
        modifiedLineNumbers: rawMonaco.modifiedLineNumbers,
      }
    }

    return {
      modelId: `diff:${path}`,
      path,
      original: source,
      modified: source,
      hasChanges: false,
      initialTopLine: null,
      originalStartLine: null,
      modifiedStartLine: null,
      originalLineNumbers: null,
      modifiedLineNumbers: null,
    }
  }

  const original: string[] = []
  const modified: string[] = []
  const originalLineNumbers: Array<number | null> = []
  const modifiedLineNumbers: Array<number | null> = []
  let hasChanges = false

  const pushOriginal = (line: string, lineNumber: number | null) => {
    original.push(line)
    originalLineNumbers.push(lineNumber)
  }

  const pushModified = (line: string, lineNumber: number | null) => {
    modified.push(line)
    modifiedLineNumbers.push(lineNumber)
  }

  for (const [index, hunk] of parsed.hunks.entries()) {
    if (index > 0) {
      pushOriginal('', null)
      pushModified('', null)
    }

    if (hunk.header) {
      pushOriginal(hunk.header, null)
      pushModified(hunk.header, null)
    }

    let oldLineCursor = normalizePositiveLine(hunk.oldStart) || 1
    let newLineCursor = normalizePositiveLine(hunk.newStart) || 1

    for (const rawLine of hunk.lines) {
      const line = normalizeLine(rawLine)
      if (!line) {
        pushOriginal('', oldLineCursor)
        pushModified('', newLineCursor)
        oldLineCursor += 1
        newLineCursor += 1
        continue
      }

      if (line.startsWith(' ') || line.startsWith('\t')) {
        const content = line.slice(1)
        pushOriginal(content, oldLineCursor)
        pushModified(content, newLineCursor)
        oldLineCursor += 1
        newLineCursor += 1
        continue
      }

      if (line.startsWith('-') && !line.startsWith('---')) {
        pushOriginal(line.slice(1), oldLineCursor)
        oldLineCursor += 1
        hasChanges = true
        continue
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        pushModified(line.slice(1), newLineCursor)
        newLineCursor += 1
        hasChanges = true
        continue
      }

      if (line.startsWith('\\')) {
        continue
      }

      pushOriginal(line, null)
      pushModified(line, null)
    }
  }

  const originalText = original.join('\n')
  const modifiedText = modified.join('\n')
  const normalizedOriginalLineNumbers = normalizeLineNumberMap(originalLineNumbers)
  const normalizedModifiedLineNumbers = normalizeLineNumberMap(modifiedLineNumbers)
  const originalStartLine = firstMappedLine(normalizedOriginalLineNumbers)
  const modifiedStartLine = firstMappedLine(normalizedModifiedLineNumbers)
  const initialTopLine = hasChanges
    ? initialTopLineFromParsed || resolveInitialTopLineFromTextPair(originalText, modifiedText)
    : null

  return {
    modelId: `diff:${path}`,
    path,
    original: originalText,
    modified: modifiedText,
    hasChanges,
    initialTopLine,
    originalStartLine,
    modifiedStartLine,
    originalLineNumbers: normalizedOriginalLineNumbers,
    modifiedLineNumbers: normalizedModifiedLineNumbers,
  }
}

export function buildVirtualMonacoDiffModel(input: VirtualDiffInput): UnifiedMonacoDiffModel {
  const explicitOriginal = typeof input.original === 'string' ? normalizeTextBlock(input.original) : ''
  const explicitModified = typeof input.modified === 'string' ? normalizeTextBlock(input.modified) : ''
  const hasExplicitContent = typeof input.original === 'string' || typeof input.modified === 'string'
  const preferPatch = input.preferPatch === true
  const compactSnapshots = input.compactSnapshots === true
  const contextLines = Math.max(0, Math.floor(input.contextLines || 3))

  let path = String(input.path || '').trim()
  let original = explicitOriginal
  let modified = explicitModified
  let hasChanges = original !== modified
  let initialTopLine: number | null = null
  let originalStartLine: number | null = null
  let modifiedStartLine: number | null = null
  let originalLineNumbers: Array<number | null> | null = null
  let modifiedLineNumbers: Array<number | null> | null = null
  let usedPatchFallback = false

  const diffText = typeof input.diff === 'string' ? input.diff : ''
  const hasPatchFallback = diffText.trim().length > 0 || Boolean(input.meta)

  if (hasPatchFallback && (preferPatch || !hasExplicitContent || (!original && !modified))) {
    const fallback = buildUnifiedMonacoDiffModel(diffText, input.meta)
    if (!path) path = fallback.path
    const hasSnapshotFallback = hasExplicitContent && (explicitOriginal.length > 0 || explicitModified.length > 0)
    if (!preferPatch || fallback.hasChanges || !hasSnapshotFallback) {
      original = fallback.original
      modified = fallback.modified
      hasChanges = fallback.hasChanges
      initialTopLine = fallback.initialTopLine
      originalStartLine = fallback.originalStartLine
      modifiedStartLine = fallback.modifiedStartLine
      originalLineNumbers = fallback.originalLineNumbers
      modifiedLineNumbers = fallback.modifiedLineNumbers
      usedPatchFallback = true
    }
  }

  if (!usedPatchFallback && compactSnapshots && (original || modified)) {
    const compacted = compactSnapshotPair(original, modified, contextLines)
    original = compacted.original
    modified = compacted.modified
    hasChanges = original !== modified
  }

  if (!path) path = 'virtual.diff'

  if (hasChanges && initialTopLine === null) {
    initialTopLine = resolveInitialTopLineFromTextPair(original, modified)
  }

  const modelId = String(input.modelId || '').trim() || `virtual:${path}`

  return {
    modelId,
    path,
    original,
    modified,
    hasChanges,
    initialTopLine,
    originalStartLine,
    modifiedStartLine,
    originalLineNumbers,
    modifiedLineNumbers,
  }
}

export function buildUnifiedDiffModel(diff: string, meta?: GitDiffMeta | null): ParsedUnifiedDiffModel {
  if (meta && typeof meta === 'object') {
    return normalizeMeta(meta)
  }
  return getCachedFallback(diff)
}
