import { apiJson, apiText } from '@/lib/api'
import type { GitBlameResponse, GitDiffResponse } from '@/types/git'

export type FsListEntry = {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

export type FsListResponse = {
  path: string
  entries: FsListEntry[]
  offset?: number
  limit?: number
  total?: number
  hasMore?: boolean
  nextOffset?: number
}

export type FsSearchResponse = {
  root: string
  count: number
  files: Array<{ name: string; path: string; relative_path?: string }>
}

export type FsUploadResponse = { success: boolean; path: string; bytes: number }

export type FsContentSearchMatch = {
  line: number
  startColumn: number
  endColumn: number
  startOffset: number
  endOffset: number
  before: string
  matched: string
  after: string
}

export type FsContentSearchFileResult = {
  path: string
  relativePath: string
  matchCount: number
  matches: FsContentSearchMatch[]
}

export type FsContentSearchResponse = {
  root: string
  query: string
  fileCount: number
  matchCount: number
  files: FsContentSearchFileResult[]
  truncated: boolean
}

export type FsContentReplaceResponse = {
  root: string
  fileCount: number
  replacementCount: number
  skipped: number
  files: Array<{ path: string; relativePath: string; replacements: number }>
}

export async function listDirectory(input: {
  path: string
  respectGitignore: boolean
  offset: number
  limit: number
}): Promise<FsListResponse> {
  const { path, respectGitignore, offset, limit } = input
  return apiJson<FsListResponse>(
    `/api/fs/list?path=${encodeURIComponent(path)}&respectGitignore=${respectGitignore ? 'true' : 'false'}&offset=${encodeURIComponent(String(offset))}&limit=${encodeURIComponent(String(limit))}`,
  )
}

export async function searchFiles(input: {
  root: string
  query: string
  limit: number
  respectGitignore: boolean
}): Promise<FsSearchResponse> {
  const { root, query, limit, respectGitignore } = input
  return apiJson<FsSearchResponse>(
    `/api/fs/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}&respectGitignore=${respectGitignore ? 'true' : 'false'}`,
  )
}

export async function searchFileContent(input: {
  directory: string
  query: string
  paths?: string[]
  includeHidden: boolean
  respectGitignore: boolean
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  maxResults?: number
  maxMatchesPerFile?: number
  contextChars?: number
}): Promise<FsContentSearchResponse> {
  return apiJson<FsContentSearchResponse>(`/api/fs/search-content?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: input.query,
      paths: input.paths,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
      isRegex: input.isRegex,
      caseSensitive: input.caseSensitive,
      wholeWord: input.wholeWord,
      maxResults: input.maxResults,
      maxMatchesPerFile: input.maxMatchesPerFile,
      contextChars: input.contextChars,
    }),
  })
}

export async function replaceFileContent(input: {
  directory: string
  replace: string
  query?: string
  includeHidden?: boolean
  respectGitignore?: boolean
  isRegex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  paths?: string[]
  match?: {
    path: string
    startOffset: number
    endOffset: number
    expected: string
  }
}): Promise<FsContentReplaceResponse> {
  return apiJson<FsContentReplaceResponse>(`/api/fs/replace-content?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: input.query,
      replace: input.replace,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
      isRegex: input.isRegex,
      caseSensitive: input.caseSensitive,
      wholeWord: input.wholeWord,
      paths: input.paths,
      match: input.match,
    }),
  })
}

export async function readFileText(input: { directory: string; path: string }): Promise<string> {
  return apiText(
    `/api/fs/read?directory=${encodeURIComponent(input.directory)}&path=${encodeURIComponent(input.path)}`,
  )
}

export async function writeFile(input: { directory: string; path: string; content: string }): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/api/fs/write?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.path, content: input.content }),
  })
}

export async function uploadFile(input: { directory: string; path: string; file: Blob }): Promise<FsUploadResponse> {
  return apiJson<FsUploadResponse>(
    `/api/fs/upload?directory=${encodeURIComponent(input.directory)}&path=${encodeURIComponent(input.path)}&overwrite=true`,
    { method: 'POST', body: input.file },
  )
}

export async function makeDirectory(input: { directory: string; path: string }): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/api/fs/mkdir?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.path }),
  })
}

export async function renamePath(input: {
  directory: string
  oldPath: string
  newPath: string
}): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/api/fs/rename?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oldPath: input.oldPath, newPath: input.newPath }),
  })
}

export async function deletePath(input: { directory: string; path: string }): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/api/fs/delete?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: input.path }),
  })
}

export async function getGitBlame(input: { directory: string; path: string }): Promise<GitBlameResponse> {
  return apiJson<GitBlameResponse>(
    `/api/git/blame?directory=${encodeURIComponent(input.directory)}&path=${encodeURIComponent(input.path)}`,
  )
}

export async function getGitDiff(input: {
  directory: string
  path: string
  staged: boolean
  contextLines?: number
  includeMeta?: boolean
}): Promise<GitDiffResponse> {
  const contextLines = input.contextLines ?? 3
  const includeMeta = input.includeMeta ? '&includeMeta=true' : ''
  return apiJson<GitDiffResponse>(
    `/api/git/diff?directory=${encodeURIComponent(input.directory)}&path=${encodeURIComponent(input.path)}&staged=${input.staged ? 'true' : 'false'}&contextLines=${encodeURIComponent(String(contextLines))}${includeMeta}`,
  )
}

export async function applyGitPatch(input: {
  directory: string
  patch: string
  mode: 'stage' | 'unstage' | 'discard'
}): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>(`/api/git/patch?directory=${encodeURIComponent(input.directory)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: input.patch, mode: input.mode }),
  })
}
