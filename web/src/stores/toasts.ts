import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast, type ExternalToast } from 'vue-sonner'

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

const TOAST_DEDUPE_WINDOW_MS = 1500
const TOAST_PENDING_LIMIT = 24

type ToastId = string | number

type PendingToast = {
  kind: ToastKind
  message: string
  timeoutMs: number
  action?: ToastAction
}

function normalizeMessage(message: string) {
  return String(message || '').trim()
}

function normalizeTimeout(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs)) return 2500
  if (timeoutMs <= 0) return Number.POSITIVE_INFINITY
  return Math.max(200, timeoutMs)
}

export const useToastsStore = defineStore('toasts', () => {
  const hostReady = ref(false)
  const recentByKey = new Map<string, number>()
  const toastIdByKey = new Map<string, ToastId>()
  const pendingBeforeHostReady = ref<PendingToast[]>([])

  const isHostReady = computed(() => hostReady.value)

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

  function showToast(kind: ToastKind, message: string, timeoutMs: number, action?: ToastAction): ToastId {
    const options: ExternalToast = {
      duration: normalizeTimeout(timeoutMs),
    }

    if (action) {
      options.action = {
        label: action.label,
        onClick: action.onClick,
      }
    }

    if (kind === 'error') return toast.error(message, options)
    if (kind === 'success') return toast.success(message, options)
    return toast.info(message, options)
  }

  function push(kind: ToastKind, message: string, timeoutMs = 2500, action?: ToastAction) {
    const normalizedMessage = normalizeMessage(message)
    if (!normalizedMessage) return

    const now = Date.now()
    const key = toastKey(kind, normalizedMessage)
    trimRecent(now)

    const lastSeenAt = recentByKey.get(key) || 0
    if (now - lastSeenAt < TOAST_DEDUPE_WINDOW_MS) {
      recentByKey.set(key, now)
      return
    }

    recentByKey.set(key, now)

    if (!hostReady.value) {
      const next = [...pendingBeforeHostReady.value, { kind, message: normalizedMessage, timeoutMs, action }]
      pendingBeforeHostReady.value = next.slice(-TOAST_PENDING_LIMIT)
      return
    }

    const prev = toastIdByKey.get(key)
    if (prev) {
      toast.dismiss(prev)
    }

    const toastId = showToast(kind, normalizedMessage, timeoutMs, action)
    toastIdByKey.set(key, toastId)
  }

  function dismiss(toastId: ToastId) {
    toast.dismiss(toastId)
  }

  function markHostReady() {
    if (hostReady.value) return
    hostReady.value = true
    const queue = [...pendingBeforeHostReady.value]
    pendingBeforeHostReady.value = []
    for (const item of queue) {
      const key = toastKey(item.kind, item.message)
      const prev = toastIdByKey.get(key)
      if (prev) {
        toast.dismiss(prev)
      }
      const toastId = showToast(item.kind, item.message, item.timeoutMs, item.action)
      toastIdByKey.set(key, toastId)
    }
  }

  return { isHostReady, push, dismiss, markHostReady }
})
