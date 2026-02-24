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

const TOAST_MAX_VISIBLE = 4
const TOAST_DEDUPE_WINDOW_MS = 1500

export const useToastsStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([])
  const recentByKey = new Map<string, number>()
  const dismissTimerById = new Map<string, number>()

  const visible = computed(() => items.value)

  function toastKey(kind: ToastKind, message: string): string {
    return `${kind}:${message.trim()}`
  }

  function trimRecent(now: number) {
    for (const [key, seenAt] of recentByKey.entries()) {
      if (now - seenAt > TOAST_DEDUPE_WINDOW_MS * 4) {
        recentByKey.delete(key)
      }
    }
  }

  function armDismissTimer(toastId: string, timeoutMs: number) {
    const prev = dismissTimerById.get(toastId)
    if (typeof prev === 'number') {
      window.clearTimeout(prev)
      dismissTimerById.delete(toastId)
    }
    if (timeoutMs <= 0) return
    const timer = window.setTimeout(() => dismiss(toastId), timeoutMs)
    dismissTimerById.set(toastId, timer)
  }

  function push(kind: ToastKind, message: string, timeoutMs = 2500, action?: ToastAction) {
    const now = Date.now()
    const key = toastKey(kind, message)
    trimRecent(now)

    const existing = items.value.find((toast) => toast.kind === kind && toast.message === message)
    if (existing) {
      recentByKey.set(key, now)
      if (action) {
        items.value = items.value.map((toast) => (toast.id === existing.id ? { ...toast, action } : toast))
      }
      armDismissTimer(existing.id, timeoutMs)
      return
    }

    const lastSeenAt = recentByKey.get(key) || 0
    if (now - lastSeenAt < TOAST_DEDUPE_WINDOW_MS) {
      recentByKey.set(key, now)
      return
    }

    recentByKey.set(key, now)
    const toast: Toast = {
      id: id(),
      kind,
      message,
      createdAt: now,
      timeoutMs,
      action,
    }
    const nextItems = [toast, ...items.value].slice(0, TOAST_MAX_VISIBLE)
    for (const stale of items.value) {
      if (nextItems.some((item) => item.id === stale.id)) continue
      const timer = dismissTimerById.get(stale.id)
      if (typeof timer === 'number') {
        window.clearTimeout(timer)
        dismissTimerById.delete(stale.id)
      }
    }
    items.value = nextItems
    armDismissTimer(toast.id, toast.timeoutMs)
  }

  function dismiss(toastId: string) {
    const timer = dismissTimerById.get(toastId)
    if (typeof timer === 'number') {
      window.clearTimeout(timer)
      dismissTimerById.delete(toastId)
    }
    items.value = items.value.filter((t) => t.id !== toastId)
  }

  return { visible, push, dismiss }
})
