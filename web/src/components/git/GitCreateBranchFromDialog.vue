<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  open: boolean
  branchName: string
  startPoint: string
  checkoutAfterCreate: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:branchName', value: string): void
  (e: 'update:startPoint', value: string): void
  (e: 'update:checkoutAfterCreate', value: boolean): void
  (e: 'create'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'branchName' | 'startPoint', v: string | number) {
  const s = String(v)
  if (key === 'branchName') emit('update:branchName', s)
  if (key === 'startPoint') emit('update:startPoint', s)
}

function onUpdateCheckout(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:checkoutAfterCreate', Boolean(el?.checked))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Create Branch From"
    description="Create a branch at a specific ref"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">Branch name</div>
        <Input
          :model-value="branchName"
          class="h-9 font-mono text-xs"
          placeholder="feature/foo"
          @update:model-value="(v) => onUpdateText('branchName', v)"
        />
      </div>
      <div class="grid gap-1">
        <div class="text-xs font-medium text-muted-foreground">Start point</div>
        <Input
          :model-value="startPoint"
          class="h-9 font-mono text-xs"
          placeholder="HEAD"
          @update:model-value="(v) => onUpdateText('startPoint', v)"
        />
      </div>
      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input :checked="checkoutAfterCreate" type="checkbox" class="accent-primary" @change="onUpdateCheckout" />
        <span>Checkout branch after create</span>
      </label>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">Cancel</Button>
        <Button size="sm" :disabled="!branchName.trim()" @click="$emit('create')">Create</Button>
      </div>
    </div>
  </FormDialog>
</template>
