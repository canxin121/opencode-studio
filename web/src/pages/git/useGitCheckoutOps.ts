import { ref } from 'vue'
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

export function useGitCheckoutOps(opts: {
  repoRoot: { value: string | null }
  toasts: Toasts
  gitJson: GitJson
  withRepoBusy: (op: string, fn: () => Promise<void>) => Promise<void>
  handleGitBusy: <T>(err: T, op: string, retry: () => Promise<void>) => boolean
  load: () => Promise<void>
  loadBranches: () => Promise<void>
}) {
  const { repoRoot, toasts, gitJson, withRepoBusy, handleGitBusy, load, loadBranches } = opts

  const detachedOpen = ref(false)
  const detachedRef = ref('HEAD')

  const branchFromOpen = ref(false)
  const branchFromName = ref('')
  const branchFromRef = ref('HEAD')
  const branchFromCheckout = ref(true)

  async function checkoutDetached() {
    const dir = repoRoot.value
    if (!dir) return
    const rf = detachedRef.value.trim()
    if (!rf) return
    detachedOpen.value = false
    await withRepoBusy('Checkout detached', async () => {
      try {
        await gitJson('checkout-detached', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ref: rf }),
        })
        toasts.push('success', `Detached HEAD at ${rf}`)
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Checkout detached', checkoutDetached)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  async function createBranchFromRef() {
    const dir = repoRoot.value
    if (!dir) return
    const name = branchFromName.value.trim()
    const startPoint = branchFromRef.value.trim() || 'HEAD'
    if (!name) return
    branchFromOpen.value = false
    await withRepoBusy('Create branch from ref', async () => {
      try {
        await gitJson('branches/create-from', dir, undefined, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, startPoint, checkout: branchFromCheckout.value }),
        })
        toasts.push('success', `Created branch ${name}`)
        branchFromName.value = ''
        await load()
        await loadBranches()
      } catch (err) {
        if (handleGitBusy(err, 'Create branch from ref', createBranchFromRef)) return
        toasts.push('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return {
    detachedOpen,
    detachedRef,
    checkoutDetached,
    branchFromOpen,
    branchFromName,
    branchFromRef,
    branchFromCheckout,
    createBranchFromRef,
  }
}
