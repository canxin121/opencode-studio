<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import PathPicker from '@/components/ui/PathPicker.vue'

const props = defineProps<{
  open: boolean
  path: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:path', v: string): void
  (e: 'add'): void
}>()

const pathModel = computed({
  get: () => props.path,
  set: (v: string) => emit('update:path', v),
})
</script>

<template>
  <FormDialog
    :open="open"
    title="Add Directory"
    description="Add another directory path"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <PathPicker
        v-model="pathModel"
        placeholder="/path/to/directory"
        view="browser"
        mode="directory"
        :resolve-to-absolute="true"
        :show-options="true"
        :show-gitignored="true"
        input-class="h-9 font-mono"
        browser-class="flex h-[min(56vh,34rem)] min-h-[14rem] flex-col"
      />
      <div class="flex items-center justify-end gap-2 flex-none">
        <Button variant="ghost" @click="emit('update:open', false)">
          <RiCloseLine class="h-4 w-4" />
          Cancel
        </Button>
        <Button @click="emit('add')" :disabled="!pathModel.trim()">Add</Button>
      </div>
    </div>
  </FormDialog>
</template>
