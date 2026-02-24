<script setup lang="ts">
import { useToastsStore } from '../stores/toasts'
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import Sonner from './ui/Sonner.vue'

const store = useToastsStore()

const shown = new Set<string>()

watch(
  store.visible,
  (items) => {
    // Keep memory bounded: forget ids that are no longer visible.
    const currentIds = new Set(items.map((t) => t.id))
    for (const id of shown) {
      if (!currentIds.has(id)) shown.delete(id)
    }

    // `items` is newest-first; show oldest-first so messages feel ordered.
    for (const t of [...items].reverse()) {
      if (shown.has(t.id)) continue
      shown.add(t.id)

      const duration = t.timeoutMs > 0 ? t.timeoutMs : Number.POSITIVE_INFINITY
      const opts: {
        duration: number
        action?: {
          label: string
          onClick: () => void
        }
      } = { duration }
      if (t.action) {
        opts.action = {
          label: t.action.label,
          onClick: () => {
            try {
              t.action?.onClick()
            } finally {
              store.dismiss(t.id)
            }
          },
        }
      }
      switch (t.kind) {
        case 'error':
          toast.error(t.message, opts)
          break
        case 'success':
          toast.success(t.message, opts)
          break
        case 'info':
          toast.info(t.message, opts)
          break
        default:
          toast(t.message, opts)
      }
    }
  },
  { deep: true, immediate: true },
)
</script>

<template>
  <Sonner />
</template>
