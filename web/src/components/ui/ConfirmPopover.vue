<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'radix-vue'
import { RiCheckLine, RiCloseLine, RiDeleteBinLine, RiLoader4Line } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    open?: boolean | null
    title?: string
    description?: string
    confirmText?: string
    cancelText?: string
    variant?: 'default' | 'destructive'
    anchorToCursor?: boolean
    forceDialog?: boolean
    maxWidth?: string
    closeOnConfirm?: boolean
    closeOnCancel?: boolean
    confirmDisabled?: boolean
    cancelDisabled?: boolean
    busy?: boolean
  }>(),
  {
    open: null,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default',
    anchorToCursor: true,
    forceDialog: false,
    maxWidth: 'max-w-[calc(100vw-2rem)] sm:max-w-sm',
    closeOnConfirm: true,
    closeOnCancel: true,
    confirmDisabled: false,
    cancelDisabled: false,
    busy: false,
  },
)

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'update:open', value: boolean): void
}>()

const ui = useUiStore()
const slots = useSlots()

const hasTrigger = computed(() => Boolean(slots.default))
const useDialog = computed(() => props.forceDialog || ui.isMobilePointer || !hasTrigger.value)

const openInternal = ref(false)
const isOpenControlled = computed(() => props.open !== null && props.open !== undefined)
const openModel = computed({
  get: () => (isOpenControlled.value ? (props.open as boolean) : openInternal.value),
  set: (next: boolean) => {
    if (!isOpenControlled.value) openInternal.value = next
    emit('update:open', next)
  },
})

const confirmButtonVariant = computed(() => (props.variant === 'destructive' ? 'destructive' : 'default'))
const confirmButtonDisabled = computed(() => props.confirmDisabled || props.busy)

const anchorRect = ref<DOMRect | null>(null)
const virtualRef = computed(() => {
  if (!anchorRect.value) return undefined
  return {
    getBoundingClientRect: () => anchorRect.value!,
  }
})

function pointRect(clientX: number, clientY: number): DOMRect {
  return {
    width: 0,
    height: 0,
    top: clientY,
    left: clientX,
    bottom: clientY,
    right: clientX,
    x: clientX,
    y: clientY,
    toJSON: () => {},
  } as DOMRect
}

function elementRect(el: HTMLElement): DOMRect {
  const rect = el.getBoundingClientRect()
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
    x: rect.x,
    y: rect.y,
    toJSON: () => {},
  } as DOMRect
}

function setAnchorFromTrigger(target: EventTarget | null) {
  if (!props.anchorToCursor || useDialog.value) return
  if (!(target instanceof HTMLElement)) return
  anchorRect.value = elementRect(target)
}

function setOpen(next: boolean) {
  openModel.value = next
}

function onTriggerPointerEnter(event: PointerEvent) {
  setAnchorFromTrigger(event.currentTarget)
}

function onTriggerFocus(event: FocusEvent) {
  setAnchorFromTrigger(event.currentTarget)
}

function onTriggerPointerDown(event: PointerEvent) {
  if (!props.anchorToCursor || useDialog.value) return

  // Anchor the desktop popover to cursor coordinates so it stays stable even
  // if the trigger element shifts due to hover state changes.
  anchorRect.value = pointRect(event.clientX, event.clientY)
}

function onCancel() {
  emit('cancel')
  if (props.closeOnCancel) setOpen(false)
}

function onConfirm() {
  if (confirmButtonDisabled.value) return
  emit('confirm')
  if (props.closeOnConfirm) setOpen(false)
}
</script>

<template>
  <DialogRoot v-if="useDialog" :open="openModel" @update:open="setOpen">
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[80] pointer-events-auto bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        :class="
          cn(
            'fixed left-[50%] top-[50%] z-[81] pointer-events-auto grid w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border/70 bg-background/95 p-6 shadow-2xl backdrop-blur duration-200 max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:w-full sm:max-h-[calc(100dvh-3rem)] outline-none',
            maxWidth,
          )
        "
      >
        <div v-if="title || description" class="flex flex-col space-y-1.5 text-center sm:text-left min-w-0">
          <DialogTitle v-if="title" class="text-lg font-semibold leading-none tracking-tight break-words">{{
            title
          }}</DialogTitle>
          <DialogDescription v-if="description" class="text-sm text-muted-foreground break-all">{{
            description
          }}</DialogDescription>
        </div>

        <div v-if="$slots.content" class="space-y-3">
          <slot name="content" />
        </div>

        <div class="grid gap-2">
          <Button variant="secondary" class="w-full" :disabled="cancelDisabled" @click="onCancel">
            <RiCloseLine class="h-4 w-4 mr-2" />
            {{ cancelText }}
          </Button>
          <Button :variant="confirmButtonVariant" class="w-full" :disabled="confirmButtonDisabled" @click="onConfirm">
            <RiLoader4Line v-if="busy" class="h-4 w-4 mr-2 animate-spin" />
            <RiDeleteBinLine v-else-if="variant === 'destructive'" class="h-4 w-4 mr-2" />
            <RiCheckLine v-else class="h-4 w-4 mr-2" />
            {{ confirmText }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <PopoverRoot v-else :open="openModel" @update:open="setOpen">
    <PopoverTrigger
      as-child
      @pointerenter="onTriggerPointerEnter"
      @focus="onTriggerFocus"
      @pointerdown="onTriggerPointerDown"
    >
      <slot />
    </PopoverTrigger>

    <PopoverAnchor
      v-if="anchorToCursor && virtualRef"
      :virtual-ref="virtualRef"
      class="absolute w-0 h-0 overflow-hidden"
      aria-hidden="true"
    />

    <PopoverPortal>
      <PopoverContent
        :class="
          cn(
            'z-[80] w-64 rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur outline-none overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          )
        "
        side="bottom"
        align="start"
        :side-offset="5"
        :collision-padding="10"
      >
        <div v-if="title || description" class="p-2 border-b border-border/60">
          <div v-if="title" class="text-xs font-semibold text-foreground px-1 mb-0.5">{{ title }}</div>
          <p v-if="description" class="text-[11px] leading-snug text-muted-foreground px-1">
            {{ description }}
          </p>
        </div>

        <div v-if="$slots.content" class="p-2 border-b border-border/60">
          <slot name="content" />
        </div>

        <div class="p-1 space-y-0.5">
          <button
            type="button"
            class="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-secondary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:pointer-events-none"
            :class="variant === 'destructive' ? 'text-destructive hover:bg-destructive/10' : 'text-foreground'"
            :disabled="confirmButtonDisabled"
            @click="onConfirm"
          >
            <RiLoader4Line v-if="busy" class="h-4 w-4 animate-spin" />
            <RiDeleteBinLine v-else-if="variant === 'destructive'" class="h-4 w-4" />
            <RiCheckLine v-else class="h-4 w-4" />
            {{ confirmText }}
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:pointer-events-none"
            :disabled="cancelDisabled"
            @click="onCancel"
          >
            <RiCloseLine class="h-4 w-4" />
            {{ cancelText }}
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
