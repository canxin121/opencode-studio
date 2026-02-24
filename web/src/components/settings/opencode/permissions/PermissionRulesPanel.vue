<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiRestartLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    RiAddLine,
    RiArrowDownLine,
    RiArrowUpLine,
    RiCheckLine,
    RiCloseLine,
    RiDeleteBinLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    const permissionRulePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.permissions.rules.options.default') },
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.rules.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.rules.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.rules.options.deny') },
      { value: 'pattern', label: t('settings.opencodeConfig.sections.permissions.rules.options.patternMap') },
    ])

    const permissionActionPickerOptions = computed<PickerOption[]>(() => [
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.rules.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.rules.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.rules.options.deny') },
    ])

    return Object.assign(ctx, { permissionRulePickerOptions, permissionActionPickerOptions })
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.rules.title') }}</span>
    <div v-for="(group, gi) in permissionQuickGroups" :key="`perm-group:${gi}`" class="grid gap-3">
      <div class="grid gap-3 lg:grid-cols-3">
        <label v-for="item in group" :key="`perm:${item.key}`" class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ item.label }}</span>
          <OptionPicker
            :model-value="permissionRuleValue(item.key)"
            @update:model-value="(v) => onPermissionSelectChange(item.key, String(v || ''))"
            :options="permissionRulePickerOptions"
            :title="t('settings.opencodeConfig.sections.permissions.rules.fields.permission')"
            :search-placeholder="t('settings.opencodeConfig.sections.permissions.rules.search.searchRules')"
            :include-empty="false"
          />
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="text-[11px] text-muted-foreground hover:text-foreground"
              @click="togglePermissionPatternEditor(item.key)"
              :disabled="permissionRuleValue(item.key) !== 'pattern'"
            >
              {{ t('settings.opencodeConfig.sections.permissions.rules.actions.editPatterns') }}
            </button>
            <span v-if="permissionRuleValue(item.key) === 'pattern'" class="text-[11px] text-muted-foreground"
              >{{ t('settings.opencodeConfig.sections.permissions.rules.rulesCount', { count: permissionPatternCount(item.key) }) }}</span
            >
          </div>

          <div
            v-if="permissionPatternEditors[item.key]?.open"
            class="mt-2 rounded-md border border-border p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <div class="font-mono text-xs break-all">{{
                t('settings.opencodeConfig.sections.permissions.rules.patternMapTitle', { key: item.key })
              }}</div>
              <div class="flex items-center gap-2">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-8 w-8"
                    :title="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                    :aria-label="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                    @click="addPatternRow(item.key)"
                  >
                    <RiAddLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern') }}</template>
                </Tooltip>
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('common.reset')"
                    :aria-label="t('common.reset')"
                    @click="resetPermissionPatternEditor(item.key)"
                  >
                    <RiRestartLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('common.reset') }}</template>
                </Tooltip>
                <Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('common.close')"
                    :aria-label="t('common.close')"
                    @click="togglePermissionPatternEditor(item.key)"
                  >
                    <RiCloseLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('common.close') }}</template>
                </Tooltip>
              </div>
            </div>

            <div class="grid gap-2">
              <div
                v-for="(row, idx) in permissionPatternEditors[item.key]?.entries || []"
                :key="`row:${item.key}:${idx}`"
                class="grid gap-2 lg:grid-cols-[1fr_160px_auto] items-center"
              >
                <Input
                  v-model="row.pattern"
                  :placeholder="t('settings.opencodeConfig.sections.permissions.rules.placeholders.pattern')"
                  class="font-mono"
                  @keydown="onPermissionPatternKeydown(item.key, idx, row, $event as KeyboardEvent)"
                />
                <OptionPicker
                  v-model="row.action"
                  :options="permissionActionPickerOptions"
                  :title="t('settings.opencodeConfig.sections.permissions.rules.fields.action')"
                  :search-placeholder="t('settings.opencodeConfig.sections.permissions.rules.search.searchActions')"
                  :include-empty="false"
                />
                <div class="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('common.moveUp')"
                    :aria-label="t('common.moveUp')"
                    @click="movePatternRow(item.key, idx, -1)"
                  >
                    <RiArrowUpLine class="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8"
                    :title="t('common.moveDown')"
                    :aria-label="t('common.moveDown')"
                    @click="movePatternRow(item.key, idx, 1)"
                  >
                    <RiArrowDownLine class="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost-destructive"
                    class="h-8 w-8"
                    :title="t('common.remove')"
                    :aria-label="t('common.remove')"
                    @click="removePatternRow(item.key, idx)"
                  >
                    <RiDeleteBinLine class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-8 w-8"
                  :title="t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns')"
                  :aria-label="t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns')"
                  @click="applyPermissionPatternEditor(item.key)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns') }}</template>
              </Tooltip>
              <span v-if="permissionPatternEditors[item.key]?.error" class="text-xs text-destructive">{{
                permissionPatternEditors[item.key]?.error
              }}</span>
              <span v-else class="text-[11px] text-muted-foreground">{{
                t('settings.opencodeConfig.sections.permissions.rules.help.orderMatters')
              }}</span>
            </div>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>
