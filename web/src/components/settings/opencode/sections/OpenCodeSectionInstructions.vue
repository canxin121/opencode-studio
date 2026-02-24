<script lang="ts">
import { defineComponent } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import StringListEditor from '../StringListEditor.vue'
import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Tooltip,
    StringListEditor,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRestartLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <section id="instructions" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.instructions.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('instructions')"
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
              isSectionOpen('instructions')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('instructions')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('instructions')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('instructions')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('instructions')" class="grid gap-4">
      <div class="rounded-md border border-border p-3 space-y-3">
        <div class="text-sm font-semibold">
          {{ t('settings.opencodeConfig.sections.instructions.groups.sourcesTitle') }}
        </div>
        <div class="text-[11px] text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.instructions.groups.sourcesHelp') }}
        </div>

        <div class="rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">
              {{ t('settings.opencodeConfig.sections.instructions.panels.instructionsTitle') }}
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('common.clear')"
                :aria-label="t('settings.opencodeConfig.sections.instructions.actions.clearInstructionsAria')"
                @click="instructionsArr = []"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.clear') }}</template>
            </Tooltip>
          </div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.instructions.panels.instructionsHelp') }}
          </div>
          <StringListEditor
            v-model="instructionsArr"
            :empty-text="t('settings.opencodeConfig.sections.instructions.empty.instructions')"
            :show-inline-adder="false"
            :advanced-default-open="true"
            advanced-first
            :advanced-label="t('settings.opencodeConfig.sections.instructions.labels.instructionsAdvanced')"
            :advanced-placeholder="t('settings.opencodeConfig.sections.instructions.placeholders.instructions')"
          />
        </div>
      </div>

      <div class="rounded-md border border-border p-3 space-y-3">
        <div class="text-sm font-semibold">
          {{ t('settings.opencodeConfig.sections.instructions.groups.extensionsTitle') }}
        </div>
        <div class="text-[11px] text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.instructions.groups.extensionsHelp') }}
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-border p-3 space-y-2">
            <div class="flex items-center justify-between">
              <div class="text-sm font-semibold">
                {{ t('settings.opencodeConfig.sections.instructions.panels.skillsPathsTitle') }}
              </div>
              <Tooltip>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  :title="t('common.clear')"
                  :aria-label="t('settings.opencodeConfig.sections.instructions.actions.clearSkillsPathsAria')"
                  @click="skillsPathsArr = []"
                >
                  <RiCloseLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.clear') }}</template>
              </Tooltip>
            </div>
            <div class="text-[11px] text-muted-foreground">
              {{ t('settings.opencodeConfig.sections.instructions.panels.skillsPathsHelp') }}
            </div>
            <StringListEditor
              v-model="skillsPathsArr"
              :empty-text="t('settings.opencodeConfig.sections.instructions.empty.skillsPaths')"
              :show-inline-adder="false"
              :advanced-default-open="true"
              advanced-first
              :advanced-label="t('settings.opencodeConfig.sections.instructions.labels.skillsPathsAdvanced')"
              :advanced-placeholder="t('settings.opencodeConfig.sections.instructions.placeholders.skillsPath')"
            />
          </div>

          <div class="rounded-md border border-border p-3 space-y-2">
            <div class="flex items-center justify-between">
              <div class="text-sm font-semibold">
                {{ t('settings.opencodeConfig.sections.instructions.panels.pluginsTitle') }}
              </div>
              <Tooltip>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  :title="t('common.clear')"
                  :aria-label="t('settings.opencodeConfig.sections.instructions.actions.clearPluginsAria')"
                  @click="pluginsArr = []"
                >
                  <RiCloseLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.clear') }}</template>
              </Tooltip>
            </div>
            <div class="text-[11px] text-muted-foreground">
              {{ t('settings.opencodeConfig.sections.instructions.panels.pluginsHelp') }}
            </div>
            <StringListEditor
              v-model="pluginsArr"
              :empty-text="t('settings.opencodeConfig.sections.instructions.empty.plugins')"
              :show-inline-adder="false"
              :advanced-default-open="true"
              advanced-first
              :advanced-label="t('settings.opencodeConfig.sections.instructions.labels.pluginsAdvanced')"
              :advanced-placeholder="t('settings.opencodeConfig.sections.instructions.placeholders.plugin')"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
