<script setup lang="ts">
import { computed } from 'vue'
import { RiRefreshLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import IconButton from '@/components/ui/IconButton.vue'
import SearchInput from '@/components/ui/SearchInput.vue'

const props = withDefaults(
  defineProps<{
    query?: string
    loading?: boolean
    isTouchPointer?: boolean
  }>(),
  {
    query: '',
    loading: false,
    isTouchPointer: false,
  },
)

const emit = defineEmits<{
  (e: 'update:query', value: string): void
  (e: 'submit-query'): void
  (e: 'refresh'): void
}>()

const { t } = useI18n()
const isTouchPointer = computed(() => Boolean(props.isTouchPointer))
</script>

<template>
  <div class="h-9 flex-shrink-0 select-none pl-3.5 pr-2 pt-1">
    <div class="flex h-full items-center justify-between gap-2">
      <div class="min-w-0 flex items-center gap-2">
        <p class="typography-ui-label font-medium text-muted-foreground">
          {{ t('settings.title') }}
        </p>
      </div>

      <div class="flex items-center gap-1">
        <IconButton
          :tooltip="String(t('settings.refresh'))"
          :title="String(t('settings.refreshAria'))"
          :aria-label="String(t('settings.refreshAria'))"
          :is-touch-pointer="isTouchPointer"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <RiRefreshLine class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
        </IconButton>
      </div>
    </div>
  </div>

  <div class="flex-shrink-0 px-3 py-2">
    <SearchInput
      :model-value="query"
      class="text-xs"
      input-class="h-8 text-xs"
      :placeholder="String(t('common.search'))"
      :input-aria-label="String(t('common.search'))"
      :input-title="String(t('common.search'))"
      :search-aria-label="String(t('common.search'))"
      :search-title="String(t('common.search'))"
      :clear-aria-label="String(t('common.clear'))"
      :clear-title="String(t('common.clear'))"
      :is-touch-pointer="isTouchPointer"
      @update:model-value="(value) => emit('update:query', String(value || ''))"
      @search="emit('submit-query')"
      @clear="emit('submit-query')"
    />
  </div>
</template>
