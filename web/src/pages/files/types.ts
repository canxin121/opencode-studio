export type ListEntry = {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

export type ListResponse = {
  path: string
  entries: ListEntry[]
  offset?: number
  limit?: number
  total?: number
  hasMore?: boolean
  nextOffset?: number
}
export type SearchFile = { name: string; path: string; relative_path?: string }
export type SearchResponse = { root: string; count: number; files: SearchFile[] }

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  relativePath?: string
}

export type ViewerMode = 'none' | 'text' | 'markdown' | 'image' | 'pdf' | 'audio' | 'video' | 'binary'

export type MarkdownViewMode = 'source' | 'preview' | 'split'

export type DialogKind = 'createFile' | 'createFolder' | 'rename' | null

export type SelectionRange = { start: number; end: number; text: string }

export type FlatRow = {
  node: FileNode
  depth: number
  isExpanded: boolean
  isLoading: boolean
}
