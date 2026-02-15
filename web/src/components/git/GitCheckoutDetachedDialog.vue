<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  detachedRef: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:detachedRef', value: string): void
  (e: 'checkout'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateRef(v: string | number) {
  emit('update:detachedRef', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Checkout Detached"
    description="Checkout a ref in detached HEAD state"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <Input
        :model-value="detachedRef"
        class="h-9 font-mono text-xs"
        placeholder="HEAD~1"
        @update:model-value="onUpdateRef"
      />
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">Cancel</Button>
        <Button size="sm" :disabled="!detachedRef.trim()" @click="$emit('checkout')">Checkout</Button>
      </div>
    </div>
  </FormDialog>
</template>
