<script lang="ts">
export { Toaster as Sonner } from 'vue-sonner'
</script>

<script setup lang="ts">
import { Toaster as Sonner } from 'vue-sonner'
import type { JsonValue } from '@/types/json'

type ToasterProps = {
  invert?: boolean
  theme?: 'light' | 'dark' | 'system'
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
  hotkey?: string[]
  richColors?: boolean
  expand?: boolean
  duration?: number
  gap?: number
  visibleToasts?: number
  closeButton?: boolean
  toastOptions?: Record<string, JsonValue>
  className?: string
  style?: Record<string, string | number>
  offset?: string | number
  dir?: 'rtl' | 'ltr' | 'auto'
}

withDefaults(defineProps<ToasterProps>(), {
  position: 'bottom-right',
  theme: 'system',
  richColors: true,
  closeButton: true,
})
</script>

<template>
  <Sonner
    class="toaster group"
    v-bind="$props"
    :toast-options="{
      classes: {
        toast:
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
  />
</template>
