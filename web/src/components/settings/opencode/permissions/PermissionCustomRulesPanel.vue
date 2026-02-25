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
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
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

    const toolIdPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.toolIdOptions) ? ctx.toolIdOptions : []
      return (list as string[]).map((id) => ({ value: id, label: id }))
    })

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

    const newPermissionActionPickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.permissions.rules.options.default') },
      { value: 'allow', label: t('settings.opencodeConfig.sections.permissions.rules.options.allow') },
      { value: 'ask', label: t('settings.opencodeConfig.sections.permissions.rules.options.ask') },
      { value: 'deny', label: t('settings.opencodeConfig.sections.permissions.rules.options.deny') },
    ])

    return Object.assign(ctx, {
      toolIdPickerOptions,
      permissionRulePickerOptions,
      permissionActionPickerOptions,
      newPermissionActionPickerOptions,
    })
  },
})
</script>

<template>
  <div class="grid gap-2">
    <span class="text-xs text-muted-foreground">{{
      t('settings.opencodeConfig.sections.permissions.customRules.title')
    }}</span>
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-[220px] flex-1 max-w-[520px]">
        <OptionPicker
          v-model="newPermissionTool"
          :options="toolIdPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.customRules.fields.toolId')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.customRules.search.searchTools')"
          :empty-label="t('settings.opencodeConfig.sections.permissions.customRules.placeholders.selectTool')"
          monospace
        />
      </div>
      <div class="w-[180px]">
        <OptionPicker
          v-model="newPermissionAction"
          :options="newPermissionActionPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.customRules.fields.action')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.customRules.search.searchActions')"
          :include-empty="false"
        />
      </div>
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-9 w-9"
          :title="t('settings.opencodeConfig.sections.permissions.customRules.actions.addRule')"
          :aria-label="t('settings.opencodeConfig.sections.permissions.customRules.actions.addRule')"
          @click="addCustomPermissionRule"
          :disabled="!newPermissionTool"
        >
          <RiAddLine class="h-4 w-4" />
        </Button>
        <template #content>{{
          t('settings.opencodeConfig.sections.permissions.customRules.actions.addRule')
        }}</template>
      </Tooltip>
    </div>

    <div v-if="toolIdsError" class="text-[11px] text-muted-foreground break-all">
      {{ t('settings.opencodeConfig.sections.permissions.customRules.toolIdsUnavailable', { error: toolIdsError }) }}
    </div>

    <div v-if="customPermissionKeys.length === 0" class="text-xs text-muted-foreground">
      {{ t('settings.opencodeConfig.sections.permissions.customRules.empty') }}
    </div>
    <div v-else class="grid gap-2">
      <div
        v-for="key in customPermissionKeys"
        :key="`perm:${key}`"
        class="rounded-md border border-border p-3 space-y-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs break-all">{{ key }}</span>
          <div class="w-[200px]">
            <OptionPicker
              :model-value="permissionRuleValue(key)"
              @update:model-value="(v) => onPermissionSelectChange(key, String(v || ''))"
              :options="permissionRulePickerOptions"
              :title="t('settings.opencodeConfig.sections.permissions.rules.fields.permission')"
              :search-placeholder="t('settings.opencodeConfig.sections.permissions.rules.search.searchRules')"
              :include-empty="false"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            @click="togglePermissionPatternEditor(key)"
            :disabled="permissionRuleValue(key) !== 'pattern'"
          >
            {{ t('settings.opencodeConfig.sections.permissions.rules.actions.editPatterns') }}
          </Button>
          <span v-if="permissionRuleValue(key) === 'pattern'" class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.permissions.rules.rulesCount', { count: permissionPatternCount(key) })
          }}</span>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              :title="t('common.remove')"
              :aria-label="t('common.remove')"
              @click="setPermissionRule(key, 'default')"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('common.remove') }}</template>
          </Tooltip>
        </div>

        <div v-if="permissionPatternEditors[key]?.open" class="grid gap-2">
          <div class="flex items-center justify-between">
            <div class="text-xs text-muted-foreground">
              {{ t('settings.opencodeConfig.sections.permissions.rules.patternMapLabel') }}
            </div>
            <div class="flex items-center gap-2">
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-8 w-8"
                  :title="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                  :aria-label="t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')"
                  @click="addPatternRow(key)"
                >
                  <RiAddLine class="h-4 w-4" />
                </Button>
                <template #content>{{
                  t('settings.opencodeConfig.sections.permissions.rules.actions.addPattern')
                }}</template>
              </Tooltip>
              <Tooltip>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  :title="t('common.reset')"
                  :aria-label="t('common.reset')"
                  @click="resetPermissionPatternEditor(key)"
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
                  @click="togglePermissionPatternEditor(key)"
                >
                  <RiCloseLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.close') }}</template>
              </Tooltip>
            </div>
          </div>

          <div class="grid gap-2">
            <div
              v-for="(row, idx) in permissionPatternEditors[key]?.entries || []"
              :key="`row:${key}:${idx}`"
              class="grid gap-2 lg:grid-cols-[1fr_160px_auto] items-center"
            >
              <Input
                v-model="row.pattern"
                :placeholder="t('settings.opencodeConfig.sections.permissions.rules.placeholders.pattern')"
                class="font-mono"
                @keydown="onPermissionPatternKeydown(key, idx, row, $event as KeyboardEvent)"
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
                  @click="movePatternRow(key, idx, -1)"
                >
                  <RiArrowUpLine class="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-8 w-8"
                  :title="t('common.moveDown')"
                  :aria-label="t('common.moveDown')"
                  @click="movePatternRow(key, idx, 1)"
                >
                  <RiArrowDownLine class="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost-destructive"
                  class="h-8 w-8"
                  :title="t('common.remove')"
                  :aria-label="t('common.remove')"
                  @click="removePatternRow(key, idx)"
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
                @click="applyPermissionPatternEditor(key)"
              >
                <RiCheckLine class="h-4 w-4" />
              </Button>
              <template #content>{{
                t('settings.opencodeConfig.sections.permissions.rules.actions.applyPatterns')
              }}</template>
            </Tooltip>
            <span v-if="permissionPatternEditors[key]?.error" class="text-xs text-destructive">{{
              permissionPatternEditors[key]?.error
            }}</span>
            <span v-else class="text-[11px] text-muted-foreground">{{
              t('settings.opencodeConfig.sections.permissions.rules.help.orderMatters')
            }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
