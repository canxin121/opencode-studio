import { reactive, ref } from 'vue'

import type { SessionRunConfig } from '../src/types/chat'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) ?? null) : null
    },
    key(index: number) {
      if (index < 0 || index >= data.size) return null
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
  }
}

export function ensureBrowserTestRuntime(): Storage {
  const globalRecord = globalThis as Record<string, unknown>
  const storage = (globalRecord.localStorage as Storage | undefined) ?? createMemoryStorage()

  globalRecord.localStorage = storage
  if (!globalRecord.window || typeof globalRecord.window !== 'object') {
    globalRecord.window = {}
  }

  const windowRecord = globalRecord.window as Record<string, unknown>
  windowRecord.localStorage = storage
  windowRecord.setTimeout = globalThis.setTimeout.bind(globalThis)
  windowRecord.clearTimeout = globalThis.clearTimeout.bind(globalThis)

  const currentDocument = globalRecord.document as Record<string, unknown> | undefined
  if (!currentDocument || typeof currentDocument.createElement !== 'function') {
    const doc = {
      createElement: () => ({ style: {} }),
      createElementNS: () => ({}),
    }
    globalRecord.document = doc
    windowRecord.document = doc
  }

  return storage
}

export function clearLocalStorageKeys(keys: string[]) {
  const storage = ensureBrowserTestRuntime()
  for (const key of keys) {
    storage.removeItem(key)
  }
}

type ChatState = {
  selectedSessionId: string | null
  selectedSessionRunConfig: SessionRunConfig | null
  messages: Array<{ info?: Record<string, unknown> }>
}

let useChatModelSelectionCached:
  | (typeof import('../src/pages/chat/useChatModelSelection'))['useChatModelSelection']
  | null = null

async function getUseChatModelSelection() {
  if (useChatModelSelectionCached) return useChatModelSelectionCached
  ensureBrowserTestRuntime()
  const mod = await import('../src/pages/chat/useChatModelSelection')
  useChatModelSelectionCached = mod.useChatModelSelection
  return useChatModelSelectionCached
}

export async function createTestHarness(
  initial: {
    selectedSessionId?: string | null
    selectedSessionRunConfig?: SessionRunConfig | null
    messages?: Array<{ info?: Record<string, unknown> }>
  } = {},
) {
  clearLocalStorageKeys(['oc2.chat.modelVariantByKey', 'oc2.chat.sessionManualModelBySession'])
  const useChatModelSelection = await getUseChatModelSelection()

  const chat = reactive<ChatState>({
    selectedSessionId: initial.selectedSessionId ?? 'session-1',
    selectedSessionRunConfig: initial.selectedSessionRunConfig ?? null,
    messages: initial.messages ?? [],
  })

  const selection = useChatModelSelection({
    chat,
    ui: { isMobile: false, isMobilePointer: false },
    opencodeConfig: {
      data: null,
      scope: 'user',
      exists: null,
      refresh: async () => {},
    },
    sessionDirectory: ref(''),
    composerControlsRef: ref(null),
    composerPickerOpen: ref(null),
    composerPickerStyle: ref({}),
    agentTriggerRef: ref(null),
    modelTriggerRef: ref(null),
    variantTriggerRef: ref(null),
    modelPickerQuery: ref(''),
    agentPickerQuery: ref(''),
    closeComposerActionMenu: () => {},
    commandOpen: ref(false),
    commandQuery: ref(''),
    commandIndex: ref(0),
  })

  return { chat, selection }
}
