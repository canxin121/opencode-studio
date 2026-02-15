import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { JsonValue } from '@/types/json'

export function useGitCommitState(opts: { repoRoot: Ref<string | null>; repoKey: (suffix: string) => string }) {
  const { repoRoot, repoKey } = opts

  const commitMessage = ref('')
  const committing = ref(false)

  // VS Code-like commit toggles.
  const commitNoVerify = ref(false)
  const commitSignoff = ref(false)
  const commitAmend = ref(false)
  const commitNoGpgSign = ref(false)

  // Commit error and post-commit nudges are UI concerns, but live with commit flow state.
  const commitErrorOpen = ref(false)
  const commitErrorTitle = ref('Commit failed')
  const commitErrorOutput = ref('')

  const postCommitOpen = ref(false)
  const postCommitTitle = ref('Commit created')
  const postCommitExplain = ref('')
  const postCommitRememberChoice = ref(false)

  // SCM input draft/history.
  const commitHistory = ref<string[]>([])
  const commitHistoryIndex = ref<number>(-1)
  const commitDraft = ref('')
  const commitDraftSaveTimer = ref<number | null>(null)
  const commitMessageFromHistory = ref(false)

  function loadCommitHistoryForRepo() {
    try {
      const raw = localStorage.getItem(repoKey('commitHistory'))
      const parsed: JsonValue = raw ? JSON.parse(raw) : []
      const list = Array.isArray(parsed) ? parsed : []
      commitHistory.value = Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()) : []
    } catch {
      commitHistory.value = []
    }
  }

  function saveCommitHistoryForRepo() {
    try {
      localStorage.setItem(repoKey('commitHistory'), JSON.stringify(commitHistory.value.slice(0, 50)))
    } catch {
      // ignore
    }
  }

  function loadCommitDraftForRepo() {
    try {
      commitDraft.value = localStorage.getItem(repoKey('commitDraft')) || ''
      // Only restore draft when the input is empty to avoid clobbering.
      if (!commitMessage.value.trim() && commitDraft.value) {
        commitMessage.value = commitDraft.value
      }
    } catch {
      commitDraft.value = ''
    }
  }

  function scheduleSaveCommitDraft() {
    if (commitDraftSaveTimer.value) window.clearTimeout(commitDraftSaveTimer.value)
    commitDraftSaveTimer.value = window.setTimeout(() => {
      commitDraftSaveTimer.value = null
      try {
        localStorage.setItem(repoKey('commitDraft'), commitMessage.value)
      } catch {
        // ignore
      }
    }, 250)
  }

  function pushCommitHistory(msg: string) {
    const m = (msg || '').trim()
    if (!m) return
    const next = [m, ...commitHistory.value.filter((x) => x !== m)]
    commitHistory.value = next.slice(0, 50)
    saveCommitHistoryForRepo()
  }

  function onCommitMessageKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return
    const el = ev.target as HTMLTextAreaElement | null
    if (!el) return
    if (ev.altKey || ev.metaKey || ev.ctrlKey) return
    if (el.selectionStart !== el.selectionEnd) return

    const atStart = el.selectionStart === 0
    const atEnd = el.selectionEnd === el.value.length

    if (ev.key === 'ArrowUp' && !atStart) return
    if (ev.key === 'ArrowDown' && !atEnd) return

    const list = commitHistory.value
    if (!list.length) return

    ev.preventDefault()

    if (commitHistoryIndex.value === -1) {
      // First time entering history navigation: capture the current draft.
      commitDraft.value = commitMessage.value
    }

    if (ev.key === 'ArrowUp') {
      const nextIdx = Math.min(list.length - 1, commitHistoryIndex.value + 1)
      commitHistoryIndex.value = nextIdx
      commitMessageFromHistory.value = true
      commitMessage.value = list[nextIdx] ?? ''
      return
    }

    // ArrowDown
    const nextIdx = commitHistoryIndex.value - 1
    if (nextIdx < 0) {
      commitHistoryIndex.value = -1
      commitMessageFromHistory.value = true
      commitMessage.value = commitDraft.value
      return
    }
    commitHistoryIndex.value = nextIdx
    commitMessageFromHistory.value = true
    commitMessage.value = list[nextIdx] ?? ''
  }

  function loadCommitTogglesForRepo() {
    try {
      const raw = localStorage.getItem(repoKey('commitToggles'))
      if (!raw) return
      const parsed: JsonValue = JSON.parse(raw)
      const v = parsed && typeof parsed === 'object' ? (parsed as Record<string, JsonValue>) : {}
      if (typeof v?.noVerify === 'boolean') commitNoVerify.value = v.noVerify
      if (typeof v?.signoff === 'boolean') commitSignoff.value = v.signoff
      if (typeof v?.amend === 'boolean') commitAmend.value = v.amend
      if (typeof v?.noGpgSign === 'boolean') commitNoGpgSign.value = v.noGpgSign
    } catch {
      // ignore
    }
  }

  function saveCommitTogglesForRepo() {
    try {
      localStorage.setItem(
        repoKey('commitToggles'),
        JSON.stringify({
          noVerify: commitNoVerify.value,
          signoff: commitSignoff.value,
          amend: commitAmend.value,
          noGpgSign: commitNoGpgSign.value,
        }),
      )
    } catch {
      // ignore
    }
  }

  watch(
    () => repoRoot.value,
    (next, prev) => {
      const n = (next || '').trim()
      const p = (prev || '').trim()
      if (n === p) return
      loadCommitTogglesForRepo()
      loadCommitHistoryForRepo()
      loadCommitDraftForRepo()
      commitHistoryIndex.value = -1
    },
    { immediate: true },
  )

  watch([commitNoVerify, commitSignoff, commitAmend, commitNoGpgSign], () => saveCommitTogglesForRepo())

  watch(
    () => commitMessage.value,
    () => {
      if (commitMessageFromHistory.value) {
        // Don't treat history navigation as a manual edit.
        commitMessageFromHistory.value = false
        return
      }
      // Reset history nav on manual edits.
      if (commitHistoryIndex.value !== -1) commitHistoryIndex.value = -1
      scheduleSaveCommitDraft()
    },
  )

  onBeforeUnmount(() => {
    if (commitDraftSaveTimer.value) window.clearTimeout(commitDraftSaveTimer.value)
  })

  return {
    commitMessage,
    committing,
    commitNoVerify,
    commitSignoff,
    commitAmend,
    commitNoGpgSign,
    commitErrorOpen,
    commitErrorTitle,
    commitErrorOutput,
    postCommitOpen,
    postCommitTitle,
    postCommitExplain,
    postCommitRememberChoice,
    pushCommitHistory,
    onCommitMessageKeydown,
  }
}
