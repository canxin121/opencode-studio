export type PreviewMode = 'text' | 'markdown' | 'image' | 'pdf' | 'audio' | 'video'

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'mdown', 'mkd'])
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
  'psd',
  'ai',
  'eps',
  'raw',
  'cr2',
  'nef',
  'heic',
  'heif',
  'avif',
  'jxl',
])
const PDF_EXTENSIONS = new Set(['pdf'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'])

export function extensionFromPath(path: string): string {
  const base = path.split('/').pop() || path
  const idx = base.lastIndexOf('.')
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : ''
}

export function detectPreviewMode(path: string): PreviewMode {
  const ext = extensionFromPath(path)
  if (!ext) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return 'text'
}
