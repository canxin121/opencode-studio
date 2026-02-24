import { inject, provide, type InjectionKey } from 'vue'
import type { JsonValue as DynamicValue } from '@/types/json'

export type OpencodeConfigPanelContext = {
  ensureJsonBuffer: (
    id: string,
    get: () => DynamicValue,
    set: (value: DynamicValue) => void,
    fallback: DynamicValue,
  ) => { text: string; error: string | null }
  setOrClear: (path: string, value: DynamicValue) => void
  // This context is used as a shared bag of refs and helpers for many SFCs.
  // Keep it flexible so UI helpers (e.g. i18n t()) can be provided.
  [k: string]: any
}

const OpencodeConfigPanelContextKey: InjectionKey<OpencodeConfigPanelContext> = Symbol('OpencodeConfigPanelContext')

export function provideOpencodeConfigPanelContext(ctx: OpencodeConfigPanelContext) {
  provide(OpencodeConfigPanelContextKey, ctx)
}

export function useOpencodeConfigPanelContext<T = OpencodeConfigPanelContext>(): T {
  const ctx = inject(OpencodeConfigPanelContextKey, null)
  if (!ctx) {
    throw new Error('OpencodeConfigPanelContext not provided')
  }
  return ctx as T
}
