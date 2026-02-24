import { ref, type Ref } from 'vue'
import type { JsonValue } from '@/types/json'
import { i18n } from '@/i18n'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

export function useGitPathOps(opts: {
  root: { value: string | null }
  selectedFile: Ref<string | null>
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  refreshDiff: () => void
}) {
  const { root, selectedFile, toasts, gitJson, withRepoBusy, handleGitBusy, load, refreshDiff } = opts

  const renameDialogOpen = ref(false)
  const renameFrom = ref('')
  const renameTo = ref('')

  function openRenameDialog(path: string) {
    const p = (path || '').trim()
    if (!p) return
    renameFrom.value = p
    renameTo.value = p
    renameDialogOpen.value = true
  }

  async function submitRename() {
    const dir = root.value
    const from = renameFrom.value.trim()
    const to = renameTo.value.trim()
    if (!dir || !from || !to) return
    renameDialogOpen.value = false
    await withRepoBusy('Rename', async () => {
      try {
        await gitJson('rename', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from, to }),
        })
        if (selectedFile.value === from) selectedFile.value = to
        toasts.push('success', i18n.global.t('git.toasts.renamed'))
        await load()
      } catch (err) {
        if (handleGitBusy(err, 'Rename', submitRename)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function deletePath(path: string, force = false) {
    const dir = root.value
    const p = (path || '').trim()
    if (!dir || !p) return
    await withRepoBusy('Delete', async () => {
      try {
        await gitJson('delete', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p, force }),
        })
        if (selectedFile.value === p) selectedFile.value = null
        toasts.push('success', i18n.global.t('git.toasts.deleted'))
        await load()
        refreshDiff()
      } catch (err) {
        if (handleGitBusy(err, 'Delete', () => deletePath(path, force))) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    renameDialogOpen,
    renameFrom,
    renameTo,
    openRenameDialog,
    submitRename,
    deletePath,
  }
}
