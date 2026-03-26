export type WorkspaceLinkTarget = {
  path: string
  line?: number
  column?: number
  anchor?: string
}

export type WorkspaceLinkOptions = {
  workspaceRoot: string
  baseFilePath?: string
}

export type MediaKind = 'image' | 'video' | 'audio'

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'icns',
  'bmp',
  'tiff',
  'tif',
  'avif',
  'heic',
  'heif',
  'jxl',
])

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'])
const FS_API_PATHS = new Set(['/api/fs/raw', '/api/fs/download'])

function normalizePath(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
}

function trimTrailingSlashes(raw: string): string {
  const normalized = normalizePath(raw)
  if (!normalized) return ''
  if (normalized === '/') return '/'
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized
  const trimmed = normalized.replace(/\/+$/g, '')
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`
  return trimmed || normalized
}

function pathForCompare(raw: string): string {
  const normalized = trimTrailingSlashes(raw)
  if (/^[A-Za-z]:/.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`
  }
  return normalized
}

function isAbsoluteFsPath(raw: string): boolean {
  return raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:\//.test(raw)
}

function decodeMaybe(raw: string): string {
  const input = String(raw || '')
  if (!input.includes('%')) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function collapsePath(raw: string): string {
  const normalized = normalizePath(raw)
  if (!normalized) return ''

  let prefix = ''
  let rest = normalized
  if (/^[A-Za-z]:\//.test(normalized)) {
    prefix = normalized.slice(0, 3)
    rest = normalized.slice(3)
  } else if (normalized.startsWith('//')) {
    prefix = '//'
    rest = normalized.slice(2)
  } else if (normalized.startsWith('/')) {
    prefix = '/'
    rest = normalized.slice(1)
  }

  const out: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length) {
        out.pop()
        continue
      }
      if (!prefix) {
        out.push('..')
      }
      continue
    }
    out.push(part)
  }

  if (prefix === '/' || prefix === '//') {
    return `${prefix}${out.join('/')}` || prefix
  }
  if (/^[A-Za-z]:\/$/.test(prefix)) {
    return out.length ? `${prefix}${out.join('/')}` : prefix
  }
  return out.join('/')
}

function withinWorkspace(path: string, workspaceRoot: string): boolean {
  const base = pathForCompare(workspaceRoot)
  const target = pathForCompare(path)
  if (!base || !target) return false
  if (target === base) return true
  return target.startsWith(`${base}/`)
}

function directoryOf(path: string): string {
  const normalized = trimTrailingSlashes(collapsePath(path))
  if (!normalized) return ''
  if (normalized === '/') return '/'
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized

  const index = normalized.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'

  const maybeDrive = normalized.slice(0, index + 1)
  if (/^[A-Za-z]:\/$/.test(maybeDrive)) return maybeDrive
  return normalized.slice(0, index)
}

function normalizeWorkspaceRoot(rawRoot: string): string {
  return trimTrailingSlashes(collapsePath(rawRoot))
}

function resolvePathWithinWorkspace(rawPath: string, opts: WorkspaceLinkOptions): string | null {
  const workspaceRoot = normalizeWorkspaceRoot(opts.workspaceRoot)
  if (!workspaceRoot) return null

  const decoded = decodeMaybe(rawPath)
  const candidate = normalizePath(decoded)
  if (!candidate) return null

  const resolved = isAbsoluteFsPath(candidate)
    ? trimTrailingSlashes(collapsePath(candidate))
    : trimTrailingSlashes(collapsePath(`${resolveBaseDirectory(opts.baseFilePath, workspaceRoot)}/${candidate}`))

  if (!resolved) return null
  if (!withinWorkspace(resolved, workspaceRoot)) return null
  return resolved
}

function resolveBaseDirectory(baseFilePath: string | undefined, workspaceRoot: string): string {
  const source = trimTrailingSlashes(collapsePath(String(baseFilePath || '')))
  if (source && withinWorkspace(source, workspaceRoot)) {
    const dir = directoryOf(source)
    if (dir && withinWorkspace(dir, workspaceRoot)) return dir
  }
  return workspaceRoot
}

