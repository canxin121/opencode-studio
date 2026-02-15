import { ref } from 'vue'

// State for the "Push/Pull/Fetch ..." target dialogs.
// Kept separate so it can be shared with the remote-branch picker.
export function useGitRemoteTargetState() {
  const pushToOpen = ref(false)
  const pullFromOpen = ref(false)
  const fetchFromOpen = ref(false)
  const targetRemote = ref('')
  const targetBranch = ref('')
  const targetRef = ref('')
  const targetSetUpstream = ref(false)

  return {
    pushToOpen,
    pullFromOpen,
    fetchFromOpen,
    targetRemote,
    targetBranch,
    targetRef,
    targetSetUpstream,
  }
}
