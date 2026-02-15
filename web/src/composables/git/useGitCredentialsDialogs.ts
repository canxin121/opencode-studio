// Intentionally thin: keeps GitPage coordinator readable.

import { ref } from 'vue'
import type { JsonValue } from '@/types/json'

export type PendingRemoteAction = 'fetch' | 'pull' | 'push'

export function useGitCredentialsDialogs() {
  const credDialogOpen = ref(false)
  const credExplain = ref('')
  const credUsername = ref('')
  const credPassword = ref('')
  const credAction = ref<PendingRemoteAction | null>(null)
  const credBaseBody = ref<Record<string, JsonValue> | null>(null)

  function openCredentialsDialog(action: PendingRemoteAction, baseBody: Record<string, JsonValue>, explain: string) {
    credAction.value = action
    credBaseBody.value = baseBody
    credExplain.value = explain
    credDialogOpen.value = true
  }

  function clearCredentials() {
    credPassword.value = ''
    credAction.value = null
    credBaseBody.value = null
    credExplain.value = ''
    credDialogOpen.value = false
  }

  return {
    credDialogOpen,
    credExplain,
    credUsername,
    credPassword,
    credAction,
    credBaseBody,
    openCredentialsDialog,
    clearCredentials,
  }
}