function readPositiveInt(raw: unknown): number | undefined {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function parseQueryLineColumn(queryPart: string): { line?: number; column?: number } {
  if (!queryPart) return {}
  const params = new URLSearchParams(queryPart)
  const line = readPositiveInt(params.get('line') || params.get('l') || params.get('ln'))
  const column = readPositiveInt(params.get('column') || params.get('col') || params.get('c'))
  return {
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  }
}

function parseFragmentLineColumn(fragmentPart: string): { line?: number; column?: number } {
  const fragment = decodeMaybe(fragmentPart).trim()
  if (!fragment) return {}

  const githubLineCol = fragment.match(/^L(\d+)C(\d+)$/i)
  if (githubLineCol) {
    const line = readPositiveInt(githubLineCol[1])
    const column = readPositiveInt(githubLineCol[2])
    return {
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    }
  }

  const githubLine = fragment.match(/^L(\d+)(?:-L?\d+)?$/i)
  if (githubLine) {
    const line = readPositiveInt(githubLine[1])
    return line ? { line } : {}
  }

  const lineNumber = fragment.match(/^line-(\d+)$/i)
  if (lineNumber) {
    const line = readPositiveInt(lineNumber[1])
    return line ? { line } : {}
  }

  const plain = fragment.match(/^(\d+)(?::(\d+))?$/)
  if (plain) {
    const line = readPositiveInt(plain[1])
    const column = readPositiveInt(plain[2])
    return {
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
    }
  }

  return parseQueryLineColumn(fragment)
}

function parseFragmentAnchor(fragmentPart: string): string | undefined {
  const fragment = decodeMaybe(fragmentPart).trim()
  if (!fragment) return undefined

  const location = parseFragmentLineColumn(fragment)
  if (location.line !== undefined || location.column !== undefined) return undefined
  return fragment
}

function parseLineColumnSuffix(pathPart: string): { pathPart: string; line?: number; column?: number } {
  const path = String(pathPart || '').trim()
  if (!path) return { pathPart: '' }

  const match = path.match(/:(\d+)(?::(\d+))?$/)
  if (!match || typeof match.index !== 'number') return { pathPart: path }

  const head = path.slice(0, match.index)
  if (!head) return { pathPart: path }
  if (/^[A-Za-z]$/.test(head)) return { pathPart: path }

  const line = readPositiveInt(match[1])
  const column = readPositiveInt(match[2])
  if (!line) return { pathPart: path }
  return {
    pathPart: head,
    line,
    ...(column ? { column } : {}),
  }
}

function readScheme(rawHref: string): string {
  if (/^[A-Za-z]:[\\/]/.test(rawHref)) {
    return ''
  }
  const match = rawHref.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  return match ? String(match[1] || '').toLowerCase() : ''
}

function splitHref(rawHref: string): { pathPart: string; queryPart: string; fragmentPart: string } {
  const href = String(rawHref || '')
  const hashIndex = href.indexOf('#')
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const fragmentPart = hashIndex >= 0 ? href.slice(hashIndex + 1) : ''

  const queryIndex = beforeHash.indexOf('?')
  if (queryIndex < 0) {
    return {
      pathPart: beforeHash,
      queryPart: '',
      fragmentPart,
    }
  }

  return {
    pathPart: beforeHash.slice(0, queryIndex),
    queryPart: beforeHash.slice(queryIndex + 1),
    fragmentPart,
  }
}

function fileUriToPath(rawHref: string): { pathPart: string; queryPart: string; fragmentPart: string } | null {
  try {
    const parsed = new URL(rawHref)
    if (parsed.protocol !== 'file:') return null

    let path = decodeMaybe(parsed.pathname || '')
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1)
    }
    if (parsed.host && !/^[A-Za-z]:\//.test(path) && !path.startsWith('//')) {
      path = `//${parsed.host}${path}`
    }

    return {
      pathPart: path,
      queryPart: String(parsed.search || '').replace(/^\?/, ''),
      fragmentPart: String(parsed.hash || '').replace(/^#/, ''),
    }
  } catch {
    return null
  }
}

