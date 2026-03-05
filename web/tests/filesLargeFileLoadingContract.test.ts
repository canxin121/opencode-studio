import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('files page loads text files in chunks with large-file prompt', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('const FILE_CHUNK_BYTES = 256 * 1024'))
  assert.ok(source.includes('const LARGE_FILE_WARNING_BYTES = 1024 * 1024'))
  assert.ok(source.includes('const pendingLargeFilePrompt = ref<{ path: string; totalBytes: number } | null>(null)'))
  assert.ok(
    source.includes('const meta = await readFileChunk({ directory: rootPath, path: node.path, offset: 0, limit: 0 })'),
  )
  assert.ok(source.includes('if (fileChunkTotalBytes.value > LARGE_FILE_WARNING_BYTES) {'))
  assert.ok(source.includes('async function confirmLargeFileLoad() {'))
  assert.ok(source.includes('async function loadMoreFileContent() {'))
})

test('file viewer exposes clear load-more actions for large files', () => {
  const file = resolve(import.meta.dir, '../src/pages/files/components/FileViewerPane.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('largeFilePrompt: LargeFilePrompt | null'))
  assert.ok(source.includes('fileChunkUi: FileChunkUi | null'))
  assert.ok(source.includes("t('files.viewer.largeFile.title')"))
  assert.ok(source.includes("t('files.viewer.largeFile.continue')"))
  assert.ok(source.includes("t('files.viewer.largeFile.loadMore')"))
})

test('files api includes chunked read endpoint', () => {
  const file = resolve(import.meta.dir, '../src/features/files/api/filesApi.ts')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('export type FsReadChunkResponse = {'))
  assert.ok(source.includes('export async function readFileChunk(input: {'))
  assert.ok(source.includes("return apiJson<FsReadChunkResponse>(`/api/fs/read-chunk?${params.join('&')}`)"))
})
