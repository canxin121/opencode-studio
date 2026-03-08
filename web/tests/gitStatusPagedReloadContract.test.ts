import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'

import { useGitStatusPaged } from '../src/composables/git/useGitStatusPaged'

function makeStatus(files: Array<{ path: string; index: string; workingDir: string }>, scope: string) {
  return {
    current: 'main',
    tracking: null,
    ahead: 0,
    behind: 0,
    files,
    totalFiles: files.length,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    mergeCount: 0,
    offset: 0,
    limit: 200,
    hasMore: false,
    scope,
  }
}

test('useGitStatusPaged queues first-page reload while a scope is loading', async () => {
  const gitReady = ref(true)
  const status = ref(makeStatus([], 'summary'))
  const calls: string[] = []

  let releaseStagedLoad: (() => void) | null = null
  let stagedLoadMorePending = true

  const paged = useGitStatusPaged({
    gitReady,
    status,
    pageSize: 50,
    loadStatusPage: async ({ directory, scope, offset }) => {
      calls.push(`${directory}:${scope}:${offset}`)

      if (scope === 'staged' && offset === 0 && stagedLoadMorePending) {
        await new Promise<void>((resolve) => {
          releaseStagedLoad = resolve
        })
        stagedLoadMorePending = false
        return makeStatus([{ path: 'staged-old.txt', index: 'M', workingDir: '' }], scope)
      }

      if (scope === 'staged' && offset === 0) {
        return makeStatus([{ path: 'staged-new.txt', index: 'M', workingDir: '' }], scope)
      }

      return makeStatus([], scope)
    },
  })

  const loadMorePromise = paged.loadMore('/repo', 'staged')
  await Promise.resolve()

  const reloadPromise = paged.reloadFirstPages('/repo')
  releaseStagedLoad?.()

  await loadMorePromise
  await reloadPromise
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(
    paged.stagedList.value.map((item) => item.path),
    ['staged-new.txt'],
  )

  const stagedFirstPageCalls = calls.filter((item) => item.includes(':staged:0'))
  assert.equal(stagedFirstPageCalls.length, 2)
})
