import { computed, ref, watch, type Ref } from 'vue'
import type { JsonValue } from '@/types/json'

type QueryValue = string | number | boolean | null | undefined

type GitJson = <T = JsonValue>(
  endpoint: string,
  directory: string,
  query?: Record<string, QueryValue> | undefined,
  init?: RequestInit | undefined,
) => Promise<T>

type GitRemoteBranchListResponse = {
  branches?: string[]
}

export function useGitRemoteBranchPicker(opts: {
  gitJson: GitJson
  repoRoot: Ref<string | null>
  pushToOpen: Ref<boolean>
  pullFromOpen: Ref<boolean>
  fetchFromOpen: Ref<boolean>
  targetRemote: Ref<string>
  targetBranch: Ref<string>
}) {
  const { gitJson, repoRoot, pushToOpen, pullFromOpen, fetchFromOpen, targetRemote, targetBranch } = opts

  const remoteBranchOptions = ref<string[]>([])
  const remoteBranchLoading = ref(false)

  type RemoteBranchCacheEntry = { fetchedAt: number; branches: string[] }
  const REMOTE_BRANCH_CACHE_TTL_MS = 60_000
  const remoteBranchCache = ref<Record<string, RemoteBranchCacheEntry>>({})
  const remoteBranchInflight = ref<Record<string, Promise<string[]>>>({})
  let remoteBranchFetchTimer: number | null = null

  const filteredRemoteBranchOptions = computed(() => {
    const q = (targetBranch.value || '').trim().toLowerCase()
    const list = remoteBranchOptions.value
    if (!q) return list
    return list.filter((b) => b.toLowerCase().includes(q))
  })

  const branchPickVisible = ref(false)
  const branchPickIndex = ref(0)

  function clampBranchPickIndex() {
    const max = Math.min(20, filteredRemoteBranchOptions.value.length) - 1
    if (max < 0) {
      branchPickIndex.value = 0
      return
    }
    if (branchPickIndex.value < 0) branchPickIndex.value = 0
    if (branchPickIndex.value > max) branchPickIndex.value = max
  }

  function onBranchPickKeydown(ev: KeyboardEvent) {
    if (!branchPickVisible.value) return
    const list = filteredRemoteBranchOptions.value.slice(0, 20)
    if (!list.length) return

    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      branchPickIndex.value = Math.min(list.length - 1, branchPickIndex.value + 1)
      return
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      branchPickIndex.value = Math.max(0, branchPickIndex.value - 1)
      return
    }
    if (ev.key === 'Enter') {
      ev.preventDefault()
      const b = list[branchPickIndex.value]
      if (b) targetBranch.value = b
      branchPickVisible.value = false
      return
    }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      branchPickVisible.value = false
    }
  }

  function hideBranchPickSoon() {
    window.setTimeout(() => {
      branchPickVisible.value = false
    }, 100)
  }

  async function loadRemoteBranches(directory: string, remote: string) {
    const r = (remote || '').trim()
    if (!r) return

    const dir = (directory || '').trim()
    if (!dir) return

    const key = `${dir}::${r}`
    const now = Date.now()
    const cached = remoteBranchCache.value[key]
    if (cached && now - cached.fetchedAt < REMOTE_BRANCH_CACHE_TTL_MS) {
      remoteBranchOptions.value = cached.branches
      return
    }

    const inflight = remoteBranchInflight.value[key]
    if (inflight) {
      remoteBranchLoading.value = true
      try {
        remoteBranchOptions.value = await inflight
      } finally {
        remoteBranchLoading.value = false
      }
      return
    }

    remoteBranchLoading.value = true
    const p = (async () => {
      const resp = await gitJson<GitRemoteBranchListResponse>('remote-branches', dir, { remote: r })
      const branches = Array.isArray(resp?.branches) ? resp.branches : []
      remoteBranchCache.value = {
        ...remoteBranchCache.value,
        [key]: { fetchedAt: Date.now(), branches },
      }
      return branches
    })()

    remoteBranchInflight.value = { ...remoteBranchInflight.value, [key]: p }
    try {
      remoteBranchOptions.value = await p
    } finally {
      const next = { ...remoteBranchInflight.value }
      delete next[key]
      remoteBranchInflight.value = next
      remoteBranchLoading.value = false
    }
  }

  watch(
    () => [pushToOpen.value, pullFromOpen.value, fetchFromOpen.value, targetRemote.value, repoRoot.value] as const,
    ([pushOpen, pullOpen, fetchOpen, remote, dir]) => {
      const open = pushOpen || pullOpen || fetchOpen
      if (!open) return
      const d = (dir || '').trim()
      const r = (remote || '').trim()
      if (!d || !r) return

      // Throttle while users switch remotes or open dialogs.
      if (remoteBranchFetchTimer) window.clearTimeout(remoteBranchFetchTimer)
      remoteBranchFetchTimer = window.setTimeout(() => {
        remoteBranchFetchTimer = null
        void loadRemoteBranches(d, r).catch(() => (remoteBranchOptions.value = []))
      }, 200)
    },
  )

  function clearRemoteBranchOptions() {
    remoteBranchOptions.value = []
  }

  function prefetchRemoteBranches(remote: string) {
    const dir = (repoRoot.value || '').trim()
    const r = (remote || '').trim()
    if (!dir || !r) return
    void loadRemoteBranches(dir, r).catch(() => (remoteBranchOptions.value = []))
  }

  watch(
    () => [filteredRemoteBranchOptions.value.length, branchPickVisible.value] as const,
    () => {
      if (!branchPickVisible.value) return
      clampBranchPickIndex()
    },
  )

  return {
    remoteBranchLoading,
    filteredRemoteBranchOptions,
    branchPickVisible,
    branchPickIndex,
    onBranchPickKeydown,
    hideBranchPickSoon,
    clearRemoteBranchOptions,
    prefetchRemoteBranches,
  }
}
