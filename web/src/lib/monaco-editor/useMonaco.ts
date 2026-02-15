// Vendored from @guolao/vue-monaco-editor@1.6.0 (MIT).
import loader from '@monaco-editor/loader'
import { onMounted, ref, shallowRef } from 'vue'

import type { MonacoEditor, Nullable } from './types'

type MonacoLoaderPromise = ReturnType<(typeof loader)['init']>

export function useMonaco() {
  const monacoRef = shallowRef<Nullable<MonacoEditor>>(loader.__getMonacoInstance() as Nullable<MonacoEditor>)
  const isLoadFailed = ref(false)
  let promise: MonacoLoaderPromise | undefined

  onMounted(() => {
    if (monacoRef.value) return

    promise = loader.init()
    promise
      .then((monacoInstance) => {
        monacoRef.value = monacoInstance as MonacoEditor
      })
      .catch((error) => {
        if ((error as { type?: string } | undefined)?.type !== 'cancelation') {
          isLoadFailed.value = true
          console.error('Monaco initialization error:', error)
        }
      })
  })

  const unload = () => promise?.cancel()

  return {
    monacoRef,
    unload,
    isLoadFailed,
  }
}

export { loader }
