import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export type ToastAction = {
  label: string
  onClick: () => void
}

export type Toast = {
  id: string
  kind: ToastKind
  message: string
  createdAt: number
  timeoutMs: number
  action?: ToastAction
}

function id() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const useToastsStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([])

  const visible = computed(() => items.value)

  function push(kind: ToastKind, message: string, timeoutMs = 2500, action?: ToastAction) {
    const toast: Toast = {
      id: id(),
      kind,
      message,
      createdAt: Date.now(),
      timeoutMs,
      action,
    }
    items.value = [toast, ...items.value].slice(0, 4)
    if (toast.timeoutMs > 0) {
      window.setTimeout(() => dismiss(toast.id), toast.timeoutMs)
    }
  }

  function dismiss(toastId: string) {
    items.value = items.value.filter((t) => t.id !== toastId)
  }

  return { visible, push, dismiss }
})
