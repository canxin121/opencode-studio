import { ref, type Ref } from 'vue'

import type { GitTagInfo, GitTagsListResponse } from '@/types/git'
import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

export function useGitTags(opts: {
  repoRoot: Ref<string | null>
  preferredRemote: () => string
  gitJson: GitJson
  toasts: Toasts
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
}) {
  const { repoRoot, preferredRemote, gitJson, toasts, withRepoBusy, handleGitBusy } = opts

  const tagsOpen = ref(false)
  const tagsLoading = ref(false)
  const tagsList = ref<GitTagInfo[]>([])
  const newTagName = ref('')
  const newTagRef = ref('HEAD')
  const newTagMessage = ref('')
  const tagRemote = ref('origin')

  async function loadTags() {
    const dir = repoRoot.value
    if (!dir) return
    tagsLoading.value = true
    try {
      const resp = await gitJson<GitTagsListResponse>('tags', dir)
      tagsList.value = Array.isArray(resp?.tags) ? resp.tags : []
    } catch (err) {
      tagsList.value = []
      toasts.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      tagsLoading.value = false
    }
  }

  function openTags() {
    tagsOpen.value = true
    const rem = preferredRemote()
    if (rem) tagRemote.value = rem
    void loadTags()
  }

  async function createTag() {
    const dir = repoRoot.value
    if (!dir) return
    const name = newTagName.value.trim()
    const rf = newTagRef.value.trim()
    const message = newTagMessage.value.trim()
    if (!name) return

    await withRepoBusy('Create tag', async () => {
      try {
        await gitJson('tags', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, ref: rf || undefined, message: message || undefined }),
        })
        toasts.push('success', `Created tag ${name}`)
        newTagName.value = ''
        newTagMessage.value = ''
        await loadTags()
      } catch (err) {
        if (handleGitBusy(err, 'Create tag', createTag)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function deleteTag(name: string) {
    const dir = repoRoot.value
    if (!dir) return
    const n = (name || '').trim()
    if (!n) return

    await withRepoBusy('Delete tag', async () => {
      try {
        await gitJson('tags', dir, undefined, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: n }),
        })
        toasts.push('success', `Deleted tag ${n}`)
        await loadTags()
      } catch (err) {
        if (handleGitBusy(err, 'Delete tag', () => deleteTag(name))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function deleteRemoteTag(name: string) {
    const dir = repoRoot.value
    if (!dir) return
    const n = (name || '').trim()
    const remote = tagRemote.value.trim() || 'origin'
    if (!n) return

    await withRepoBusy('Delete remote tag', async () => {
      try {
        await gitJson('tags/delete-remote', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ remote, name: n }),
        })
        toasts.push('success', `Deleted remote tag ${remote}/${n}`)
      } catch (err) {
        if (handleGitBusy(err, 'Delete remote tag', () => deleteRemoteTag(name))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    tagsOpen,
    tagsLoading,
    tagsList,
    newTagName,
    newTagRef,
    newTagMessage,
    tagRemote,
    loadTags,
    openTags,
    createTag,
    deleteTag,
    deleteRemoteTag,
  }
}
