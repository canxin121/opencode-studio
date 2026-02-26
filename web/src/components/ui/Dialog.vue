<script setup lang="ts">
import { DialogRoot, DialogContent, DialogOverlay, DialogPortal, DialogTitle, DialogDescription } from 'radix-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiCloseLine } from '@remixicon/vue'
import { cn } from '@/lib/utils'
import IconButton from '@/components/ui/IconButton.vue'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  open: boolean
  title?: string
  description?: string
  maxWidth?: string
  mobileFullscreen?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:open', value: boolean): void
}>()

function close() {
  emit('close')
  emit('update:open', false)
}

const { t } = useI18n()
const ui = useUiStore()

const contentClass = computed(() =>
  cn(
    props.mobileFullscreen
      ? 'fixed inset-0 z-[71] pointer-events-auto grid h-[100dvh] w-screen min-w-0 gap-4 rounded-none border-0 bg-background/95 p-4 shadow-2xl backdrop-blur duration-200 overflow-y-auto overflow-x-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:left-[50%] sm:top-[50%] sm:inset-auto sm:w-full sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:border sm:border-border/70 sm:p-6 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]'
      : 'fixed left-[50%] top-[50%] z-[71] pointer-events-auto grid w-[calc(100vw-2rem)] min-w-0 translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur duration-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:w-full sm:max-h-[calc(100dvh-3rem)] sm:p-6',
    props.maxWidth || 'max-w-lg',
  ),
)
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[70] pointer-events-auto bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent :class="contentClass">
        <div class="absolute right-3 top-3">
          <IconButton
            variant="ghost"
            size="md"
            class="h-8 w-8"
            :tooltip="t('common.close')"
            :is-mobile-pointer="ui.isMobilePointer"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <RiCloseLine class="h-4.5 w-4.5" />
          </IconButton>
        </div>

        <div class="flex flex-col space-y-1.5 text-center sm:text-left min-w-0" v-if="title || description">
          <DialogTitle v-if="title" class="text-lg font-semibold leading-none tracking-tight break-words">{{
            title
          }}</DialogTitle>
          <!-- Paths / slugs can be long unbroken strings on mobile; force wrapping to avoid overflow. -->
          <DialogDescription v-if="description" class="text-sm text-muted-foreground break-all">{{
            description
          }}</DialogDescription>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