function extFromHref(rawHref: string): string {
  if (!rawHref) return ''

  const cleaned = decodeMaybe(rawHref)
  const withoutHash = cleaned.split('#')[0] || ''
  const withoutQuery = withoutHash.split('?')[0] || ''
  const normalized = normalizePath(withoutQuery)
  const fileName = normalized.split('/').filter(Boolean).pop() || normalized
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function mediaKindFromHref(rawHref: string): MediaKind | null {
  const ext = extFromHref(rawHref)
  if (!ext) return null
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return null
}

export function buildWorkspaceRawFileUrl(workspaceRoot: string, path: string): string {
  return `/api/fs/raw?directory=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(path)}`
}

export function resolveWorkspaceFileLink(rawHref: string, opts: WorkspaceLinkOptions): WorkspaceLinkTarget | null {
  const href = String(rawHref || '').trim()
  const workspaceRoot = normalizeWorkspaceRoot(opts.workspaceRoot)
  if (!href || !workspaceRoot) return null
  if (href.startsWith('#')) return null
  if (href.startsWith('//')) return null

  const scheme = readScheme(href)
  if (scheme && scheme !== 'file') {
    return null
  }

  const split = scheme === 'file' ? fileUriToPath(href) : splitHref(href)
  if (!split) return null

  const suffix = parseLineColumnSuffix(split.pathPart)
  const pathPart = String(suffix.pathPart || '').trim()
  if (!pathPart) return null

  let line = suffix.line
  let column = suffix.column
  const anchor = parseFragmentAnchor(split.fragmentPart)

  if (line === undefined || column === undefined) {
    const fromQuery = parseQueryLineColumn(split.queryPart)
    if (line === undefined) line = fromQuery.line
    if (column === undefined) column = fromQuery.column
  }

  if (line === undefined || column === undefined) {
    const fromFragment = parseFragmentLineColumn(split.fragmentPart)
    if (line === undefined) line = fromFragment.line
    if (column === undefined) column = fromFragment.column
  }

  const resolvedPath = resolvePathWithinWorkspace(pathPart, {
    workspaceRoot,
    baseFilePath: opts.baseFilePath,
  })
  if (!resolvedPath) return null

  return {
    path: resolvedPath,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    ...(anchor ? { anchor } : {}),
  }
}

export function resolveWorkspaceMediaUrl(rawHref: string, opts: WorkspaceLinkOptions): string | null {
  const target = resolveWorkspaceFileLink(rawHref, opts)
  if (!target) return null
  if (!mediaKindFromHref(target.path)) return null

  const workspaceRoot = normalizeWorkspaceRoot(opts.workspaceRoot)
  if (!workspaceRoot) return null
  return buildWorkspaceRawFileUrl(workspaceRoot, target.path)
}

function pathFromFsApiHref(rawHref: string, workspaceRoot: string): string | null {
  try {
    const parsed = new URL(rawHref, 'http://localhost')
    if (!FS_API_PATHS.has(parsed.pathname)) return null

    const rawPath = decodeMaybe(parsed.searchParams.get('path') || '')
    const rawDirectory = decodeMaybe(parsed.searchParams.get('directory') || workspaceRoot)
    if (!rawPath) return null

    return resolvePathWithinWorkspace(rawPath, {
      workspaceRoot,
      baseFilePath: rawDirectory,
    })
  } catch {
    return null
  }
}

export function extractWorkspacePathFromFileUrl(rawHref: string, workspaceRootRaw: string): string | null {
  const href = String(rawHref || '').trim()
  const workspaceRoot = normalizeWorkspaceRoot(workspaceRootRaw)
  if (!href || !workspaceRoot) return null
  if (href.startsWith('data:') || href.startsWith('blob:')) return null

  const directApi = pathFromFsApiHref(href, workspaceRoot)
  if (directApi) return directApi

  const scheme = readScheme(href)
  if (scheme === 'file') {
    return resolveWorkspaceFileLink(href, { workspaceRoot })?.path || null
  }
  if (scheme === 'http' || scheme === 'https') {
    return null
  }
  if (scheme) {
    return null
  }

  return resolveWorkspaceFileLink(href, { workspaceRoot })?.path || null
}
