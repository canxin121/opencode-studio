<script lang="ts">
import { defineComponent } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

import PermissionBulkPanel from '../permissions/PermissionBulkPanel.vue'
import PermissionCustomRulesPanel from '../permissions/PermissionCustomRulesPanel.vue'
import PermissionJsonEditorsPanel from '../permissions/PermissionJsonEditorsPanel.vue'
import PermissionPresetsPanel from '../permissions/PermissionPresetsPanel.vue'
import PermissionRulesPanel from '../permissions/PermissionRulesPanel.vue'
import PermissionTestPanel from '../permissions/PermissionTestPanel.vue'

export default defineComponent({
  components: {
    Button,
    Tooltip,
    PermissionBulkPanel,
    PermissionCustomRulesPanel,
    PermissionJsonEditorsPanel,
    PermissionPresetsPanel,
    PermissionRulesPanel,
    PermissionTestPanel,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiRestartLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <section id="permissions" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">{{ t('settings.opencodeConfig.sections.permissions.title') }}</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('permissions')"
          >
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.common.resetSection') }}</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="
              isSectionOpen('permissions')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('permissions')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('permissions')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('permissions')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('permissions')" class="grid gap-4">
      <PermissionPresetsPanel />
      <PermissionBulkPanel />
      <PermissionTestPanel />
      <PermissionRulesPanel />
      <PermissionCustomRulesPanel />
      <PermissionJsonEditorsPanel />
    </div>
  </section>
</template>
