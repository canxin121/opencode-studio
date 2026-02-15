<script lang="ts">
import { defineComponent } from 'vue'
import { RiCheckLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Tooltip,
    RiCheckLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">Permission rules (advanced JSON)</span>
    <textarea
      v-model="
        ensureJsonBuffer(
          'permission',
          () => getPath(draft, 'permission'),
          (val) => setOrClear('permission', val),
          {},
        ).text
      "
      rows="6"
      class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
    />
    <div class="flex items-center gap-2">
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-8 w-8"
          title="Apply"
          aria-label="Apply JSON"
          @click="applyJsonBuffer('permission')"
        >
          <RiCheckLine class="h-4 w-4" />
        </Button>
        <template #content>Apply</template>
      </Tooltip>
      <span
        v-if="
          ensureJsonBuffer(
            'permission',
            () => getPath(draft, 'permission'),
            (val) => setOrClear('permission', val),
            {},
          ).error
        "
        class="text-xs text-destructive"
      >
        {{
          ensureJsonBuffer(
            'permission',
            () => getPath(draft, 'permission'),
            (val) => setOrClear('permission', val),
            {},
          ).error
        }}
      </span>
    </div>
  </div>
</template>
